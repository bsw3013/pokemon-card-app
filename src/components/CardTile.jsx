import React, { useMemo } from 'react';
import CardThumbnail from './CardThumbnail';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { useAuth } from '../AuthContext';
import { DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { rarityTone } from '../utils/rarityTone';
import { cardLanguage, copyBreakdown, langShort } from '../utils/cardStats';

// 도감·필터 화면이 함께 쓰는 카드 한 장 타일.
// 이미지 아래에는 이름 한 줄, "세트코드 번호/총장수" + 레어도 배지만 둔다.
export default function CardTile({ card, settings = {}, onClick, selected = false, overlay = null, title }) {
  const { catalog } = useOwnedCards();
  const { user } = useAuth();
  const setIndex = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const set = findSetForCard(card, setIndex);
  const split = copyBreakdown(card);
  const owned = split.total;
  const no = card.cardNo ?? parseCardNo(card.cardNumber);
  const total = set?.printedTotal;
  const code = set ? String(set.code).toUpperCase() : '';
  const numberText = no != null ? `${code ? `${code} ` : ''}${no}${total ? `/${total}` : ''}` : (card.cardNumber || '');
  // 언어판(일판·영문판 등)과 등급 표시는 이미지 위에 크게 보여준다. (한판은 표시 안 함)
  const language = cardLanguage(card);
  const langBadge = user && !language.includes('한국') ? langShort(language) : '';
  // 등급 카드: 금색 슬랩 배지(가장 높은 점수), Raw 카드와 같이 있으면 "Raw ×N" 배지를 따로 붙인다.
  const gradeBadge = split.gradedCount > 0
    ? `${split.top ? `${split.top.company} ${split.top.grade}`.trim() : '등급'}${split.gradedCount > 1 ? ` ×${split.gradedCount}` : ''}`
    : '';
  const rawBadge = split.gradedCount > 0 && split.rawCount > 0 ? `Raw ×${split.rawCount}` : '';
  const {
    showName = true, showSeries = true, showNumber = true, showRarity = true, showPrice = true, hoverMode = false,
  } = settings;

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };

  return (
    <article
      className={`ctile ${owned || !user ? 'owned' : 'missing'} ${hoverMode ? 'hover-mode' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      title={title || card.cardName || ''}
    >
      <div className="ctile-img">
        <CardThumbnail imageUrl={card.imageUrl} alt={card.cardName || '카드'} type="grid" />
        {owned > 1 && !gradeBadge && <span className="ctile-qty">×{owned}</span>}
        {(langBadge || gradeBadge) && (
          <span className="ctile-badges">
            {gradeBadge && <span className="ctile-slab" title="등급 카드">{gradeBadge}</span>}
            {rawBadge && <span className="ctile-raw" title="Raw 카드 (등급 안 받은 카드)">{rawBadge}</span>}
            {langBadge && <span className={`ctile-lang-badge lang-${langBadge}`}>{langBadge}</span>}
          </span>
        )}
        {overlay}
      </div>
      <div className="ctile-body">
        {showName && (
          <div className="ctile-name">
            <span>{card.cardName || '이름 없음'}</span>
          </div>
        )}
        {(showNumber || showRarity) && (
          <div className="ctile-meta">
            {showNumber ? <span className="ctile-num">{numberText || '-'}</span> : <span />}
            {showRarity && card.rarity && <span className={`rar-badge ${rarityTone(card.rarity)}`}>{card.rarity}</span>}
          </div>
        )}
        {showSeries && set && <div className="ctile-set">{set.name}</div>}
        {showSeries && !set && card.series && <div className="ctile-set">{card.series}</div>}
        {showPrice && Number(card.price) > 0 && <div className="ctile-price">{Number(card.price).toLocaleString()}원</div>}
      </div>
    </article>
  );
}
