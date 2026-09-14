// 검색 결과 미리보기에서 "혹시 묶음판매일 수도 있음"을 살짝 알려주는 용도일 뿐,
// 최종 판단은 사용자가 사진/제목을 보고 직접 한다 (자동으로 걸러내지 않음).
const BUNDLE_KEYWORDS = ['일괄', '묶음', '세트', '무더기', '전체판매', '한번에', '몰아서'];

export function looksLikeBundle(title) {
  const t = title || '';
  return BUNDLE_KEYWORDS.some((k) => t.includes(k));
}
