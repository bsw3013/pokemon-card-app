// "시세 업데이트" 요청 확인 (GitHub Actions가 5분마다 실행)
// 사이트에서 버튼을 누르면 Firestore marketPriceHistory/_updateRequests 에 요청이 남는다(로그인한 사용자 누구나).
// 지난번 결과(cafe.json)의 requestsHandledUntil 이후에 들어온 요청이 있으면 무엇을 검색할지 GITHUB_OUTPUT 으로 알려준다.
//
// 사용법: node scripts/check-market-requests.mjs <이전 cafe.json 경로>
// 출력(GITHUB_OUTPUT): run=none|full|cards, cards=<JSON 배열>, until=<처리한 마지막 요청 시각>

import fs from 'node:fs';

const PROJECT_ID = 'pokemoncard-0319';
const DOC = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/marketPriceHistory/_updateRequests`;
const PREV = process.argv[2] || '';

function str(v) { return v && typeof v === 'object' ? (v.stringValue ?? v.timestampValue ?? '') : ''; }
function arr(v) { return (v?.arrayValue?.values || []).map(str).filter(Boolean); }

function output(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  console.log(lines);
}

async function main() {
  let handled = '';
  try {
    if (PREV && fs.existsSync(PREV)) handled = JSON.parse(fs.readFileSync(PREV, 'utf8')).requestsHandledUntil || '';
  } catch { /* 처음이면 비어 있음 */ }

  const res = await fetch(DOC);
  if (res.status === 404) { output({ run: 'none', cards: '[]', until: handled }); return; }
  if (!res.ok) throw new Error(`요청 목록 읽기 실패 (HTTP ${res.status})`);
  const json = await res.json();
  const reqs = Object.values(json.fields?.r?.mapValue?.fields || {}).map((v) => {
    const f = v.mapValue?.fields || {};
    return { at: str(f.at), cardKey: str(f.cardKey), cardName: str(f.cardName), queries: arr(f.queries) };
  }).filter((r) => r.at && (!handled || r.at > handled));

  if (!reqs.length) { output({ run: 'none', cards: '[]', until: handled }); return; }
  const until = reqs.map((r) => r.at).sort().pop();
  const full = reqs.some((r) => !r.cardKey);
  const byKey = new Map();
  reqs.filter((r) => r.cardKey).forEach((r) => byKey.set(r.cardKey, { cardKey: r.cardKey, cardName: r.cardName, queries: r.queries }));
  console.log(`새 요청 ${reqs.length}건 (${full ? '관심 카드 전체' : `카드 ${byKey.size}장`})`);
  output({ run: full ? 'full' : 'cards', cards: JSON.stringify([...byKey.values()]), until });
}

main().catch((err) => {
  console.error(err);
  output({ run: 'none', cards: '[]', until: '' });
});
