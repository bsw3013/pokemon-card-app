// 세트(확장팩) 표와 레어도 표.
// Firestore `settings/catalog` 문서 하나에 { sets: [...], rarities: [...] } 로 저장한다.
// 문서가 아직 없으면 아래 기본값을 쓴다. (마스터 설정 → 세트·레어도 관리에서 "표 만들기"로 저장)
//
// 세트 한 줄: { code, name, label, era, kind, releaseDate, printedTotal }
//   code         세트 고유 이름표. 카드의 setCode 와 같다. (예: 'sv2a')
//   name         화면에 보이는 이름 (예: '포켓몬 카드 151')
//   label        예전부터 카드의 series 칸에 쓰던 글자. 기존 화면·데이터와 맞추려고 그대로 둔다.
//   era          시대 (메가 / 스칼렛&바이올렛 / 소드&실드 / 썬&문 / XY / 블랙&화이트 / 기타)
//   kind         종류 (확장팩 / 강화 확장팩 / 하이클래스팩 / 스타터 덱 / 프로모 / 기타)
//   releaseDate  한국 발매일 'YYYY-MM-DD' (공식 사이트 pokemoncard.co.kr 기준, 모르면 '')
//   printedTotal 카드에 인쇄된 "/165" 의 숫자 (모르면 null)
//
// 레어도 한 줄: { code, order, group }
//   order 가 클수록 높은 레어도. group 은 일반 / 힛카드 / 기타.

export const ERA_OPTIONS = ['메가', '스칼렛&바이올렛', '소드&실드', '썬&문', 'XY', '블랙&화이트', '기타'];
export const KIND_OPTIONS = ['확장팩', '강화 확장팩', '하이클래스팩', '스타터 덱', '프로모', '기타'];
export const RARITY_GROUPS = ['일반', '힛카드', '기타'];

// 레어도를 화면에 늘어놓을 때 쓰는 비교 함수: 힛카드(높은 것부터) → 일반(높은 것부터) → 기타 → 미분류
export function makeRarityCompare(rarities) {
  const info = new Map((rarities || []).map((r) => [String(r.code || '').trim(), r]));
  const groupRank = { 힛카드: 0, 일반: 1, 기타: 2 };
  const key = (code) => {
    const r = info.get(String(code || '').trim());
    if (!r) return [3, 0];
    const g = groupRank[r.group] ?? 2;
    const order = Number(r.order) || 0;
    return [g, g === 2 ? order : -order]; // 기타는 설정 순서대로, 나머지는 높은 레어도부터
  };
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  };
}

const S = (code, name, era, kind, releaseDate, printedTotal, label) => ({
  code, name, era, kind, releaseDate, printedTotal, label: label || `${code} -「${name}」`,
});

