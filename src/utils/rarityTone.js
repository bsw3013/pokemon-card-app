// 레어도 배지 색 묶음: 금색(최상위) / 은색 / 청록(일러스트) / 기본
const GOLD = ['SAR', 'UR', 'HR', 'MUR', 'BWR'];
const SILVER = ['SR', 'SSR', 'S', 'CSR', 'MA', 'A'];
const TEAL = ['AR', 'CHR'];

export function rarityTone(rarity) {
  const r = String(rarity || '').trim().toUpperCase();
  if (GOLD.includes(r)) return 'gold';
  if (SILVER.includes(r)) return 'silver';
  if (TEAL.includes(r)) return 'teal';
  return 'plain';
}
