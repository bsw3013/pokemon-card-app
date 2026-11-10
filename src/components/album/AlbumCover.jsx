import React from 'react';
import CardThumbnail from '../CardThumbnail';
import { DEFAULT_ALBUM_COLOR, slotImage, slotOwned } from './albumUtils';

// 앨범 표지: 바인더 색 + 왼쪽 링 + (첫 페이지 미리보기 | 앨범 속 카드 한 장 | 직접 올린 사진)
export default function AlbumCover({ album, cardsById, cover: coverOverride, color: colorOverride, className = '' }) {
  const color = colorOverride || album?.coverColor || DEFAULT_ALBUM_COLOR;
  const cover = coverOverride || album?.cover || { type: 'pages' };
  const cols = Math.max(1, Number(album?.cols) || 3);
  const rows = Math.max(1, Number(album?.rows) || 3);

  let body;
  if (cover.type === 'photo' && cover.imageUrl) {
    body = (
      <img
        className="alb-cover-photo"
        src={cover.imageUrl}
        alt=""
        loading="lazy"
        style={{ objectPosition: `center ${cover.position || 'center'}` }}
      />
    );
  } else if (cover.type === 'card' && cover.imageUrl) {
    body = (
      <div className="alb-cover-card">
        <CardThumbnail imageUrl={cover.imageUrl} alt="" type="grid" />
      </div>
    );
  } else {
    const slots = (album?.pages?.[0]?.slots || []).slice(0, cols * rows);
    while (slots.length < cols * rows) slots.push(null);
    body = (
      <div className="alb-mini" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, '--r': (cols * 63 + (cols + 1) * 8) / (rows * 88 + (rows + 1) * 8) }}>
        {slots.map((s, i) => {
          const img = s ? slotImage(s, cardsById) : '';
          return (
            <div key={i} className={`alb-mini-cell ${s ? '' : 'empty'} ${s && !slotOwned(s, cardsById) ? 'miss' : ''}`}>
              {img && <CardThumbnail imageUrl={img} alt="" type="grid" />}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`alb-cover ${cover.type === 'photo' && cover.imageUrl ? 'is-photo' : ''} ${className}`} style={{ '--alb-color': color }}>
      <span className="alb-rings" aria-hidden="true" />
      <div className="alb-cover-body">{body}</div>
    </div>
  );
}
