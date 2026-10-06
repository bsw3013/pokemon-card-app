import React from 'react';

// 홈 대시보드 전용 인라인 SVG 아이콘 모음. 이모지 대신 사용한다.
// 모두 currentColor 기반이라 부모 요소의 color(CSS 변수)로 색을 맞춘다.
function IconBase({ children, size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconGallery(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </IconBase>
  );
}

export function IconFilter(props) {
  return (
    <IconBase {...props}>
      <path d="M4 5h16" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </IconBase>
  );
}

export function IconAlbum(props) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="1.6" />
      <path d="M8 4v16" />
      <path d="M12 9h5" />
      <path d="M12 13h5" />
    </IconBase>
  );
}

export function IconStats(props) {
  return (
    <IconBase {...props}>
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
      <path d="M3 20h18" />
    </IconBase>
  );
}

export function IconMarket(props) {
  return (
    <IconBase {...props}>
      <path d="M3 10l2-5.5A1 1 0 0 1 6 4h12a1 1 0 0 1 1 .5L21 10" />
      <path d="M4 10h16v8.4A1.6 1.6 0 0 1 18.4 20H5.6A1.6 1.6 0 0 1 4 18.4V10Z" />
      <path d="M9 13.5a3 3 0 0 0 6 0" />
    </IconBase>
  );
}

export function IconSettings(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.5v2.1" />
      <path d="M12 18.4v2.1" />
      <path d="M4.9 6.4l1.5 1.5" />
      <path d="M17.6 16.1l1.5 1.5" />
      <path d="M3.5 12h2.1" />
      <path d="M18.4 12h2.1" />
      <path d="M4.9 17.6l1.5-1.5" />
      <path d="M17.6 7.9l1.5-1.5" />
    </IconBase>
  );
}

export function IconTarget(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconArrowRight(props) {
  return (
    <IconBase {...props}>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </IconBase>
  );
}

// 로그인 버튼용 아이콘. 특정 브랜드 색 대신 currentColor만 사용한다.
export function IconLogin(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5 19.5c1.2-3.3 4-5 7-5s5.8 1.7 7 5" />
    </IconBase>
  );
}

// 통계 칩(보유/미보유/등급카드)에 쓰는 작은 점 아이콘.
export function IconDot(props) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" {...props}>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}
