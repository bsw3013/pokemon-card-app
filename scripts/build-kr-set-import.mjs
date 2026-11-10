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
  // M6a는 힛카드만이 아니라 공식 사이트에 올라온 모든 카드를 넣는다 (all: true)
  { code: 'm6a', name: '30th CELEBRATION', kind: '확장팩', releaseDate: '2026-09-16', detail: 'BS2026006', count: 176, all: true },
];

// 공식 사이트 상세 페이지가 오류(HTTP 500)라 읽지 못하는 M6a 카드들.
// 포켓몬코리아 공식 카드 사진(MEGA/M6a/M6a_번호.png)에 인쇄된 이름·레어도를 그대로 옮겨 적었다.
// 136~165번(옛 디자인 복각 카드)은 카드에 레어도 표시가 없어서 '없음'으로 둔다.
const MANUAL = {
  m6a: [
    [119, '짜랑고우거', 'AR', '포켓몬', '0784'],
    [128, '뮤츠 ex', 'SAR', '포켓몬', '0150'],
    [129, '뮤 ex', 'SAR', '포켓몬', '0151'],
    [131, '팬텀 ex', 'SAR', '포켓몬', '0094'],
    [134, '뮤츠 ex', 'FUR', '포켓몬', '0150'],
    [135, '뮤 ex', 'FUR', '포켓몬', '0151'],
    [136, '피카츄', '없음', '포켓몬', '0025'],
    [137, '리자몽', '없음', '포켓몬', '0006'],
    [138, '이슬', '없음', '서포트', ''],
    [139, '민화의 푸린', '없음', '포켓몬', '0039'],
    [140, '포푸니', '없음', '포켓몬', '0215'],
    [141, '빛나는 세레비', '없음', '포켓몬', '0251'],
    [142, '루기아', '없음', '포켓몬', '0249'],
    [143, '델케티', '없음', '포켓몬', '0301'],
    [144, '나쁜 마기라스', '없음', '포켓몬', '0248'],
    [145, '핫삼 ex', '없음', '포켓몬', '0212'],
    [146, '메타그로스 δ', '없음', '포켓몬', '0376'],
    [147, '펄기아 LV.X', '없음', '포켓몬', '0484'],
    [148, '유크시', '없음', '포켓몬', '0480'],
    [149, '크로뱃 G', '없음', '포켓몬', '0169'],
    [150, '팬텀', '없음', '포켓몬', '0094'],
    [151, '다크라이&크레세리아 LEGEND', '없음', '포켓몬', '0491'],
    [152, '다크라이&크레세리아 LEGEND', '없음', '포켓몬', '0488'],
    [153, 'N', '없음', '서포트', ''],
    [154, '레쿠쟈 EX', '없음', '포켓몬', '0384'],
    [155, '게노세크트 EX', '없음', '포켓몬', '0649'],
    [156, 'M가디안 EX', '없음', '포켓몬', '0282'],
    [157, '개굴닌자 BREAK', '없음', '포켓몬', '0658'],
    [158, '솔가레오 GX', '없음', '포켓몬', '0791'],
    [159, '매시붕 GX', '없음', '포켓몬', '0794'],
    [160, '피카츄&제크로무 GX', '없음', '포켓몬', '0025'],
    [161, '자시안 V', '없음', '포켓몬', '0888'],
    [162, '라이코', '없음', '포켓몬', '0243'],
    [163, '뮤 VMAX', '없음', '포켓몬', '0151'],
    [164, '아르세우스 VSTAR', '없음', '포켓몬', '0493'],
    [165, '잉어킹', '없음', '포켓몬', '0129'],
  ],
};

// 기본 레어도 표에 없는 새 레어도 (자동 등록 때 레어도 표에도 추가된다)
const NEW_RARITIES = [{ code: 'FUR', order: 23, group: '힛카드' }];

// 지금 DB처럼 힛카드만 넣는다 (마스터 설정의 레어도 표에서 "힛카드" 묶음)
const HIT = new Set(['S', 'A', 'MA', 'AR', 'CHR', 'CSR', 'SR', 'SSR', 'SAR', 'HR', 'UR', 'BWR', 'MUR', 'FUR']);
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
  // 기본 에너지는 카드 번호·레어도 표시가 없다
  const [no, printed] = i >= 0 ? lines[i].split('/') : [0, 0];
  const rarity = i >= 0 && /^[A-Z]{1,4}$/.test(lines[i + 1] || '') ? lines[i + 1] : '';
  const title = htmlText.match(/class="card-hp title">([^<]*)/);
  const kind = lines.find((l) => l.startsWith('카드 종류')) || '';
  const dex = body.match(/No\.\s*(\d{1,4})/);
  const img = htmlText.match(/wmimages\/([A-Za-z0-9/_-]+)\.(?:png|webp|jpg)/);
  return {
    no: Number(no), printed: Number(printed) || null, rarity,
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

const out = { id: IMPORT_ID, createdAt: new Date().toISOString(), source: 'pokemoncard.co.kr', sets: [], rarities: NEW_RARITIES, cards: [] };
for (const set of SETS) {
  let printed = null;
  let kept = 0;
  const code = set.code.toUpperCase().replace(/A$/, 'a');
  const manual = new Map((MANUAL[set.code] || []).map(([n, name, rarity, type, dex]) => [n, { name, rarity, type, dex, imagePath: '' }]));
  for (let n = 1; n <= set.count; n += 1) {
    const nnn = String(n).padStart(3, '0');
    const html = await fetchCard(`https://pokemoncard.co.kr/cards/detail/${set.detail}${nnn}`);
    let c = parse(html);
    await sleep(PAUSE_MS);
    if ((!c || !c.name) && manual.has(n)) c = manual.get(n);
    if (!c || !c.name) { console.warn(`  ${set.code} ${nnn}: 읽지 못함`); continue; }
    printed = printed || c.printed;
    if (!c.rarity) c.rarity = '없음';
    if (!set.all && !HIT.has(c.rarity)) continue;
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
