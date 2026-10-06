import React, { useState } from 'react';
import { toggleTheme } from '../theme';

function SunIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4" />
      <path d="M12 19.1v2.4" />
      <path d="M4.6 4.6l1.7 1.7" />
      <path d="M17.7 17.7l1.7 1.7" />
      <path d="M2.5 12h2.4" />
      <path d="M19.1 12h2.4" />
      <path d="M4.6 19.4l1.7-1.7" />
      <path d="M17.7 6.3l1.7-1.7" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20 14.2A8.3 8.3 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2Z" />
    </svg>
  );
}

// 상단바 라이트/다크 전환 버튼. 기본값은 라이트, 선택은 localStorage(pc_theme)에 저장된다.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  const handleClick = () => {
    setTheme(toggleTheme());
  };

  return (
    <button
      type="button"
      className="btn btn-secondary btn-compact theme-toggle-btn"
      onClick={handleClick}
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
