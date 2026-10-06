import React, { useEffect } from 'react';
import HomeCardThumb from './HomeCardThumb';
import { sortEntryCards, isOwnedOrGraded } from '../../utils/homeStats';

function cardInfoLines(card) {
  const seriesAndNumber = [card?.series, card?.cardNumber].filter(Boolean).join(' · ');
  return [
    card?.cardName || '이름 없음',
    seriesAndNumber,
    card?.rarity || '',
    isOwnedOrGraded(card) ? '보유' : '미보유',
  ];
}

// 전국도감 한 번호를 눌렀을 때 뜨는 카드 목록 팝업.
// 기존 .modal-backdrop / .modal-content 를 그대로 재사용한다.
export default function PokedexEntryModal({ entry, onClose, onNavigate }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!entry) return null;

  const sortedCards = sortEntryCards(entry.cards);
  const paddedNumber = String(entry.number).padStart(4, '0');

  return (
    <div className="modal-backdrop fade-in" onClick={onClose}>
      <div className="modal-content slide-up" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="modal-title">No.{paddedNumber} {entry.name}</h2>
        <p className="home-widget-subtitle">
          {entry.totalCount > 0 ? `카드 ${entry.totalCount}장 중 ${entry.ownedCount}장 보유` : '카드 없음'}
        </p>

        {entry.totalCount === 0 ? (
          <p className="home-widget-empty">이 포켓몬의 카드는 아직 도감에 없어요.</p>
        ) : (
          <div className="home-pokedex-modal-grid">
            {sortedCards.map((card, idx) => (
              <HomeCardThumb
                key={card.id || idx}
                card={card}
                grayscale={!isOwnedOrGraded(card)}
                infoLines={cardInfoLines(card)}
              />
            ))}
          </div>
        )}

        <button type="button" className="home-widget-link home-pokedex-modal-link" onClick={() => onNavigate('gallery')}>
          도감에서 보기 →
        </button>
      </div>
    </div>
  );
}
