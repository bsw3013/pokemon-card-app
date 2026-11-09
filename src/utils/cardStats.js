function parsePossessions(raw) {
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
