/**
 * 새 수집기를 추가하려면: 이 파일과 같은 형태로
 *   { id, label, search: async (query) => [{ externalId, title, price, url, imageUrl, region }] }
 * 를 export하고, scripts/collect-prices.cjs의 COLLECTORS 배열에 추가하면 된다.
 */
const SEARCH_URL = 'https://api.bunjang.co.kr/api/1/find_v2.json';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

async function search(query, { maxPages = 2, pageSize = 100, delayMs = 1000 } = {}) {
  const results = [];
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      q: query,
      order: 'date',
      page: String(page),
      n: String(pageSize),
      stat_device: 'w',
      req_ref: 'search',
      version: '4',
    });
    const resp = await fetch(`${SEARCH_URL}?${params}`, { headers: HEADERS });
    if (!resp.ok) throw new Error(`번개장터 API 오류: ${resp.status}`);
    const data = await resp.json();
    const items = data.list || [];
    if (items.length === 0) break;

    for (const item of items) {
      const pid = item.pid;
      results.push({
        externalId: String(pid),
        title: item.name,
        price: toInt(item.price),
        url: `https://m.bunjang.co.kr/products/${pid}`,
        imageUrl: (item.product_image || '').replace('{res}', '300'),
        region: item.location || '',
      });
    }
    if (items.length < pageSize) break;
    await sleep(delayMs);
  }
  return results;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { id: 'bunjang', label: '번개장터', search };
