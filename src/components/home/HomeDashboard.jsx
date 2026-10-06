import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import pokemonMapAll from '../../utils/pokemonMapAll.json';
import {
  computeCollectionSummary,
  buildPokedexEntries,
  computeGenerationStats,
  computePokedexHeaderStats,
  computeRarityComposition,
} from '../../utils/homeStats';
import GuestSummaryCard from './GuestSummaryCard';
import CollectionSummaryCard from './CollectionSummaryCard';
import ShortcutTiles from './ShortcutTiles';
import PokedexGridWidget from './PokedexGridWidget';
import RarityCompositionWidget from './RarityCompositionWidget';
import PokedexEntryModal from './PokedexEntryModal';
import { IconGallery, IconFilter, IconAlbum, IconStats, IconMarket, IconSettings } from './icons';

// 전국도감 순서 그대로인 이름 배열 (krToEn 의 키 순서 = 1~1025번).
const POKEMON_NAMES = Object.keys(pokemonMapAll.krToEn || {});

const SHORTCUT_DEFS = [
  { id: 'gallery', label: '도감', Icon: IconGallery },
  { id: 'filter', label: '필터', Icon: IconFilter },
  { id: 'album', label: '앨범', Icon: IconAlbum },
  { id: 'stats', label: '통계', Icon: IconStats },
  { id: 'market', label: '시세', Icon: IconMarket },
  { id: 'admin', label: '설정', Icon: IconSettings },
];

export default function HomeDashboard({ onNavigate }) {
  const { user, isAdmin, signInWithGoogle } = useAuth();
  const { cards, loading } = useOwnedCards();
  const [selectedNumber, setSelectedNumber] = useState(null);

  const summary = useMemo(() => computeCollectionSummary(cards), [cards]);
  const entries = useMemo(() => buildPokedexEntries(cards, POKEMON_NAMES), [cards]);
  const generationStats = useMemo(() => computeGenerationStats(entries), [entries]);
  const headerStats = useMemo(() => computePokedexHeaderStats(entries), [entries]);
  const raritySegments = useMemo(() => computeRarityComposition(cards), [cards]);

  if (!user) {
    const guestItems = SHORTCUT_DEFS.filter((item) => ['gallery', 'filter', 'stats', 'market'].includes(item.id));
    return (
      <main className="home-dashboard fade-in">
        <GuestSummaryCard total={summary.total} loading={loading} onLogin={signInWithGoogle} />
        <ShortcutTiles items={guestItems} onNavigate={onNavigate} />
      </main>
    );
  }

  const userItems = SHORTCUT_DEFS.filter((item) => item.id !== 'admin' || isAdmin);
  const selectedEntry = selectedNumber ? entries[selectedNumber - 1] : null;

  return (
    <main className="home-dashboard fade-in">
      <CollectionSummaryCard summary={summary} loading={loading} />
      <ShortcutTiles items={userItems} onNavigate={onNavigate} />

      <PokedexGridWidget
        loading={loading}
        entries={entries}
        generationStats={generationStats}
        headerStats={headerStats}
        onSelectEntry={setSelectedNumber}
      />

      <RarityCompositionWidget loading={loading} segments={raritySegments} />

      {selectedEntry && (
        <PokedexEntryModal
          entry={selectedEntry}
          onClose={() => setSelectedNumber(null)}
          onNavigate={onNavigate}
        />
      )}
    </main>
  );
}
