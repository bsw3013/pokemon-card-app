// 카드 사진 찾기 창에서 쓰는 사진 출처 3가지
//  - 한국: 이름은 GitHub Actions가 모은 한국 공식 카드 목록(kr.json)에서 찾고, 세트 코드 + 번호는 사진 주소를 바로 만든다
//  - 일본: GitHub Actions가 매주 만드는 일본 공식 카드 목록(jp.json)에서 이름으로 찾는다
//  - 영어: TCGdex (키 없이 쓰는 무료 공개 API), TCGdex에 사진이 없는 카드는 pokemontcg.io 사진

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
export function smartCase(code) {
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
  return out.filter((x) => (seen.has(x.url) ? false : seen.add(x.url))).map((x, i) => ({ id: `kr_${i}`, ...x, thumbnail: x.url, fullImage: x.url, meta: { lang: 'kr-code', set: parsed.code, no: String(parsed.num) } }));
}

// ---------- 한국: 공식 카드 목록 파일 (이름으로 찾기) ----------
// GitHub Actions(.github/workflows/card-index.yml)가 한국 공식 사이트 카드 상세를 천천히 모아 만든 kr.json
export const KR_INDEX_URL = 'https://cdn.jsdelivr.net/gh/bsw3013/pokemon-card-app@card-index/kr.json';
let krIndexPromise = null;

// 예전에 만든 목록 고치기 (목록을 새로 모으면 처음부터 맞게 들어감)
//  - 세트 코드: 사진 폴더(S5) 대신 사진 파일 이름 앞부분(S5I·S5R) — 폴더 하나를 두 세트가 같이 쓰는 경우가 있음
//  - 상품 이름: 기술 설명("이 포켓몬의 HP를 「30」회복한다.")이 잘못 들어간 것은 비움
const BAD_PRODUCT = /(이 포켓몬|자신의|상대의|상대 |데미지|사용할|회복|받지 않는다|선택해서|내보낸다|섞는다)|다\.?$/;
function fixKrIndex(index) {
  if (!index?.cards) return index;
  index.cards.forEach((c) => {
    const set = String(c[7] || '').split('/').pop().split('_')[0].replace(/\.[a-z]+$/i, '');
    if (set) c[2] = set;
  });
  Object.values(index.products || {}).forEach((p) => { if (BAD_PRODUCT.test(p?.name || '')) p.name = ''; });
  return index;
}

export function loadKrIndex() {
  if (!krIndexPromise) {
    krIndexPromise = fetch(KR_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`한국 공식 카드 목록을 불러오지 못했어요 (${res.status})`);
        return res.json();
      })
      .then(fixKrIndex)
      .catch((err) => { krIndexPromise = null; throw err; });
  }
  return krIndexPromise;
}

const normKo = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const productShort = (name) => { const m = String(name || '').match(/「(.+?)」/); return m ? m[1] : String(name || ''); };

