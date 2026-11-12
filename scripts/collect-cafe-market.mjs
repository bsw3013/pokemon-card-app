// MVP 카페(네이버 카페 cardmvk) 시세 후보 모으기.
// 깃허브 Actions(.github/workflows/market-cafe.yml)가 매일 새벽 실행한다.
//
// 1) 관리자의 관심 카드 목록(settings/marketTargets, 누구나 읽기 가능)을 읽고
// 2) 카드마다 검색어(별명 포함)로 네이버 공식 "카페글 검색 API"(NAVER API HUB)를 부른다.
// 3) MVP 카페 글만 골라 판매글/경매글/구매글 등으로 나누고 가격·언어·등급·마감일을 읽는다.
// 4) 지난번 결과(cafe.json)에 합쳐서 다시 저장한다. 같은 글은 한 번만, 고쳐진 제목·가격은 새 값으로.
//    결과 파일은 market-data 브랜치에 올라가고, 사이트가 jsDelivr로 읽어서 "후보"로 보여준다.
//
// 필요한 키(깃허브 저장소 Settings → Secrets → Actions):
//   NAVER_HUB_CLIENT_ID, NAVER_HUB_CLIENT_SECRET  (네이버 클라우드 콘솔 → NAVER API HUB → Application 인증 정보)
// 키가 없으면 아무것도 지우지 않고 "키 없음"만 기록하고 끝난다.
//
// 사용법: node scripts/collect-cafe-market.mjs <이전 cafe.json 경로(없어도 됨)> <저장할 경로>
//   TARGETS_FILE=파일.json 을 주면 Firestore 대신 그 파일에서 관심 카드 목록을 읽는다(시험용).

import fs from 'node:fs';
import path from 'node:path';
import { stripTags, findName, analyzePost, articleIdFromLink } from './lib/cafeParse.mjs';

const PROJECT_ID = 'pokemoncard-0319';
const API = 'https://naverapihub.apigw.ntruss.com/search/v1/cafearticle';
const PREV = process.argv[2] || '';
const OUT = process.argv[3] || 'cafe.json';
const MAX_CALLS = 900;          // 하루 무료 한도(25,000)보다 훨씬 적게
const PAUSE_MS = 250;
const KEEP_DAYS = { sale: 60, auction: 60, hidden: 21 };
const DEFAULT_CAFES = ['cardmvk'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fromRest(value) {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromRest);
  if ('mapValue' in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = fromRest(v);
    return out;
  }
  return null;
}

async function loadTargets() {
  if (process.env.TARGETS_FILE) return JSON.parse(fs.readFileSync(process.env.TARGETS_FILE, 'utf8'));
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/marketTargets`;
  const res = await fetch(url);
  if (res.status === 404) return { targets: [], cafes: DEFAULT_CAFES };
  if (!res.ok) throw new Error(`관심 카드 목록 읽기 실패 (HTTP ${res.status})`);
  const json = await res.json();
  const data = {};
  for (const [k, v] of Object.entries(json.fields || {})) data[k] = fromRest(v);
  return data;
}

function loadPrev() {
  try {
    if (PREV && fs.existsSync(PREV)) return JSON.parse(fs.readFileSync(PREV, 'utf8'));
  } catch (err) {
    console.warn('이전 결과를 못 읽었어요(새로 시작):', err.message);
  }
  return { candidates: {}, runs: [] };
}

function save(data) {
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(data)}\n`);
}

let calls = 0;
async function search(query) {
  if (calls >= MAX_CALLS) throw new Error('오늘 호출 한도에 닿았어요');
  calls += 1;
  const url = `${API}?query=${encodeURIComponent(query)}&display=100&sort=date`;
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': process.env.NAVER_HUB_CLIENT_ID || '',
        'X-NCP-APIGW-API-KEY': process.env.NAVER_HUB_CLIENT_SECRET || '',
      },
    });
    if (res.ok) return (await res.json()).items || [];
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`네이버 키 확인 필요 (HTTP ${res.status})`), { fatal: true });
    if (attempt >= 3) throw new Error(`네이버 검색 실패 (HTTP ${res.status})`);
    await sleep(1500 * attempt);
  }
}

