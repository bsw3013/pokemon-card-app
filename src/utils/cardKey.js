/**
 * 같은 이름의 카드(예: "리자몽 ex")가 시리즈/카드번호별로 여러 장 존재하기 때문에,
 * 이름만으로는 특정 인쇄본을 구분할 수 없다. cardName+series+cardNumber를 합쳐
 * 실제로 유일한 카드를 가리키는 키를 만든다.
 */
export function buildCardKey({ cardName, series, cardNumber }) {
  const parts = [cardName, series, cardNumber].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join('__') : '';
}
