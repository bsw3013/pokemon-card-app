import { setCafeData } from './cafeMarket';

// "시세 업데이트" 버튼: 사이트에서 GitHub의 MVP 카페 수집 작업(market-cafe.yml)을 바로 실행한다.
// - 네이버 키는 GitHub 금고에만 있고, 사이트에는 "작업 실행" 권한만 있는 GitHub 토큰을 쓴다.
// - 토큰은 이 기기의 브라우저에만 저장한다(코드·데이터베이스에 넣지 않음).
const REPO = 'bsw3013/pokemon-card-app';
const WORKFLOW = 'market-cafe.yml';
const API = 'https://api.github.com';
const TOKEN_KEY = 'market_update_token_v1';

export function getUpdateToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setUpdateToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* 저장 못 하는 브라우저면 무시 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) throw new Error('토큰이 맞지 않거나 기간이 끝났어요. 토큰을 다시 넣어 주세요.');
  if (res.status === 403 || res.status === 404) throw new Error('토큰에 이 저장소의 "Actions 실행" 권한이 없어요.');
  if (!res.ok) throw new Error(`GitHub 응답 오류 (${res.status})`);
  return res;
}

// 결과 파일을 GitHub에서 바로(캐시 없이) 읽어 온다
async function fetchFreshData(token) {
  const res = await gh(`/repos/${REPO}/contents/cafe.json?ref=market-data`, token, {
    headers: { Accept: 'application/vnd.github.raw+json' },
    cache: 'no-store',
  });
  return res.json();
}

// card: { cardKey, cardName, queries } 를 주면 그 카드만, 안 주면 관심 카드 전체.
// onStep(문구)로 진행 상황을 알려 주고, 끝나면 새 수집 결과를 돌려준다.
export async function runMarketUpdate({ card, onStep } = {}) {
  const token = getUpdateToken();
  if (!token) throw Object.assign(new Error('토큰이 필요해요'), { needToken: true });
  const startedAt = Date.now();
  onStep?.('GitHub에 수집을 요청하는 중…');
  await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({
      ref: 'main',
      inputs: card ? {
        card_key: card.cardKey,
        card_name: card.cardName || '',
        queries: (card.queries || []).join(','),
      } : {},
    }),
  });

  // 방금 요청한 실행을 찾아서 끝날 때까지 기다린다 (보통 30초~1분)
  let run = null;
  const deadline = startedAt + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(run ? 5000 : 3000);
    const res = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`, token, { cache: 'no-store' });
    const { workflow_runs: runs = [] } = await res.json();
    run = runs.find((r) => Date.parse(r.created_at) >= startedAt - 10000) || run;
    if (!run) { onStep?.('수집 작업을 기다리는 중…'); continue; }
    if (run.status !== 'completed') {
      onStep?.(run.status === 'queued' ? '앞의 수집이 끝나길 기다리는 중…' : '카페에서 검색하는 중… (약 1분)');
      continue;
    }
    if (run.conclusion !== 'success') throw new Error('수집 작업이 실패했어요. 잠시 뒤 다시 해 주세요.');
    onStep?.('결과를 불러오는 중…');
    const data = await fetchFreshData(token);
    setCafeData(data);
    return data;
  }
  throw new Error('시간이 오래 걸려요. 몇 분 뒤 새로고침하면 반영돼 있을 거예요.');
}
