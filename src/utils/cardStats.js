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

export function possessionLabel(p, cardLang) {
  if (!p) return '';
  const base = isGradedCopy(p) ? `${p.company} ${p.grade}` : (p.condition || '일반');
  const rowLang = p.language || cardLang;
  const lang = rowLang && !String(rowLang).includes('한국') ? ` · ${langShort(rowLang)}` : '';
  const qty = Number(p.count) > 1 ? ` ×${p.count}` : '';
  return `${base}${lang}${qty}`;
}

// 언어판 짧은 이름: 한국 → 한판, 일본 → 일판, 미국/영어 → 영문판, 중국 → 중국판
export function langShort(lang) {
  const t = String(lang || '').trim();
  if (!t || t.includes('한국')) return '한판';
  if (t.includes('일본')) return '일판';
  if (t.includes('미국') || t.includes('영')) return '영문판';
  if (t.includes('중국')) return '중국판';
  return `${t}판`;
}

export function cardLanguage(card) {
  return String(card?.language || '').trim() || '한국';
}

// 등급 카드 정보. 보유 기록에 등급(PSA 10 등)이 있으면 그 장수,
// 기록 없이 보유 상태만 "등급카드"로 해 둔 카드도 등급 카드로 센다.
export function gradedInfo(card) {
  const rows = parsePossessions(card?.possessions);
  const gradedRows = rows.filter((r) => isGradedCopy(r) || (Array.isArray(r?.graded) && r.graded.some((g) => g?.company && g?.grade)));
  const count = gradedRows.reduce((s, r) => s + (Number(r.count) || 1), 0);
  if (count > 0) return { count, statusOnly: false };
  if (String(card?.status || '').includes('등급')) return { count: ownedCount(card), statusOnly: true };
  return { count: 0, statusOnly: false };
}
