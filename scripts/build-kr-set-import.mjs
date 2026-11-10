// 한국 공식 사이트(pokemoncard.co.kr) 카드 상세 페이지에서 새 세트의 "힛카드"만 모아
// 사이트가 관리자 접속 때 자동으로 한 번 등록하는 가져오기 파일(public/imports/<id>.json)을 만든다.
//   사용: node scripts/build-kr-set-import.mjs
// - 카드 상세 주소 규칙: /cards/detail/BS{연도}{제품 순번 3자리}{카드 번호 3자리}  예) BS2026003001 = M4 001번
// - 공식 사이트에 부담을 주지 않도록 한 장씩, 요청 사이에 잠깐 쉰다.
// - 사진은 복사하지 않고 포켓몬코리아 공식 사진 주소만 기록한다.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_ID = '2026-11-mega-m4-m6a';

// 새로 넣을 세트 (한국 공식 발매일 기준). detail = 상세 주소 앞부분, count = 확인한 카드 수(시크릿 포함)
const SETS = [
  { code: 'm4', name: '닌자스피너', kind: '확장팩', releaseDate: '2026-05-01', detail: 'BS2026003', count: 120 },
  { code: 'm5', name: '어비스아이', kind: '확장팩', releaseDate: '2026-06-26', detail: 'BS2026004', count: 118 },
  { code: 'm6', name: '스톰에메랄다', kind: '확장팩', releaseDate: '2026-08-21', detail: 'BS2026005', count: 113 },
  { code: 'm6a', name: '30th CELEBRATION', kind: '확장팩', releaseDate: '2026-09-16', detail: 'BS2026006', count: 176 },
];

// 지금 DB처럼 힛카드만 넣는다 (마스터 설정의 레어도 표에서 "힛카드" 묶음)
const HIT = new Set(['S', 'A', 'MA', 'AR', 'CHR', 'CSR', 'SR', 'SSR', 'SAR', 'HR', 'UR', 'BWR', 'MUR']);
const PAUSE_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');

function cardType(kindText) {
  const k = kindText.replace(/^카드 종류\s*:\s*/, '').trim();
  if (k.includes('포켓몬') && !k.includes('도구')) return '포켓몬';
  if (k.includes('서포트')) return '서포트';
  if (k.includes('스타디움')) return '스타디움';
  if (k.includes('도구')) return '포켓몬의 도구';
  if (k.includes('아이템')) return '아이템';
  if (k.includes('에너지')) return '에너지';
  return k;
}

async function fetchCard(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'card-set-import-builder (personal collection app)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      // 공식 사이트에 없는 번호(빠진 번호)도 있어서, 세 번 실패하면 건너뛴다
      if (attempt === 3) { console.warn(`  건너뜀: ${url} (${err.message})`); return ''; }
      await sleep(1500 * attempt);
    }
  }
  return '';
}

function parse(htmlText) {
  const body = htmlText.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const lines = decode(body.replace(/<[^>]+>/g, '\n')).split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^\d{3}\/\d{3}$/.test(l));
  if (i < 0) return null;
  const [no, printed] = lines[i].split('/');
  const rarity = /^[A-Z]{1,4}$/.test(lines[i + 1] || '') ? lines[i + 1] : '';
  const title = htmlText.match(/class="card-hp title">([^<]*)/);
  const kind = lines.find((l) => l.startsWith('카드 종류')) || '';
  const dex = body.match(/No\.\s*(\d{1,4})/);
  const img = htmlText.match(/wmimages\/([A-Za-z0-9/_-]+)\.(?:png|webp|jpg)/);
  return {
    no: Number(no), printed: Number(printed), rarity,
    name: title ? decode(title[1]).trim() : '',
    type: cardType(kind),
    dex: dex ? dex[1].padStart(4, '0') : '',
    imagePath: img ? img[1] : '',
  };
}

export function baseNameForDex(name) {
  return String(name || '')
    .replace(/\s+(ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.X)$/u, '')
    .replace(/^.+의\s+/u, '')
    .replace(/^(메가|M)(?=[가-힣])/u, '')
    .replace(/^(알로라|가라르|히스이|팔데아)\s*/u, '')
    .replace(/\s+[XY]$/u, '')
    .replace(/^(히트|워시|프로스트|스핀|커트)(?=로토무)/u, '')
    .trim();
}

function fillDexNumbers(cards) {
  const names = Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'src/utils/pokemonMapAll.json'), 'utf8')).krToEn || {});
  const byName = new Map(names.map((n, i) => [n, String(i + 1).padStart(4, '0')]));
  cards.forEach((c) => {
    if (c.type !== '포켓몬' || c.pokedexNumber) return;
    const dex = byName.get(baseNameForDex(c.cardName));
    if (dex) c.pokedexNumber = dex;
  });
}

const out = { id: IMPORT_ID, createdAt: new Date().toISOString(), source: 'pokemoncard.co.kr', sets: [], cards: [] };
for (const set of SETS) {
  let printed = null;
  let kept = 0;
  for (let n = 1; n <= set.count; n += 1) {
    const nnn = String(n).padStart(3, '0');
    const html = await fetchCard(`https://pokemoncard.co.kr/cards/detail/${set.detail}${nnn}`);
    const c = parse(html);
    await sleep(PAUSE_MS);
    if (!c || !c.name) { console.warn(`  ${set.code} ${nnn}: 읽지 못함`); continue; }
    printed = printed || c.printed;
    if (!HIT.has(c.rarity)) continue;
    const code = set.code.toUpperCase().replace(/A$/, 'a');
    out.cards.push({
      cardName: c.name,
      series: `${set.code} -「${set.name}」`,
      cardNumber: `${code}-${nnn}`,
      rarity: c.rarity,
      type: c.type,
      pokedexNumber: c.type === '포켓몬' ? c.dex : '',
      imageUrl: `https://cards.image.pokemonkorea.co.kr/data/wmimages/${c.imagePath || `MEGA/${code}/${code}_${nnn}`}.png`,
    });
    kept += 1;
  }
  out.sets.push({ code: set.code, name: set.name, era: '메가', kind: set.kind, releaseDate: set.releaseDate, printedTotal: printed, label: `${set.code} -「${set.name}」` });
  console.log(`${set.code} ${set.name}: 일반 번호 ${printed}장, 힛카드 ${kept}장`);
}

// ex·메가진화 카드처럼 상세 페이지에 도감 번호가 없는 포켓몬은 이름으로 도감 번호를 채운다.
fillDexNumbers(out.cards);

const dir = path.join(ROOT, 'public', 'imports');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, `${IMPORT_ID}.json`), `${JSON.stringify(out, null, 1)}\n`);
const manifestPath = path.join(dir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { imports: [] };
if (!manifest.imports.includes(IMPORT_ID)) manifest.imports.push(IMPORT_ID);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`완료: 세트 ${out.sets.length}개, 카드 ${out.cards.length}장 → public/imports/${IMPORT_ID}.json`);
