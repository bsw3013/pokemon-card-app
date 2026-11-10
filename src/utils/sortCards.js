// 카드 목록 정렬 (카드 화면·내 컬렉션 공통)
// "무엇으로" 정렬할지(기준)와 "어느 방향"으로(오름/내림) 정렬할지를 따로 고른다.
// 정렬할 값이 없는 카드(가격 미기록 등)는 방향과 상관없이 항상 맨 뒤로 보낸다.
// 값이 같으면 세트 발매일(최신 세트 먼저) → 같은 세트 안에서는 카드 번호 순으로 정리한다.

const text = (v) => String(v ?? '').trim();

// asc/desc: 방향 버튼에 보여줄 말, dir: 기준을 고를 때 처음 방향
export const SORT_FIELDS = {
  release: { label: '세트 발매일·카드 번호', dir: 'desc', asc: '오래된 세트부터', desc: '최신 세트부터' },
  price: { label: '내 평가 가격 (1장)', dir: 'desc', asc: '낮은 가격부터', desc: '높은 가격부터' },
  value: { label: '평가액 (가격 × 장수)', dir: 'desc', asc: '낮은 금액부터', desc: '높은 금액부터' },
  purchase: { label: '구매가', dir: 'desc', asc: '낮은 가격부터', desc: '높은 가격부터' },
  bought: { label: '구매일', dir: 'desc', asc: '오래된 구매부터', desc: '최근 구매부터' },
  added: { label: '도감에 추가된 날', dir: 'desc', asc: '오래전 추가부터', desc: '최근 추가부터' },
  rarity: { label: '레어도', dir: 'desc', asc: '낮은 레어도부터', desc: '높은 레어도부터' },
  dex: { label: '도감 번호', dir: 'asc', asc: '1번부터', desc: '큰 번호부터' },
  name: { label: '이름', dir: 'asc', asc: '가나다순', desc: '가나다 역순' },
  count: { label: '보유 장수', dir: 'desc', asc: '적게 가진 것부터', desc: '많이 가진 것부터' },
  graded: { label: '등급 카드 장수', dir: 'desc', asc: '적은 것부터', desc: '많은 것부터' },
};

// item: { card, release, setCode, no, rarityOrder, count, graded, maxPurchase, lastBought, value }
function valueOf(item, field) {
  const { card } = item;
  switch (field) {
    case 'release': return item.release || null;
    case 'price': return Number(card.price) || null;
    case 'value': return Number(item.value) || null;
    case 'purchase': return Number(item.maxPurchase) || null;
    case 'bought': return item.lastBought || null;
    case 'added': return text(card.createdAt) || null;
    case 'rarity': return Number(item.rarityOrder) || null;
    case 'dex': return Number(card.pokedexNumber) || null;
    case 'name': return text(card.cardName) || null;
    case 'count': return Number(item.count) || 0;
    case 'graded': return Number(item.graded) || 0;
    default: return null;
  }
}

// 같은 세트 안에서는 카드 번호 1번부터
const bySetThenNo = (a, b) => text(a.setCode).localeCompare(text(b.setCode)) || (Number(a.no) || 0) - (Number(b.no) || 0);
const tieBreak = (a, b) => text(b.release).localeCompare(text(a.release)) || bySetThenNo(a, b);

export function sortItems(list, field, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const va = valueOf(a, field);
    const vb = valueOf(b, field);
    if (va === null && vb === null) return tieBreak(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb, 'ko') : va - vb;
    if (c) return c * sign;
    return field === 'release' ? bySetThenNo(a, b) : tieBreak(a, b);
  });
}

// 저장된 정렬 설정 읽기 ({ field, dir }), 모르는 값이면 기본값
export function readSort(storageKey, fields, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (v && fields.includes(v.field) && (v.dir === 'asc' || v.dir === 'desc')) return v;
  } catch { /* 저장된 값이 없거나 깨졌으면 기본값 */ }
  return fallback;
}
export function writeSort(storageKey, value) {
  try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 그대로 동작 */ }
}
