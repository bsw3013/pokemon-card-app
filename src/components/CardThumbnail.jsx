import React, { useState } from 'react';
import { normalizeImageUrl, thumbUrlFor } from '../utils/thumbKey';

// 목록 화면은 가벼운 썸네일(public/thumbs)을 먼저 쓰고, 아직 썸네일이 없으면 원본으로 대신 보여준다.
// 카드 상세 창(type="modal")은 크게 보여야 하므로 항상 원본을 쓴다.
function CardImage({ imageUrl, alt, className, useThumb }) {
  const original = normalizeImageUrl(imageUrl);
  const thumb = useThumb ? thumbUrlFor(original) : '';
  const [thumbFailed, setThumbFailed] = useState(false);
  const usingThumb = Boolean(thumb) && !thumbFailed;
  return (
    <img
      src={usingThumb ? thumb : original}
      alt={alt}
      className={className}
      loading="lazy"
      onError={usingThumb ? () => setThumbFailed(true) : undefined}
    />
  );
}

export default function CardThumbnail({ imageUrl, alt = '카드', type = 'grid', className = '' }) {
  if (imageUrl) {
    return <CardImage key={imageUrl} imageUrl={imageUrl} alt={alt} className={className} useThumb={type !== 'modal'} />;
  }

  // Fallbacks based on type
  if (type === 'table') {
    return (
      <div className="table-no-thumb-wrapper">
        <img src="/placeholder.png" alt="placeholder" className="table-placeholder-img" />
        <div className="table-placeholder-text">이미지 필요</div>
      </div>
    );
  }

  if (type === 'modal') {
    return (
      <div className="placeholder-image">
        <img src="/placeholder.png" alt="placeholder" className="modal-placeholder-img" />
        <div className="modal-placeholder-text">이미지<br />필요</div>
      </div>
    );
  }

  if (type === 'filter') {
    return (
      <div className="filter-card-placeholder">
        <span>이미지 없음</span>
      </div>
    );
  }

  if (type === 'album-slot') {
    return <div className="album-slot-empty">비어있음</div>;
  }

  if (type === 'album-picker') {
    return <div className="thumb-placeholder">No Img</div>;
  }

  // Default (grid)
  return (
    <div className="no-image-wrapper">
      <img src="/placeholder.png" alt="placeholder" className="placeholder-img" />
      <div className="placeholder-text">이미지<br/>필요</div>
    </div>
  );
}
