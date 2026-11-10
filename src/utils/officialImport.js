// 공식 카드 목록(한국 kr.json · 일본 jp.json · 영문 TCGdex)에서 카드 탭에 아직 없는 카드를 골라 한 번에 등록하기
//  - 한국판: 언어 "한국", 지금 세트 표의 세트에 (없는 세트는 새로 추가)
//  - 일본판: 언어 "일본"(일판 표시)으로 따로 등록. 세트 코드가 같으면 한국 세트를 같이 씀
//  - 영문판: 언어 "미국"(영문판 표시)으로 따로 등록. 세트 구성이 달라서 영문 세트(en-…)를 새로 만듦
// 이미 등록된 카드인지는 (1) 공식 카드 ID(officialId) (2) 같은 언어 + 세트 + 번호 로 판단한다.
import { buildSetIndex, findSetForCard, parseCardNo, setLabel } from './catalog';
import { cardLanguage } from './cardStats';
import { smartCase } from './imageSources';
import { koDexFromName, translateEn, translateJa } from './cardAutofill';

const text = (v) => String(v ?? '').trim();
const pad = (n, w) => String(n).padStart(w, '0');

export const LANGS = {
  kr: { label: '한국판', cardLang: '한국', badge: '' },
  ja: { label: '일본판', cardLang: '일본', badge: '일판' },
  en: { label: '영문판', cardLang: '미국', badge: '영문판' },
};

// 카드의 언어 → kr / ja / en
export function langKeyOf(card) {
  const l = cardLanguage(card);
  if (l.includes('일본')) return 'ja';
  if (l.includes('미국') || l.includes('영')) return 'en';
  if (l.includes('한국')) return 'kr';
  return 'other';
}

// 세트 코드로 시대 추측 (세트·레어도 표의 "시대" 칸)
export function eraOf(code) {
  const c = text(code).toLowerCase().replace(/^en-/, '');
  if (/^swsh/.test(c)) return '소드&실드';
  if (/^sv/.test(c)) return '스칼렛&바이올렛';
  if (/^sm/.test(c)) return '썬&문';
  if (/^(me|m\d|m-|mc|mb|mp)/.test(c)) return '메가';
  if (/^(s\d|s-|sc|sp|sa|sh|sj|sk|sn|so)/.test(c)) return '소드&실드';
  if (/^xy/.test(c)) return 'XY';
  if (/^bw/.test(c)) return '블랙&화이트';
  return '기타';
}

// 공식 사이트 폴더 이름 → 세트 표 코드 모양 ('SV9' → 'sv9', 'M1L' → 'm1L', 'S8a-P' → 's8a-P', 'M-P' → 'M-P')
export function catalogCode(raw) {
  const m = text(raw).match(/^([A-Za-z]+)(\d.*)$/);
  return m ? `${m[1].toLowerCase()}${m[2]}` : text(raw);
}

// 일본 프로모 세트 이름 (세트 표에 없을 때 새로 만들 이름)
const JP_SET_NAMES = {
  'M-P': '메가 프로모', 'SV-P': 'SV 프로모', 'S-P': '소드&실드 프로모', SMP: '썬&문 프로모', 'SM-P': '썬&문 프로모',
  XYP: 'XY 프로모', 'XY-P': 'XY 프로모', BWP: 'BW 프로모', DPP: 'DP 프로모', DPtP: 'DPt 프로모', LP: 'LEGEND 프로모',
  'S8a-P': '25주년 프로모팩', SVJP: 'SV 프로모', WCP: '월드 챔피언십 프로모', SMSMP: '썬&문 프로모',
};
const isJpPromo = (code) => /-P$/i.test(code) || ['XYP', 'SMP', 'BWP', 'DPP', 'DPtP', 'LP', 'PPP', 'WCP', 'SVJP', 'SMSMP'].includes(code);

const KIND_WORDS = [['하이클래스팩', '하이클래스팩'], ['강화 확장팩', '강화 확장팩'], ['스타트', '스타터 덱'], ['스타터', '스타터 덱'], ['덱', '스타터 덱'], ['프로모', '프로모'], ['확장팩', '확장팩']];
const kindOf = (productName) => (KIND_WORDS.find(([w]) => text(productName).includes(w)) || [null, '기타'])[1];
const shortName = (productName) => { const m = text(productName).match(/「(.+?)」/); return m ? m[1] : text(productName); };

// 영문 레어도 → 세트 표 레어도 코드 (모르는 건 영어 그대로)
const EN_RARITY = {
  Common: 'C', Uncommon: 'U', Rare: 'R', 'Rare Holo': 'R', 'Double rare': 'RR', 'Illustration rare': 'AR',
  'Special illustration rare': 'SAR', 'Ultra Rare': 'SR', 'Hyper rare': 'UR', 'Shiny rare': 'S', 'Shiny Ultra Rare': 'SSR',
  'Mega Hyper Rare': 'MUR', 'Black White Rare': 'BWR', 'ACE SPEC Rare': 'ACE', None: '',
};
const EN_TYPE = { Supporter: '서포트', Item: '도구', Tool: '도구', 'Pokémon Tool': '도구', Stadium: '스타디움' };

