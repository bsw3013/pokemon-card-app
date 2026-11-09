// 카드 도감(pokemon_cards)을 CSV로 백업하는 스크립트.
// 깃허브 Actions(.github/workflows/backup-cards.yml)가 매일 자동으로 실행하고,
// 결과 파일을 저장소에 커밋한다. 사이트(브라우저)에는 깃허브 토큰이 전혀 필요 없다.
//
// pokemon_cards 는 누구나 읽을 수 있는 공용 데이터라서 로그인·키 없이 Firestore REST API로 읽는다.
//
// 사용법: node scripts/backup-cards.mjs [저장할 파일 경로]
//   기본 저장 위치: database_backups/main_dataset.csv

import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

const PROJECT_ID = 'pokemoncard-0319';
const COLLECTION = 'pokemon_cards';
const OUT = process.argv[2] || 'database_backups/main_dataset.csv';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}`;

// Firestore REST 값 → 앱(웹 SDK)이 받는 것과 같은 일반 JS 값
function fromRest(value) {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromRest);
  if ('mapValue' in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = fromRest(v);
    return out;
  }
  return '';
}

async function fetchJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function fetchAllCards() {
  const rows = [];
  let pageToken = '';
  do {
    const url = `${BASE}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const json = await fetchJson(url);
    for (const d of json.documents || []) {
      const row = { raw_database_id: d.name.split('/').pop() };
      for (const [k, v] of Object.entries(d.fields || {})) row[k] = fromRest(v);
      rows.push(row);
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return rows;
}

const rows = await fetchAllCards();
if (rows.length === 0) {
  // 빈 결과로 기존 백업을 덮어쓰지 않도록 멈춘다.
  console.error('카드를 한 장도 읽지 못했습니다. 백업을 중단합니다.');
  process.exit(1);
}

// 마스터 설정의 예전 "깃허브 백업" 버튼과 같은 정렬·열 순서
rows.sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));
// 기존 백업 파일이 있으면 그 열 순서를 그대로 이어 써서, 바뀐 내용만 깃허브 기록에 보이게 한다.
const columns = new Set(['raw_database_id']);
if (fs.existsSync(OUT)) {
  const header = fs.readFileSync(OUT, 'utf8').replace(/^﻿/, '').split(/\r?\n/, 1)[0];
  Papa.parse(header).data[0]?.forEach((k) => k && columns.add(k));
}
const present = new Set(rows.flatMap((row) => Object.keys(row)));
[...columns].forEach((k) => { if (k !== 'raw_database_id' && !present.has(k)) columns.delete(k); });
rows.forEach((row) => Object.keys(row).forEach((k) => columns.add(k)));

const csv = '﻿' + Papa.unparse(rows, { columns: Array.from(columns) });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, csv);
console.log(`백업 완료: ${rows.length}장 → ${OUT}`);

// 세트·레어도 표(settings/catalog)도 같은 폴더에 JSON으로 함께 저장한다. (아직 없으면 건너뜀)
try {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/catalog`);
  if (res.ok) {
    const json = await res.json();
    const catalog = {};
    for (const [k, v] of Object.entries(json.fields || {})) catalog[k] = fromRest(v);
    const catalogPath = path.join(path.dirname(OUT), 'catalog.json');
    // 칸 순서를 항상 같게 정렬해서, 내용이 같으면 파일도 똑같이 나오게 한다.
    const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
    fs.writeFileSync(catalogPath, JSON.stringify(sortKeys(catalog), null, 2) + '\n');
    console.log(`세트·레어도 표 백업: 세트 ${catalog.sets?.length ?? 0}개, 레어도 ${catalog.rarities?.length ?? 0}개 → ${catalogPath}`);
  } else if (res.status !== 404) {
    console.warn(`세트·레어도 표를 읽지 못했습니다 (HTTP ${res.status}). 카드 백업은 정상입니다.`);
  }
} catch (err) {
  console.warn('세트·레어도 표 백업 실패 (카드 백업은 정상):', err.message);
}
