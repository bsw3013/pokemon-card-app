import React, { useState, useRef, useEffect } from 'react';

export default function ThumbnailSettings({ settings, toggleSetting }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // 팝업 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="thumbnail-settings-container" ref={menuRef} style={{ position: 'relative' }}>
      <button 
        type="button" 
        className="btn btn-secondary" 
        style={{ padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem', height: '100%' }}
        onClick={() => setIsOpen(!isOpen)}
        title="보기 설정"
      >
        <span>⚙️ 보기 설정</span>
      </button>

      {isOpen && (
        <div 
          className="thumbnail-settings-popup fade-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '1rem',
            width: '240px',
            zIndex: 2000,
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.5)'
          }}
        >
          <div style={{ marginBottom: '1rem', paddingBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontWeight: 'bold', color: 'var(--primary-color)' }}>
              <input 
                type="checkbox" 
                checked={settings.hoverMode} 
                onChange={() => toggleSetting('hoverMode')} 
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
              />
              ✨ 스마트 갤러리 모드
            </label>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', marginLeft: '1.6rem', lineHeight: 1.3 }}>
              사진만 크게 보고, 마우스를 올릴 때만 상세 정보를 띄웁니다.
            </p>
          </div>

          <strong style={{ fontSize: '0.8rem', display: 'block', marginBottom: '0.6rem', color: 'var(--text-muted)' }}>표시할 정보 선택</strong>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={settings.showName} onChange={() => toggleSetting('showName')} />
              이름 및 국가/보유상태
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={settings.showSeries} onChange={() => toggleSetting('showSeries')} />
              시리즈
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={settings.showNumber} onChange={() => toggleSetting('showNumber')} />
              도감/카드번호
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={settings.showRarity} onChange={() => toggleSetting('showRarity')} />
              레어도
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={settings.showPrice} onChange={() => toggleSetting('showPrice')} />
              가격
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