// ---------- 공식 카드 한 장의 공통 모양 ----------
// { oid, lang, setKey, name, nameOk, num, noText, rarity, type, dex, img, thumb }

// 한국판: 세트(폴더)별로 묶는다. 최신 상품부터.
export function buildKrGroups(index) {
  if (!index?.cards) return [];
  const groups = new Map();
  for (const [id, name, folder, no, rarity, type, dex, img] of index.cards) {
    const key = text(folder);
    if (!key) continue;
    const productId = String(id).slice(0, 9);
    const product = index.products?.[productId]?.name || '';
    if (!groups.has(key)) groups.set(key, { key, lang: 'kr', raw: key, name: shortName(product), kind: kindOf(product), order: productId, cards: [] });
    const g = groups.get(key);
    if (productId > g.order) g.order = productId;
    const first = text(no).split('/')[0];
    const dexNo = Number(dex) || (type === '포켓몬' ? koDexFromName(name) : 0);
    g.cards.push({
      oid: `kr:${id}`, lang: 'kr', setKey: key, name: text(name), nameOk: true,
      num: /^\d+$/.test(first) ? Number(first) : parseCardNo(first), noText: text(no),
      rarity: text(rarity), type: text(type), dex: dexNo,
      img: `${index.imageBase}${String(img).replace(/\.webp$/i, '.png')}`, thumb: `${index.imageBase}${img}`,
    });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cards: g.cards.sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999)), total: g.cards.length }))
    .sort((a, b) => b.order.localeCompare(a.order));
}

// 일본판: 세트별로 묶는다. 카드 ID가 큰(최신) 세트부터. 번호·레어도는 상세 목록(jp-detail.json)이 있을 때만.
export function buildJpGroups(index, detail) {
  if (!index?.cards) return [];
  const groups = new Map();
  for (const [id, rawName, set, file] of index.cards) {
    const key = text(set);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, lang: 'ja', raw: key, name: JP_SET_NAMES[key] || '', kind: isJpPromo(key) ? '프로모' : '기타', order: 0, cards: [] });
    const g = groups.get(key);
    if (Number(id) > g.order) g.order = Number(id);
    const jaName = String(rawName || '').replace(/&amp;/g, '&');
    const tr = translateJa(jaName);
    const [no, rarity, dex] = detail?.cards?.[id] || [];
    const first = text(no).split('/')[0];
    g.cards.push({
      oid: `jp:${id}`, lang: 'ja', setKey: key, name: tr?.name || jaName, nameOk: !!tr, original: jaName,
      num: first ? parseCardNo(first) : null, noText: text(no),
      rarity: text(rarity), type: tr ? '포켓몬' : '', dex: Number(dex) || tr?.dex || 0,
      img: `${index.imageBase}${key}/${file}`, thumb: `${index.imageBase}${key}/${file}`,
    });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cards: g.cards.sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999) || Number(a.oid.slice(3)) - Number(b.oid.slice(3))), total: g.cards.length }))
    .sort((a, b) => b.order - a.order);
}

// ---------- 영문판: TCGdex (GraphQL, 키 없이 무료) ----------
const TCGDEX_GQL = 'https://api.tcgdex.net/v2/graphql';
async function gql(query) {
  const res = await fetch(TCGDEX_GQL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`TCGdex 응답 오류 (${res.status})`);
  const json = await res.json();
  if (!json.data) throw new Error(json.errors?.[0]?.message || 'TCGdex 응답 오류');
  return json.data;
}

let enSetsPromise = null;
// 영문 세트 목록 (휴대폰 게임 TCG Pocket 세트는 뺌). 최신 세트부터.
export function loadEnSets() {
  if (!enSetsPromise) {
    enSetsPromise = gql('{ sets { id name releaseDate cardCount { official total } serie { id } } }')
      .then((d) => (d.sets || [])
        .filter((s) => s.serie?.id !== 'tcgp' && !/^(?:[AB]\d+[a-z]?|P-[AB])$/.test(s.id))
        .map((s) => ({ key: s.id, lang: 'en', raw: s.id, name: s.name, kind: /p$/.test(s.id) ? '프로모' : '확장팩', releaseDate: text(s.releaseDate), printedTotal: s.cardCount?.official || null, total: s.cardCount?.total || 0, cards: null }))
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)))
      .catch((err) => { enSetsPromise = null; throw err; });
  }
  return enSetsPromise;
}

// 영문 세트 한 개의 카드 (이름·번호·레어도·종류·도감 번호·사진)
export async function loadEnSetCards(setId) {
  const d = await gql(`{ cards(filters: { id: "${String(setId).replace(/"/g, '')}-" }) { id localId name image rarity category trainerType dexId } }`);
  return (d.cards || [])
    .filter((c) => String(c.id).startsWith(`${setId}-`))
    .map((c) => {
      const tr = translateEn(c.name);
      const num = /^\d+$/.test(text(c.localId)) ? Number(c.localId) : parseCardNo(c.localId);
      const type = c.category === 'Pokemon' ? '포켓몬' : c.category === 'Energy' ? '에너지' : (EN_TYPE[c.trainerType] || (c.category === 'Trainer' ? '도구' : ''));
      const rarity = c.rarity in EN_RARITY ? EN_RARITY[c.rarity] : text(c.rarity);
      return {
        oid: `en:${c.id}`, lang: 'en', setKey: setId, name: tr?.name || text(c.name), nameOk: !!tr, original: text(c.name),
        num, noText: text(c.localId), rarity, type,
        dex: Number(c.dexId?.[0]) || tr?.dex || 0,
        img: c.image ? `${c.image}/high.png` : '', thumb: c.image ? `${c.image}/low.webp` : '',
      };
    })
    .filter((c) => c.img)
    .sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999));
}