// 카페 글 번호는 올라온 순서대로 커진다. 경매글의 마감일(보통 올린 날 ~ 3일 뒤)을 기준점으로 삼아
// 글 번호 → 대략 올라온 날짜를 계산한다. (처음 모을 때 섞여 나오는 옛날 글의 날짜를 맞추는 용도)
function makeDateEstimator(cands) {
  const pts = Object.values(cands)
    .filter((c) => c.kind === 'auction' && c.endsAt && c.articleId)
    .map((c) => [Number(c.articleId), Date.parse(c.endsAt) - 1.5 * 86400e3])
    .sort((a, b) => a[0] - b[0]);
  // 같은 구간에서 튀는 값을 줄이려고 번호순으로 정렬한 뒤 날짜도 단조 증가하게 다듬는다
  for (let i = 1; i < pts.length; i += 1) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
  return (articleId) => {
    if (pts.length < 2) return null;
    const x = Number(articleId);
    let i = pts.findIndex((p) => p[0] >= x);
    if (i === -1) i = pts.length - 1;
    if (i === 0) i = 1;
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    if (x1 === x0) return y0;
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
}

function cleanQueries(t) {
  const list = [t.cardName, ...(Array.isArray(t.queries) ? t.queries : [])]
    .map((q) => String(q || '').trim())
    .filter((q) => q.length >= 2);
  return [...new Set(list)].slice(0, 6);
}

async function main() {
  const now = new Date().toISOString();
  const prev = loadPrev();
  const candidates = prev.candidates || {};
  const run = { at: now, calls: 0, targets: 0, newCandidates: 0, updated: 0, errors: [] };
  // 지난번까지 본 가장 큰 글 번호. 이보다 작은(=예전) 글을 처음 보면 "오늘 발견"이 아니라 추정 날짜로 적는다.
  const knownMax = Math.max(0, ...Object.values(candidates).map((c) => Number(c.articleId) || 0));
  const fresh = [];

  if (!process.env.NAVER_HUB_CLIENT_ID || !process.env.NAVER_HUB_CLIENT_SECRET) {
    run.errors.push('네이버 키가 없어요 (NAVER_HUB_CLIENT_ID / NAVER_HUB_CLIENT_SECRET)');
  } else {
    let cfg;
    try {
      cfg = await loadTargets();
    } catch (err) {
      run.errors.push(err.message);
      cfg = { targets: [] };
    }
    const cafes = (cfg.cafes && cfg.cafes.length ? cfg.cafes : DEFAULT_CAFES).map((c) => String(c).toLowerCase());
    const targets = (cfg.targets || []).filter((t) => t && t.cardKey && t.cardName);
    run.targets = targets.length;

    outer:
    for (const t of targets) {
      const queries = cleanQueries(t);
      for (const q of queries) {
        let items;
        try {
          items = await search(q);
        } catch (err) {
          run.errors.push(`${t.cardName} / ${q}: ${err.message}`);
          if (err.fatal || calls >= MAX_CALLS) break outer;
          continue;
        } finally {
          await sleep(PAUSE_MS);
        }
        for (const it of items) {
          const cafe = String(it.cafeurl || '').toLowerCase();
          if (!cafes.some((c) => cafe.endsWith(`/${c}`) || cafe.includes(`cafe.naver.com/${c}`))) continue;
          const articleId = articleIdFromLink(it.link);
          if (!articleId) continue;
          const title = stripTags(it.title);
          const snippet = stripTags(it.description);
          // 이 카드 이름(또는 별명)이 제목이나 요약에 실제로 있어야 후보로 본다
          if (!queries.some((n) => findName(`${title} ${snippet}`, n).length)) continue;
          const id = `${articleId}|${t.cardKey}`;
          const old = candidates[id];
          const foundAt = old?.foundAt || now;
          if (!old) fresh.push(id);
          const a = analyzePost({ title, snippet, foundAt }, queries);
          const hidden = a.kind === 'buy' || a.kind === 'other' ? a.kind : null;
          const next = {
            id,
            articleId,
            cardKey: t.cardKey,
            cardName: t.cardName,
            cafe: it.cafename || '',
            url: it.link,
            title,
            // 검색어마다 요약이 달라서, 가격이 들어 있는 요약을 우선 남긴다
            snippet: (old && old.snippet && !a.price && old.price ? old.snippet : snippet).slice(0, 240),
            foundAt,
            lastSeen: now,
            kind: hidden ? 'sale' : a.kind,
            hidden,
            price: a.price ?? (old?.title === title ? old?.price ?? null : null),
            startPrice: a.startPrice,
            endsAt: a.endsAt,
            language: a.language,
            conditionType: a.conditionType,
            gradingCompany: a.gradingCompany,
            grade: a.grade,
            flags: a.flags,
            soldMark: a.soldMark,
            soldSeenAt: a.soldMark ? (old?.soldSeenAt || now) : null,
            dateEstimated: old?.dateEstimated || false,
          };
          if (old && (old.title !== next.title || old.price !== next.price)) run.updated += 1;
          candidates[id] = next;
        }
      }
    }
    run.calls = calls;
  }

  // 새로 본 글 중 예전 글은 글 번호로 날짜를 추정한다
  const estimate = makeDateEstimator(candidates);
  for (const id of fresh) {
    const c = candidates[id];
    if (!c) continue;
    if (Number(c.articleId) <= knownMax || knownMax === 0) {
      const est = estimate(c.articleId);
      if (est && est < Date.parse(now)) { c.foundAt = new Date(est).toISOString(); c.dateEstimated = true; }
    }
  }

  // 오래된 후보 정리
  const nowMs = Date.parse(now);
  for (const [id, c] of Object.entries(candidates)) {
    const ageDays = Math.max((nowMs - Date.parse(c.lastSeen || c.foundAt)) / 86400e3, c.hidden ? 0 : (nowMs - Date.parse(c.foundAt)) / 86400e3 - 30);
    const limit = c.hidden ? KEEP_DAYS.hidden : KEEP_DAYS[c.kind] || 60;
    const auctionLate = c.kind === 'auction' && c.endsAt && (nowMs - Date.parse(c.endsAt)) / 86400e3 > KEEP_DAYS.auction;
    if (ageDays > limit || auctionLate) delete candidates[id];
  }

  run.newCandidates = fresh.filter((id) => candidates[id] && !candidates[id].dateEstimated && !candidates[id].hidden).length;
  const runs = [run, ...(prev.runs || [])].slice(0, 14);
  save({ version: 1, updatedAt: now, runs, candidates });
  console.log(`카페 후보: 카드 ${run.targets}장 · 검색 ${run.calls}번 · 새 후보 ${run.newCandidates} · 바뀐 후보 ${run.updated} · 전체 ${Object.keys(candidates).length}`);
  if (run.errors.length) console.log('문제:', run.errors.slice(0, 10).join(' / '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
