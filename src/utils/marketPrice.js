// 시세와 내 카드를 "종류"로 짝짓는 계산.
// 종류 = 언어판(한국/일본/미국/중국) + 상태(Raw 또는 등급 업체·점수, 예: PSA 10)
// 시세 = 판매완료 평균을 먼저 쓰고, 판매완료 기록이 없으면 판매중 평균.
import { buildCardKey, buildLegacyCardKey } from './cardKey';
import { UNKNOWN_GRADER, activeRows, cardLanguage, copyGrade, isPulledCopy, langShort } from './cardStats';

const ACTIVE = ['active', 'unconfirmed', 'manual'];
const norm = (v) => String(v ?? '').trim();
const company = (v) => norm(v).toUpperCase();

function kindKey(isGraded, comp, grade) {
  if (!isGraded) return 'raw';
  if (!comp || !grade) return null; // 업체·점수를 모르면 짝지을 수 없음
  return `${company(comp)} ${norm(grade)}`;
}

export function listingTypeKey(l) {
  const kind = kindKey(l.conditionType === 'graded', l.gradingCompany, l.grade);
  return kind ? `${norm(l.language) || '한국'}|${kind}` : null;
}

export function copyTypeKey(card, row) {
  const g = copyGrade(row);
  const comp = g && g.company !== UNKNOWN_GRADER ? g.company : '';
  const kind = kindKey(!!g, comp, g?.grade);
  return kind ? `${norm(row.language) || cardLanguage(card)}|${kind}` : null;
}

export function typeLabel(key) {
  const [lang, kind] = key.split('|');
  return `${kind === 'raw' ? 'Raw' : kind} · ${langShort(lang)}`;
}

// 이 카드의 시세 기록 (카드 ID 키 + 예전 방식 키)
export function cardListings(index, card) {
  if (!index || !card) return [];
  const keys = [...new Set([buildCardKey(card), buildLegacyCardKey(card)].filter(Boolean))];
  const byId = new Map();
  keys.forEach((k) => (index.get(k) || []).forEach((l) => byId.set(l.id, l)));
  return [...byId.values()];
}

const avg = (arr) => Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);

// 종류별 시세 표: Map<typeKey, { key, active:{count,min,max,avg}|null, sold:{count,avg}|null, price, basis }>
export function priceTable(listings) {
  const groups = new Map();
  listings.forEach((l) => {
    if (l.classification !== 'normal' || typeof l.price !== 'number') return;
    const isActive = ACTIVE.includes(l.status);
    const isSold = l.status === 'sold_estimated';
    if (!isActive && !isSold) return;
    const key = listingTypeKey(l);
    if (!key) return;
    const g = groups.get(key) || { active: [], sold: [] };
    (isSold ? g.sold : g.active).push(l.price);
    groups.set(key, g);
  });
  const out = new Map();
  groups.forEach((g, key) => {
    const active = g.active.length ? { count: g.active.length, min: Math.min(...g.active), max: Math.max(...g.active), avg: avg(g.active) } : null;
    const sold = g.sold.length ? { count: g.sold.length, avg: avg(g.sold) } : null;
    out.set(key, { key, active, sold, price: sold ? sold.avg : active.avg, basis: sold ? 'sold' : 'active' });
  });
  return out;
}

// 카드 한 장(보유 기록 한 줄)의 시세. 없으면 null
export function copyMarketPrice(table, card, row) {
  const key = copyTypeKey(card, row);
  return key ? (table.get(key) || null) : null;
}

// 카드 하나의 내 보유분 시세 합계와 구매가 대비
export function cardMarketValue(index, card) {
  const rows = activeRows(card);
  const out = { value: 0, priced: 0, unpriced: 0, pairedCost: 0, pairedValue: 0, pairedCount: 0, unit: null };
  if (rows.length === 0) return out;
  const table = priceTable(cardListings(index, card));
  rows.forEach((r) => {
    const n = Number(r.count) || 1;
    const m = copyMarketPrice(table, card, r);
    if (!m) { out.unpriced += n; return; }
    out.value += m.price * n;
    out.priced += n;
    if (!isPulledCopy(r) && Number(r.purchasePrice) > 0) {
      out.pairedCount += n;
      out.pairedCost += Number(r.purchasePrice) * n;
      out.pairedValue += m.price * n;
    }
  });
  out.unit = out.priced ? Math.round(out.value / out.priced) : null;
  return out;
}

// 내가 안 가진 카드도 정렬·표에 쓸 대표 시세: 그 카드 언어판의 Raw 시세, 없으면 아무 종류나
export function representativePrice(index, card) {
  const table = priceTable(cardListings(index, card));
  if (table.size === 0) return null;
  const raw = table.get(`${cardLanguage(card)}|raw`);
  return (raw || [...table.values()][0]).price;
}