// ---------- 세트 표에서 세트 찾기 / 새로 만들기 ----------
export function enCatalogCode(setId) {
  return `en-${String(setId).toLowerCase().replace(/\./g, 'pt')}`;
}

// 공식 세트(group)를 넣을 세트 표 세트. 없으면 새 세트 { isNew: true }
export function targetSet(group, sets) {
  const index = buildSetIndex(sets);
  if (group.lang === 'en') {
    const code = enCatalogCode(group.key);
    const found = index.byCode.get(code);
    if (found) return found;
    return { isNew: true, code, name: group.name || group.key, era: eraOf(group.key), kind: group.kind || '확장팩', releaseDate: group.releaseDate || '', printedTotal: group.printedTotal || null, label: `${code} -「${group.name || group.key}」` };
  }
  const found = index.byCode.get(text(group.key).toLowerCase());
  if (found) return found;
  const code = catalogCode(group.key);
  const name = group.name || code;
  return { isNew: true, code, name, era: eraOf(code), kind: group.kind || '기타', releaseDate: '', printedTotal: null, label: `${code} -「${name}」` };
}

// ---------- 이미 등록된 카드 ----------
// 카드 탭의 카드로 "이미 있는 카드" 표를 만든다: 공식 ID + (언어|세트 코드|번호)
export function buildRegistry(cards, sets) {
  const index = buildSetIndex(sets);
  const ids = new Set();
  const keys = new Set();
  (cards || []).forEach((c) => {
    if (c.officialId) ids.add(c.officialId);
    const set = findSetForCard(c, index);
    const no = c.cardNo ?? parseCardNo(c.cardNumber);
    if (set && no != null) keys.add(`${langKeyOf(c)}|${text(set.code).toLowerCase()}|${no}`);
  });
  return { ids, keys };
}

export function isRegistered(card, set, registry) {
  if (registry.ids.has(card.oid)) return true;
  return card.num != null && registry.keys.has(`${card.lang}|${text(set?.code).toLowerCase()}|${card.num}`);
}

// 공식 카드 → 카드 탭에 저장할 내용 (마스터 정보 + 내 보유 현황)
export function toCardPayload(card, set) {
  const number = card.num != null ? `${smartCase(set.code)}-${pad(card.num, 3)}` : '';
  return {
    master: {
      cardName: card.name,
      series: setLabel(set),
      cardNumber: number,
      rarity: card.rarity || '',
      type: card.type || '',
      pokedexNumber: card.type === '포켓몬' && card.dex ? pad(card.dex, 4) : '',
      imageUrl: card.img,
      officialId: card.oid,
    },
    ownership: card.lang === 'kr' ? null : { status: '미보유', language: LANGS[card.lang].cardLang, possessions: [] },
  };
}

// 등록할 카드에 필요한 새 레어도 (세트 표에 없는 것)
export function missingRarities(cards, rarities) {
  const have = new Set((rarities || []).map((r) => text(r.code).toUpperCase()));
  const out = [];
  let order = Math.max(40, ...(rarities || []).map((r) => Number(r.order) || 0)) + 1;
  (cards || []).forEach((c) => {
    const code = text(c.rarity);
    if (!code || have.has(code.toUpperCase())) return;
    have.add(code.toUpperCase());
    out.push({ code, order, group: '기타' });
    order += 1;
  });
  return out;
}

// 일본 상세 목록이 늦게 모였을 때: 이미 등록한 일판 카드의 빈 번호·레어도 채우기
export function jpDetailPatches(cards, detail, sets) {
  if (!detail?.cards) return [];
  const index = buildSetIndex(sets);
  const out = [];
  (cards || []).forEach((c) => {
    const m = String(c.officialId || '').match(/^jp:(\d+)$/);
    if (!m) return;
    const [no, rarity, dex] = detail.cards[m[1]] || [];
    const patch = {};
    const first = text(no).split('/')[0];
    const set = findSetForCard(c, index);
    if (!text(c.cardNumber) && first && set) patch.cardNumber = `${smartCase(set.code)}-${/^\d+$/.test(first) ? pad(Number(first), 3) : first}`;
    if (!text(c.rarity) && text(rarity)) patch.rarity = text(rarity);
    if (!text(c.pokedexNumber) && Number(dex) && text(c.type) === '포켓몬') patch.pokedexNumber = pad(Number(dex), 4);
    if (Object.keys(patch).length) out.push({ id: c.id, patch });
  });
  return out;
}
