export function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ko');
}

export function compareNumberLike(a, b) {
  const na = Number(String(a || '').replace(/[^0-9.-]/g, ''));
  const nb = Number(String(b || '').replace(/[^0-9.-]/g, ''));
  const va = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
  return va - vb;
}
