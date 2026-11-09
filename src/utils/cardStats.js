export function parsePossessions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

// 보유 장수. 보유 여부는 지금처럼 "보유 상태"(보유중/등급카드/미보유)로 정하고,
// 장수는 보유 기록의 수량 합계(기록이 없으면 1장)로 센다.
export function ownedCount(card) {
  const status = String(card?.status || '');
  if (!status || status.includes('미보유')) return 0;
  const total = parsePossessions(card?.possessions).reduce((sum, p) => sum + (Number(p?.count) || 0), 0);
  return total > 0 ? total : 1;
}

// 가장 높은 그레이딩(예: PSA 10)
export function topGrading(card) {
  let top = null;
  parsePossessions(card?.possessions).forEach((p) => {
    const candidates = [...(Array.isArray(p?.graded) ? p.graded : []), p];
    candidates.forEach((g) => {
      if (!g || !g.company || !g.grade) return;
      const num = parseFloat(String(g.grade).replace(/[^0-9.]/g, '')) || 0;
      if (!top || num > top.num) top = { company: g.company, grade: g.grade, num };
    });
  });
  return top;
}

// 보유 기록 한 줄의 상태 (등급 카드면 "PSA 10", 아니면 카드 상태)
export const CONDITION_OPTIONS = ['미개봉', '민트', '거의 새것', '사용감 있음', '손상'];

export function isGradedCopy(p) {
  return !!(p && p.company && p.company !== 'raw' && p.grade);
}

export function possessionLabel(p) {
  if (!p) return '';
  const base = isGradedCopy(p) ? `${p.company} ${p.grade}` : (p.condition || '일반');
  const lang = p.language && p.language !== '한국' ? ` · ${p.language}판` : '';
  const qty = Number(p.count) > 1 ? ` ×${p.count}` : '';
  return `${base}${lang}${qty}`;
}
