// 판매 기록 도우미: 보유 기록 한 줄을 "판매완료"로 바꾸거나 되돌리고,
// 원하면 그 거래를 시세(marketListings / marketPriceHistory)에도 "판매완료" 매물로 남긴다.
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { buildCardKey } from './cardKey';
import { UNKNOWN_GRADER, cardLanguage, copyGrade } from './cardStats';

export const SOLD_VIA_OPTIONS = ['번개장터', '당근마켓', '중고나라', '카페·커뮤니티', '지인', '기타'];

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const newId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// rows 중 rowId 줄에서 qty장을 판매완료로 만든다. 일부만 팔면 줄을 둘로 나눈다.
export function sellCopy(rows, rowId, { qty, price, date, via, note, listingId }) {
  const out = [];
  rows.forEach((r) => {
    if (r.id !== rowId) { out.push(r); return; }
    const count = Number(r.count) || 1;
    const n = Math.min(Math.max(1, Number(qty) || 1), count);
    const sold = {
      ...r,
      id: n < count ? newId() : r.id,
      count: n,
      sold: true,
      forTrade: false,
      soldPrice: Number(price) || 0,
      soldDate: date || todayStr(),
      soldVia: via || '',
      soldNote: note || '',
      soldListingId: listingId || null,
    };
    if (n < count) out.push({ ...r, count: count - n });
    out.push(sold);
  });
  return out;
}

// 판매완료를 취소해서 다시 보유로 돌린다.
export function unsellCopy(rows, rowId) {
  return rows.map((r) => {
    if (r.id !== rowId) return r;
    const rest = { ...r };
    ['sold', 'soldPrice', 'soldDate', 'soldVia', 'soldNote', 'soldListingId'].forEach((k) => { delete rest[k]; });
    return rest;
  });
}

// 보유 기록을 보고 보유 상태를 정한다: 갖고 있는 장이 있으면 보유중, 전부 팔았으면 미보유.
export function statusFromRows(rows, fallback) {
  const live = rows.filter((r) => r && Number(r.count ?? 1) > 0);
  if (live.length === 0) return fallback;
  return live.some((r) => !r.sold) ? '보유중' : '미보유';
}

// 판매 거래를 시세에 "판매완료" 매물로 기록. 만든 매물 문서 id를 돌려준다.
export async function recordSaleToMarket({ card, row, price, date, via, note, recordedBy }) {
  const cardKey = buildCardKey(card);
  if (!cardKey) return null;
  const g = copyGrade(row);
  const at = new Date(`${date || todayStr()}T12:00:00`).toISOString();
  const externalId = `sale_${Date.now()}`;
  const language = row.language || cardLanguage(card);
  const conditionType = g ? 'graded' : 'raw';
  const gradingCompany = g && g.company !== UNKNOWN_GRADER ? g.company : '';
  const grade = g ? (g.grade || '') : '';
  const marketplace = via || null;
  const ref = await addDoc(collection(db, 'marketListings'), {
    cardKey,
    cardName: card.cardName || '',
    series: card.series || '',
    cardNumber: card.cardNumber || '',
    source: 'manual',
    marketplace,
    externalId,
    title: `${via ? `${via} ` : ''}판매 (내 판매 기록)`,
    price: Number(price) || 0,
    url: null,
    imageUrl: null,
    region: null,
    classification: 'normal',
    classificationOverride: true,
    status: 'sold_estimated',
    missedCount: 2,
    firstSeen: at,
    lastSeen: at,
    removedAt: at,
    memo: note || '',
    recordedBy: recordedBy || null,
    language,
    conditionType,
    gradingCompany,
    grade,
  });
  await addDoc(collection(db, 'marketPriceHistory'), {
    cardKey,
    source: 'manual',
    marketplace,
    externalId,
    price: Number(price) || 0,
    recordedAt: at,
    recordedBy: recordedBy || null,
    language,
    conditionType,
    gradingCompany,
    grade,
  });
  return ref.id;
}

// 판매를 되돌릴 때, 같이 남겼던 시세 기록도 지운다.
export async function removeSaleFromMarket(card, listingId) {
  if (!listingId) return;
  const cardKey = buildCardKey(card);
  const snap = await getDocs(query(collection(db, 'marketListings'), where('cardKey', '==', cardKey)));
  const listing = snap.docs.find((d) => d.id === listingId);
  if (!listing) return;
  const { source, externalId } = listing.data();
  await deleteDoc(doc(db, 'marketListings', listingId));
  const hist = await getDocs(query(
    collection(db, 'marketPriceHistory'),
    where('cardKey', '==', cardKey),
    where('source', '==', source),
    where('externalId', '==', externalId),
  ));
  await Promise.all(hist.docs.map((d) => deleteDoc(d.ref)));
}
