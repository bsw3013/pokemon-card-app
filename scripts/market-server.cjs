/**
 * 브라우저에서 직접 번개장터/당근마켓을 호출하면 CORS에 막히기 때문에,
 * 로컬에서 이 프록시 서버를 띄워두면 앱의 "🔍 마켓에서 검색" 버튼이 이 서버를 통해
 * 실시간 검색 결과를 받아온다. Firestore에는 아무것도 쓰지 않는다 — 결과를 보고
 * 사용자가 직접 "가져오기"를 눌러야만 그 매물이 저장된다.
 *
 * 실행: npm run market-server (개발 서버 npm run dev 와 별개로 계속 켜둬야 함)
 */
const http = require('http');
const { URL } = require('url');
const bunjang = require('./collectors/bunjang.cjs');
const danggeun = require('./collectors/danggeun.cjs');

const PORT = process.env.MARKET_SERVER_PORT || 5175;
const COLLECTORS = [bunjang, danggeun];

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/search') {
    const q = (url.searchParams.get('query') || '').trim();
    if (!q) {
      sendJson(res, 400, { error: '검색어(query)가 필요합니다.' });
      return;
    }

    const settled = await Promise.allSettled(COLLECTORS.map((c) => c.search(q)));
    const results = [];
    const errors = [];
    settled.forEach((r, i) => {
      const collector = COLLECTORS[i];
      if (r.status === 'fulfilled') {
        r.value.forEach((item) => results.push({ ...item, source: collector.id }));
      } else {
        errors.push(`${collector.label}: ${r.reason.message}`);
      }
    });

    sendJson(res, 200, { results, errors });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`마켓 검색 로컬 서버 실행중: http://localhost:${PORT}`);
  console.log('이 창은 열어둔 채로, 다른 터미널에서 npm run dev로 앱을 켜서 사용하세요.');
});
