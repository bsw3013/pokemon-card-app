import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// MVP 카페 시세 후보
// - 매일 새벽 GitHub Actions(market-cafe.yml)가 모은 결과(cafe.json)를 market-data 브랜치에서 읽는다.
// - 저장/버리기 같은 결정은 Firestore settings/marketCafeDecisions 에 남긴다(관리자만).
// - 관리자의 관심 카드 목록은 settings/marketTargets 에 옮겨 적어서, 수집 작업이 그 카드들을 검색한다.

// GitHub 원본 주소는 새 파일이 몇 분 안에 반영된다(jsDelivr는 예전 파일을 오래 붙잡고 있을 때가 있어서 예비로만 쓴다).
export const CAFE_DATA_URL = 'https://raw.githubusercontent.com/bsw3013/pokemon-card-app/market-data/cafe.json';
const CAFE_DATA_FALLBACK_URL = 'https://cdn.jsdelivr.net/gh/bsw3013/pokemon-card-app@market-data/cafe.json';
export const CAFE_MARKETPLACE = 'MVP';
export const CAFE_IDS = ['cardmvk'];
export const OLD_CANDIDATE_DAYS = 30;
export const OLD_AUCTION_DAYS = 14;

const DAY = 86400e3;

// ── 카페 수집 결과 ──
let dataCache = null;
let dataPending = null;
export async function loadCafeData(force = false) {
  if (dataCache && !force) return dataCache;
  if (!dataPending || force) {
    const get = (url) => fetch(url, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    dataPending = get(CAFE_DATA_URL)
      .catch(() => get(CAFE_DATA_FALLBACK_URL))
      .catch(() => ({ candidates: {}, runs: [] }))
      .then((d) => { dataCache = { candidates: d.candidates || {}, runs: d.runs || [], cardRuns: d.cardRuns || {}, updatedAt: d.updatedAt || null }; return dataCache; })
      .finally(() => { dataPending = null; });
  }
  return dataPending;
}

// "시세 업데이트" 버튼으로 새로 받은 결과를 모든 화면에 바로 알린다
const dataListeners = new Set();
export function setCafeData(d) {
  dataCache = { candidates: d?.candidates || {}, runs: d?.runs || [], cardRuns: d?.cardRuns || {}, updatedAt: d?.updatedAt || null };
  dataListeners.forEach((fn) => fn(dataCache));
}
export function subscribeCafeData(fn) {
  dataListeners.add(fn);
  return () => dataListeners.delete(fn);
}

// 마지막 업데이트 시각: 카드를 주면 그 카드를 마지막으로 검색한 때, 없으면 관심 카드 전체를 검색한 때
export function lastUpdateAt(data, cardKey) {
  if (!data) return null;
  const full = (data.runs || []).find((r) => !r.only && r.targets > 0 && !(r.errors || []).some((e) => /키/.test(e)));
  if (cardKey) {
    const one = data.cardRuns?.[cardKey] || null;
    const f = full?.at || null;
    if (one && f) return one > f ? one : f;
    return one || f;
  }
  return full?.at || null;
}

export function fmtUpdatedAt(iso) {
  if (!iso) return '아직 없음';
  const d = new Date(iso);
  const w = '일월화수목금토'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 관리자의 결정(버리기·되살리기) ──
const DECISIONS_REF = () => doc(db, 'settings', 'marketCafeDecisions');
let decisionsCache = null;
export async function loadCafeDecisions(force = false) {
  if (decisionsCache && !force) return decisionsCache;
  try {
    const snap = await getDoc(DECISIONS_REF());
    decisionsCache = (snap.exists() && snap.data().d) || {};
  } catch {
    decisionsCache = {};
  }
  return decisionsCache;
}
export async function setCafeDecisions(map) {
  // map: { 후보id: 'dismissed' | 'restored' | null }
  const at = new Date().toISOString().slice(0, 10);
  const d = {};
  Object.entries(map).forEach(([id, v]) => { d[id] = v ? `${v}@${at}` : null; });
  await setDoc(DECISIONS_REF(), { d }, { merge: true });
  decisionsCache = { ...(decisionsCache || {}), ...d };
  return decisionsCache;
}
export const decisionOf = (decisions, id) => String(decisions?.[id] || '').split('@')[0] || null;

// ── 후보 고르기 ──
export function ageDays(iso, now = Date.now()) {
  return iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : 0;
}
export function isEnded(iso, now = Date.now()) {
  return !!iso && Date.parse(iso) <= now;
}

// isHandled(c): 이미 매물로 저장(또는 경매 추적)한 글이면 true
export function splitCandidates(all, { decisions, isHandled, now = Date.now() }) {
  const out = { active: [], old: [], hidden: [] };
  Object.values(all || {}).forEach((c) => {
    if (isHandled && isHandled(c)) return;
    const dec = decisionOf(decisions, c.id);
    if (dec === 'dismissed') return;
    if (c.hidden && dec !== 'restored') { out.hidden.push(c); return; }
    // 30일 지난 판매글, 2주 넘게 지난 경매는 "오래된 후보"로 접어 둔다(처음 모을 때 섞여 나오는 옛날 글)
    const old = c.kind === 'auction'
      ? !!c.endsAt && ageDays(c.endsAt, now) > OLD_AUCTION_DAYS
      : ageDays(c.foundAt, now) > OLD_CANDIDATE_DAYS;
    (old ? out.old : out.active).push(c);
  });
  return out;
}

// ── 숫자 입력 ──
// "31.5" → 315000, "31.5만" → 315000, "315,000" → 315000. 1000 미만 숫자는 만원 단위로 본다.
export function parseKrw(text) {
  const s = String(text ?? '').replace(/[,\s원]/g, '');
  if (!s) return null;
  const man = s.endsWith('만');
  const n = parseFloat(man ? s.slice(0, -1) : s);
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(man || n < 1000 ? n * 10000 : n);
}

// 댓글을 통째로 붙여넣으면 줄마다 끝에 있는 입찰 금액 중 가장 큰 값을 고른다.
export function highestBid(text) {
  const nums = String(text || '').split('\n').map((line) => {
    const m = line.normalize('NFKC').match(/(\d+(?:[.,]\d+)*)\s*(만)?\s*원?\s*(?:[!~.]*|←.*)$/);
    return m ? parseKrw(m[1].replace(/,(?=\d{3}\b)/g, '') + (m[2] || '')) : null;
  }).filter((n) => n && n >= 1000);
  return nums.length ? Math.max(...nums) : null;
}

export function fmtWon(p) {
  return typeof p === 'number' ? `${p.toLocaleString('ko-KR')}원` : '-';
}

export function fmtDeadline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const w = '일월화수목금토'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtFound(c, now = Date.now()) {
  const n = ageDays(c.foundAt, now);
  if (c.dateEstimated) return n <= 0 ? '오늘쯤 글' : `약 ${n}일 전 글`;
  return n <= 0 ? '오늘 발견' : `${n}일 전 발견`;
}

// 저장할 수 있을 만큼 값이 다 채워졌는지(한 번에 저장용)
export function isComplete(v) {
  if (!v.language || !v.price) return false;
  if (v.conditionType === 'graded' && (!v.gradingCompany || !v.grade)) return false;
  return true;
}

// ── 수집 대상(관리자의 관심 카드) 옮겨 적기 ──
let lastTargetsSig = null;
export async function syncMarketTargets(watchlist) {
  const byKey = new Map();
  (watchlist || []).forEach((w) => {
    if (!w.cardKey || !w.cardName || byKey.has(w.cardKey)) return;
    const queries = (Array.isArray(w.queries) ? w.queries : [])
      .map((q) => String(q || '').trim()).filter((q) => q && q !== w.cardName);
    byKey.set(w.cardKey, { cardKey: w.cardKey, cardName: w.cardName, queries });
  });
  const targets = [...byKey.values()].sort((a, b) => a.cardKey.localeCompare(b.cardKey));
  const sig = JSON.stringify(targets);
  if (sig === lastTargetsSig) return false;
  const ref = doc(db, 'settings', 'marketTargets');
  if (lastTargetsSig === null) {
    try {
      const snap = await getDoc(ref);
      const cur = snap.exists() ? JSON.stringify([...(snap.data().targets || [])].sort((a, b) => a.cardKey.localeCompare(b.cardKey))) : null;
      if (cur === sig) { lastTargetsSig = sig; return false; }
    } catch { /* 읽기 실패면 그냥 쓴다 */ }
  }
  await setDoc(ref, { targets, cafes: CAFE_IDS, updatedAt: new Date().toISOString() });
  lastTargetsSig = sig;
  return true;
}
