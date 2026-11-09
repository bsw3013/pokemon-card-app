// 카드 목록 화면용 썸네일(가로 300px WebP)을 public/thumbs/ 에 만든다.
// 이미 만들어진 썸네일은 건너뛰므로, 새 카드를 추가한 뒤 다시 실행하면 새 카드 것만 만든다.
//
// 사용법:
//   npm run thumbs              최신 카드 목록(Firestore)을 읽어 빠진 썸네일만 만든다
//   npm run thumbs -- --dry-run 만들지 않고 몇 장이 새로 필요한지만 보여준다
//   npm run thumbs -- --prune   어떤 카드에서도 쓰지 않는 썸네일 파일을 지운다
//   npm run thumbs -- --csv=database_backups/main_dataset.csv  Firestore 대신 CSV에서 목록을 읽는다
//
// 만든 뒤에는 public/thumbs 를 커밋해서 배포해야 사이트에 반영된다.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Papa from 'papaparse';
import { normalizeImageUrl, thumbFileName } from '../src/utils/thumbKey.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THUMB_DIR = path.join(REPO_ROOT, 'public', 'thumbs');
const PROJECT_ID = 'pokemoncard-0319';
const THUMB_WIDTH = 300;
const WEBP_QUALITY = 80;
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');
const csvArg = args.find((a) => a.startsWith('--csv='));

async function loadImageUrlsFromFirestore() {
  // pokemon_cards 는 누구나 읽을 수 있는 컬렉션이라 로그인 없이 REST로 읽는다.
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/pokemon_cards`;
  const urls = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '300', 'mask.fieldPaths': 'imageUrl' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${base}?${params}`);
    if (!res.ok) throw new Error(`Firestore 목록 읽기 실패: HTTP ${res.status}`);
    const json = await res.json();
    for (const d of json.documents || []) urls.push(d.fields?.imageUrl?.stringValue || '');
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return urls;
}

function loadImageUrlsFromCsv(csvPath) {
  const text = readFileSync(path.resolve(REPO_ROOT, csvPath), 'utf-8').replace(/^﻿/, '');
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data.map((r) => r.imageUrl || '');
}

async function makeThumb(url, dest) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-card-app-thumbnailer' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const input = Buffer.from(await res.arrayBuffer());
      const output = await sharp(input)
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      writeFileSync(dest, output);
      return output.length;
    } catch (err) {
      lastError = err;
      if (String(err.message).startsWith('HTTP 404')) break;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  const rawUrls = csvArg ? loadImageUrlsFromCsv(csvArg.slice('--csv='.length)) : await loadImageUrlsFromFirestore();
  const wanted = new Map();
  for (const raw of rawUrls) {
    const url = normalizeImageUrl(raw);
    const name = thumbFileName(url);
    if (name) wanted.set(name, url);
  }

  mkdirSync(THUMB_DIR, { recursive: true });
  const existing = new Set(readdirSync(THUMB_DIR).filter((f) => f.endsWith('.webp')));
  const todo = [...wanted].filter(([name]) => !existing.has(name));

  console.log(`카드 이미지 ${wanted.size}개 중 이미 썸네일 있음 ${wanted.size - todo.length}개, 새로 만들 것 ${todo.length}개`);

  if (prune) {
    const unused = [...existing].filter((f) => !wanted.has(f));
    console.log(`쓰이지 않는 썸네일 ${unused.length}개${dryRun ? ' (dry-run이라 지우지 않음)' : ' 삭제'}`);
    if (!dryRun) unused.forEach((f) => unlinkSync(path.join(THUMB_DIR, f)));
  }
  if (dryRun || todo.length === 0) return;

  let made = 0;
  let bytes = 0;
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const [name, url] = todo[next++];
      try {
        bytes += await makeThumb(url, path.join(THUMB_DIR, name));
        made += 1;
        if (made % 100 === 0) console.log(`  ${made}/${todo.length} 완료`);
      } catch (err) {
        failed.push(`${url} (${err.message})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`새로 만든 썸네일 ${made}개 (합계 ${(bytes / 1024 / 1024).toFixed(1)}MB), 실패 ${failed.length}개`);
  failed.forEach((f) => console.log(`  실패: ${f}`));
  if (existsSync(THUMB_DIR)) console.log('public/thumbs 를 커밋하고 배포하면 사이트에 반영됩니다.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
