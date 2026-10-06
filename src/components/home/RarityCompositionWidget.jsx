import React from 'react';

export default function RarityCompositionWidget({ loading, segments }) {
  if (!loading && (!segments || segments.length === 0)) {
    return null;
  }

  return (
    <section className="home-widget home-widget-rarity">
      <header className="home-widget-header">
        <h3>레어도 구성</h3>
        <span className="home-widget-count">보유 카드 기준</span>
      </header>

      {loading ? (
        <div className="home-skeleton home-skeleton-rarity-bar" />
      ) : (
        <>
          <div className="home-rarity-bar">
            {segments.map((seg) => (
              <div
                key={seg.label}
                className="home-rarity-bar-segment"
                style={{ width: `${seg.percent}%`, background: `var(${seg.colorVar})` }}
                title={`${seg.label} ${seg.count.toLocaleString()}장`}
              />
            ))}
          </div>
          <div className="home-rarity-legend">
            {segments.map((seg) => (
              <span key={seg.label} className="home-rarity-legend-item">
                <i className="home-rarity-legend-dot" style={{ background: `var(${seg.colorVar})` }} />
                {seg.label} {seg.count.toLocaleString()}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
