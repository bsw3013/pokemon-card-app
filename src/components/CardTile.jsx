import React, { useMemo } from 'react';
import CardThumbnail from './CardThumbnail';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { rarityTone } from '../utils/rarityTone';
import { ownedCount, topGrading } from '../utils/cardStats';

const LANG_TAG = { 일본: 'JP', 중국: 'CN', 미국: 'EN', 영어: 'EN' };
function languageTag(lang) {
  const text = String(lang || '');
  const hit = Object.keys(LANG_TAG).find((k) => text.includes(k));
  return hit ? LANG_TAG[hit] : '';
}

// 도감·필터 화면이 함께 쓰는 카드 한 장 타일.
// 이미지 아래에는 이름 한 줄, "세트코드 번호/총장수" + 레어도 배지만 둔다.
export default function CardTile({ card, settings = {}, onClick, selected = false, overlay = null, title }) {
  const { catalog } = useOwnedCards();
  const setIndex = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const set = findSetForCard(card, setIndex);
  const owned = ownedCount(card);
  const grading = topGrading(card);
  const no = card.cardNo ?? parseCardNo(card.cardNumber);
  const total = set?.printedTotal;
  const code = set ? String(set.code).toUpperCase() : '';
  const numberText = no != null ? `${code ? `${code} ` : ''}${no}${total ? `/${total}` : ''}` : (card.cardNumber || '');
  const lang = languageTag(card.language);
  const {
    showName = true, showSeries = true, showNumber = true, showRarity = true, showPrice = true, hoverMode = false,
  } = settings;

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };

  return (
    <article
      className={`ctile ${owned ? 'owned' : 'missing'} ${hoverMode ? 'hover-mode' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      title={title || card.cardName || ''}
    >
      <div className="ctile-img">
        <CardThumbnail imageUrl={card.imageUrl} alt={card.cardName || '카드'} type="grid" />
        {owned > 1 && <span className="ctile-qty">×{owned}</span>}
        {grading && <span className="ctile-grade">{grading.company} {grading.grade}</span>}
        {overlay}
      </div>
      <div className="ctile-body">
        {showName && (
          <div className="ctile-name">
            <span>{card.cardName || '이름 없음'}</span>
            {lang && <em className="ctile-lang">{lang}</em>}
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
