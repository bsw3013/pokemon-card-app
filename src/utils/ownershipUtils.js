// pokemon_cards(공용 마스터 정보)와 cardOwnership(개인 보유 현황)으로 분리 저장하기 위한 유틸.

// 사용자마다 달라지는 "개인 보유 현황" 필드. 이 필드들을 제외한 나머지는 전부
// 모든 사용자가 공유하는 "카드 도감 마스터 정보"(이름/시리즈/카드번호/레어도/이미지,
// 그리고 마스터 설정에서 추가한 커스텀 필드 등)로 취급한다.
export const OWNERSHIP_FIELDS = ['status', 'language', 'price', 'possessions'];

export function ownershipDocId(cardId, uid) {
  return `${cardId}_${uid}`;
}

// formatCardPayload() 등으로 만든 하나의 카드 payload를 마스터/개인 필드로 나눈다.
export function splitCardPayload(payload = {}) {
  const master = {};
  const ownership = {};
  Object.keys(payload).forEach((key) => {
    if (OWNERSHIP_FIELDS.includes(key)) {
      ownership[key] = payload[key];
    } else {
      master[key] = payload[key];
    }
  });
  return { master, ownership };
}
