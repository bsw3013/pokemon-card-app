import React, { useState } from 'react';
import { normalizeImageUrl, thumbUrlFor } from '../utils/thumbKey';

// 목록 화면은 가벼운 썸네일(public/thumbs)을 먼저 쓰고, 아직 썸네일이 없으면 원본으로 대신 보여준다.
// 카드 상세 창(type="modal")은 크게 보여야 하므로 항상 원본을 쓴다.
function CardImage({ imageUrl, alt, className, useThumb, type }) {
  const original = normalizeImageUrl(imageUrl);
  const thumb = thumbUrlFor(original);
  // 목록: 썸네일 → (실패하면) 원본 → (또 실패하면) 빈 자리
  // 상세(modal): 썸네일을 먼저 깔아 두고, 원본이 다 받아지면 그 위에 보여준다.
  const [stage, setStage] = useState(useThumb && thumb ? 'thumb' : 'original');
  const [originalLoaded, setOriginalLoaded] = useState(false);

  if (stage === 'failed') {
    return <div className={`img-failed ${type === 'modal' ? 'large' : ''}`}><span>이미지 없음</span></div>;
  }

  if (!useThumb) {
    return (
      <span className="img-stack">
        {thumb && !originalLoaded && <img src={thumb} alt="" aria-hidden="true" className={`${className} img-under`} />}
        <img
          src={original}
          alt={alt}
          className={`${className} ${originalLoaded ? 'loaded' : 'loading'}`}
          onLoad={() => setOriginalLoaded(true)}
          onError={() => setStage('failed')}
        />
      </span>
    );
  }

  return (
    <img
      src={stage === 'thumb' ? thumb : original}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setStage(stage === 'thumb' ? 'original' : 'failed')}
    />
  );
}

export default function CardThumbnail({ imageUrl, alt = '카드', type = 'grid', className = '' }) {
  if (imageUrl) {
    return <CardImage key={imageUrl} imageUrl={imageUrl} alt={alt} className={className} type={type} useThumb={type !== 'modal'} />;
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
