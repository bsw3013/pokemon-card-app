import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { loadCafeData, setCafeData } from './cafeMarket';

// "시세 업데이트" 버튼 (로그인한 사용자 누구나)
// - 버튼을 누르면 Firestore에 "업데이트 요청"만 남긴다(토큰·키가 필요 없음).
// - GitHub Actions(market-cafe.yml)가 5분마다 요청을 확인해서 MVP 카페를 검색하고 결과(cafe.json)를 새로 올린다.
// - 결과의 requestsHandledUntil 이 요청 시각을 넘으면 처리된 것. 사이트는 그때까지 1분마다 결과를 다시 읽는다.
// 요청은 시세 기록과 같은 곳(marketPriceHistory)에 cardKey 없는 문서 하나로 둔다(다른 화면은 cardKey 없는 문서를 무시함).
const REQ_REF = () => doc(db, 'marketPriceHistory', '_updateRequests');
const FRESH_URL = 'https://api.github.com/repos/bsw3013/pokemon-card-app/contents/cafe.json?ref=market-data';
const POLL_MS = 60 * 1000;
const GIVE_UP_MS = 45 * 60 * 1000;
const KEEP_MS = 2 * 86400e3;

const state = { pending: [], handledUntil: '', lastDone: null }; // pending: [{ at, cardKey }]
const listeners = new Set();
let timer = null;

function notify() { listeners.forEach((fn) => fn({ ...state })); }
export function subscribeMarketUpdate(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

async function fetchFresh() {
  try {
    const res = await fetch(FRESH_URL, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* 아래 예비 주소로 */ }
  return loadCafeData(true);
}

function applyHandled(handledUntil) {
  state.handledUntil = handledUntil || '';
  state.pending = state.pending.filter((p) => !state.handledUntil || p.at > state.handledUntil);
}

async function poll() {
  clearTimeout(timer);
  if (!state.pending.length) return;
  const before = state.pending.length;
  try {
    const data = await fetchFresh();
    if (data && data.candidates) {
      setCafeData(data);
      applyHandled(data.requestsHandledUntil);
    }
  } catch { /* 다음에 다시 */ }
  const oldest = state.pending.reduce((m, p) => (p.at < m ? p.at : m), '9');
  if (state.pending.length && Date.now() - Date.parse(oldest) > GIVE_UP_MS) state.pending = [];
  if (state.pending.length < before) state.lastDone = new Date().toISOString();
  notify();
  if (state.pending.length) timer = setTimeout(poll, POLL_MS);
}

// 화면을 열 때: 다른 기기·다른 사용자가 남긴, 아직 처리 안 된 요청이 있는지 확인
let checked = false;
export async function checkPendingUpdates() {
  if (checked) return;
  checked = true;
  try {
    const [snap, data] = await Promise.all([getDoc(REQ_REF()), loadCafeData()]);
    const r = (snap.exists() && snap.data().r) || {};
    state.pending = Object.values(r).filter((v) => v && v.at).map((v) => ({ at: v.at, cardKey: v.cardKey || '' }));
    applyHandled(data?.requestsHandledUntil);
    notify();
    if (state.pending.length) timer = setTimeout(poll, 5000);
  } catch { /* 못 읽으면 표시만 생략 */ }
}

// card를 주면 그 카드만, 안 주면 관심 카드 전체 업데이트를 요청한다
export async function requestMarketUpdate({ card, uid }) {
  const at = new Date().toISOString();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const patch = {
    [id]: {
      at,
      uid: uid || '',
      cardKey: card?.cardKey || '',
      cardName: card?.cardName || '',
      queries: (card?.queries || []).slice(0, 5),
    },
  };
  // 이틀 지난 요청은 같이 지워서 문서가 커지지 않게 한다
  try {
    const snap = await getDoc(REQ_REF());
    const old = (snap.exists() && snap.data().r) || {};
    Object.entries(old).forEach(([k, v]) => { if (!v?.at || Date.now() - Date.parse(v.at) > KEEP_MS) patch[k] = deleteField(); });
  } catch { /* 정리는 다음에 */ }
  await setDoc(REQ_REF(), { r: patch }, { merge: true });
  state.pending = [...state.pending, { at, cardKey: card?.cardKey || '' }];
  notify();
  clearTimeout(timer);
  timer = setTimeout(poll, POLL_MS);
  return at;
}

// 이 버튼과 관련된 대기 중인 요청 (전체 요청은 모든 카드에 해당)
export function pendingFor(st, cardKey) {
  return st.pending.filter((p) => !p.cardKey || (cardKey && p.cardKey === cardKey));
}
