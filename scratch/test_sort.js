const cards = [
  { id: 1, name: 'A', rarity: 'UR', price: 100 },
  { id: 2, name: 'B', rarity: '', price: 200 },
  { id: 3, name: 'C', rarity: 'SR', price: 50 },
  { id: 4, name: 'D', rarity: '', price: 0 }
];

const activeLevels = [
  { field: 'rarity', dir: 'desc' },
  { field: 'price', dir: 'asc' }
];

const rarityRank = { 'UR': 0, 'SR': 1 };

cards.sort((a, b) => {
  for (const lvl of activeLevels) {
    const field = lvl.field;
    const dir = lvl.dir === 'asc' ? 1 : -1;
    const isNumericField = field === 'price';
    const aRaw = a[field];
    const bRaw = b[field];

    let aHas = aRaw !== undefined && aRaw !== null && String(aRaw).trim() !== '';
    let bHas = bRaw !== undefined && bRaw !== null && String(bRaw).trim() !== '';
    if (isNumericField) {
      aHas = aHas && Number.isFinite(Number(aRaw));
      bHas = bHas && Number.isFinite(Number(bRaw));
    }

    if (!aHas || !bHas) {
      if (!aHas && !bHas) continue; // both absent
      return !aHas ? 1 : -1; // always bottom if absent
    }

    let cmp = 0;
    if (isNumericField) {
      cmp = Number(aRaw) - Number(bRaw);
    } else if (field === 'rarity') {
      cmp = (rarityRank[aRaw] ?? 999) - (rarityRank[bRaw] ?? 999);
    }

    if (cmp !== 0) return cmp * dir;
  }
  return 0;
});

console.log(cards.map(c => `${c.name}: ${c.rarity || 'empty'} - ${c.price}`));
