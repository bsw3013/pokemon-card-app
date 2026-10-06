export const DEFAULT_STATUS_OPTIONS = ['미보유', '보유중', '등급카드'];

export function normalizeStatus(rawStatus) {
  const status = String(rawStatus || '').trim();
  if (!status || status === '상태 없음') return '미보유';
  
  if (status === '손상됨' || status === '수집 완료 (소장중)') {
    return '보유중';
  }

  return status;
}

// StatsDashboard.jsx 의 classifyStatus 와 완전히 동일한 로직. 홈 대시보드 등에서도
// 같은 기준으로 보유/미보유/등급카드를 판정해야 통계 탭과 숫자가 일치한다.
export function classifyStatus(status) {
  const normalized = String(status || '').trim();

  if (normalized.includes('등급')) return 'graded';
  if (normalized.includes('미보유') || normalized.includes('위시')) return 'unowned';
  if (normalized.includes('보유') || normalized.includes('수집') || normalized.includes('소장') || normalized.includes('배송')) return 'owned';

  return 'unowned';
}

export function sanitizeStatusOptions(statusOptions) {
  const source = Array.isArray(statusOptions) ? statusOptions : [];
  const normalized = source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => item !== '상태 없음' && item !== '손상됨' && item !== '수집 완료 (소장중)');

  const merged = [...normalized, ...DEFAULT_STATUS_OPTIONS]
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return Array.from(new Set(merged));
}
