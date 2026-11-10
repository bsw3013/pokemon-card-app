// 일본 공식 사이트(pokemon-card.com) 카드 상세 페이지를 한 장씩 천천히 읽어
// 카드 번호·레어도·도감 번호를 모은 "일본 카드 상세 목록"(jp-detail.json)을 만든다.
// (카드 이름·세트·사진은 jp.json 에 있고, 이 파일은 사진 고를 때 정보 자동 입력에 쓴다)
//
//   사용: node scripts/build-jp-card-details.mjs <일본 목록 jp.json> <출력 파일> [이전 상세 목록 파일]
//   환경 변수(선택):
//     JPD_BUDGET_MIN  이번에 읽을 최대 시간(분, 기본 290). 다 못 읽으면 저장하고 다음 실행 때 이어서 읽는다.
//     JPD_MAX_CARDS   이번에 읽을 최대 장수 (테스트용)
//     JPD_ONLY_IF_INCOMPLETE=1  이미 다 모았으면 아무것도 하지 않는다 (매일 이어 모으기용)
//
// 공식 사이트에 부담을 주지 않도록
//   - 한 번에 한 장씩, 요청 사이에 0.7초 쉰다. 최신 카드부터 읽는다.
//   - "너무 많다(429)"·"잠시 안 된다(503)"면 1분 쉬고, 3번 계속되면 그날은 멈춘다.
//   - 한 번 읽은 카드는 다시 읽지 않는다. (새로 나온 카드만 읽음)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const LIST = process.argv[2];
const OUT = process.argv[3] || 'card-index/jp-detail.json';
const PREV = process.argv[4] || '';
const BASE = 'https://www.pokemon-card.com/card-search/details.php/card/';
const PAUSE_MS = 700;
const BUDGET_MS = (Number(process.env.JPD_BUDGET_MIN) || 290) * 60 * 1000;
const MAX_CARDS = Number(process.env.JPD_MAX_CARDS) || Infinity;

if (!LIST || !existsSync(LIST)) {
  console.log('일본 카드 목록(jp.json)이 없어서 상세 목록을 만들 수 없어요. 먼저 일본 목록을 만들어 주세요.');
  process.exit(0);
}
const list = JSON.parse(readFileSync(LIST, 'utf8'));
const prev = PREV && existsSync(PREV) ? JSON.parse(readFileSync(PREV, 'utf8')) : null;
const details = { ...(prev?.cards || {}) }; // { 카드 ID: [번호, 레어도, 도감 번호] }
const ids = (list.cards || []).map((c) => String(c[0])).filter(Boolean);
const todo = ids.filter((id) => !details[id]).sort((a, b) => Number(b) - Number(a));

if (process.env.JPD_ONLY_IF_INCOMPLETE === '1' && todo.length === 0) {
  console.log('일본 카드 상세 목록이 이미 다 모아져 있어서 이번에는 읽지 않습니다.');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
let busyStreak = 0;
let fetched = 0;
let stopReason = '';

function parse(html) {
  // 예) <img ... class="img-regulation" alt="SV11W" /> &nbsp;088&nbsp;/&nbsp;086&nbsp; <img src=".../ic_rare_ar.gif">
  const num = html.match(/&nbsp;([0-9A-Za-z-]{1,8})&nbsp;\/&nbsp;([0-9A-Za-z-]{1,8})&nbsp;/);
  const rare = html.match(/card\/rarity\/ic_rare_([a-z0-9_]+)\.(?:gif|png|svg)/i);
  const dex = html.match(/No\.\s*([0-9]{1,4})/);
  return [num ? `${num[1]}/${num[2]}` : '', rare ? rare[1].toUpperCase().replace(/_/g, '') : '', dex ? Number(dex[1]) : 0];
}

async function fetchDetail(id) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sleep(PAUSE_MS);
    try {
      const res = await fetch(`${BASE}${id}/regu/all`, { headers: { 'User-Agent': 'card-index-builder (personal collection app, slow crawl)' } });
      if (res.status === 429 || res.status === 503) {
        busyStreak += 1;
        if (busyStreak >= 3) return { stop: true };
        console.warn(`  사이트가 바빠요(${res.status}). 1분 쉬었다가 다시 시도합니다.`);
        await sleep(60 * 1000);
        continue;
      }
      busyStreak = 0;
      if (!res.ok) { if (attempt >= 2) return { missing: true }; await sleep(2000); continue; }
      return { html: await res.text() };
    } catch (err) {
      if (attempt === 3) return { missing: true };
      await sleep(3000 * attempt);
    }
  }
  return { missing: true };
}

console.log(`일본 카드 ${ids.length}장 중 상세를 안 읽은 카드 ${todo.length}장`);
for (const id of todo) {
  if (Date.now() - startedAt > BUDGET_MS) { stopReason = '시간 제한'; break; }
  if (fetched >= MAX_CARDS) { stopReason = '장수 제한(테스트)'; break; }
  const r = await fetchDetail(id);
  if (r.stop) { stopReason = '사이트가 계속 바빠서 멈춤'; break; }
  // 못 읽은 카드도 빈 값으로 기록해 두어 같은 카드를 계속 다시 읽지 않는다
  details[id] = r.html ? parse(r.html) : ['', '', 0];
  fetched += 1;
  if (fetched % 500 === 0) console.log(`  ${fetched}장 읽음`);
}

const left = ids.filter((id) => !details[id]).length;
const out = {
  source: 'pokemon-card.com (일본 공식 카드 상세)',
  updatedAt: new Date().toISOString(),
  fields: ['no', 'rarity', 'dex'],
  complete: left === 0,
  count: Object.keys(details).length,
  cards: details,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const mins = Math.round((Date.now() - startedAt) / 60000);
console.log(`완료: 상세 ${out.count}장 (이번에 ${fetched}장, ${mins}분)${left ? ` · 남은 ${left}장${stopReason ? ` (${stopReason})` : ''} → 다음 실행 때 이어서` : ''} → ${OUT}`);
