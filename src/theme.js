// 라이트/다크 테마 전환. 선택값은 localStorage(pc_theme)에 저장한다.
const THEME_STORAGE_KEY = 'pc_theme';

export function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) 시 기본값으로 진행
  }
  return 'light';
}

export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // 저장 실패해도 화면 적용은 그대로 유지
  }
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
