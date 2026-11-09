/**
 * 시세 기록(관심카드·매물·가격 기록)을 카드와 연결하는 키.
 *
 * - 도감에 있는 카드: 카드 고유 ID로 연결한다 → 'id:<카드ID>'
 *   이름이나 시리즈 글자를 고쳐도 연결이 끊기지 않는다.
 * - 도감에 없는 카드(시세 화면에서 직접 입력한 카드): 예전처럼 이름+시리즈+카드번호를 이어 붙인다.
 */
export function buildCardKey(card = {}) {
  if (card.id && card.id !== 'new') return `id:${card.id}`;
  return buildLegacyCardKey(card);
}

export function buildLegacyCardKey({ cardName, series, cardNumber } = {}) {
  const parts = [cardName, series, cardNumber].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join('__') : '';
}

export function isIdCardKey(key) {
  return String(key || '').startsWith('id:');
}

export function cardIdFromKey(key) {
  return isIdCardKey(key) ? String(key).slice(3) : '';
}

const norm = (v) => String(v ?? '').trim();
const upper = (v) => norm(v).toUpperCase();

/**
 * 예전 방식 키('이름__시리즈__카드번호')가 가리키던 카드를 찾아 카드 ID를 돌려준다.
 * 이름이 나중에 채워졌거나 바뀌었을 수 있으므로 카드번호 → 시리즈 → 이름 순서로 좁힌다.
 * 하나로 정해지지 않으면 '' (그대로 둔다).
 */
export function resolveLegacyCardKey(key, cards = []) {
  if (!key || isIdCardKey(key)) return '';
  const parts = String(key).split('__').map(norm).filter(Boolean);
  if (parts.length === 0) return '';
  const partsUpper = parts.map(upper);
  let candidates = cards.filter((c) => norm(c.cardNumber) && partsUpper.includes(upper(c.cardNumber)));
  if (candidates.length === 0) {
    // 카드번호 없이 기록된 경우: 이름+시리즈가 모두 맞는 카드
    candidates = cards.filter((c) => norm(c.cardName) && parts.includes(norm(c.cardName)) && norm(c.series) && parts.includes(norm(c.series)));
  }
  if (candidates.length > 1) {
    const bySeries = candidates.filter((c) => norm(c.series) && parts.includes(norm(c.series)));
    if (bySeries.length > 0) candidates = bySeries;
  }
  if (candidates.length > 1) {
    const byName = candidates.filter((c) => norm(c.cardName) && parts.includes(norm(c.cardName)));
    if (byName.length > 0) candidates = byName;
  }
  return candidates.length === 1 ? candidates[0].id : '';
}
