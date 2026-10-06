import React from 'react';
import { IconGallery } from './icons';
import { POKEDEX_MAX } from '../../utils/homeStats';

export default function PokedexGridWidget({ loading, error, pokedexGrid, ownedSpecies }) {
  return (
    <section className="home-widget home-widget-pokedex">
      <header className="home-widget-header">
        <h3><IconGallery size={18} />내 포켓몬 도감</h3>
        {!loading && !error && (
          <span className="home-widget-count">{ownedSpecies.toLocaleString()} / {POKEDEX_MAX.toLocaleString()}종</span>
        )}
      </header>
      <p className="home-widget-desc">포켓몬 한 마리당 한 칸. 색이 칠해진 칸은 그 포켓몬 카드를 한 장 이상 가진 거예요.</p>

      {loading && <div className="home-skeleton home-skeleton-pokedex" />}

      {!loading && error && (
        <p className="home-widget-error">불러오지 못했어요. 새로고침해 주세요.</p>
      )}

      {!loading && !error && (
        <div className="home-pokedex-grid">
          {pokedexGrid.map((cell) => (
            <div
              key={cell.number}
              className={`home-pokedex-cell ${cell.filled ? 'filled' : ''}`}
              title={cell.title || `No.${String(cell.number).padStart(4, '0')}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
