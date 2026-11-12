import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { buildLegacyCardKey, cardIdFromKey, isIdCardKey } from '../utils/cardKey';
import { looksLikeBundle } from '../utils/bundleHint';
import PriceTrendChart from './PriceTrendChart';
import { invalidateMarketIndex } from '../hooks/useMarketIndex';
import { invalidateWatchlist } from '../hooks/useWatchlist';
import { normalizeImageUrl } from '../utils/thumbKey';
import CafeCandidates from './market/CafeCandidates';
import AuctionSection from './market/AuctionSection';
import MarketUpdateButton from './market/MarketUpdateButton';
import {
  CAFE_MARKETPLACE, isEnded, lastUpdateAt, loadCafeData, loadCafeDecisions, setCafeDecisions, splitCandidates, subscribeCafeData,
} from '../utils/cafeMarket';

const SOURCE_LABELS = { bunjang: '번개장터', danggeun: '당근마켓', manual: '직접입력', cafe: 'MVP 카페' };
const TOP_GRADES = ['10', '9'];
const MARKET_SERVER_URL = 'http://localhost:5175';
const LANGUAGE_OPTIONS = ['한국', '일본', '미국', '중국'];
const FALLBACK_GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', '기타'];
const FALLBACK_GRADING_SCALE = ['10', '9.5', '9', '8', '7', '6', '5'];
const FALLBACK_MARKETPLACES = ['당근', '번개장터', 'ebay', 'MVP'];

