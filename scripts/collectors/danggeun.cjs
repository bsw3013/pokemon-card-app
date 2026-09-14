/**
 * 당근마켓 중고거래 검색결과 페이지(Remix SSR)에서 판매중 매물을 가져온다.
 * 지역 기반 서비스라 region 옵션으로 지정한 동네 인근 매물만 조회된다.
 */
const SEARCH_URL = 'https://www.daangn.com/kr/buy-sell/';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const REMIX_CONTEXT_RE = /window\.__remixContext\s*=\s*(\{.*?\});/s;

async function search(query, { region = '서울', delayMs = 1000 } = {}) {
  const params = new URLSearchParams({ search: query });
  if (region) params.set('in', region);

  const resp = await fetch(`${SEARCH_URL}?${params}`, { headers: HEADERS });
  if (!resp.ok) throw new Error(`당근마켓 페이지 오류: ${resp.status}`);
  const html = await resp.text();
  await sleep(delayMs);

  const match = REMIX_CONTEXT_RE.exec(html);
  if (!match) return [];

  const data = JSON.parse(match[1]);
  const articles = findArticles(data);

  return articles.map((a) => {
    const href = a.href || '';
    return {
      // 당근마켓 article.id/href는 슬래시가 섞인 경로라 Firestore 문서ID로 못 씀 -> 마지막 슬러그만 추출
      externalId: extractSlug(a.id || href),
      title: a.title,
      price: toInt(a.price),
      url: href.startsWith('/') ? `https://www.daangn.com${href}` : href,
      imageUrl: a.thumbnail,
      region: (a.region || {}).name || '',
    };
  });
}

function findArticles(obj) {
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findArticles(v);
      if (found) return found;
    }
    return null;
  }
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj.fleamarketArticles)) return obj.fleamarketArticles;
    for (const v of Object.values(obj)) {
      const found = findArticles(v);
      if (found) return found;
    }
  }
  return null;
}

function extractSlug(pathOrId) {
  const segments = String(pathOrId || '').split('/').filter(Boolean);
  return segments[segments.length - 1] || String(pathOrId || '').replace(/\//g, '_');
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { id: 'danggeun', label: '당근마켓', search };
