import React from 'react';
import HomeCardThumb from './HomeCardThumb';

export default function RareShowcaseWidget({ loading, error, rareCards, onNavigate }) {
  if (!loading && !error && (!rareCards || rareCards.length === 0)) {
    return null;
  }

  return (
    <section className="home-widget home-widget-showcase">
      <header className="home-widget-header">
        <h3>내 레어 카드</h3>
      </header>

      {loading && (
        <div className="home-thumb-row">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="home-skeleton home-skeleton-thumb" />)}
        </div>
      )}

      {!loading && error && (
        <p className="home-widget-error">불러오지 못했어요. 새로고침해 주세요.</p>
      )}

      {!loading && !error && (
        <div className="home-thumb-row">
          {rareCards.map((card) => (
            <HomeCardThumb
              key={card.id}
              card={card}
              badge={card.rarity}
              title={card.cardName}
              onClick={() => onNavigate('gallery')}
            />
          ))}
        </div>
      )}
    </section>
  );
}
