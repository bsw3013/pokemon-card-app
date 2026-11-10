// 일본 공식 사이트(pokemon-card.com) 카드 검색에서 전체 카드 목록(이름·세트·사진 파일)을 모아
// 사진 찾기 창에서 쓸 목록 파일(JSON)을 만든다.
//   사용: node scripts/build-jp-card-index.mjs <출력 파일> [최대 페이지 수(테스트용)]
// - 로그인·키 없이 공개된 검색 결과를 차례로 읽는다. (한 페이지 39장, 전체 약 600페이지)
// - 공식 사이트에 부담을 주지 않도록 한 번에 한 페이지씩, 요청 사이에 잠깐 쉰다.
// - 사진은 복사하지 않고 공식 사진 주소만 기록한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'card-index/jp.json';
const PAGE_LIMIT = Number(process.argv[3]) || Infinity;
const API = 'https://www.pokemon-card.com/card-search/resultAPI.php';
const IMAGE_BASE = 'https://www.pokemon-card.com/assets/images/card_images/large/';
const PAUSE_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page) {
  const params = new URLSearchParams({
    keyword: '', se_ta: '', regulation_sidebar_form: 'all', pg: '', illust: '', sm_and_keyword: 'true', page: String(page),
  });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'card-index-builder (personal collection app)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.cardList)) throw new Error('cardList 없음');
      return json;
    } catch (err) {
      if (attempt === 4) throw err;
      console.warn(`  ${page}페이지 다시 시도 (${attempt}) - ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
  return null;
}

const first = await fetchPage(1);
const maxPage = Math.min(Number(first.maxPage) || 1, PAGE_LIMIT);
console.log(`전체 ${first.hitCnt}장, ${first.maxPage}페이지 (이번에 ${maxPage}페이지까지 읽음)`);

const seen = new Set();
const cards = [];
const add = (list) => {
  list.forEach((c) => {
    const file = String(c.cardThumbFile || '');
    const m = file.match(/card_images\/large\/([^/]+)\/([^/]+)$/);
    if (!m || seen.has(c.cardID)) return;
    seen.add(c.cardID);
    // [카드 ID, 이름, 세트 코드, 사진 파일 이름] — 파일 크기를 줄이려고 배열로 저장
    const name = String(c.cardNameViewText || c.cardNameAltText || '').trim()
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    cards.push([String(c.cardID), name, m[1], m[2]]);
  });
};
add(first.cardList);

for (let page = 2; page <= maxPage; page += 1) {
  await sleep(PAUSE_MS);
  const json = await fetchPage(page);
  add(json.cardList);
  if (page % 50 === 0) console.log(`  ${page}/${maxPage}페이지, ${cards.length}장`);
}

const out = {
  source: 'pokemon-card.com (일본 공식 카드 검색)',
  updatedAt: new Date().toISOString(),
  imageBase: IMAGE_BASE,
  fields: ['id', 'name', 'set', 'file'],
  count: cards.length,
  cards,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`완료: ${cards.length}장 → ${OUT}`);