export const DEFAULT_SETS = [
  S('sc', '샤이니 컬렉션', '블랙&화이트', '확장팩', '2013-08-01', null),
  S('xy1x', 'X컬렉션', 'XY', '확장팩', '2014-03-01', 60, 'XY 확장팩 제1탄 「X컬렉션」'),
  S('xy1y', 'Y컬렉션', 'XY', '확장팩', '2014-03-01', 60, 'XY 확장팩 제1탄 「Y컬렉션」'),
  S('CP3', '포켓심쿵 컬렉션', 'XY', '확장팩', '2016-04-01', 32, 'CP3 - 「XY BREAK 확장팩 포켓심쿵 컬렉션」'),
  S('xy20th', 'BASE PACK 20th Anniversary', 'XY', '확장팩', '2016-09-29', 100, 'XY BREAK 확장팩 BASE PACK 20th Anniversary'),
  S('sm6a', '드래곤스톰', '썬&문', '강화 확장팩', '2018-06-01', 53),
  S('sm6b', '챔피언로드', '썬&문', '강화 확장팩', '2018-07-02', null),
  S('sm8b', '울트라샤이니', '썬&문', '하이클래스팩', '2019-02-28', 150),
  S('sm9b', '풀메탈월', '썬&문', '강화 확장팩', '2019-04-12', 54),
  S('sm10', '더블블레이즈', '썬&문', '확장팩', '2019-05-10', 95, 'sm10'),
  S('sm10b', '스카이레전드', '썬&문', '강화 확장팩', '2019-07-10', 54),
  S('sm11', '미라클트윈', '썬&문', '확장팩', '2019-08-07', 94, 'sm11'),
  S('sm11a', '리믹스바우트', '썬&문', '강화 확장팩', '2019-09-10', 64),
  S('sm11b', '드림리그', '썬&문', '강화 확장팩', '2019-10-11', 49),
  S('sm12a', 'TAG TEAM GX 태그올스타즈', '썬&문', '하이클래스팩', '2019-12-06', 173),
  S('s5I', '일격마스터', '소드&실드', '확장팩', '2021-02-24', 70),
  S('s5R', '연격마스터', '소드&실드', '확장팩', '2021-02-24', 70),
  S('s6a', '이브이 히어로즈', '소드&실드', '강화 확장팩', '2021-08-11', 69),
  S('s7D', '마천퍼펙트', '소드&실드', '확장팩', '2021-09-08', 67),
  S('s7R', '창공스트림', '소드&실드', '확장팩', '2021-09-08', 67),
  S('s8a-P', '25주년 프로모팩', '소드&실드', '프로모', '2021-10-22', null),
  S('s8', '퓨전아츠', '소드&실드', '확장팩', '2021-12-01', 100),
  S('s8b', 'VMAX 클라이맥스', '소드&실드', '하이클래스팩', '2022-01-26', 184),
  S('s9', '스타버스', '소드&실드', '확장팩', '2022-02-23', 100),
  S('s9a', '배틀리전', '소드&실드', '강화 확장팩', '2022-04-27', 67),
  S('s10P', '스페이스 저글러', '소드&실드', '확장팩', '2022-05-20', 67),
  S('s10a', '다크판타스마', '소드&실드', '강화 확장팩', '2022-07-22', 71),
  S('s11', '로스트어비스', '소드&실드', '확장팩', '2022-09-02', 100),
  S('s11a', '백열의 아르카나', '소드&실드', '강화 확장팩', '2022-10-14', 68),
  S('s12', '패러다임트리거', '소드&실드', '확장팩', '2022-11-30', 98),
  S('s12a', 'VSTAR 유니버스', '소드&실드', '하이클래스팩', '2023-01-13', 172),
  S('sv1S', '스칼렛 ex', '스칼렛&바이올렛', '확장팩', '2023-03-15', 78),
  S('sv1V', '바이올렛 ex', '스칼렛&바이올렛', '확장팩', '2023-03-15', 78),
  S('sv1a', '트리플렛비트', '스칼렛&바이올렛', '강화 확장팩', '2023-05-03', 73),
  S('sv2D', '클레이버스트', '스칼렛&바이올렛', '확장팩', '2023-06-14', 71),
  S('sv2P', '스노해저드', '스칼렛&바이올렛', '확장팩', '2023-06-14', 71),
  S('sv2a', '포켓몬 카드 151', '스칼렛&바이올렛', '강화 확장팩', '2023-07-28', 165),
  S('sv3', '흑염의 지배자', '스칼렛&바이올렛', '확장팩', '2023-08-25', 108, 'sv3 - 「흑염의 지배자」'),
  S('sv3a', '레이징서프', '스칼렛&바이올렛', '강화 확장팩', '2023-10-20', 62),
  S('sv4K', '고대의 포효', '스칼렛&바이올렛', '확장팩', '2023-11-30', 66),
  S('sv4M', '미래의 일섬', '스칼렛&바이올렛', '확장팩', '2023-11-30', 66),
  S('sv4a', '샤이니트레저 ex', '스칼렛&바이올렛', '하이클래스팩', '2024-01-26', 190),
  S('sv5K', '와일드포스', '스칼렛&바이올렛', '확장팩', '2024-03-06', 71),
  S('sv5M', '사이버저지', '스칼렛&바이올렛', '확장팩', '2024-03-06', 71),
  S('sv5a', '크림슨헤이즈', '스칼렛&바이올렛', '강화 확장팩', '2024-05-24', 66),
  S('sv6', '변환의 가면', '스칼렛&바이올렛', '확장팩', '2024-06-21', 101),
  S('sv6a', '나이트원더러', '스칼렛&바이올렛', '강화 확장팩', '2024-08-09', 64),
  S('sv7', '스텔라미라클', '스칼렛&바이올렛', '확장팩', '2024-09-06', 102),
  S('sv7a', '낙원드래고나', '스칼렛&바이올렛', '강화 확장팩', '2024-10-30', 64),
  S('sv8', '초전브레이커', '스칼렛&바이올렛', '확장팩', '2024-11-27', 106),
  S('sv8a', '테라스탈 페스타 ex', '스칼렛&바이올렛', '하이클래스팩', '2025-01-22', 187),
  S('sv9', '배틀파트너즈', '스칼렛&바이올렛', '확장팩', '2025-03-21', 100),
  S('svOD', '성호의 메탕&메타그로스 ex', '스칼렛&바이올렛', '스타터 덱', '2025-04-25', null),
  S('svOM', '마리의 모르페코&오롱털 ex', '스칼렛&바이올렛', '스타터 덱', '2025-04-25', null),
  S('sv9a', '열풍의 아레나', '스칼렛&바이올렛', '강화 확장팩', '2025-05-16', 63),
  S('sv10', '로켓단의 영광', '스칼렛&바이올렛', '확장팩', '2025-06-20', 98),
  S('sv11B', '블랙볼트', '스칼렛&바이올렛', '확장팩', '2025-08-01', 86),
  S('sv11W', '화이트플레어', '스칼렛&바이올렛', '확장팩', '2025-08-01', 86),
  S('m1L', '메가 브레이브', '메가', '확장팩', '2025-09-26', 63),
  S('m1S', '메가 심포니아', '메가', '확장팩', '2025-09-26', 63),
  S('m2', '인페르노X', '메가', '확장팩', '2025-11-28', 80),
  S('m2a', '메가드림', '메가', '하이클래스팩', '2026-01-23', 193),
  S('MC', 'MEGA 스타트 덱 100 배틀컬렉션', '메가', '스타터 덱', '2026-02-13', null, 'MC - MEGA「스타트 덱 100 배틀컬렉션」'),
  S('m3', '니힐제로', '메가', '확장팩', '2026-03-13', 80),
  S('m4', '닌자스피너', '메가', '확장팩', '2026-05-01', 83),
  S('m5', '어비스아이', '메가', '확장팩', '2026-06-26', 81),
  S('m6', '스톰에메랄다', '메가', '확장팩', '2026-08-21', 76),
  S('m6a', '30th CELEBRATION', '메가', '확장팩', '2026-09-16', 103),
  S('promo', '프로모 카드', '기타', '프로모', '', null, 'PROMO'),
];

