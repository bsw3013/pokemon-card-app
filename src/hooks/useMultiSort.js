import { useState, useEffect } from 'react';

const STORAGE_KEY = 'pc_sort_levels_v2';

const defaultSortLevels = [
  { field: 'pokedexNumber', dir: 'asc', enabled: true },
  { field: '', dir: 'asc', enabled: false },
  { field: '', dir: 'asc', enabled: false },
  { field: '', dir: 'asc', enabled: false },
  { field: '', dir: 'asc', enabled: false }
];

export function useMultiSort() {
  const [sortLevels, setSortLevels] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to parse sort levels from local storage', e);
    }
    return defaultSortLevels;
  });

  const persistSortLevels = (next) => {
    setSortLevels(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to save sort levels to local storage', e);
    }
  };

  const handleLevelFieldChange = (index, field) => {
    const next = sortLevels.slice();
    next[index] = { ...next[index], field, enabled: !!field };
    persistSortLevels(next);
  };

  const toggleLevelDir = (index) => {
    const next = sortLevels.slice();
    next[index].dir = next[index].dir === 'asc' ? 'desc' : 'asc';
    persistSortLevels(next);
  };

  const toggleLevelEnabled = (index) => {
    const next = sortLevels.slice();
    next[index].enabled = !next[index].enabled;
    // if turning off, clear field
    if (!next[index].enabled) next[index].field = '';
    persistSortLevels(next);
  };

  const resetSortLevels = () => {
    persistSortLevels(defaultSortLevels);
  };

  return {
    sortLevels,
    handleLevelFieldChange,
    toggleLevelDir,
    toggleLevelEnabled,
    resetSortLevels,
    persistSortLevels,
  };
}
