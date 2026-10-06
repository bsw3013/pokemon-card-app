// 홈 대시보드 전용 순수 계산 함수 모음.
// 화면(React)과 완전히 분리되어 있어서 node 로 바로 import/실행해서 검증할 수 있다.
// firebase, JSON, vite 전용 문법은 쓰지 않는다.
import { buildCardKey } from './cardKey.js';
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

// 2) 시세 집계: marketListings 문서들을 cardKey 별로 평균내서 { [cardKey]: 평균가 } 로 돌려준다.
//    classification === 'normal' 이고 status 가 active/unconfirmed/manual 이고 price 가 숫자인 것만.
export function computeMarketPriceByCardKey(marketListings) {
  const list = Array.isArray(marketListings) ? marketListings : [];
  const sums = new Map(); // cardKey -> { sum, count }

  list.forEach((listing) => {
    if (!listing) return;
    if (listing.classification !== 'normal') return;
    if (!['active', 'unconfirmed', 'manual'].includes(listing.status)) return;
    if (typeof listing.price !== 'number' || Number.isNaN(listing.price)) return;
    const cardKey = listing.cardKey;
    if (!cardKey) return;

    const entry = sums.get(cardKey) || { sum: 0, count: 0 };
    entry.sum += listing.price;
    entry.count += 1;
    sums.set(cardKey, entry);
  });

  const result = {};
  sums.forEach((entry, cardKey) => {
    result[cardKey] = entry.count > 0 ? Math.round(entry.sum / entry.count) : 0;
  });
  return result;
}

// 3) 다음 목표: series 로 묶어서, 전체 10장 이상 & 아직 100% 미만인 시리즈 중 완성률이 가장 높은 것 1개.
//    동률이면 전체 장수가 많은 쪽, 그래도 동률이면 먼저 나온(원본 배열 순서) 시리즈.
export function computeNextGoalSeries(cards, marketPriceByCardKey = {}, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 4;
  const list = Array.isArray(cards) ? cards : [];

  const bySeries = new Map(); // series -> { series, cards: [] }
  list.forEach((card) => {
    const series = String(card?.series || '').trim();
    if (!series) return;
    if (!bySeries.has(series)) bySeries.set(series, { series, cards: [] });
    bySeries.get(series).cards.push(card);
  });

  let best = null;
  bySeries.forEach((group) => {
    const total = group.cards.length;
    if (total < 10) return;
    const ownedCount = group.cards.filter(isOwnedOrGraded).length;
    const percent = total > 0 ? (ownedCount / total) * 100 : 0;
    if (percent >= 100) return;

    if (!best) {
      best = { ...group, total, ownedCount, percent };
      return;
    }
    if (percent > best.percent) {
      best = { ...group, total, ownedCount, percent };
    } else if (percent === best.percent && total > best.total) {
      best = { ...group, total, ownedCount, percent };
    }
  });

  if (!best) return null;

  const missing = best.cards.filter((card) => classifyStatus(card?.status) === 'unowned');

  const priceFor = (card) => {
    const key = buildCardKey(card || {});
    const price = marketPriceByCardKey[key];
    return typeof price === 'number' ? price : null;
  };

  const hasAnyPrice = missing.some((card) => priceFor(card) !== null);
  const sortedMissing = [...missing].sort((a, b) => {
    if (hasAnyPrice) {
      const pa = priceFor(a);
      const pb = priceFor(b);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    }
    const na = String(a?.cardNumber || '');
    const nb = String(b?.cardNumber || '');
    return na.localeCompare(nb, undefined, { numeric: true });
  });

  const topMissing = sortedMissing.slice(0, limit);
  const pricedAmongTop = topMissing
    .map((card) => priceFor(card))
    .filter((price) => price !== null);

  return {
    series: best.series,
    totalCount: best.total,
    ownedCount: best.ownedCount,
    missingCount: missing.length,
    percent: Math.round(best.percent),
    missingCards: topMissing,
    pricedMissingCount: pricedAmongTop.length,
    pricedMissingSum: pricedAmongTop.reduce((sum, price) => sum + price, 0),
  };
}

// 4) 내 앨범 위젯: AlbumPlanner.jsx 의 countFilledSlots / totalSlots 와 동일한 로직.
export function countAlbumFilledSlots(album) {
  if (!album?.pages?.length) return 0;
  return album.pages.reduce((acc, page) => acc + (page.slots || []).filter(Boolean).length, 0);
}

export function countAlbumTotalSlots(album) {
  return (album?.pages?.length || 0) * ((album?.cols || 0) * (album?.rows || 0));
}

export function pickRecentAlbums(albums, limit = 2) {
  const list = Array.isArray(albums) ? albums : [];
  return list
    .filter((album) => album && album.isDeleted !== true)
    .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
    .slice(0, limit);
}

// 5) 내 포켓몬 도감 격자: pokedexNumber 문자열에서 맨 앞 숫자 덩어리를 뽑아 1~1025 범위인지 확인.
export function parsePokedexNumber(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  const match = str.match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  if (!Number.isFinite(num) || num < 1 || num > POKEDEX_MAX) return null;
  return num;
}

export function buildPokedexGrid(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const byNumber = new Map(); // number -> { filled, firstCard }

  list.forEach((card) => {
    const num = parsePokedexNumber(card?.pokedexNumber);
    if (num === null) return;
    const owned = isOwnedOrGraded(card);
    const entry = byNumber.get(num);
    if (!entry) {
      byNumber.set(num, { filled: owned, firstCard: card });
    } else {
      if (owned) entry.filled = true;
      // firstCard는 먼저 발견된 카드를 그대로 유지(원본 배열 순서 기준 "첫 카드").
    }
  });

  const grid = [];
  for (let num = 1; num <= POKEDEX_MAX; num += 1) {
    const entry = byNumber.get(num);
    if (!entry) {
      grid.push({ number: num, filled: false, title: null });
      continue;
    }
    const paddedNumber = String(num).padStart(4, '0');
    const cardName = entry.firstCard?.cardName || '';
    const title = cardName ? `No.${paddedNumber} ${cardName}` : `No.${paddedNumber}`;
    grid.push({ number: num, filled: entry.filled, title });
  }
  return grid;
}

export function countOwnedSpecies(pokedexGrid) {
  const list = Array.isArray(pokedexGrid) ? pokedexGrid : [];
  return list.filter((cell) => cell.filled).length;
}

// 6) 내 레어 카드 쇼케이스: 레어도 우선순위대로 정렬해 상위 N장.
export const RARITY_RANK_ORDER = [
  'MUR', 'UR', 'SAR', 'HR', 'SSR', 'CSR', 'SR', 'CHR', 'AR', 'RRR', 'RR',
];

export function rankOfRarity(rarity) {
  const normalized = String(rarity || '').trim();
  const idx = RARITY_RANK_ORDER.indexOf(normalized);
  return idx === -1 ? RARITY_RANK_ORDER.length : idx;
}

export function pickRareShowcase(cards, limit = 8) {
  const list = Array.isArray(cards) ? cards : [];
  const owned = list
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => isOwnedOrGraded(card));

  owned.sort((a, b) => {
    const rankDiff = rankOfRarity(a.card?.rarity) - rankOfRarity(b.card?.rarity);
    if (rankDiff !== 0) return rankDiff;
    return a.index - b.index; // 안정 정렬(원본 순서 유지)
  });

  return owned.slice(0, limit).map(({ card }) => card);
}
