import { compareNumberLike, compareText } from './stringUtils';

// Sort an array of cards based on the multi-level sort configuration
export function sortCards(cards, activeLevels, appConfig) {
  if (!activeLevels || activeLevels.length === 0) {
    // default sort by pokedexNumber if no levels active
    const result = [...cards];
    result.sort((a, b) => {
      return (Number(a.pokedexNumber) || 0) - (Number(b.pokedexNumber) || 0);
    });
    return result;
  }

  const createRankMap = (optionsList, fallbackList) => {
    const rank = {};
    const list = (optionsList && Array.isArray(optionsList)) ? optionsList : fallbackList;
    list.forEach((s, i) => { rank[s] = i; });
    return rank;
  };

  const statusRank = createRankMap(appConfig?.statusOptions, ['보유중', '등급카드', '미보유']);
  const seriesRank = createRankMap(appConfig?.seriesOptions, []);
  const rarityRank = createRankMap(appConfig?.rarityOptions, []);
  const typeRank = createRankMap(appConfig?.typeOptions, []);

  const result = [...cards];

  result.sort((a, b) => {
    for (const lvl of activeLevels) {
      const field = lvl.field;
      const dir = lvl.dir === 'asc' ? 1 : -1;
      const isNumericField = field === 'pokedexNumber' || field === 'price';
      const aRaw = a[field];
      const bRaw = b[field];

      let aHas = aRaw !== undefined && aRaw !== null && String(aRaw).trim() !== '';
      let bHas = bRaw !== undefined && bRaw !== null && String(bRaw).trim() !== '';
      if (field === 'createdAt') {
        aHas = !!a.createdAt;
        bHas = !!b.createdAt;
      }
      if (isNumericField) {
        aHas = aHas && Number.isFinite(Number(aRaw)) && Number(aRaw) > 0;
        bHas = bHas && Number.isFinite(Number(bRaw)) && Number(bRaw) > 0;
      }

      if (!aHas || !bHas) {
        if (!aHas && !bHas) continue; // both absent, continue to next level
        // if one is absent, it always goes to the bottom
        return !aHas ? 1 : -1;
      }

      let cmp = 0;
      if (field === 'createdAt') {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        cmp = ta - tb;
      } else if (isNumericField) {
        cmp = Number(aRaw) - Number(bRaw);
      } else if (field === 'status') {
        cmp = (statusRank[aRaw] ?? 999) - (statusRank[bRaw] ?? 999);
      } else if (field === 'series') {
        cmp = (seriesRank[aRaw] ?? 999) - (seriesRank[bRaw] ?? 999);
      } else if (field === 'rarity') {
        cmp = (rarityRank[aRaw] ?? 999) - (rarityRank[bRaw] ?? 999);
      } else if (field === 'type') {
        cmp = (typeRank[aRaw] ?? 999) - (typeRank[bRaw] ?? 999);
      } else {
        cmp = String(aRaw).localeCompare(String(bRaw), 'ko');
      }

      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });

  return result;
}
