import React from 'react';

export default function CardThumbnail({ imageUrl, alt = '카드', type = 'grid', className = '' }) {
  if (imageUrl) {
    let validUrl = imageUrl;
    // URL이 http/https, data:, / 로 시작하지 않으면 (예: www.example.com/img.jpg) https://를 붙여줍니다.
    if (!/^(https?:\/\/|data:|blob:|\/)/.test(imageUrl)) {
      validUrl = `https://${imageUrl}`;
    }
    return <img src={validUrl} alt={alt} className={className} loading="lazy" />;
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
