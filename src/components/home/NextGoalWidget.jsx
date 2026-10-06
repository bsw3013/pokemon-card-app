import React from 'react';
import HomeCardThumb from './HomeCardThumb';
import { IconTarget, IconArrowRight } from './icons';
import { buildCardKey } from '../../utils/cardKey';

function fmtPrice(n) {
  return `${Math.round(n).toLocaleString()}원`;
}

export default function NextGoalWidget({ loading, error, goal, marketPriceByCardKey, onNavigate }) {
  return (
    <section className="home-widget home-widget-next-goal">
      <header className="home-widget-header">
        <h3><IconTarget size={18} />다음 목표</h3>
        <button type="button" className="home-widget-link" onClick={() => onNavigate('gallery')}>
          도감에서 보기<IconArrowRight size={14} />
        </button>
      </header>

      {loading && (
        <div className="home-skeleton-row">
          <div className="home-skeleton home-skeleton-text" />
          <div className="home-skeleton-thumbs">
            {[0, 1, 2, 3].map((i) => <div key={i} className="home-skeleton home-skeleton-thumb" />)}
          </div>
        </div>
      )}

      {!loading && error && (
        <p className="home-widget-error">불러오지 못했어요. 새로고침해 주세요.</p>
      )}

      {!loading && !error && !goal && (
        <p className="home-widget-empty">다음 목표가 없어요</p>
      )}

      {!loading && !error && goal && (
        <>
          <p className="home-widget-subtitle">
            {goal.series} · {goal.missingCount.toLocaleString()}장 남음 ({goal.percent}%)
          </p>
          <div className="home-thumb-row">
            {goal.missingCards.map((card, idx) => {
              const priceKey = buildCardKey(card);
              const key = `${priceKey || 'card'}__${idx}`;
              const price = marketPriceByCardKey?.[priceKey];
              return (
                <HomeCardThumb
                  key={key}
                  card={card}
                  grayscale
                  infoText={typeof price === 'number' ? fmtPrice(price) : '시세 없음'}
                />
              );
            })}
          </div>
          {goal.pricedMissingCount > 0 && (
            <p className="home-widget-footnote">
              시세 기록이 있는 {goal.pricedMissingCount}장 합계 약 {fmtPrice(goal.pricedMissingSum)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
