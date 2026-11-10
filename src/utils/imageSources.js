// 카드 사진 찾기 창에서 쓰는 사진 출처 3가지
//  - 한국: 이름은 GitHub Actions가 모은 한국 공식 카드 목록(kr.json)에서 찾고, 세트 코드 + 번호는 사진 주소를 바로 만든다
//  - 일본: GitHub Actions가 매주 만드는 일본 공식 카드 목록(jp.json)에서 이름으로 찾는다
//  - 영어: TCGdex (키 없이 쓰는 무료 공개 API)

// ---------- 한국: 주소 규칙으로 바로 만들기 ----------
// 포켓몬코리아 공식: https://cards.image.pokemonkorea.co.kr/data/wmimages/{시대 폴더}/{세트}/{세트}_{번호 3자리}.png
// mtg-kr.com:      https://mtg-kr.com/cardimage/poketcg{세트}-{번호 3자리}.png
const ERA_FOLDERS = {
  메가: ['MEGA'],
  '스칼렛&바이올렛': ['SV'],
  '소드&실드': ['S'],
  '썬&문': ['SM'],
  XY: ['XY'],
  '블랙&화이트': ['BW'],
};
const ALL_FOLDERS = ['MEGA', 'SV', 'S', 'SM', 'XY', 'BW'];

// "SV8a-217", "sv8a 217", "M3_086" → { code: 'SV8a', num: 217 }
export function parseCardCode(text) {
  const m = String(text || '').trim().match(/^([A-Za-z][A-Za-z0-9-]*?)[\s_-]+0*(\d{1,3})$/);
  return m ? { code: m[1], num: Number(m[2]) } : null;
}

// sv8a → SV8a, s8b → S8b, sm10b → SM10b (앞 영문은 대문자, 숫자 뒤 마지막 한 글자는 소문자)
function smartCase(code) {
  const m = code.match(/^([A-Za-z-]+)(\d+)([A-Za-z]?)$/);
  return m ? `${m[1].toUpperCase()}${m[2]}${m[3].toLowerCase()}` : code;
}

export function koreanImageCandidates(text, era) {
  const parsed = parseCardCode(text);
  if (!parsed) return [];
  const nnn = String(parsed.num).padStart(3, '0');
  const codes = [...new Set([parsed.code, smartCase(parsed.code), parsed.code.toUpperCase()])];
  const folders = ERA_FOLDERS[era] || ALL_FOLDERS;
  const out = [];
  codes.forEach((c) => {
    folders.forEach((f) => {
      ['png', 'jpg'].forEach((ext) => out.push({ source: '포켓몬코리아 공식', url: `https://cards.image.pokemonkorea.co.kr/data/wmimages/${f}/${c}/${c}_${nnn}.${ext}` }));
    });
    out.push({ source: 'mtg-kr.com', url: `https://mtg-kr.com/cardimage/poketcg${c}-${nnn}.png` });
  });
  // 같은 주소는 한 번만
  const seen = new Set();
  return out.filter((x) => (seen.has(x.url) ? false : seen.add(x.url))).map((x, i) => ({ id: `kr_${i}`, ...x, thumbnail: x.url, fullImage: x.url }));
}

// ---------- 한국: 공식 카드 목록 파일 (이름으로 찾기) ----------
// GitHub Actions(.github/workflows/card-index.yml)가 한국 공식 사이트 카드 상세를 천천히 모아 만든 kr.json
export const KR_INDEX_URL = 'https://cdn.jsdelivr.net/gh/bsw3013/pokemon-card-app@card-index/kr.json';
let krIndexPromise = null;

export function loadKrIndex() {
  if (!krIndexPromise) {
    krIndexPromise = fetch(KR_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`한국 공식 카드 목록을 불러오지 못했어요 (${res.status})`);
        return res.json();
      })
      .catch((err) => { krIndexPromise = null; throw err; });
  }
  return krIndexPromise;
}

const normKo = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const productShort = (name) => { const m = String(name || '').match(/「(.+?)」/); return m ? m[1] : String(name || ''); };

// 이름(또는 세트 코드·번호)으로 한국 공식 카드 찾기. setCode 를 주면 그 세트에서만.
export function searchKrIndex(index, { text = '', setCode = '' }, limit = 120) {
  if (!index?.cards) return [];
  const code = parseCardCode(text);
  const key = normKo(text);
  const set = String(setCode || '').trim().toLowerCase();
  const hits = [];
  for (const [id, name, cardSet, no, rarity, , , img] of index.cards) {
    const setHit = !set || String(cardSet).toLowerCase() === set;
    let hit = false;
    if (code) {
      hit = String(cardSet).toLowerCase() === code.code.toLowerCase() && Number(String(no).split('/')[0]) === code.num;
    } else {
      hit = key && normKo(name).includes(key);
    }
    if (hit && setHit) {
      const prod = productShort(index.products?.[id.slice(0, 9)]?.name);
      const full = `${index.imageBase}${img.replace(/\.webp$/i, '.png')}`;
      hits.push({
        id: `krx_${id}`,
        source: `한국 공식 · ${cardSet}${rarity ? ` ${rarity}` : ''}`,
        title: `${name} · ${prod}${no ? ` ${no}` : ''}`,
        thumbnail: `${index.imageBase}${img}`,
        fullImage: full,
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

// ---------- 일본: 공식 카드 목록 파일 ----------
// GitHub Actions(.github/workflows/card-index.yml)가 card-index 브랜치에 올린 파일을 jsDelivr로 불러온다.
export const JP_INDEX_URL = 'https://cdn.jsdelivr.net/gh/bsw3013/pokemon-card-app@card-index/jp.json';
let jpIndexPromise = null;

export function loadJpIndex() {
  if (!jpIndexPromise) {
    jpIndexPromise = fetch(JP_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`일본 공식 카드 목록을 불러오지 못했어요 (${res.status})`);
        return res.json();
      })
      .catch((err) => { jpIndexPromise = null; throw err; });
  }
  return jpIndexPromise;
}

// 가타카나·히라가나·공백 차이를 줄여서 비교
const normJa = (s) => String(s || '').replace(/[\s・･＝=]/g, '').replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60)).toLowerCase();

// names: 찾을 일본어 이름들, setCode: 세트 코드로도 찾기(선택)
export function searchJpIndex(index, { names = [], setCode = '' }, limit = 80) {
  if (!index?.cards) return [];
  const keys = names.map(normJa).filter(Boolean);
  const set = String(setCode || '').trim().toLowerCase();
  const hits = [];
  for (const [id, name, cardSet, file] of index.cards) {
    const n = normJa(name);
    const nameHit = keys.length === 0 || keys.some((k) => n.includes(k));
    const setHit = !set || cardSet.toLowerCase() === set;
    if (nameHit && setHit) {
      const url = `${index.imageBase}${cardSet}/${file}`;
      hits.push({ id: `jp_${id}`, source: `일본 공식 · ${cardSet}`, title: name, thumbnail: url, fullImage: url });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

// ---------- 영어: TCGdex ----------
export async function searchTcgdexEn(name, limit = 80) {
  const res = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`TCGdex 응답 오류 (${res.status})`);
  const list = await res.json();
  return (Array.isArray(list) ? list : [])
    .filter((c) => c.image) // 사진 없는 카드는 빼서 빈칸이 안 보이게
    .slice(0, limit)
    .map((c) => ({ id: `en_${c.id}`, source: 'TCGdex', title: `${c.name} · ${c.id}`, thumbnail: `${c.image}/low.webp`, fullImage: `${c.image}/high.png` }));
}
