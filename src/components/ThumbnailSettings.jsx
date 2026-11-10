import React, { useEffect, useRef, useState } from 'react';

const FIELDS = [
  ['showName', '카드 이름'],
  ['showNumber', '세트 코드·카드 번호'],
  ['showRarity', '레어도'],
  ['showSeries', '세트 이름'],
  ['showPrice', '내 평가 가격'],
];

// 카드 목록 "보기 설정": 카드 정보를 항상 보여줄지, 마우스를 올렸을 때 카드 위에 보여줄지 + 표시 항목
export default function ThumbnailSettings({ settings, toggleSetting, updateSettings, hide = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const setHover = (v) => {
    if (updateSettings) updateSettings({ hoverMode: v });
    else if (!!settings.hoverMode !== v) toggleSetting('hoverMode');
  };

  return (
    <div className="tset" ref={ref}>
      <button type="button" className="btn btn-secondary btn-compact" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        보기 설정
      </button>
      {open && (
        <div className="tset-pop" role="dialog" aria-label="보기 설정">
          <strong>카드 정보 표시</strong>
          <div className="tset-mode">
            <button type="button" className={!settings.hoverMode ? 'on' : ''} onClick={() => setHover(false)}>
              <b>항상 보기</b><small>카드 아래에 정보가 늘 보여요</small>
            </button>
            <button type="button" className={settings.hoverMode ? 'on' : ''} onClick={() => setHover(true)}>
              <b>마우스 올리면 보기</b><small>사진만 크게, 올리면 카드 위에 정보</small>
            </button>
          </div>
          <strong>보여줄 항목</strong>
          <div className="tset-fields">
            {FIELDS.filter(([k]) => !hide.includes(k)).map(([k, l]) => (
              <label key={k}>
                <input type="checkbox" checked={settings[k] !== false} onChange={() => toggleSetting(k)} />
                {l}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