// 판매처 고르기: 목록은 마스터 설정 > 목록값·표시 항목 > "시세 판매처 관리"에서 바꾼다.
// 예전에 직접 적어 둔 판매처(목록에 없는 값)도 그대로 보이고 저장된다.
function MarketplaceSelect({ options, value, onChange }) {
  const list = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label="판매처">
      <option value="">판매처 선택</option>
      {list.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

// 카페 글을 매물로 저장할 때 쓰는 문서 id (같은 글을 같은 카드에 두 번 저장하지 않게)
function cafeListingId(articleId, cardKey) {
  let h = 5381;
  for (const ch of String(cardKey)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `cafe_${articleId}_${h.toString(36)}`;
}

function fmtPrice(p) {
  return typeof p === 'number' ? `${p.toLocaleString()}원` : '-';
}
function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR');
}
function cardLabel(c) {
  return [c.series, c.cardNumber].filter(Boolean).join(' ');
}

// 카드 한 장의 시세 창 (오른쪽에서 열림).
// 시세 페이지와 카드 상세(어느 화면이든)에서 같이 쓴다.
//  card: { cardKey, cardName, series, cardNumber, imageUrl, price }
//  onChanged: 매물을 기록/수정/삭제하거나 관심카드에 추가했을 때 (바깥 목록 새로고침용)
//  onOpenMarketPage: 있으면 "시세 페이지에서 보기" 버튼을 보여준다
//  overModal: 카드 상세 창 위에 띄울 때 true
export default function MarketDrawer({ card, appConfig, onClose, onChanged, onOpenMarketPage, overModal = false }) {
  const { user, nickname, signInWithGoogle, isAdmin } = useAuth();
  const { cards: myCards } = useOwnedCards();
  const [editingListing, setEditingListing] = useState(null); // {id, price, url, memo, language, conditionType, gradingCompany, grade}
  const [listings, setListings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartRange, setChartRange] = useState('all'); // 'all' | '30' | '7'
  const [langFilter, setLangFilter] = useState('한국'); // '한국' | '일본' | '미국' | '중국'
  const [conditionFilter, setConditionFilter] = useState('raw'); // 'raw' | 'graded'

  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    price: '', date: new Date().toISOString().slice(0, 10), title: '', memo: '', url: '', marketplace: '',
    language: '한국', conditionType: 'raw', gradingCompany: '', grade: '',
  });

  const [importLanguage, setImportLanguage] = useState('한국');
  const [importConditionType, setImportConditionType] = useState('raw');
  const [importGradingCompany, setImportGradingCompany] = useState('');
  const [importGrade, setImportGrade] = useState('');

  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearchQuery, setMarketSearchQuery] = useState(() => card.cardName || '');
  const [marketSearchResults, setMarketSearchResults] = useState([]);
  const [marketSearchLoading, setMarketSearchLoading] = useState(false);
  const [marketSearchError, setMarketSearchError] = useState('');
  const [importingId, setImportingId] = useState(null);

  // MVP 카페 후보 (관리자만)
  const [cafeAll, setCafeAll] = useState({});
  const [cafeRuns, setCafeRuns] = useState([]);
  const [cafeCardRuns, setCafeCardRuns] = useState({});
  const [cafeDecisions, setCafeDecisionsState] = useState({});
  const [cafeOpen, setCafeOpen] = useState(true);
  const [cafeBusy, setCafeBusy] = useState(false);
  const [aliasText, setAliasText] = useState('');
  const [aliasOpen, setAliasOpen] = useState(false);
  const [nicknameByUid, setNicknameByUid] = useState({}); // uid -> 현재 닉네임(실시간). 없으면 null로 캐싱.

  const [watchEntry, setWatchEntry] = useState(null); // 내 관심카드에 있으면 그 문서
  const [watchBusy, setWatchBusy] = useState(false);

  function buildRecordedBy() {
    if (!user) return null;
    return { uid: user.uid, name: nickname || user.displayName || user.email || '알 수 없음' };
  }

  const gradingCompanies = appConfig?.gradingCompaniesOptions?.length ? appConfig.gradingCompaniesOptions : FALLBACK_GRADING_COMPANIES;
  const gradingScale = appConfig?.gradingScaleOptions?.length ? appConfig.gradingScaleOptions : FALLBACK_GRADING_SCALE;
  const marketplaces = appConfig?.marketplaceOptions?.length ? appConfig.marketplaceOptions : FALLBACK_MARKETPLACES;

  // 열릴 때 이 카드의 시세 데이터를 읽는다. (다른 카드를 열 때는 바깥에서 key를 바꿔 창을 새로 만든다)
  useEffect(() => {
    loadCardData(card.cardKey);
    loadWatchEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.cardKey]);

  // Esc 키로 닫기 (수정 창이 열려 있으면 수정 창만 닫는다). 뒤에 있는 카드 상세 창은 그대로 둔다.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (editingListing) setEditingListing(null); else onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingListing, onClose]);

  // "시세 업데이트"로 새 결과를 받으면 바로 반영
  useEffect(() => subscribeCafeData((d) => {
    setCafeAll(d.candidates);
    setCafeRuns(d.runs);
    setCafeCardRuns(d.cardRuns || {});
  }), []);

  async function loadWatchEntry() {
    if (!user) { setWatchEntry(null); return; }
    try {
      const snap = await getDocs(query(collection(db, 'marketWatchlist'), where('ownerId', '==', user.uid)));
      const found = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((w) => w.cardKey === card.cardKey) || null;
      setWatchEntry(found);
      if (found?.query) setMarketSearchQuery(found.query);
    } catch (err) {
      console.error('관심카드 확인 실패', err);
    }
  }

  async function handleAddWatch() {
    if (!user) { signInWithGoogle(); return; }
    setWatchBusy(true);
    try {
      await addDoc(collection(db, 'marketWatchlist'), {
        cardKey: card.cardKey,
        cardName: card.cardName,
        series: card.series || '',
        cardNumber: card.cardNumber || '',
        imageUrl: card.imageUrl || '',
        query: card.cardName,
        ownerId: user.uid,
        addedAt: new Date().toISOString(),
      });
      await loadWatchEntry();
      invalidateWatchlist();
      onChanged?.();
    } catch (err) {
      console.error('관심카드 추가 실패', err);
      alert('관심 카드 추가에 실패했어요.');
    } finally {
      setWatchBusy(false);
    }
  }

  async function loadCardData(cardKey) {
    setLoading(true);
    try {
      // 관리자가 "카드 정보 정리하기"를 실행하기 전에 쌓인 기록은 예전 방식 키로 저장돼 있으므로 같이 읽는다.
      const card = isIdCardKey(cardKey) ? myCards.find((c) => c.id === cardIdFromKey(cardKey)) : null;
      const legacyKey = card ? buildLegacyCardKey(card) : '';
      const keys = legacyKey && legacyKey !== cardKey ? [cardKey, legacyKey] : [cardKey];
      const readAll = async (colName) => {
        const snaps = await Promise.all(keys.map((k) => getDocs(query(collection(db, colName), where('cardKey', '==', k)))));
        const byId = new Map();
        snaps.forEach((snap) => snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() })));
        return [...byId.values()];
      };
      const [listingDocs, historyDocs] = await Promise.all([readAll('marketListings'), readAll('marketPriceHistory')]);
      setListings(listingDocs);
      setHistory(historyDocs);
      if (isAdmin) {
        const [cafe, decisions] = await Promise.all([loadCafeData(), loadCafeDecisions()]);
        setCafeAll(cafe.candidates);
        setCafeRuns(cafe.runs);
        setCafeCardRuns(cafe.cardRuns || {});
        setCafeDecisionsState(decisions);
        markCafeSold(listingDocs, cafe.candidates);
      }
    } catch (err) {
      console.error('시세 데이터 로드 실패', err);
      setListings([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  // 매물에 찍힌 "등록자" 이름은 기록 당시 닉네임 스냅샷이라, 이후에 닉네임을 바꿔도 안 바뀐다.
  // 그래서 listings가 바뀔 때마다 recordedBy.uid들의 "현재" 닉네임을 userProfiles에서 따로 조회해 캐싱해두고,
  // 화면에는 이 실시간 닉네임을 우선 보여준다(소급 적용).
  useEffect(() => {
    const uids = Array.from(new Set(
      listings.map((l) => l.recordedBy?.uid).filter(Boolean)
    )).filter((uid) => !(uid in nicknameByUid));
    if (uids.length === 0) return;
    let cancelled = false;
    (async () => {
      const found = {};
      for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        try {
          const snap = await getDocs(query(collection(db, 'userProfiles'), where(documentId(), 'in', chunk)));
          snap.forEach((d) => { found[d.id] = d.data().nickname || null; });
        } catch (err) {
          console.error('닉네임 조회 실패', err);
        }
      }
      if (cancelled) return;
      setNicknameByUid((prev) => {
        const next = { ...prev };
        uids.forEach((uid) => { next[uid] = uid in found ? found[uid] : null; });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);

  // 매물에 변화가 생겼을 때(직접기록/가져오기/상태변경/수정/삭제) 이 카드 데이터와 바깥 목록을 같이 새로 읽는다.
  function refresh() {
    loadCardData(card.cardKey);
    invalidateMarketIndex();
    onChanged?.();
  }

  // 언어/컨디션(싱글 vs 등급)/기간 필터를 먼저 적용한 뒤, 그 결과로 통계/차트를 계산한다.
  function matchesLangAndCondition(entry) {
    return (entry.language || '한국') === langFilter && (entry.conditionType || 'raw') === conditionFilter;
  }

  function withinChartRange(iso) {
    if (chartRange === 'all') return true;
    if (!iso) return false;
    const days = chartRange === '30' ? 30 : 7;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return new Date(iso).getTime() >= cutoff;
  }

  // 판매중 매물은 마지막으로 확인된 시점(lastSeen), 판매완료 매물은 처음 등록한 날짜(firstSeen) 기준으로 기간을 따진다.
  function listingDateForRange(l) {
    return l.status === 'sold_estimated' ? l.firstSeen : (l.lastSeen || l.firstSeen);
  }

  const filteredListings = useMemo(
    () => listings.filter((l) => matchesLangAndCondition(l) && withinChartRange(listingDateForRange(l))),
    [listings, langFilter, conditionFilter, chartRange]
  );
  const filteredHistory = useMemo(
    () => history.filter((h) => matchesLangAndCondition(h) && withinChartRange(h.recordedAt)),
    [history, langFilter, conditionFilter, chartRange]
  );

  const activeNormal = useMemo(
    () => filteredListings.filter((l) => l.classification === 'normal' && (l.status === 'active' || l.status === 'unconfirmed' || l.status === 'manual'))
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
    [filteredListings]
  );
  const soldEstimated = useMemo(
    () => filteredListings.filter((l) => l.classification === 'normal' && l.status === 'sold_estimated')
      .sort((a, b) => new Date(b.removedAt || 0) - new Date(a.removedAt || 0)),
    [filteredListings]
  );

  // {count, min(매물), max(매물), avg} 형태의 통계. 가격 있는 매물이 하나도 없으면 null.
  function computeStats(list) {
    const priced = list.filter((l) => typeof l.price === 'number');
    if (priced.length === 0) return null;
    const sorted = [...priced].sort((a, b) => a.price - b.price);
    const avg = Math.round(sorted.reduce((s, l) => s + l.price, 0) / sorted.length);
    return { count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], avg };
  }

  // 등급카드는 등급사+등급(10/9만)별로 묶어서 각각 따로 통계를 낸다.
  function groupGradedStats(list) {
    const groups = new Map();
    list.forEach((l) => {
      const grade = String(l.grade || '');
      if (!TOP_GRADES.includes(grade)) return;
      const company = l.gradingCompany || '기타';
      const key = `${company}__${grade}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    });
    return Array.from(groups.entries())
      .map(([key, items]) => {
        const [company, grade] = key.split('__');
        return { company, grade, stats: computeStats(items) };
      })
      .filter((g) => g.stats)
      .sort((a, b) => (a.company !== b.company ? a.company.localeCompare(b.company) : Number(b.grade) - Number(a.grade)));
  }

  const rawActiveStats = useMemo(() => (conditionFilter === 'raw' ? computeStats(activeNormal) : null), [conditionFilter, activeNormal]);
  const rawSoldStats = useMemo(() => (conditionFilter === 'raw' ? computeStats(soldEstimated) : null), [conditionFilter, soldEstimated]);
  const gradedActiveGroups = useMemo(() => (conditionFilter === 'graded' ? groupGradedStats(activeNormal) : []), [conditionFilter, activeNormal]);
  const gradedSoldGroups = useMemo(() => (conditionFilter === 'graded' ? groupGradedStats(soldEstimated) : []), [conditionFilter, soldEstimated]);

  // 필터와 무관하게, 이 카드에 언어/컨디션별로 매물이 몇 건씩 등록되어 있는지(판매중+판매완료 합계) 한눈에 보여주는 표용 집계.
  const langConditionCounts = useMemo(() => {
    const counts = {};
    listings.forEach((l) => {
      if (l.classification !== 'normal') return;
      if (!['active', 'unconfirmed', 'manual', 'sold_estimated'].includes(l.status)) return;
      const lang = l.language || '한국';
      const cond = l.conditionType === 'graded' ? 'graded' : 'raw';
      if (!counts[lang]) counts[lang] = { raw: 0, graded: 0 };
      counts[lang][cond] += 1;
    });
    return counts;
  }, [listings]);

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!user) { signInWithGoogle(); return; }
    const price = parseInt(manualForm.price, 10);
    if (!card || Number.isNaN(price)) return;
    const recordedAt = new Date(manualForm.date).toISOString();
    const externalId = `manual_${Date.now()}`;
    const recordedBy = buildRecordedBy();
    const language = manualForm.language || '한국';
    const conditionType = manualForm.conditionType || 'raw';
    const gradingCompany = conditionType === 'graded' ? (manualForm.gradingCompany || '') : '';
    const grade = conditionType === 'graded' ? (manualForm.grade || '') : '';
    const marketplace = manualForm.marketplace.trim() || null;

    await addDoc(collection(db, 'marketListings'), {
      cardKey: card.cardKey,
      cardName: card.cardName,
      series: card.series || '',
      cardNumber: card.cardNumber || '',
      source: 'manual',
      marketplace,
      externalId,
      title: manualForm.title.trim() || manualForm.memo.trim() || '직접 입력한 시세',
      price,
      url: manualForm.url.trim() || null,
      imageUrl: null,
      region: null,
      classification: 'normal',
      classificationOverride: true,
      status: 'manual',
      missedCount: 0,
      firstSeen: recordedAt,
      lastSeen: recordedAt,
      removedAt: null,
      memo: manualForm.memo || '',
      recordedBy,
      language,
      conditionType,
      gradingCompany,
      grade,
    });
    await addDoc(collection(db, 'marketPriceHistory'), {
      cardKey: card.cardKey,
      source: 'manual',
      marketplace,
      externalId,
      price,
      recordedAt,
      recordedBy,
      language,
      conditionType,
      gradingCompany,
      grade,
    });

    setManualForm({
      price: '', date: new Date().toISOString().slice(0, 10), title: '', memo: '', url: '', marketplace: '',
      language: '한국', conditionType: 'raw', gradingCompany: '', grade: '',
    });
    setManualFormOpen(false);
    refresh();
  }

  async function handleMarketSearch(e) {
    if (e) e.preventDefault();
    const q = marketSearchQuery.trim();
    if (!q) return;
    setMarketSearchLoading(true);
    setMarketSearchError('');
    setMarketSearchResults([]);
    try {
      const resp = await fetch(`${MARKET_SERVER_URL}/search?query=${encodeURIComponent(q)}`);
      if (!resp.ok) throw new Error(`서버 응답 오류 (${resp.status})`);
      const data = await resp.json();
      setMarketSearchResults(data.results || []);
      if (data.errors?.length) setMarketSearchError(data.errors.join(' / '));
    } catch (err) {
      setMarketSearchError(
        '로컬 검색 서버에 연결할 수 없습니다. 터미널에서 `npm run market-server`를 실행한 뒤 다시 시도해주세요. (' + err.message + ')'
      );
    } finally {
      setMarketSearchLoading(false);
    }
  }

  async function handleImportListing(result) {
    if (!card) return;
    if (!user) { signInWithGoogle(); return; }
    const importKey = `${result.source}_${result.externalId}`;
    setImportingId(importKey);
    try {
      const now = new Date().toISOString();
      const existing = listings.find((l) => l.id === importKey);
      const recordedBy = buildRecordedBy();
      const gradingCompany = importConditionType === 'graded' ? importGradingCompany : '';
      const grade = importConditionType === 'graded' ? importGrade : '';
      const marketplace = existing?.marketplace || SOURCE_LABELS[result.source] || result.source;
      await setDoc(doc(db, 'marketListings', importKey), {
        cardKey: card.cardKey,
        cardName: card.cardName,
        series: card.series || '',
        cardNumber: card.cardNumber || '',
        source: result.source,
        marketplace,
        externalId: result.externalId,
        title: result.title,
        price: result.price,
        url: result.url,
        imageUrl: result.imageUrl,
        region: result.region,
        classification: existing?.classification || 'normal',
        classificationOverride: true,
        status: existing?.status || 'active',
        missedCount: 0,
        firstSeen: existing?.firstSeen || now,
        lastSeen: now,
        removedAt: existing?.removedAt || null,
        recordedBy,
        language: importLanguage,
        conditionType: importConditionType,
        gradingCompany,
        grade,
      });
      await addDoc(collection(db, 'marketPriceHistory'), {
        cardKey: card.cardKey,
        source: result.source,
        marketplace,
        externalId: result.externalId,
        price: result.price,
        recordedAt: now,
        language: importLanguage,
        conditionType: importConditionType,
        gradingCompany,
        grade,
        recordedBy,
      });
      await refresh();
    } finally {
      setImportingId(null);
    }
  }

  // ── MVP 카페 후보 ──
  const cardKeys = useMemo(() => {
    const ks = new Set([card.cardKey]);
    if (watchEntry?.cardKey) ks.add(watchEntry.cardKey);
    if (watchEntry?.legacyCardKey) ks.add(watchEntry.legacyCardKey);
    return ks;
  }, [card.cardKey, watchEntry]);
  const cafeGroups = useMemo(() => {
    const handled = new Set(listings.filter((l) => l.source === 'cafe').map((l) => String(l.externalId)));
    const mine = Object.fromEntries(Object.entries(cafeAll).filter(([, c]) => cardKeys.has(c.cardKey)));
    return splitCandidates(mine, { decisions: cafeDecisions, isHandled: (c) => handled.has(String(c.articleId)) });
  }, [cafeAll, cafeDecisions, listings, cardKeys]);
  const auctions = useMemo(() => listings.filter((l) => l.status === 'auction'), [listings]);
  const auctionsEnded = auctions.filter((l) => isEnded(l.auctionEndsAt)).length
    + cafeGroups.active.filter((c) => c.kind === 'auction' && isEnded(c.endsAt)).length;
  const newCafeCount = cafeGroups.active.filter((c) => !(c.kind === 'auction' && isEnded(c.endsAt))).length;

  // 판매자가 제목에 "판매완료"를 붙인 글은, 이미 판매중으로 저장해 둔 매물을 판매완료로 바꾼다
  async function markCafeSold(listingDocs, all) {
    if (!user) return;
    const soldByArticle = new Map();
    Object.values(all || {}).forEach((c) => { if (c.soldMark) soldByArticle.set(String(c.articleId), c.soldSeenAt || c.lastSeen); });
    const targets = listingDocs.filter((l) => l.source === 'cafe' && l.status === 'active' && soldByArticle.has(String(l.externalId)));
    if (!targets.length) return;
    await Promise.all(targets.map((l) => updateDoc(doc(db, 'marketListings', l.id), {
      status: 'sold_estimated', missedCount: 2, removedAt: soldByArticle.get(String(l.externalId)) || new Date().toISOString(),
    })));
    loadCardData(card.cardKey);
    invalidateMarketIndex();
  }

  function cafeBase(c, v) {
    return {
      cardKey: card.cardKey, cardName: card.cardName, series: card.series || '', cardNumber: card.cardNumber || '',
      source: 'cafe', marketplace: CAFE_MARKETPLACE, externalId: String(c.articleId), cafeCandidateId: c.id,
      title: c.title, url: c.url || null, imageUrl: null, region: null,
      classification: 'normal', classificationOverride: true, missedCount: 0, recordedBy: buildRecordedBy(),
      language: v.language || '한국', conditionType: v.conditionType || 'raw',
      gradingCompany: v.conditionType === 'graded' ? (v.gradingCompany || '') : '',
      grade: v.conditionType === 'graded' ? (v.grade || '') : '',
    };
  }
  function historyOf(base, price, recordedAt, saleType) {
    return {
      cardKey: base.cardKey, source: 'cafe', marketplace: CAFE_MARKETPLACE, externalId: base.externalId, price, recordedAt, saleType,
      language: base.language, conditionType: base.conditionType, gradingCompany: base.gradingCompany, grade: base.grade, recordedBy: base.recordedBy,
    };
  }
  async function withCafeBusy(fn) {
    if (!user) { signInWithGoogle(); return; }
    setCafeBusy(true);
    try { await fn(); refresh(); } catch (err) { console.error('카페 후보 처리 실패', err); alert('저장에 실패했어요. 잠시 뒤 다시 해 주세요.'); } finally { setCafeBusy(false); }
  }
  // 판매글 저장(한 건 또는 여러 건)
  function handleCafeSave(items) {
    return withCafeBusy(async () => {
      const batch = writeBatch(db);
      items.forEach(({ c, v }) => {
        const base = cafeBase(c, v);
        const at = c.foundAt || new Date().toISOString();
        const soldAt = c.soldSeenAt || at;
        batch.set(doc(db, 'marketListings', cafeListingId(c.articleId, card.cardKey)), {
          ...base, price: v.price, saleType: 'sale', status: v.sold ? 'sold_estimated' : 'active',
          firstSeen: at, lastSeen: c.lastSeen || at, removedAt: v.sold ? soldAt : null,
        });
        batch.set(doc(collection(db, 'marketPriceHistory')), historyOf(base, v.price, at, 'sale'));
      });
      await batch.commit();
    });
  }
  function handleCafeTrack(c, v) {
    return withCafeBusy(async () => {
      const at = c.foundAt || new Date().toISOString();
      await setDoc(doc(db, 'marketListings', cafeListingId(c.articleId, card.cardKey)), {
        ...cafeBase(c, v), price: null, startPrice: c.startPrice ?? null, saleType: 'auction', status: 'auction',
        auctionEndsAt: c.endsAt, firstSeen: at, lastSeen: c.lastSeen || at, removedAt: null,
      });
    });
  }
  // 이미 마감된 경매 후보에 바로 낙찰가를 넣을 때
  function handleCafeAuctionDirect(c, v, won) {
    return withCafeBusy(async () => {
      const base = cafeBase(c, v);
      await setDoc(doc(db, 'marketListings', cafeListingId(c.articleId, card.cardKey)), {
        ...base, price: won, startPrice: c.startPrice ?? null, saleType: 'auction', status: 'sold_estimated',
        auctionEndsAt: c.endsAt, firstSeen: c.endsAt, lastSeen: c.endsAt, removedAt: c.endsAt,
      });
      await addDoc(collection(db, 'marketPriceHistory'), historyOf(base, won, c.endsAt, 'auction'));
    });
  }
  function handleCafeDismiss(ids) {
    return withCafeBusy(async () => {
      setCafeDecisionsState(await setCafeDecisions(Object.fromEntries(ids.map((id) => [id, 'dismissed']))));
    });
  }
  function handleCafeRestore(c) {
    return withCafeBusy(async () => {
      setCafeDecisionsState(await setCafeDecisions({ [c.id]: 'restored' }));
    });
  }
  function handleAuctionResult(l, won) {
    return withCafeBusy(async () => {
      await updateDoc(doc(db, 'marketListings', l.id), { price: won, status: 'sold_estimated', firstSeen: l.auctionEndsAt, lastSeen: l.auctionEndsAt, removedAt: l.auctionEndsAt });
      await addDoc(collection(db, 'marketPriceHistory'), historyOf(l, won, l.auctionEndsAt, 'auction'));
    });
  }
  // 유찰: 시세에서 빼고, 같은 글이 다시 후보로 뜨지 않게 버린 것으로 남긴다
  function handleAuctionUnsold(l) {
    return withCafeBusy(async () => {
      await deleteDoc(doc(db, 'marketListings', l.id));
      if (l.cafeCandidateId) setCafeDecisionsState(await setCafeDecisions({ [l.cafeCandidateId]: 'dismissed' }));
    });
  }
  // 카페 검색어(별명) 저장 → 다음 새벽 수집부터 같이 찾는다
  async function handleSaveAliases() {
    if (!watchEntry) return;
    const queries = [...new Set(aliasText.split(/[,\n]/).map((q) => q.trim()).filter((q) => q.length >= 2 && q !== watchEntry.cardName))].slice(0, 5);
    await updateDoc(doc(db, 'marketWatchlist', watchEntry.id), { queries });
    setWatchEntry({ ...watchEntry, queries });
    setAliasOpen(false);
    invalidateWatchlist();
  }
  const saleTypeCount = (list) => {
    const a = list.filter((l) => l.saleType === 'auction').length;
    return a ? ` · 판매 ${list.length - a} · 경매 ${a}` : '';
  };
  const lastRun = cafeRuns[0] || null;

  function openEditListing(listing) {
    if (!user) { signInWithGoogle(); return; }
    setEditingListing({
      id: listing.id,
      price: listing.price ?? '',
      date: listing.firstSeen ? listing.firstSeen.slice(0, 10) : new Date().toISOString().slice(0, 10),
      url: listing.url || '',
      title: listing.title || '',
      memo: listing.memo || '',
      marketplace: listing.marketplace || SOURCE_LABELS[listing.source] || '',
      language: listing.language || '한국',
      conditionType: listing.conditionType || 'raw',
      gradingCompany: listing.gradingCompany || '',
      grade: listing.grade || '',
    });
  }

  async function handleUpdateListing(e) {
    e.preventDefault();
    if (!editingListing) return;
    if (!user) { signInWithGoogle(); return; }
    const price = parseInt(editingListing.price, 10);
    if (Number.isNaN(price)) return;
    const gradingCompany = editingListing.conditionType === 'graded' ? editingListing.gradingCompany : '';
    const grade = editingListing.conditionType === 'graded' ? editingListing.grade : '';
    await updateDoc(doc(db, 'marketListings', editingListing.id), {
      price,
      firstSeen: new Date(editingListing.date).toISOString(),
      url: editingListing.url.trim() || null,
      title: editingListing.title.trim() || '(제목 없음)',
      memo: editingListing.memo,
      marketplace: editingListing.marketplace.trim() || null,
      language: editingListing.language,
      conditionType: editingListing.conditionType,
      gradingCompany,
      grade,
    });
    setEditingListing(null);
    refresh();
  }

  async function handleStatusToggle(listing) {
    const nextStatus = listing.status === 'sold_estimated' ? 'active' : 'sold_estimated';
    await updateDoc(doc(db, 'marketListings', listing.id), {
      status: nextStatus,
      missedCount: nextStatus === 'sold_estimated' ? 2 : 0,
      removedAt: nextStatus === 'sold_estimated' ? new Date().toISOString() : null,
    });
    refresh();
  }

  async function handleDeleteListing(listing) {
    if (!window.confirm(`이 시세 기록을 삭제할까요?\n${listing.title || ''} · ${fmtPrice(listing.price)}`)) return;
    await deleteDoc(doc(db, 'marketListings', listing.id));
    const historySnap = await getDocs(query(
      collection(db, 'marketPriceHistory'),
      where('cardKey', '==', listing.cardKey),
      where('source', '==', listing.source),
      where('externalId', '==', listing.externalId),
    ));
    await Promise.all(historySnap.docs.map((d) => deleteDoc(d.ref)));
    refresh();
  }

  return (
    <>
        <div className={`market-drawer-backdrop fade-in ${overModal ? 'over-modal' : ''}`} onClick={onClose}>
          <div className="market-drawer-panel slide-in-right" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${card.cardName} 시세`}>
            <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">✕</button>

            <div className="market-detail-header">
            <img
              className="market-preview-image"
              src={normalizeImageUrl(card.imageUrl) || '/placeholder.png'}
              alt={card.cardName}
            />
            <div className="market-preview-info">
              <h3 className="market-selected-title">{card.cardName}</h3>
              <p className="market-hint">{cardLabel(card) || ' '}</p>
              <div className="market-drawer-actions">
                {watchEntry ? (
                  <span className="market-watch-on">관심 카드에 있어요</span>
                ) : (
                  <button type="button" className="btn btn-secondary btn-compact" onClick={handleAddWatch} disabled={watchBusy}>
                    {watchBusy ? '추가 중...' : '+ 관심 카드에 추가'}
                  </button>
                )}
                {onOpenMarketPage && (
                  <button type="button" className="btn btn-secondary btn-compact" onClick={onOpenMarketPage}>시세 페이지에서 보기 →</button>
                )}
              </div>
              {isAdmin && (
                <MarketUpdateButton
                  compact
                  card={{ cardKey: watchEntry?.cardKey || card.cardKey, cardName: watchEntry?.cardName || card.cardName, queries: watchEntry?.queries || [] }}
                  lastAt={lastUpdateAt({ runs: cafeRuns, cardRuns: cafeCardRuns }, watchEntry?.cardKey || card.cardKey)}
                  countFor={(d) => Object.values((d || { candidates: cafeAll }).candidates || {}).filter((c) => cardKeys.has(c.cardKey)).length}
                  onDone={() => setCafeOpen(true)}
                />
              )}
              {isAdmin && watchEntry && (
                <div className="cafe-alias">
                  <span className="market-hint">카페 검색어: <b>{[watchEntry.cardName, ...(watchEntry.queries || [])].join(', ')}</b></span>
                  {!aliasOpen ? (
                    <button type="button" className="link-btn" onClick={() => { setAliasText((watchEntry.queries || []).join(', ')); setAliasOpen(true); }}>별명 추가·수정</button>
                  ) : (
                    <span className="cafe-alias-edit">
                      <input value={aliasText} onChange={(e) => setAliasText(e.target.value)} placeholder="예: 흑자몽, 110/063 (쉼표로 여러 개)" />
                      <button type="button" className="btn btn-primary btn-compact" onClick={handleSaveAliases}>저장</button>
                      <button type="button" className="btn btn-compact" onClick={() => setAliasOpen(false)}>취소</button>
                    </span>
                  )}
                </div>
              )}
              {loading && <span className="market-hint">불러오는 중...</span>}
              {!loading && conditionFilter === 'raw' && rawActiveStats && (
                <span className="market-preview-range">
                  {fmtPrice(rawActiveStats.min.price)} ~ {fmtPrice(rawActiveStats.max.price)} · 판매중 매물 {rawActiveStats.count}건
                </span>
              )}
              {!loading && conditionFilter === 'raw' && !rawActiveStats && <span className="market-hint">아직 판매중인 정상 매물이 없습니다.</span>}
              {!loading && conditionFilter === 'graded' && gradedActiveGroups.length > 0 && (
                <span className="market-preview-range">
                  10/9등급 판매중 매물 {gradedActiveGroups.reduce((s, g) => s + g.stats.count, 0)}건
                </span>
              )}
              {!loading && conditionFilter === 'graded' && gradedActiveGroups.length === 0 && <span className="market-hint">아직 10등급/9등급 판매중 매물이 없습니다.</span>}
              {!loading && isAdmin && (newCafeCount > 0 || auctionsEnded > 0) && (
                <button type="button" className="market-cafe-alert" onClick={() => { setCafeOpen(true); setTimeout(() => document.getElementById(newCafeCount ? 'cafe-candidates' : 'cafe-auctions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>
                  {newCafeCount > 0 && <span>MVP 카페 새 후보 <b>{newCafeCount}</b>건</span>}
                  {auctionsEnded > 0 && <span className="auction">낙찰가 입력 <b>{auctionsEnded}</b>건</span>}
                  <span className="arrow">확인하기 →</span>
                </button>
              )}
            </div>
            {!loading && (
              <LangConditionTable
                counts={langConditionCounts}
                className="market-header-lang-table"
                onSelect={(lang, cond) => { setLangFilter(lang); setConditionFilter(cond); }}
              />
            )}
            </div>

              <p className="market-hint" style={{ marginBottom: '0.3rem' }}>아래 매물 중 뭘 보여줄지 고르는 필터예요. 통계와 그래프에 모두 적용돼요. (기록할 때는 따로 선택해요)</p>
              <div className="market-filter-bar">
                <div className="market-filter-group">
                  <span className="market-filter-label">언어</span>
                  <div className="view-toggle">
                    {LANGUAGE_OPTIONS.map((l) => (
                      <button type="button" key={l} className={`btn-toggle ${langFilter === l ? 'active' : ''}`} onClick={() => setLangFilter(l)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="market-filter-group">
                  <span className="market-filter-label">컨디션</span>
                  <div className="view-toggle">
                    <button type="button" className={`btn-toggle ${conditionFilter === 'raw' ? 'active' : ''}`} onClick={() => setConditionFilter('raw')}>싱글</button>
                    <button type="button" className={`btn-toggle ${conditionFilter === 'graded' ? 'active' : ''}`} onClick={() => setConditionFilter('graded')}>등급카드</button>
                  </div>
                </div>
                <div className="market-filter-group">
                  <span className="market-filter-label">기간</span>
                  <div className="view-toggle">
                    <button type="button" className={`btn-toggle ${chartRange === '7' ? 'active' : ''}`} onClick={() => setChartRange('7')}>최근 7일</button>
                    <button type="button" className={`btn-toggle ${chartRange === '30' ? 'active' : ''}`} onClick={() => setChartRange('30')}>최근 30일</button>
                    <button type="button" className={`btn-toggle ${chartRange === 'all' ? 'active' : ''}`} onClick={() => setChartRange('all')}>전체</button>
                  </div>
                </div>
              </div>

              {conditionFilter === 'raw' ? (
                <div className="market-summary-groups">
                  <div className="market-summary-group">
                    <h5>판매중 기준</h5>
                    {rawActiveStats ? (
                      <div className="market-summary-cards">
                        <div className="market-summary-card"><span className="label">매물건수</span><span className="value">{rawActiveStats.count}건</span></div>
                        <div className="market-summary-card"><span className="label">최저가</span><span className="value">{fmtPrice(rawActiveStats.min.price)}</span></div>
                        <div className="market-summary-card"><span className="label">평균가</span><span className="value">{fmtPrice(rawActiveStats.avg)}</span></div>
                        <div className="market-summary-card"><span className="label">최고가</span><span className="value">{fmtPrice(rawActiveStats.max.price)}</span></div>
                      </div>
                    ) : <p className="market-hint">판매중인 매물이 없습니다.</p>}
                  </div>
                  <div className="market-summary-group">
                    <h5>판매완료 기준<small className="sale-type-split">{saleTypeCount(soldEstimated)}</small></h5>
                    {rawSoldStats ? (
                      <div className="market-summary-cards">
                        <div className="market-summary-card"><span className="label">매물건수</span><span className="value">{rawSoldStats.count}건</span></div>
                        <div className="market-summary-card"><span className="label">최저가</span><span className="value">{fmtPrice(rawSoldStats.min.price)}</span></div>
                        <div className="market-summary-card"><span className="label">평균가</span><span className="value">{fmtPrice(rawSoldStats.avg)}</span></div>
                        <div className="market-summary-card"><span className="label">최고가</span><span className="value">{fmtPrice(rawSoldStats.max.price)}</span></div>
                      </div>
                    ) : <p className="market-hint">판매완료로 표시된 매물이 없습니다.</p>}
                  </div>
                </div>
              ) : (
                <div className="market-summary-groups">
                  <div className="market-summary-group">
                    <h5>판매중 기준 (10등급/9등급)</h5>
                    {gradedActiveGroups.length > 0 ? (
                      <div className="market-grade-stat-table-wrap">
                      <table className="market-grade-stat-table">
                        <thead>
                          <tr><th>등급</th><th>매물건수</th><th>최저가</th><th>평균가</th><th>최고가</th></tr>
                        </thead>
                        <tbody>
                          {gradedActiveGroups.map((g) => (
                            <tr key={`${g.company}-${g.grade}-active`}>
                              <td className="market-grade-label">{g.company} {g.grade}</td>
                              <td>{g.stats.count}건</td>
                              <td>{fmtPrice(g.stats.min.price)}</td>
                              <td>{fmtPrice(g.stats.avg)}</td>
                              <td>{fmtPrice(g.stats.max.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    ) : <p className="market-hint">10등급/9등급 판매중 매물이 없습니다.</p>}
                  </div>
                  <div className="market-summary-group">
                    <h5>판매완료 기준 (10등급/9등급)<small className="sale-type-split">{saleTypeCount(soldEstimated)}</small></h5>
                    {gradedSoldGroups.length > 0 ? (
                      <div className="market-grade-stat-table-wrap">
                      <table className="market-grade-stat-table">
                        <thead>
                          <tr><th>등급</th><th>매물건수</th><th>최저가</th><th>평균가</th><th>최고가</th></tr>
                        </thead>
                        <tbody>
                          {gradedSoldGroups.map((g) => (
                            <tr key={`${g.company}-${g.grade}-sold`}>
                              <td className="market-grade-label">{g.company} {g.grade}</td>
                              <td>{g.stats.count}건</td>
                              <td>{fmtPrice(g.stats.min.price)}</td>
                              <td>{fmtPrice(g.stats.avg)}</td>
                              <td>{fmtPrice(g.stats.max.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    ) : <p className="market-hint">10등급/9등급 판매완료 매물이 없습니다.</p>}
                  </div>
                </div>
              )}

              <PriceTrendChart history={filteredHistory} />

              <div className="market-add-row">
                {isAdmin && (
                  <button type="button" className={`btn ${cafeOpen ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setCafeOpen((o) => !o)}>
                    MVP 카페 후보{cafeGroups.active.length > 0 && <span className="cafe-count">{cafeGroups.active.length}</span>}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (!marketSearchOpen) {
                      setImportLanguage(langFilter);
                      setImportConditionType(conditionFilter);
                    }
                    setMarketSearchOpen((o) => !o);
                  }}
                >
                  마켓에서 검색
                </button>
                {!manualFormOpen ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setManualForm((f) => ({
                        ...f,
                        language: langFilter,
                        conditionType: conditionFilter,
                      }));
                      setManualFormOpen(true);
                    }}
                  >
                    + 시세 직접 기록
                  </button>
                ) : (
                  <form className="market-manual-form" onSubmit={handleManualSubmit}>
                    <input type="number" placeholder="가격(원)" value={manualForm.price} onChange={(e) => setManualForm((f) => ({ ...f, price: e.target.value }))} required />
                    <input type="date" value={manualForm.date} onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))} required />
                    <select value={manualForm.language} onChange={(e) => setManualForm((f) => ({ ...f, language: e.target.value }))} title="언어/국가판">
                      {LANGUAGE_OPTIONS.map((l) => <option key={l} value={l}>{l}판</option>)}
                    </select>
                    <select value={manualForm.conditionType} onChange={(e) => setManualForm((f) => ({ ...f, conditionType: e.target.value }))} title="싱글/등급">
                      <option value="raw">싱글(미등급)</option>
                      <option value="graded">등급카드</option>
                    </select>
                    {manualForm.conditionType === 'graded' && (
                      <>
                        <select value={manualForm.gradingCompany} onChange={(e) => setManualForm((f) => ({ ...f, gradingCompany: e.target.value }))} required>
                          <option value="">등급사</option>
                          {gradingCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={manualForm.grade} onChange={(e) => setManualForm((f) => ({ ...f, grade: e.target.value }))} required>
                          <option value="">등급</option>
                          {gradingScale.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </>
                    )}
                    <MarketplaceSelect options={marketplaces} value={manualForm.marketplace} onChange={(v) => setManualForm((f) => ({ ...f, marketplace: v }))} />
                    <input type="text" placeholder="제목 (매물 목록에 표시돼요, 비우면 메모로 채워짐)" value={manualForm.title} onChange={(e) => setManualForm((f) => ({ ...f, title: e.target.value }))} />
                    <input type="text" placeholder="메모 (목록엔 안 보여요)" value={manualForm.memo} onChange={(e) => setManualForm((f) => ({ ...f, memo: e.target.value }))} />
                    <input type="url" placeholder="원본 링크 (선택, 예: 트윗/카페글 주소)" value={manualForm.url} onChange={(e) => setManualForm((f) => ({ ...f, url: e.target.value }))} />
                    <button type="submit" className="btn btn-primary">저장</button>
                    <button type="button" className="btn" onClick={() => setManualFormOpen(false)}>취소</button>
                  </form>
                )}
              </div>

              {isAdmin && cafeOpen && (
                <CafeCandidates
                  key={card.cardKey}
                  groups={cafeGroups}
                  gradingCompanies={gradingCompanies}
                  gradingScale={gradingScale}
                  busy={cafeBusy}
                  lastRun={lastRun}
                  onSave={handleCafeSave}
                  onTrack={handleCafeTrack}
                  onDismiss={handleCafeDismiss}
                  onRestore={handleCafeRestore}
                  onAuctionDirect={handleCafeAuctionDirect}
                />
              )}

              <AuctionSection auctions={auctions} busy={cafeBusy} onResult={handleAuctionResult} onUnsold={handleAuctionUnsold} />

              {marketSearchOpen && (
                <div className="market-search-panel">
                  <form className="market-search-form" onSubmit={handleMarketSearch}>
                    <input
                      type="text"
                      value={marketSearchQuery}
                      onChange={(e) => setMarketSearchQuery(e.target.value)}
                      placeholder="검색어"
                    />
                    <button type="submit" className="btn btn-primary" disabled={marketSearchLoading}>
                      {marketSearchLoading ? '검색중...' : '검색'}
                    </button>
                  </form>
                  <p className="market-hint">번개장터·당근마켓 검색 결과를 보여줍니다. 실제로 이 카드가 맞는지 사진/제목을 직접 확인하고, 맞는 것만 "가져오기"를 눌러주세요.</p>

                  <div className="market-manual-form" style={{ marginBottom: '0.6rem' }}>
                    <span className="market-hint" style={{ margin: 0 }}>가져올 매물의 언어/컨디션:</span>
                    <select value={importLanguage} onChange={(e) => setImportLanguage(e.target.value)}>
                      {LANGUAGE_OPTIONS.map((l) => <option key={l} value={l}>{l}판</option>)}
                    </select>
                    <select value={importConditionType} onChange={(e) => setImportConditionType(e.target.value)}>
                      <option value="raw">싱글(미등급)</option>
                      <option value="graded">등급카드</option>
                    </select>
                    {importConditionType === 'graded' && (
                      <>
                        <select value={importGradingCompany} onChange={(e) => setImportGradingCompany(e.target.value)}>
                          <option value="">등급사</option>
                          {gradingCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={importGrade} onChange={(e) => setImportGrade(e.target.value)}>
                          <option value="">등급</option>
                          {gradingScale.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </>
                    )}
                  </div>

                  {marketSearchError && <p className="market-hint market-photo-error">{marketSearchError}</p>}

                  {marketSearchResults.length > 0 && (
                    <div className="market-search-results">
                      {marketSearchResults.map((r) => {
                        const importKey = `${r.source}_${r.externalId}`;
                        const alreadyImported = listings.some((l) => l.id === importKey);
                        return (
                          <div key={importKey} className="market-search-result">
                            <img src={normalizeImageUrl(r.imageUrl) || '/placeholder.png'} alt={r.title} className="market-search-result-image" />
                            <div className="market-search-result-body">
                              <span className={`badge-source badge-source-${r.source}`}>{SOURCE_LABELS[r.source] || r.source}</span>
                              {looksLikeBundle(r.title) && <span className="badge-classification">묶음의심</span>}
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="market-search-result-title">{r.title}</a>
                              <span className="market-listing-price">{fmtPrice(r.price)}</span>
                              <span className="market-listing-region">{r.region || '-'}</span>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={importingId === importKey}
                              onClick={() => handleImportListing(r)}
                            >
                              {alreadyImported ? '🔄 다시 가져오기' : (importingId === importKey ? '가져오는 중...' : '✅ 가져오기')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <ListingSection
                title="현재 판매중"
                listings={activeNormal}
                emptyText="현재 판매중인 매물이 없습니다."
                onEdit={openEditListing}
                onToggleStatus={handleStatusToggle}
                onDelete={handleDeleteListing}
                statusActionLabel="판매완료로 표시"
                nicknameByUid={nicknameByUid}
              />

              <ListingSection
                title="판매완료 표시됨"
                listings={soldEstimated}
                emptyText="판매완료로 표시한 매물이 없습니다."
                onEdit={openEditListing}
                onToggleStatus={handleStatusToggle}
                onDelete={handleDeleteListing}
                statusActionLabel="판매중으로 되돌리기"
                nicknameByUid={nicknameByUid}
                showSaleType
              />

          </div>
        </div>

      {editingListing && (
        <div className="market-confirm-backdrop" onClick={() => setEditingListing(null)}>
          <div className="market-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="market-confirm-body">
              <h4>매물 정보 수정</h4>
              <form className="market-manual-form" onSubmit={handleUpdateListing}>
                <input type="number" placeholder="가격(원)" value={editingListing.price} onChange={(e) => setEditingListing((l) => ({ ...l, price: e.target.value }))} required />
                <input type="date" value={editingListing.date} onChange={(e) => setEditingListing((l) => ({ ...l, date: e.target.value }))} required />
                <select value={editingListing.language} onChange={(e) => setEditingListing((l) => ({ ...l, language: e.target.value }))}>
                  {LANGUAGE_OPTIONS.map((lang) => <option key={lang} value={lang}>{lang}판</option>)}
                </select>
                <select value={editingListing.conditionType} onChange={(e) => setEditingListing((l) => ({ ...l, conditionType: e.target.value }))}>
                  <option value="raw">싱글(미등급)</option>
                  <option value="graded">등급카드</option>
                </select>
                {editingListing.conditionType === 'graded' && (
                  <>
                    <select value={editingListing.gradingCompany} onChange={(e) => setEditingListing((l) => ({ ...l, gradingCompany: e.target.value }))} required>
                      <option value="">등급사</option>
                      {gradingCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={editingListing.grade} onChange={(e) => setEditingListing((l) => ({ ...l, grade: e.target.value }))} required>
                      <option value="">등급</option>
                      {gradingScale.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </>
                )}
                <MarketplaceSelect options={marketplaces} value={editingListing.marketplace} onChange={(v) => setEditingListing((l) => ({ ...l, marketplace: v }))} />
                <input type="text" placeholder="제목 (매물 목록에 표시돼요)" value={editingListing.title} onChange={(e) => setEditingListing((l) => ({ ...l, title: e.target.value }))} />
                <input type="text" placeholder="메모 (목록엔 안 보여요)" value={editingListing.memo} onChange={(e) => setEditingListing((l) => ({ ...l, memo: e.target.value }))} />
                <input type="url" placeholder="원본 링크" value={editingListing.url} onChange={(e) => setEditingListing((l) => ({ ...l, url: e.target.value }))} />
                <button type="submit" className="btn btn-primary">저장</button>
                <button type="button" className="btn" onClick={() => setEditingListing(null)}>취소</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 언어(한국/일본/미국/중국) x 컨디션(싱글/등급) 조합별 매물 건수를 보여주는 작은 표.
// onSelect가 있으면 칸을 클릭해서 바로 그 조합으로 필터를 바꿀 수 있다.
export function LangConditionTable({ counts, className = '', compact = false, onSelect }) {
  return (
    <table className={`market-lang-cond-table ${compact ? 'compact' : ''} ${className}`}>
      <thead>
        <tr><th></th><th>싱글</th><th>등급</th></tr>
      </thead>
      <tbody>
        {LANGUAGE_OPTIONS.map((lang) => {
          const row = counts?.[lang] || { raw: 0, graded: 0 };
          return (
            <tr key={lang}>
              <th scope="row">{lang}</th>
              <td
                className={onSelect ? 'clickable' : ''}
                onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(lang, 'raw'); } : undefined}
              >
                {row.raw}
              </td>
              <td
                className={onSelect ? 'clickable' : ''}
                onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(lang, 'graded'); } : undefined}
              >
                {row.graded}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListingSection({ title, listings, emptyText, onEdit, onToggleStatus, onDelete, statusActionLabel, dateField = 'firstSeen', nicknameByUid, showSaleType }) {
  return (
    <div className="market-section">
      {title && <h4>{title} ({listings.length})</h4>}
      {listings.length === 0 && <div className="empty-results">{emptyText}</div>}
      {listings.length > 0 && (
        <div className="market-listing-table">
          {listings.map((l) => {
            return (
              <div key={l.id} className="market-listing-row">
                <span className={`badge-source badge-source-${l.source}`}>{l.marketplace || SOURCE_LABELS[l.source] || l.source}</span>
                {showSaleType && <span className={`badge-kind ${l.saleType === 'auction' ? 'auction' : 'sale'}`}>{l.saleType === 'auction' ? '경매 낙찰' : '판매'}</span>}
                {l.language && <span className="badge-classification">{l.language}판</span>}
                {l.conditionType === 'graded' && (
                  <span className="badge-classification">{[l.gradingCompany, l.grade].filter(Boolean).join(' ') || '등급카드'}</span>
                )}
                <span className="market-listing-title">
                  {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a> : l.title}
                </span>
                <span className="market-listing-price">{fmtPrice(l.price)}</span>
                <span className="market-listing-region">{l.region || '-'}</span>
                <span className="market-listing-date">{fmtDate(l[dateField])}</span>
                {l.recordedBy?.name && (
                  <span className="market-listing-recorder" title="기록한 사용자">
                    {(l.recordedBy.uid && nicknameByUid?.[l.recordedBy.uid]) || l.recordedBy.name}
                  </span>
                )}
                <span className="market-listing-actions">
                  {onToggleStatus && (
                    <button type="button" className="btn" onClick={() => onToggleStatus(l)}>{statusActionLabel}</button>
                  )}
                  {onEdit && (
                    <button type="button" className="btn" onClick={() => onEdit(l)}>수정</button>
                  )}
                  {onDelete && (
                    <button type="button" className="btn btn-danger" onClick={() => onDelete(l)}>삭제</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
