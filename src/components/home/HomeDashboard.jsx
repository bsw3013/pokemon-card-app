import React, { useMemo } from 'react';
import { useAuth } from '../../AuthContext';
import { useHomeData } from '../../hooks/useHomeData';
import {
  computeCollectionSummary,
  computeMarketPriceByCardKey,
  computeNextGoalSeries,
  pickRecentAlbums,
  buildPokedexGrid,
  countOwnedSpecies,
  pickRareShowcase,
} from '../../utils/homeStats';
import GuestSummaryCard from './GuestSummaryCard';
import CollectionSummaryCard from './CollectionSummaryCard';
import ShortcutTiles from './ShortcutTiles';
import NextGoalWidget from './NextGoalWidget';
import MyAlbumsWidget from './MyAlbumsWidget';
import PokedexGridWidget from './PokedexGridWidget';
import RareShowcaseWidget from './RareShowcaseWidget';
import { IconGallery, IconFilter, IconAlbum, IconStats, IconMarket, IconSettings } from './icons';

const SHORTCUT_DEFS = [
  { id: 'gallery', label: '도감', href: '#/gallery', Icon: IconGallery },
  { id: 'filter', label: '필터', href: '#/filter', Icon: IconFilter },
  { id: 'album', label: '앨범', href: '#/album', Icon: IconAlbum },
  { id: 'stats', label: '통계', href: '#/stats', Icon: IconStats },
  { id: 'market', label: '시세', href: '#/market', Icon: IconMarket },
  { id: 'admin', label: '설정', href: '#/admin', Icon: IconSettings },
];

export default function HomeDashboard({ onNavigate }) {
  const { user, isAdmin, signInWithGoogle } = useAuth();
  const {
    cards,
    cardsLoading,
    albums,
    albumsLoading,
    albumsError,
    marketListings,
    marketLoading,
    marketError,
  } = useHomeData();

  const summary = useMemo(() => computeCollectionSummary(cards), [cards]);

  const marketPriceByCardKey = useMemo(
    () => computeMarketPriceByCardKey(marketListings),
    [marketListings]
  );

  const goal = useMemo(
    () => computeNextGoalSeries(cards, marketPriceByCardKey),
    [cards, marketPriceByCardKey]
  );

  const recentAlbums = useMemo(() => pickRecentAlbums(albums, 2), [albums]);

  const pokedexGrid = useMemo(() => buildPokedexGrid(cards), [cards]);
  const ownedSpecies = useMemo(() => countOwnedSpecies(pokedexGrid), [pokedexGrid]);

  const rareCards = useMemo(() => pickRareShowcase(cards, 8), [cards]);

  if (!user) {
    const guestItems = SHORTCUT_DEFS.filter((item) => ['gallery', 'filter', 'stats', 'market'].includes(item.id));
    return (
      <main className="home-dashboard fade-in">
        <GuestSummaryCard total={summary.total} loading={cardsLoading} onLogin={signInWithGoogle} />
        <ShortcutTiles items={guestItems} onNavigate={onNavigate} />
      </main>
    );
  }

  const userItems = SHORTCUT_DEFS.filter((item) => item.id !== 'admin' || isAdmin);

  return (
    <main className="home-dashboard fade-in">
      <CollectionSummaryCard summary={summary} loading={cardsLoading} />
      <ShortcutTiles items={userItems} onNavigate={onNavigate} />

      <div className="home-widget-grid">
        <NextGoalWidget
          loading={cardsLoading || marketLoading}
          error={false}
          goal={goal}
          marketPriceByCardKey={marketError ? {} : marketPriceByCardKey}
          onNavigate={onNavigate}
        />
        <MyAlbumsWidget
          loading={albumsLoading}
          error={albumsError}
          recentAlbums={recentAlbums}
          onNavigate={onNavigate}
        />
        <PokedexGridWidget
          loading={cardsLoading}
          error={false}
          pokedexGrid={pokedexGrid}
          ownedSpecies={ownedSpecies}
        />
      </div>

      <RareShowcaseWidget loading={cardsLoading} error={false} rareCards={rareCards} onNavigate={onNavigate} />
    </main>
  );
}
