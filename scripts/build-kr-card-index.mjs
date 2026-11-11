// 한국 공식 사이트(pokemoncard.co.kr) 카드 상세 페이지를 한 장씩 읽어
// 사진 찾기 창에서 쓸 "한국 공식 카드 목록" 파일(kr.json)을 만든다.
//
//   사용: node scripts/build-kr-card-index.mjs <출력 파일> [이전 목록 파일]
//   환경 변수(선택):
//     KR_BUDGET_MIN  이번에 읽을 최대 시간(분, 기본 300). 시간이 다 되면 거기까지 저장하고 다음 실행 때 이어서 읽는다.
//     KR_YEARS       읽을 연도 (예: "2026" 또는 "2015-2026", 테스트용)
//     KR_MAX_CARDS   이번에 읽을 최대 장수 (테스트용)
//     KR_ONLY_IF_INCOMPLETE=1  이전 목록이 이미 다 모아졌으면 아무것도 하지 않는다 (매일 이어 모으기용)
//
// 카드 상세 주소 규칙: /cards/detail/BS{연도}{제품 순번 3자리}{카드 번호 3자리}
//   예) BS2025001001 = 2025년 첫 번째 제품의 001번 카드
//
// 공식 사이트에 부담을 주지 않도록
//   - 한 번에 4장씩 동시에, 요청마다 0.25초 쉰다. (바쁘다고 하면 한 장씩 0.7초 간격으로)
//   - "너무 많다(429)"·"잠시 안 된다(503)" 응답이 오면 1분 쉬고 다시 시도한다. 계속되면 그날은 멈춘다.
//   - 한 번 다 모은 옛날 제품은 다시 읽지 않는다. 최근 1~2년 제품만 뒤쪽 번호(새로 추가된 카드)를 확인한다.
// 사진은 복사하지 않고 공식 사진 주소만 기록한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'card-index/kr.json';
const PREV = process.argv[3] || '';
const BASE = 'https://pokemoncard.co.kr/cards/detail/';
const IMAGE_BASE = 'https://cards.image.pokemonkorea.co.kr/data/wmimages/';
// 속도: 한 번에 CONCURRENCY장씩 동시에 읽고, 요청마다 PAUSE_MS 쉰다.
// 사이트가 "바쁘다(429/503)"고 하면 바로 한 장씩·0.7초 간격(예전 속도)으로 돌아간다.
const CONCURRENCY = Math.max(1, Number(process.env.KR_CONCURRENCY) || 4);
let PAUSE_MS = Number(process.env.KR_PAUSE_MS) || 250;
let conc = CONCURRENCY;
const slowDown = () => { if (conc > 1 || PAUSE_MS < 700) console.warn('  사이트가 바빠해서 천천히(한 장씩, 0.7초 간격) 읽습니다.'); conc = 1; PAUSE_MS = 700; };
const FIRST_YEAR = 2012;
const NOW_YEAR = new Date().getFullYear();
const BUDGET_MS = (Number(process.env.KR_BUDGET_MIN) || 300) * 60 * 1000;
const MAX_CARDS = Number(process.env.KR_MAX_CARDS) || Infinity;
const MISS_STOP = 15; // 제품 안에서 연속으로 이만큼 없으면 그 제품은 끝
const SEQ_STOP = 4; // 한 해에 제품이 연속으로 이만큼 없으면 그 해는 끝
const RECENT_YEARS = 1; // 올해 + 작년 제품은 매번 새 카드 확인

