// 홈 대시보드 전용 순수 계산 함수 모음.
// 화면(React)과 완전히 분리되어 있어서 node 로 바로 import/실행해서 검증할 수 있다.
// firebase, JSON, vite 전용 문법은 쓰지 않는다. 포켓몬 이름 목록은 컴포넌트에서
// pokemonMapAll.json 을 읽어 배열로 만든 뒤 여기 함수들에 인자로 넘겨준다.
import { classifyStatus } from './statusUtils.js';

export const POKEDEX_MAX = 1025;

// 통계 탭(StatsDashboard)과 동일한 기준: owned 또는 graded 면 "보유"로 센다.
export function isOwnedOrGraded(card) {
  const type = classifyStatus(card?.status);
  return type === 'owned' || type === 'graded';
}

// 1) 내 컬렉션 요약 카드 (보유/미보유/등급카드/전체/완성률)
export function computeCollectionSummary(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const summary = { total: list.length, owned: 0, unowned: 0, graded: 0, ownedOrGraded: 0, percent: 0 };

  list.forEach((card) => {
    const type = classifyStatus(card?.status);
    if (type === 'owned') summary.owned += 1;
    else if (type === 'graded') summary.graded += 1;
    else summary.unowned += 1;
  });

  summary.ownedOrGraded = summary.owned + summary.graded;
  summary.percent = summary.total > 0 ? Math.round((summary.ownedOrGraded / summary.total) * 100) : 0;
  return summary;
}

// 2) 도감 번호 파싱: 문자열 안의 모든 숫자 덩어리를 뽑아 1~1025 범위인 것만,
//    같은 문자열 안에서 중복 없이 정수 배열로 돌려준다.
//    "0006"->[6]  "6"->[6]  "006-007"->[6,7]  "6, 6"->[6]  ""->[]  "2000"->[]  "0"->[]
export function extractPokedexNumbers(raw) {
  const str = String(raw ?? '');
  const matches = str.match(/\d+/g) || [];
  const seen = new Set();
  const result = [];
  matches.forEach((m) => {
    const num = parseInt(m, 10);
    if (!Number.isFinite(num) || num < 1 || num > POKEDEX_MAX) return;
    if (seen.has(num)) return;
    seen.add(num);
    result.push(num);
  });
  return result;
}

// 3) 전국도감 1~1025번 각각에 대해, 그 번호로 매칭되는 카드들을 모아
//    보유/미보유/카드없음 상태까지 판정한 항목 배열(1~1025 순서)을 만든다.
export function buildPokedexEntries(cards, pokemonNames) {
  const list = Array.isArray(cards) ? cards : [];
  const names = Array.isArray(pokemonNames) ? pokemonNames : [];

  const byNumber = new Map();
  for (let num = 1; num <= POKEDEX_MAX; num += 1) {
    byNumber.set(num, { number: num, name: names[num - 1] || '', cards: [] });
  }

  list.forEach((card) => {
    extractPokedexNumbers(card?.pokedexNumber).forEach((num) => {
      byNumber.get(num).cards.push(card);
    });
  });

  const entries = [];
  byNumber.forEach((entry) => {
    const ownedCount = entry.cards.filter(isOwnedOrGraded).length;
    const totalCount = entry.cards.length;
    let state = 'none';
    if (totalCount > 0) state = ownedCount > 0 ? 'owned' : 'unowned';
    entries.push({ ...entry, ownedCount, totalCount, state });
  });
  return entries;
}

// 4) 세대 구간 정의
export const GENERATIONS = [
  { label: '1세대', start: 1, end: 151 },
  { label: '2세대', start: 152, end: 251 },
  { label: '3세대', start: 252, end: 386 },
  { label: '4세대', start: 387, end: 493 },
  { label: '5세대', start: 494, end: 649 },
  { label: '6세대', start: 650, end: 721 },
  { label: '7세대', start: 722, end: 809 },
  { label: '8세대', start: 810, end: 905 },
  { label: '9세대', start: 906, end: 1025 },
];

export function computeGenerationStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return GENERATIONS.map((gen) => {
    const totalSpecies = gen.end - gen.start + 1;
    const ownedSpecies = list.filter((e) => e.number >= gen.start && e.number <= gen.end && e.state === 'owned').length;
    return { ...gen, ownedSpecies, totalSpecies };
  });
}

// 헤더에 쓰는 전체 집계: 보유종(보유 카드가 1장 이상 있는 번호 수),
// 카드가 있는 종(도감에 카드가 1장 이상 있는 번호 수)
export function computePokedexHeaderStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const ownedSpecies = list.filter((e) => e.state === 'owned').length;
  const speciesWithCards = list.filter((e) => e.state !== 'none').length;
  return { ownedSpecies, speciesWithCards, total: POKEDEX_MAX };
}

// 5) 도감 항목(한 번호)의 카드 목록 정렬: 보유 먼저 -> series -> cardNumber
export function sortEntryCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return [...list].sort((a, b) => {
    const aOwned = isOwnedOrGraded(a) ? 0 : 1;
    const bOwned = isOwnedOrGraded(b) ? 0 : 1;
    if (aOwned !== bOwned) return aOwned - bOwned;

    const aSeries = String(a?.series || '');
    const bSeries = String(b?.series || '');
    if (aSeries !== bSeries) return aSeries.localeCompare(bSeries, 'ko');

    const aNum = String(a?.cardNumber || '');
    const bNum = String(b?.cardNumber || '');
    return aNum.localeCompare(bNum, undefined, { numeric: true });
  });
}

// 6) 레어도 구성: 보유(owned/graded) 카드를 rarity 별로 세어, 개수 상위 N개 + 나머지를
//    합친 "기타" 구간으로 만든다. 색은 --home-chart-1 ~ 5 변수를 순서대로 매긴다.
export const RARITY_CHART_COLOR_VARS = [
  '--home-chart-1',
  '--home-chart-2',
  '--home-chart-3',
  '--home-chart-4',
  '--home-chart-5',
];

export function computeRarityComposition(cards, options = {}) {
  const topN = Number.isFinite(options.topN) ? options.topN : 4;
  const list = Array.isArray(cards) ? cards : [];
  const owned = list.filter(isOwnedOrGraded);
  if (owned.length === 0) return [];

  const counts = new Map();
  owned.forEach((card) => {
    const rarity = String(card?.rarity || '').trim() || '미분류';
    counts.set(rarity, (counts.get(rarity) || 0) + 1);
  });

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restSum = rest.reduce((sum, [, count]) => sum + count, 0);

  const segments = top.map(([label, count]) => ({ label, count }));
  if (restSum > 0) segments.push({ label: '기타', count: restSum });

  const total = owned.length;
  return segments.map((seg, i) => ({
    ...seg,
    percent: total > 0 ? (seg.count / total) * 100 : 0,
    colorVar: RARITY_CHART_COLOR_VARS[i] || RARITY_CHART_COLOR_VARS[RARITY_CHART_COLOR_VARS.length - 1],
  }));
}
