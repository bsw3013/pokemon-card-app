// 사진 찾기에서 사진을 고르면, 그 사진의 공식 정보로 카드 정보 칸을 채운다.
// 규칙: 이미 적혀 있는 칸은 절대 바꾸지 않고, 비어 있는 칸만 채운다.
//  - 한국판(목록): 이름·세트·번호·레어도·종류·도감 번호
//  - 한국판(세트 코드-번호로 만든 사진): 세트·번호
//  - 일본판: 세트·번호·레어도(일본 상세 목록이 있을 때), 포켓몬이면 이름(한글로 번역)·도감 번호
//  - 영문판: 포켓몬이면 이름(한글로 번역)만 (영문판은 세트 구성·번호가 달라서 채우지 않음)
import pokemonMapAll from './pokemonMapAll.json';
import { setLabel } from './catalog';
import { smartCase } from './imageSources';

const { krToEn, krToJa } = pokemonMapAll;
const krNames = Object.keys(krToJa || krToEn || {});
const dexOf = new Map(krNames.map((n, i) => [n, i + 1]));
const jaToKr = new Map(Object.entries(krToJa || {}).map(([k, v]) => [String(v).normalize('NFKC'), k]));
const enToKr = new Map(Object.entries(krToEn || {}).map(([k, v]) => [String(v).toLowerCase(), k]));

const text = (v) => String(v ?? '').trim();
const pad = (n, w) => String(n).padStart(w, '0');

const JA_SUFFIX = /\s*(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|δ|☆|◇|プリズムスター)$/u;
const JA_REGION = [['ヒスイ', '히스이'], ['アローラ', '알로라'], ['ガラル', '가라르'], ['パルデア', '팔데아']];
// 일본어 포켓몬 카드 이름 → 한글 (트레이너 카드 등 번역표에 없으면 null)
function translateJa(raw) {
  let name = String(raw || '').replace(/<[^>]+>/g, '').normalize('NFKC').trim();
  const mega = /^メガ|^M(?=[ァ-ヿ])/.test(name);
  name = name.replace(/^メガ|^M(?=[ァ-ヿ])/, '');
  let region = '';
  JA_REGION.forEach(([ja, ko]) => { if (name.startsWith(ja)) { region = ko; name = name.slice(ja.length).trim(); } });
  const suf = name.match(JA_SUFFIX);
  let base = suf ? name.slice(0, suf.index).trim() : name;
  // 메가리자몽 X / Y 처럼 끝에 X·Y가 붙는 폼
  const form = mega ? base.match(/([XY])$/) : null;
  if (form) base = base.slice(0, -1).trim();
  const ko = jaToKr.get(base);
  if (!ko) return null;
  const suffix = `${form ? ` ${form[1]}` : ''}${suf ? ` ${suf[1]}` : ''}`;
  return { name: `${region ? `${region} ` : ''}${mega ? '메가' : ''}${ko}${suffix}`, dex: dexOf.get(ko) || 0 };
}

const EN_SUFFIX = /\s+(ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.X|δ)$/u;
const EN_REGION = [['Hisuian ', '히스이'], ['Alolan ', '알로라'], ['Galarian ', '가라르'], ['Paldean ', '팔데아']];
function translateEn(raw) {
  let name = String(raw || '').trim();
  const mega = /^(Mega|M) /.test(name);
  name = name.replace(/^(Mega|M) /, '');
  let region = '';
  EN_REGION.forEach(([en, ko]) => { if (name.startsWith(en)) { region = ko; name = name.slice(en.length); } });
  const suf = name.match(EN_SUFFIX);
  const base = suf ? name.slice(0, suf.index).trim() : name;
  const ko = enToKr.get(base.toLowerCase());
  if (!ko) return null;
  return { name: `${region ? `${region} ` : ''}${mega ? '메가' : ''}${ko}${suf ? ` ${suf[1]}` : ''}`, dex: dexOf.get(ko) || 0 };
}

const productShort = (name) => { const m = String(name || '').match(/「(.+?)」/); return m ? m[1] : ''; };

// 공식 정보 → 채울 값 (아직 빈 칸 여부는 따지지 않음)
async function officialInfo(meta, { sets, loadJpDetail }) {
  if (!meta) return {};
  const findSet = (code) => (sets || []).find((x) => text(x.code).toLowerCase() === text(code).toLowerCase()) || null;
  const numberText = (code, no) => {
    const first = text(no).split('/')[0];
    if (!code || !first) return '';
    const n = /^\d+$/.test(first) ? pad(Number(first), 3) : first;
    return `${smartCase(code)}-${n}`;
  };
  const seriesFor = (code, product) => {
    const set = findSet(code);
    if (set) return setLabel(set);
    const short = productShort(product);
    return short ? `${text(code).toLowerCase()} -「${short}」` : '';
  };

  if (meta.lang === 'kr') {
    return {
      cardName: meta.name,
      series: seriesFor(meta.set, meta.product),
      cardNumber: numberText(findSet(meta.set)?.code || meta.set, meta.no),
      rarity: meta.rarity,
      type: meta.type,
      pokedexNumber: meta.type === '포켓몬' && meta.dex ? pad(meta.dex, 4) : '',
    };
  }
  if (meta.lang === 'kr-code') {
    return { series: seriesFor(meta.set, ''), cardNumber: numberText(findSet(meta.set)?.code || meta.set, meta.no) };
  }
  if (meta.lang === 'ja') {
    const tr = translateJa(meta.name);
    const detail = await loadJpDetail().catch(() => null);
    const [no, rarity, dex] = detail?.cards?.[meta.id] || [];
    const set = findSet(meta.set);
    return {
      cardName: tr?.name || '',
      series: set ? setLabel(set) : '',
      cardNumber: set && no ? numberText(set.code, no) : '',
      rarity: rarity || '',
      pokedexNumber: (dex || tr?.dex) ? pad(dex || tr.dex, 4) : '',
    };
  }
  if (meta.lang === 'en') {
    const tr = translateEn(meta.name);
    return { cardName: tr?.name || '' };
  }
  return {};
}

export const AUTOFILL_LABELS = { cardName: '카드 이름', series: '세트', cardNumber: '카드 번호', rarity: '레어도', type: '종류', pokedexNumber: '도감 번호' };

// 비어 있는 칸만 골라 채울 값을 돌려준다. 예) { series: 'sv9 -「배틀파트너즈」', cardNumber: 'SV9-006' }
export async function autofillFromMeta(meta, current, opts) {
  const info = await officialInfo(meta, opts);
  const fills = {};
  Object.keys(AUTOFILL_LABELS).forEach((k) => {
    const v = text(info[k]);
    if (v && !text(current?.[k])) fills[k] = v;
  });
  return fills;
}
