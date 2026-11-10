import { ownedCount } from '../../utils/cardStats';

// 앨범 색 (바인더 색). 직접 고르기로 다른 색도 쓸 수 있다.
export const ALBUM_COLORS = [
  { hex: '#334155', label: '차콜' },
  { hex: '#111827', label: '블랙' },
  { hex: '#d63a2c', label: '레드' },
  { hex: '#ea580c', label: '오렌지' },
  { hex: '#ca8a04', label: '골드' },
  { hex: '#16a34a', label: '그린' },
  { hex: '#0f766e', label: '틸' },
  { hex: '#0284c7', label: '스카이' },
  { hex: '#2563eb', label: '블루' },
  { hex: '#7c3aed', label: '퍼플' },
  { hex: '#db2777', label: '핑크' },
  { hex: '#78716c', label: '웜그레이' },
];
export const DEFAULT_ALBUM_COLOR = '#334155';

export const COVER_POSITIONS = [
  { key: 'top', label: '위' },
  { key: 'center', label: '가운데' },
  { key: 'bottom', label: '아래' },
];

// 슬롯 카드가 지금 내 컬렉션에서 보유 중인지 (도감 카드를 못 찾으면 넣을 때 저장된 상태로)
export function slotOwned(slot, cardsById) {
  if (!slot) return false;
  const card = slot.cardId ? cardsById.get(slot.cardId) : null;
  if (card) return ownedCount(card) > 0;
  return String(slot.status || '').includes('보유중');
}

export function slotImage(slot, cardsById) {
  const card = slot?.cardId ? cardsById.get(slot.cardId) : null;
  return card?.imageUrl || slot?.imageUrl || '';
}

// 앨범 한 권의 칸·배치·보유 수 (보유는 지금 내 컬렉션 기준)
export function albumStats(album, cardsById) {
  const perPage = (Number(album?.cols) || 0) * (Number(album?.rows) || 0);
  const pages = Array.isArray(album?.pages) ? album.pages : [];
  let placed = 0;
  let owned = 0;
  pages.forEach((p) => (p?.slots || []).forEach((s) => {
    if (!s) return;
    placed += 1;
    if (slotOwned(s, cardsById)) owned += 1;
  }));
  const total = pages.length * perPage;
  return { pages: pages.length, perPage, total, placed, owned, missing: placed - owned, empty: Math.max(0, total - placed) };
}

// 표지에 고를 수 있는 앨범 속 카드 (같은 카드는 한 번만)
export function albumCards(album, cardsById) {
  const seen = new Set();
  const out = [];
  (album?.pages || []).forEach((p) => (p?.slots || []).forEach((s) => {
    if (!s) return;
    const key = s.cardId || `${s.cardName}|${s.cardNumber}`;
    if (seen.has(key)) return;
    seen.add(key);
    const img = slotImage(s, cardsById);
    if (img) out.push({ key, cardId: s.cardId || '', name: cardsById.get(s.cardId)?.cardName || s.cardName || '', imageUrl: img });
  }));
  return out;
}

export function relativeTime(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// 올릴 사진을 가로·세로 최대 maxSize로 줄여 JPEG로 만든다 (빠르게 뜨고 저장 용량도 적게)
export async function shrinkImage(file, maxSize = 1200, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('사진을 읽지 못했어요'));
      el.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진 변환 실패'))), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}
