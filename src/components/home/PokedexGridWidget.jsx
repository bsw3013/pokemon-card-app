import React, { useState } from 'react';
import { GENERATIONS, POKEDEX_MAX } from '../../utils/homeStats';

function padNumber(num) {
  return num >= 1000 ? String(num) : String(num).padStart(3, '0');
}

function entryInfoText(entry) {
  const label = `No.${entry.number} ${entry.name}`;
  if (entry.totalCount === 0) return `${label} · 도감에 카드 없음`;
  return `${label} · 카드 ${entry.totalCount}장 중 ${entry.ownedCount}장 보유`;
}

function entryAriaLabel(entry) {
  const label = `No.${entry.number} ${entry.name}`;
  if (entry.totalCount === 0) return `${label}, 도감에 카드 없음`;
  return `${label}, 카드 ${entry.totalCount}장 중 ${entry.ownedCount}장 보유`;
}

export default function PokedexGridWidget({ loading, entries, generationStats, headerStats, onSelectEntry }) {
  const [genIndex, setGenIndex] = useState(0);
  const [hoverNumber, setHoverNumber] = useState(null);

  if (loading) {
    return (
      <section className="home-widget home-widget-pokedex">
        <header className="home-widget-header">
          <h3>내 포켓몬 도감</h3>
        </header>
        <div className="home-skeleton home-skeleton-pokedex" />
      </section>
    );
  }

  const gen = GENERATIONS[genIndex];
  const genEntries = entries.slice(gen.start - 1, gen.end);
  const hoveredEntry = hoverNumber ? entries[hoverNumber - 1] : null;

  return (
    <section className="home-widget home-widget-pokedex">
      <header className="home-widget-header">
        <h3>내 포켓몬 도감</h3>
        <span className="home-widget-count-group">
          <strong className="home-widget-count-big">{headerStats.ownedSpecies.toLocaleString()}종 보유</strong>
          <span className="home-widget-count">카드가 있는 포켓몬 {headerStats.speciesWithCards.toLocaleString()}종 중 · 전체 {POKEDEX_MAX.toLocaleString()}종</span>
        </span>
      </header>

      <div className="home-pokedex-gen-tabs" role="tablist" aria-label="세대 선택">
        {generationStats.map((g, idx) => (
          <button
            key={g.label}
            type="button"
            role="tab"
            aria-selected={idx === genIndex}
            className={`home-pokedex-gen-tab ${idx === genIndex ? 'active' : ''}`}
            onClick={() => { setGenIndex(idx); setHoverNumber(null); }}
          >
            {g.label} {g.ownedSpecies}/{g.totalSpecies}
          </button>
        ))}
      </div>

      <p className="home-pokedex-infobar" aria-live="polite">
        {hoveredEntry ? (
          entryInfoText(hoveredEntry)
        ) : (
          <>
            <span className="home-pokedex-hint-mouse">칸에 마우스를 올려보세요</span>
            <span className="home-pokedex-hint-touch">칸을 눌러보세요</span>
          </>
        )}
      </p>

      <div className="home-pokedex-grid">
        {genEntries.map((entry) => (
          <button
            key={entry.number}
            type="button"
            className={`home-pokedex-cell ${entry.state}`}
            aria-label={entryAriaLabel(entry)}
            onMouseEnter={() => setHoverNumber(entry.number)}
            onMouseLeave={() => setHoverNumber((n) => (n === entry.number ? null : n))}
            onFocus={() => setHoverNumber(entry.number)}
            onBlur={() => setHoverNumber((n) => (n === entry.number ? null : n))}
            onClick={() => onSelectEntry(entry.number)}
          >
            {padNumber(entry.number)}
          </button>
        ))}
      </div>

      <div className="home-pokedex-legend">
        <span className="home-pokedex-legend-item"><i className="home-pokedex-legend-swatch owned" />보유</span>
        <span className="home-pokedex-legend-item"><i className="home-pokedex-legend-swatch unowned" />카드는 있는데 아직 없음</span>
        <span className="home-pokedex-legend-item"><i className="home-pokedex-legend-swatch none" />도감에 카드가 없는 포켓몬</span>
      </div>
    </section>
  );
}
