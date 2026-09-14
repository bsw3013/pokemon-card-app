import React, { useEffect, useRef } from 'react';

const sortOptions = [
  { value: '', label: '없음' },
  { value: 'pokedexNumber', label: '전국도감번호' },
  { value: 'cardNumber', label: '카드 파일 넘버' },
  { value: 'cardName', label: '카드 이름' },
  { value: 'series', label: '시리즈' },
  { value: 'rarity', label: '레어도' },
  { value: 'type', label: '종류' },
  { value: 'status', label: '상태' },
  { value: 'price', label: '가격' },
  { value: 'createdAt', label: '추가된 날짜' }
];

export default function MultiSortPanel({
  sortLevels,
  handleLevelFieldChange,
  toggleLevelDir,
  toggleLevelEnabled,
  resetSortLevels,
  onClose,
  align = 'right',
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Use setTimeout to avoid immediate trigger when button is clicked
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 10);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [onClose]);

  const panelStyle = {
    right: align === 'right' ? 0 : 'auto',
    left: align === 'left' ? 0 : 'auto',
  };

  return (
    <div className="multi-sort-panel slide-up" ref={panelRef} style={panelStyle}>
      <div className="multi-sort-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <strong>정렬 우선순위 <span style={{opacity:0.6, fontWeight:'normal'}}>(최대 5단계)</span></strong>
        </div>
        <div className="multi-sort-actions">
          <button type="button" className="btn btn-outline btn-compact" onClick={resetSortLevels}>초기화</button>
          <button type="button" className="btn btn-danger btn-compact" onClick={onClose}>닫기</button>
        </div>
      </div>

      <div className="multi-sort-body">
        {sortLevels.map((lvl, idx) => (
          <div key={idx} className={`sort-level-row ${lvl.enabled ? 'active' : 'inactive'}`}>
            <div className="sort-level-index">{idx + 1}</div>
            
            <div className="sort-level-field">
              <select 
                value={lvl.field} 
                onChange={(e) => handleLevelFieldChange(idx, e.target.value)}
                className="multi-sort-select"
              >
                {sortOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="sort-level-controls">
              <button 
                type="button" 
                className={`sort-dir-btn ${lvl.enabled ? 'active' : ''}`}
                onClick={() => toggleLevelDir(idx)}
                disabled={!lvl.enabled}
                title={lvl.dir === 'asc' ? '오름차순 (작은 값부터)' : '내림차순 (큰 값부터)'}
              >
                <span className="icon" style={{ transform: lvl.dir === 'desc' ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.3s ease' }}>
                  ▲
                </span>
              </button>

              <button 
                type="button" 
                className={`sort-toggle-btn ${lvl.enabled ? 'on' : 'off'}`}
                onClick={() => toggleLevelEnabled(idx)}
              >
                {lvl.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="multi-sort-footer">
         <button type="button" className="btn btn-primary" onClick={onClose} style={{ width: '100%', padding: '0.6rem', fontSize: '1rem' }}>저장 및 적용</button>
      </div>
    </div>
  );
}
