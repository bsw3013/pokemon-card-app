const LEGACY_GRADE_STATUS_REGEX = /^[A-Za-z가-힣]\s*급/;

export const DEFAULT_STATUS_OPTIONS = ['미보유', '보유중', '등급카드', '상태 없음'];

export function normalizeStatus(rawStatus) {
  const status = String(rawStatus || '').trim();
  if (!status) return '상태 없음';

  // Legacy labels like "S급 (민트)", "A급" are normalized into possession status.
  if (LEGACY_GRADE_STATUS_REGEX.test(status)) {
    return '보유중';
  }

  return status;
}

export function sanitizeStatusOptions(statusOptions) {
  const source = Array.isArray(statusOptions) ? statusOptions : [];
  const normalized = source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => !LEGACY_GRADE_STATUS_REGEX.test(item));

  const merged = [...normalized, ...DEFAULT_STATUS_OPTIONS]
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return Array.from(new Set(merged));
}
