// 등급카드 묶음 이름 (예: "BRG 10"). 등급사·등급이 다르면 시세가 달라서 통계·그래프에서 섞지 않는다.
export function gradeKeyOf(entry) {
  const company = String(entry?.gradingCompany || '').trim().toUpperCase() || '기타';
  const grade = String(entry?.grade || '').trim() || '?';
  return `${company} ${grade}`;
}

// 등급카드 그래프·등급 칩에서 같이 쓰는 색 (고른 순서대로)
export const GRADE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