const years = (() => {
  const v = String(process.env.KR_YEARS || '').trim();
  const m = v.match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!m) return { from: FIRST_YEAR, to: NOW_YEAR };
  return { from: Number(m[1]), to: Number(m[2] || m[1]) };
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
const outOfTime = () => Date.now() - startedAt > BUDGET_MS;
let requests = 0;
let fetchedCards = 0;
let busyStreak = 0;
let stopReason = '';

// ── 이전 목록 이어 쓰기
const prev = PREV && existsSync(PREV) ? JSON.parse(readFileSync(PREV, 'utf8')) : null;
if (prev && process.env.KR_ONLY_IF_INCOMPLETE === '1' && prev.complete) {
  console.log('이전 목록이 이미 다 모아져 있어서 이번에는 읽지 않습니다.');
  process.exit(0);
}
const products = { ...(prev?.products || {}) }; // { BS2025001: { name, max, done, scannedAt } }
const cardMap = new Map((prev?.cards || []).map((c) => [c[0], c]));

// 세트 코드는 사진 파일 이름 앞부분 (S/S5/S5I_081.webp → S5I). 폴더(S5)는 일격·연격마스터처럼 두 세트가 같이 쓰기도 해서
const setFromImage = (path) => String(path || '').split('/').pop().split('_')[0].replace(/\.[a-z]+$/i, '');
// 상품 이름이 제대로인지 (기술 설명이 잘못 들어간 예전 목록 고치기용)
const goodProductName = (name) => !!String(name || '').trim() && !/(이 포켓몬|자신의|상대의|상대 |데미지|사용할|회복|받지 않는다|선택해서|내보낸다|섞는다)|다\.?$/.test(name);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
function cardType(kindText) {
  const k = kindText.replace(/^카드 종류\s*:\s*/, '').trim();
  if (k.includes('에너지')) return '에너지';
  if (k.includes('포켓몬') && !k.includes('도구')) return '포켓몬';
  if (k.includes('서포트')) return '서포트';
  if (k.includes('스타디움')) return '스타디움';
  if (k.includes('도구')) return '포켓몬의 도구';
  if (k.includes('아이템')) return '아이템';
  return k;
}
function parse(htmlText) {
  const title = htmlText.match(/class="card-hp title">([^<]*)/);
  const img = htmlText.match(/wmimages\/([A-Za-z0-9/_.-]+?\.(?:png|webp|jpe?g))/i);
  if (!title || !img) return null;
  const body = htmlText.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const lines = decode(body.replace(/<[^>]+>/g, '\n')).split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^\d{1,3}\/\d{1,3}$/.test(l));
  const no = i >= 0 ? lines[i] : '';
  const rarity = i >= 0 && /^[A-Za-z★☆]{1,5}$/.test(lines[i + 1] || '') ? lines[i + 1] : '';
  const kind = lines.find((l) => l.startsWith('카드 종류')) || '';
  // 상품 이름: 카드 아래 상품 링크 (예: <a class="search_href">소드&실드 확장팩 「퓨전아츠」</a>)
  // (예전에는 「」가 들어간 첫 줄을 썼는데, 기술 설명 "이 포켓몬의 HP를 「30」회복한다." 가 잡히는 문제가 있었음)
  const link = htmlText.match(/class="search_href"[^>]*>([^<]+)</);
  const product = link ? decode(link[1]).trim() : '';
  const dex = body.match(/No\.\s*(\d{1,4})/);
  const path = img[1];
  return {
    name: decode(title[1]).trim(),
    no,
    rarity,
    type: cardType(kind),
    dex: dex ? Number(dex[1]) : 0,
    product,
    set: setFromImage(path),
    img: path,
  };
}

// 결과: { ok: true, html } | { ok: false, missing: true } | { ok: false, stop: true }
async function fetchDetail(id) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sleep(PAUSE_MS);
    requests += 1;
    try {
      const res = await fetch(BASE + id, { headers: { 'User-Agent': 'card-index-builder (personal collection app)' } });
      if (res.status === 429 || res.status === 503) {
        slowDown();
        busyStreak += 1;
        if (busyStreak >= 3) return { ok: false, stop: true };
        console.warn(`  사이트가 바빠요(${res.status}). 1분 쉬었다가 다시 시도합니다.`);
        await sleep(60 * 1000);
        continue;
      }
      busyStreak = 0;
      if (res.status === 404) return { ok: false, missing: true };
      if (!res.ok) { if (attempt >= 2) return { ok: false, missing: true }; await sleep(2000); continue; }
      return { ok: true, html: await res.text() };
    } catch (err) {
      if (attempt === 3) { console.warn(`  ${id} 읽기 실패: ${err.message}`); return { ok: false, missing: true }; }
      await sleep(3000 * attempt);
    }
  }
  return { ok: false, missing: true };
}

const productNames = new Map(Object.entries(products).map(([k, v]) => [k, v.name || '']));
function record(id, c, prodId) {
  if (c.product && !goodProductName(productNames.get(prodId))) productNames.set(prodId, c.product);
  // [상세 ID, 이름, 세트(사진 파일 이름 앞부분), 번호, 레어도, 종류, 도감 번호, 사진 경로]
  cardMap.set(id, [id, c.name, c.set, c.no, c.rarity, c.type, c.dex, c.img]);
}

