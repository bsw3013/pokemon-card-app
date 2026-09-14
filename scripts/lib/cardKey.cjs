/**
 * src/utils/cardKey.js 와 동일한 로직 (Node/CommonJS 쪽 사본).
 * 이름만으로는 같은 이름의 다른 시리즈/카드번호 인쇄본을 구분할 수 없어서
 * cardName+series+cardNumber를 합친 키로 카드를 식별한다.
 */
function buildCardKey({ cardName, series, cardNumber }) {
  const parts = [cardName, series, cardNumber].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join('__') : '';
}

module.exports = { buildCardKey };