const R = (code, order, group) => ({ code, order, group });

export const DEFAULT_RARITIES = [
  R('C', 1, '일반'), R('U', 2, '일반'), R('R', 3, '일반'), R('RR', 4, '일반'), R('RRR', 5, '일반'),
  R('S', 10, '힛카드'), R('A', 11, '힛카드'), R('MA', 12, '힛카드'), R('AR', 13, '힛카드'),
  R('CHR', 14, '힛카드'), R('CSR', 15, '힛카드'), R('SR', 16, '힛카드'), R('SSR', 17, '힛카드'),
  R('SAR', 18, '힛카드'), R('HR', 19, '힛카드'), R('UR', 20, '힛카드'), R('BWR', 21, '힛카드'), R('MUR', 22, '힛카드'),
  R('PROMO', 30, '기타'), R('기타 AR', 31, '기타'), R('없음', 32, '기타'),
];

const norm = (v) => String(v ?? '').trim();
const lower = (v) => norm(v).toLowerCase();

export function setLabel(set) {
  if (!set) return '';
  return norm(set.label) || `${norm(set.code)} -「${norm(set.name)}」`;
}

// 발매일 순(오래된 것 먼저). 발매일이 없는 세트는 맨 뒤.
export function sortSets(sets = []) {
  return [...sets].sort((a, b) => {
    const da = norm(a.releaseDate);
    const dbb = norm(b.releaseDate);
    if (da && dbb && da !== dbb) return da.localeCompare(dbb);
    if (!da !== !dbb) return da ? -1 : 1;
    return norm(a.code).localeCompare(norm(b.code));
  });
}

export function sortRarities(rarities = []) {
  return [...rarities].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

// 예전 series 글자에서 앞쪽 세트 코드를 뽑는다. 'sv2a -「포켓몬 카드 151」' → 'sv2a'
export function codeFromSeriesText(series) {
  const m = norm(series).match(/^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)?)\s*-\s*/);
  return m ? m[1] : '';
}

// 'sv2a -「포켓몬 카드 151」' → '포켓몬 카드 151'
export function nameFromSeriesText(series) {
  const m = norm(series).match(/「([^」]+)」/);
  return m ? m[1].trim() : norm(series);
}