// 이름(또는 세트 코드·번호)으로 한국 공식 카드 찾기. setCode 를 주면 그 세트에서만.
export function searchKrIndex(index, { text = '', setCode = '' }, limit = 1000) {
  if (!index?.cards) return [];
  const code = parseCardCode(text);
  const key = normKo(text);
  const set = String(setCode || '').trim().toLowerCase();
  const hits = [];
  for (const [id, name, cardSet, no, rarity, type, dex, img] of index.cards) {
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
        title: `${name || '사진만 있는 카드'}${prod ? ` · ${prod}` : ''}${no ? ` ${no}` : ''}`,
        thumbnail: `${index.imageBase}${img}`,
        fullImage: full,
        meta: { lang: 'kr', name, set: cardSet, no, rarity, type, dex, product: index.products?.[id.slice(0, 9)]?.name || '' },
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
export const JP_DETAIL_URL = 'https://cdn.jsdelivr.net/gh/bsw3013/pokemon-card-app@card-index/jp-detail.json';
let jpDetailPromise = null;
// 일본 카드 번호·레어도·도감 번호 (정보 자동 입력용, 없으면 null)
export function loadJpDetail() {
  if (!jpDetailPromise) {
    jpDetailPromise = fetch(JP_DETAIL_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return jpDetailPromise;
}

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
// NFKC: 전각 글자(２・Ｚ)를 반각(2・Z)으로 맞춘다 (폴리곤2·폴리곤Z)
const normJa = (s) => String(s || '').normalize('NFKC').replace(/[\s・･＝=]/g, '').replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60)).toLowerCase();

// names: 찾을 일본어 이름들, setCode: 세트 코드로도 찾기(선택)
// 일본 프로모 카드 세트: 코드가 "-P"로 끝나는 세트(SV-P, S-P, M-P …)와 예전 프로모 세트
const JP_PROMO_SETS = new Set(['XYP', 'SMP', 'BWP', 'DPP', 'DPtP', 'LP', 'PPP', 'WCP', 'SVJP', 'SMSMP']);
export const isJpPromoSet = (code) => /-P$/i.test(String(code || '')) || JP_PROMO_SETS.has(String(code || ''));
// 공식 사이트 이름에 섞여 있는 "&amp;" 같은 글자를 원래 글자로
const decodeHtml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// 최신 카드(카드 ID가 큰 것)부터 전부 보여준다
export function searchJpIndex(index, { names = [], setCode = '', promoOnly = false }, limit = 1000) {
  if (!index?.cards) return [];
  const keys = names.map(normJa).filter(Boolean);
  const set = String(setCode || '').trim().toLowerCase();
  const hits = [];
  for (const [id, rawName, cardSet, file] of index.cards) {
    const name = decodeHtml(rawName);
    const n = normJa(name);
    const nameHit = keys.length === 0 || keys.some((k) => n.includes(k));
    const setHit = !set || cardSet.toLowerCase() === set;
    if (nameHit && setHit && (!promoOnly || isJpPromoSet(cardSet))) {
      const url = `${index.imageBase}${cardSet}/${file}`;
      hits.push({ id: `jp_${id}`, source: `일본 공식 · ${cardSet}`, title: name, thumbnail: url, fullImage: url, meta: { lang: 'ja', id: String(id), name, set: cardSet } });
    }
  }
  return hits.sort((x, y) => Number(y.meta.id) - Number(x.meta.id)).slice(0, limit);
}

// ---------- 영어: TCGdex (+ 사진 없는 카드는 pokemontcg.io 사진) ----------
// 휴대폰 게임(Pokémon TCG Pocket) 세트는 실물 카드가 아니라서 뺀다
const POCKET_SET = /^(?:[AB]\d+[a-z]?|P-[AB])$/;
// TCGdex 세트 ID → pokemontcg.io 세트 ID (규칙으로 안 되는 것만)
const PTCG_SET = {
  lc: 'base6', 'sm3.5': 'sm35', 'sm7.5': 'sm75', 'swsh3.5': 'swsh35', 'swsh4.5': 'swsh45', 'swsh4.5sv': 'swsh45sv',
  'swsh10.5': 'pgo', 'swsh12.5': 'swsh12pt5', 'swsh12.5gg': 'swsh12pt5gg', cel25cc: 'cel25c',
  'sv10.5w': 'rsv10pt5', 'sv10.5b': 'zsv10pt5',
};
function ptcgImage(setId, localId) {
  let set = PTCG_SET[setId];
  // 맥도날드 프로모: 2019sm → mcd19
  if (!set && /^20\d\d[a-z]+$/.test(setId)) set = `mcd${setId.slice(2, 4)}`;
  if (!set) {
    // sv03.5 → sv3pt5, me02 → me2, sm11.5 → sm115
    set = /^(sv|me)\d/.test(setId) ? setId.replace(/^([a-z]+)0+(\d)/, '$1$2').replace('.5', 'pt5') : setId.replace('.', '');
  }
  const no = /^\d+$/.test(localId) ? String(Number(localId)) : localId;
  return { thumbnail: `https://images.pokemontcg.io/${set}/${no}.png`, fullImage: `https://images.pokemontcg.io/${set}/${no}_hires.png` };
}

let tcgdexSetOrder = null; // 세트 ID → 발매 순서 (TCGdex 세트 목록은 오래된 것부터 차례대로)
async function loadTcgdexSetOrder() {
  if (tcgdexSetOrder) return tcgdexSetOrder;
  try {
    const res = await fetch('https://api.tcgdex.net/v2/en/sets');
    const sets = res.ok ? await res.json() : [];
    const order = new Map((Array.isArray(sets) ? sets : []).map((x, i) => [x.id, i]));
    if (order.size) tcgdexSetOrder = order;
    return order;
  } catch {
    return new Map();
  }
}

// 최신 세트부터, 같은 세트는 번호 순. 사진이 안 열리는 카드는 사진 찾기 창이 알아서 숨긴다.
export async function searchTcgdexEn(name, limit = 400) {
  const [res, order] = await Promise.all([
    fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name)}`),
    loadTcgdexSetOrder(),
  ]);
  if (!res.ok) throw new Error(`TCGdex 응답 오류 (${res.status})`);
  const list = await res.json();
  const num = (v) => { const n = parseInt(String(v).replace(/^\D+/, ''), 10); return Number.isFinite(n) ? n : 9999; };
  const cards = (Array.isArray(list) ? list : [])
    .map((c) => ({ ...c, setId: String(c.id).slice(0, String(c.id).length - String(c.localId).length - 1) }))
    .filter((c) => c.setId && !POCKET_SET.test(c.setId))
    .sort((a, b) => (order.get(b.setId) ?? -1) - (order.get(a.setId) ?? -1) || num(a.localId) - num(b.localId))
    .slice(0, limit)
    .map((c) => {
      const img = c.image
        ? { thumbnail: `${c.image}/low.webp`, fullImage: `${c.image}/high.png`, source: 'TCGdex' }
        : { ...ptcgImage(c.setId, c.localId), source: 'pokemontcg.io' };
      return { id: `en_${c.id}`, title: `${c.name} · ${c.id}`, ...img, meta: { lang: 'en', name: c.name, set: c.setId } };
    });
  // pokemontcg.io 는 사진이 없으면 카드 뒷면 그림을 보내서(404), 미리 확인해서 뺀다
  const ok = await Promise.all(cards.map(async (r) => {
    if (r.source !== 'pokemontcg.io') return true;
    try {
      const head = await fetch(r.thumbnail, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      return head.ok;
    } catch {
      return false;
    }
  }));
  return cards.filter((_, i) => ok[i]);
}
