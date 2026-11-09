// 주소 뒤 # 부분으로 화면을 나눈다. 예) #/sets/sv2a?cardId=abc
//   path   : ['sets', 'sv2a']
//   params : { cardId: 'abc' }

export function parseHash(hash = (typeof window !== 'undefined' ? window.location.hash : '')) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.split('/').map((s) => decodeURIComponent(s.trim())).filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryPart));
  return { path, params };
}

export function buildHash(path = [], params = {}) {
  const p = path.map((s) => encodeURIComponent(s)).join('/');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString();
  return `#/${p}${qs ? `?${qs}` : ''}`;
}

export function navigate(path = [], params = {}, { replace = false } = {}) {
  const next = buildHash(path, params);
  if (window.location.hash === next) return;
  if (replace) {
    window.history.replaceState(null, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = next;
  }
}

// 지금 화면은 그대로 두고 ?뒤 값만 바꾼다. (null 이면 지움)
export function setHashParams(changes = {}, { replace = false } = {}) {
  const { path, params } = parseHash();
  const next = { ...params };
  Object.entries(changes).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '' || v === false) delete next[k];
    else next[k] = String(v);
  });
  navigate(path, next, { replace });
}