// 카드번호에서 정렬용 숫자만 뽑는다.
// 'SV2a-169' → 169, '106/100' → 106, 'SV-P-0163' → 163, 'S8a-P-21' → 21, '' → null
export function parseCardNo(cardNumber) {
  const text = norm(cardNumber);
  if (!text) return null;
  const slash = text.match(/^(\d+)\s*\//);
  if (slash) return Number(slash[1]);
  const last = text.match(/(\d+)\D*$/);
  return last ? Number(last[1]) : null;
}

// 세트를 빨리 찾기 위한 색인
export function buildSetIndex(sets = []) {
  const byCode = new Map();
  const byLabel = new Map();
  sets.forEach((s) => {
    if (norm(s.code)) byCode.set(lower(s.code), s);
    if (setLabel(s)) byLabel.set(setLabel(s), s);
  });
  return { byCode, byLabel };
}

// 카드가 어느 세트에 속하는지 찾는다. (setCode → series 글자 → series 앞 코드 → 카드번호 앞부분 순서)
export function findSetForCard(card, index) {
  if (!card || !index) return null;
  const bySetCode = index.byCode.get(lower(card.setCode));
  if (bySetCode) return bySetCode;
  const byLabel = index.byLabel.get(norm(card.series));
  if (byLabel) return byLabel;
  const seriesCode = codeFromSeriesText(card.series);
  if (seriesCode && index.byCode.get(lower(seriesCode))) return index.byCode.get(lower(seriesCode));
  const numberPrefix = norm(card.cardNumber).match(/^([A-Za-z][A-Za-z0-9]*)-/);
  if (numberPrefix && !norm(card.series) && index.byCode.get(lower(numberPrefix[1]))) {
    return index.byCode.get(lower(numberPrefix[1]));
  }
  return null;
}

// 기본값 + 지금 쓰고 있는 시리즈/레어도 목록을 합쳐 처음 저장할 세트·레어도 표를 만든다.
// 기본값에 없는 시리즈·레어도도 빠짐없이 표에 넣는다(정보 칸은 빈칸으로).
export function buildInitialCatalog({ seriesOptions = [], rarityOptions = [], cards = [] } = {}) {
  const sets = DEFAULT_SETS.map((s) => ({ ...s }));
  const index = buildSetIndex(sets);
  const seriesTexts = new Set([...seriesOptions, ...cards.map((c) => c.series)].map(norm).filter(Boolean));
  seriesTexts.forEach((text) => {
    if (index.byLabel.has(text)) return;
    const code = codeFromSeriesText(text);
    if (code && index.byCode.has(lower(code))) return;
    const newSet = { code: code || text, name: nameFromSeriesText(text), label: text, era: '기타', kind: '기타', releaseDate: '', printedTotal: null };
    sets.push(newSet);
    index.byCode.set(lower(newSet.code), newSet);
    index.byLabel.set(text, newSet);
  });

  const rarities = DEFAULT_RARITIES.map((r) => ({ ...r }));
  const known = new Set(rarities.map((r) => r.code));
  let nextOrder = 40;
  const rarityTexts = new Set([...rarityOptions, ...cards.map((c) => c.rarity)].map(norm).filter(Boolean));
  rarityTexts.forEach((code) => {
    if (known.has(code)) return;
    rarities.push({ code, order: nextOrder, group: '기타' });
    known.add(code);
    nextOrder += 1;
  });

  return { sets: sortSets(sets), rarities: sortRarities(rarities) };
}

// 세트·레어도 표를 기존 설정(appConfig)의 선택지 목록에 반영한다.
// 화면 대부분이 아직 seriesOptions/rarityOptions(글자 목록)를 쓰기 때문에,
// 표의 순서(발매일 순, 레어도 순)대로 글자 목록을 다시 만들어 넣어준다.
export function applyCatalogToConfig(config, catalog) {
  if (!config) return config;
  if (!catalog || !Array.isArray(catalog.sets) || !Array.isArray(catalog.rarities)) {
    return { ...config, catalog: null };
  }
  return {
    ...config,
    seriesOptions: sortSets(catalog.sets).map(setLabel).filter(Boolean),
    rarityOptions: sortRarities(catalog.rarities).map((r) => norm(r.code)).filter(Boolean),
    catalog,
  };
}

// 카드 정보를 저장할 때 자동으로 붙이는 칸들.
//   setCode : 세트 표에서 찾은 세트 코드 (못 찾으면 '')
//   cardNo  : 카드번호의 숫자 부분 (정렬용, 없으면 null)
//   updatedAt / createdAt : 수정·추가 시각
// master 는 이번에 저장할 칸들, existing 은 원래 카드(새 카드면 빈 객체).
export function withCardMeta(master, { setIndex, existing = {}, isNew = false, now = new Date().toISOString() } = {}) {
  const out = { ...master, updatedAt: now };
  if (isNew) out.createdAt = now;
  const touchesSet = ['series', 'cardNumber', 'setCode'].some((k) => k in master);
  if (setIndex && (touchesSet || isNew)) {
    const merged = { ...existing, ...master };
    // series 를 바꿨다면 예전 setCode 대신 새 series 기준으로 다시 찾는다.
    const lookup = 'setCode' in master ? merged : { ...merged, setCode: '' };
    const found = findSetForCard(lookup, setIndex);
    out.setCode = found ? found.code : '';
    out.cardNo = parseCardNo(merged.cardNumber);
  }
  return out;
}
