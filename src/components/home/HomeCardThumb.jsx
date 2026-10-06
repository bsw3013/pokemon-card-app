import React from 'react';
import CardThumbnail from '../CardThumbnail';

// 홈 대시보드 공통 카드 썸네일. 글자를 카드 밑에 늘어놓지 않고,
// 마우스를 올리면(터치 기기에서는 항상) 이미지 위에 정보 박스가 떠오른다.
// index.css의 .album-slot-details / .market-tile-hover-info 와 같은 패턴을 .home- 접두사로 재구현했다.
export default function HomeCardThumb({ card, infoLines, grayscale = false, badge, onClick, title }) {
  const lines = (infoLines || []).filter(Boolean);
  return (
    <div
      className={`home-thumb ${grayscale ? 'filter-grayscale' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {badge && <span className="home-thumb-badge">{badge}</span>}
      <CardThumbnail imageUrl={card?.imageUrl} alt={card?.cardName || '카드'} type="grid" />
      {lines.length > 0 && (
        <div className="home-thumb-info">
          {lines.map((line, i) => (i === 0 ? <strong key={i}>{line}</strong> : <small key={i}>{line}</small>))}
        </div>
      )}
    </div>
  );
}