// 제품 하나 읽기. 반환: 'absent' | 'done' | 'stopped'
async function scanProduct(prodId, fromNo) {
  let miss = 0;
  let hit = false;
  let max = products[prodId]?.max || 0;
  const pause = (why, n) => {
    stopReason = why;
    // 읽은 데까지 기록해 두고 다음 실행 때 그다음 번호부터 이어서 읽는다
    if (max) products[prodId] = { name: productNames.get(prodId) || '', max: n - 1, done: false };
    return 'stopped';
  };
  for (let n = fromNo; n <= 999;) {
    if (outOfTime()) return pause('시간 제한', n);
    if (fetchedCards >= MAX_CARDS) return pause('장수 제한(테스트)', n);
    // 이번에 동시에 읽을 번호들
    const batch = [];
    for (let k = 0; k < conc && n + k <= 999; k += 1) batch.push(n + k);
    const results = await Promise.all(batch.map((m) => fetchDetail(`${prodId}${String(m).padStart(3, '0')}`)));
    for (let i = 0; i < batch.length; i += 1) {
      const m = batch[i];
      const r = results[i];
      if (r.stop) return pause('사이트가 계속 바빠서 멈춤', m);
      const c = r.ok ? parse(r.html) : null;
      if (c) {
        record(`${prodId}${String(m).padStart(3, '0')}`, c, prodId);
        hit = true; miss = 0; max = Math.max(max, m); fetchedCards += 1;
      } else {
        miss += 1;
        // 제품 첫머리 3장이 모두 없으면 없는 제품
        if (!hit && !max && m >= fromNo + 2) return 'absent';
        if (miss >= MISS_STOP) {
          products[prodId] = { name: productNames.get(prodId) || products[prodId]?.name || '', max, done: true, scannedAt: new Date().toISOString() };
          return 'done';
        }
      }
    }
    n += batch.length;
  }
  products[prodId] = { name: productNames.get(prodId) || products[prodId]?.name || '', max, done: true, scannedAt: new Date().toISOString() };
  return 'done';
}

// 예전 목록 고치기: 세트 코드를 사진 파일 이름으로 다시 정한다 (사진으로 모은 카드는 그대로)
cardMap.forEach((c) => {
  if (String(c[0]).startsWith('BS')) { const set = setFromImage(c[7]); if (set) c[2] = set; }
  c[7] = String(c[7] || '').replace(/\.png$/i, '.webp'); // 공식 사진 서버는 2026-11-11부터 .webp 만 줌
});

// 예전 목록에 잘못 들어간 상품 이름은 그 상품 카드 한 장을 다시 읽어서 고친다
for (const prodId of Object.keys(products)) {
  if (!prodId.startsWith('BS') || goodProductName(productNames.get(prodId))) continue;
  if (outOfTime()) break;
  const first = [...cardMap.keys()].filter((id) => id.startsWith(prodId)).sort()[0];
  if (!first) continue;
  const r = await fetchDetail(first);
  if (r.stop) break;
  const c = r.ok ? parse(r.html) : null;
  if (c?.product) {
    productNames.set(prodId, c.product);
    console.log(`상품 이름 고침: ${prodId} → ${c.product}`);
  }
}

// ── 보충 1: 다 읽은 상품 안에서 빠진 번호를 한 번 더 읽어 본다 (잠깐 안 열렸던 카드). 한 번 다시 봐도 없으면 기록해 두고 다음부터는 건너뜀
{
  const retry = [];
  for (const [prodId, info] of Object.entries(products)) {
    if (!prodId.startsWith('BS') || !info?.done || !info.max) continue;
    const tried = new Set(info.retried || []);
    for (let n = 1; n <= info.max; n += 1) {
      const id = `${prodId}${String(n).padStart(3, '0')}`;
      if (!cardMap.has(id) && !tried.has(n)) retry.push([prodId, n, id]);
    }
  }
  let found = 0;
  for (let i = 0; i < retry.length && !outOfTime(); i += conc) {
    const batch = retry.slice(i, i + conc);
    const results = await Promise.all(batch.map(([, , id]) => fetchDetail(id)));
    if (results.some((r) => r.stop)) break;
    batch.forEach(([prodId, n, id], k) => {
      const c = results[k].ok ? parse(results[k].html) : null;
      if (c) { record(id, c, prodId); found += 1; } else {
        products[prodId] = { ...products[prodId], retried: [...(products[prodId].retried || []), n] };
      }
    });
  }
  if (retry.length) console.log(`빠진 번호 다시 읽기: ${retry.length}장 중 ${found}장 찾음`);
}

// 사진 서버에 사진이 있는지만 확인 (사진 서버는 공식 사이트 카드 페이지와 따로라서 가볍다)
async function imageExists(path) {
  await sleep(PAUSE_MS);
  requests += 1;
  try {
    const res = await fetch(IMAGE_BASE + path, { method: 'HEAD' });
    return res.ok;
  } catch { return false; }
}
async function checkImages(paths) {
  const ok = [];
  for (let i = 0; i < paths.length && !outOfTime(); i += conc) {
    const batch = paths.slice(i, i + conc);
    const res = await Promise.all(batch.map(imageExists));
    batch.forEach((p, k) => { if (res[k]) ok.push(p); });
  }
  return ok;
}
// 사진만 있는 카드 기록: 이름·레어도 등은 비워 둔다 (등록한 뒤 사진을 보고 입력)
const recordImageOnly = (set, num, path) => {
  const no = String(num).padStart(3, '0');
  cardMap.set(`IMG_${set}_${no}`, [`IMG_${set}_${no}`, '', set, no, '', '', 0, path]);
};

