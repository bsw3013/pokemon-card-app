export const DEFAULT_STATUS_OPTIONS = ['미보유', '보유중', '등급카드'];

export function normalizeStatus(rawStatus) {
  const status = String(rawStatus || '').trim();
  if (!status || status === '상태 없음') return '미보유';
  
  if (status === '손상됨' || status === '수집 완료 (소장중)') {
    return '보유중';
  }

  return status;
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
