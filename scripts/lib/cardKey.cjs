/**
 * src/utils/cardKey.js 와 같은 규칙 (Node/CommonJS 쪽 사본).
 * 도감에 있는 카드는 'id:<카드ID>', 도감에 없는 카드는 이름+시리즈+카드번호를 이어 붙인다.
 */
function buildLegacyCardKey({ cardName, series, cardNumber } = {}) {
  const parts = [cardName, series, cardNumber].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join('__') : '';
}

function buildCardKey(card = {}) {
  if (card.id && card.id !== 'new') return `id:${card.id}`;
  return buildLegacyCardKey(card);
}

module.exports = { buildCardKey, buildLegacyCardKey };