// ── 보충 2: 세트 안에서 번호가 빈 카드는 공식 사진 서버에 사진이 있는지 확인해서, 있으면 "사진만 있는 카드"로 넣는다
{
  const bySet = new Map();
  cardMap.forEach((c) => {
    const file = String(c[7]).split('/').pop();
    const m = file.match(/^(.+?)_(\d{3})\.(?:webp|png)$/i);
    if (!m) return;
    const folder = String(c[7]).split('/').slice(0, -1).join('/');
    if (!bySet.has(m[1])) bySet.set(m[1], { folder, nums: new Set() });
    bySet.get(m[1]).nums.add(Number(m[2]));
  });
  const paths = [];
  bySet.forEach(({ folder, nums }, set) => {
    const max = Math.max(...nums);
    for (let n = 1; n < max; n += 1) if (!nums.has(n)) paths.push([set, n, `${folder}/${set}_${String(n).padStart(3, '0')}.webp`]);
  });
  const ok = new Set(await checkImages(paths.map((p) => p[2])));
  paths.filter((p) => ok.has(p[2])).forEach(([set, n, path]) => recordImageOnly(set, n, path));
  if (paths.length) console.log(`빈 번호 사진 확인: ${paths.length}개 중 ${ok.size}장 사진 있음`);
}

// ── 보충 3: 프로모는 상품 목록(BS…)에 없어서, 공식 사진 서버에서 번호를 차례로 확인해 모은다 (이름은 비어 있음)
const PROMO_FOLDERS = [
  ['MEGA/M-P', 'M-P', 'MEGA 프로모'],
  ['SV/SV-P', 'SV-P', '스칼렛&바이올렛 프로모'],
  ['S/S-P', 'S-P', '소드&실드 프로모'],
];
for (const [folder, set, name] of PROMO_FOLDERS) {
  if (outOfTime()) break;
  const key = `IMG_${set}`;
  let n = (products[key]?.max || 0) + 1;
  let miss = 0;
  let max = products[key]?.max || 0;
  while (miss < 20 && n <= 999 && !outOfTime()) {
    const batch = [];
    for (let k = 0; k < conc; k += 1) batch.push(n + k);
    const res = await Promise.all(batch.map((m) => imageExists(`${folder}/${set}_${String(m).padStart(3, '0')}.webp`)));
    batch.forEach((m, k) => {
      if (res[k]) { recordImageOnly(set, m, `${folder}/${set}_${String(m).padStart(3, '0')}.webp`); max = Math.max(max, m); miss = 0; } else miss += 1;
    });
    n += batch.length;
  }
  products[key] = { name, max, done: true, scannedAt: new Date().toISOString(), imageOnly: true };
  productNames.set(key, name);
  console.log(`${name}: 사진 ${max}번까지`);
}

let finished = true;
outer:
for (let year = years.to; year >= years.from; year -= 1) {
  const recent = year >= NOW_YEAR - RECENT_YEARS;
  let absent = 0;
  for (let seq = 1; seq <= 999; seq += 1) {
    const prodId = `BS${year}${String(seq).padStart(3, '0')}`;
    const known = products[prodId];
    if (known?.done && !recent) { absent = 0; continue; } // 다 모은 옛날 제품은 건너뜀
    const from = known?.done ? known.max + 1 : (known?.max || 0) + 1;
    const res = await scanProduct(prodId, from);
    if (res === 'stopped') { finished = false; break outer; }
    if (res === 'absent' && !known?.max) {
      absent += 1;
      if (absent >= SEQ_STOP) break;
    } else {
      absent = 0;
      console.log(`${prodId} ${products[prodId]?.name || ''}: ${products[prodId]?.max || 0}번까지 · 지금까지 ${cardMap.size}장`);
    }
  }
}

const cards = [...cardMap.values()].sort((a, b) => b[0].localeCompare(a[0]));
const out = {
  source: 'pokemoncard.co.kr (한국 공식 카드 상세)',
  updatedAt: new Date().toISOString(),
  imageBase: IMAGE_BASE,
  detailBase: BASE,
  fields: ['id', 'name', 'set', 'no', 'rarity', 'type', 'dex', 'img'],
  complete: finished && years.from <= FIRST_YEAR && years.to >= NOW_YEAR,
  products: Object.fromEntries(Object.entries(products).map(([k, v]) => [k, { ...v, name: productNames.get(k) || v.name || '' }])),
  count: cards.length,
  cards,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const mins = Math.round((Date.now() - startedAt) / 60000);
console.log(`완료: ${cards.length}장 (이번에 ${fetchedCards}장 읽음, 요청 ${requests}번, ${mins}분)${finished ? '' : ` · ${stopReason} → 다음 실행 때 이어서 읽어요`} → ${OUT}`);
