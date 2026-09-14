// 마스터 설정 탭 및 카드 도감 마스터 정보(추가/수정/삭제) 접근 권한을 가진 관리자 이메일 목록.
// ⚠️ 이 목록을 바꾸면 firestore.rules 의 isAdmin() 함수도 반드시 같이 수정하고 배포해야 합니다.
export const ADMIN_EMAILS = [
  'bsw3013@gmail.com',
];

const NORMALIZED_ADMIN_EMAILS = ADMIN_EMAILS.map((email) => String(email).trim().toLowerCase());

export function isAdminEmail(email) {
  if (!email) return false;
  return NORMALIZED_ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}
