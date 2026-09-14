import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { analyzeListingImage } from '../gemini';
import { buildCardKey } from '../utils/cardKey';
import { looksLikeBundle } from '../utils/bundleHint';
import PriceTrendChart from './PriceTrendChart';

const SOURCE_LABELS = { bunjang: '번개장터', danggeun: '당근마켓', manual: '직접입력' };
const TOP_GRADES = ['10', '9'];

// Gemini API 키를 새로 발급받아 .env.local에 넣은 뒤 true로 바꾸면
// "🔍 사진으로 확인" 버튼이 바로 다시 나타난다. (로직/핸들러는 그대로 남겨둠)
const PHOTO_CHECK_ENABLED = false;

const PICKER_RESULT_LIMIT = 60;
const MARKET_SERVER_URL = 'http://localhost:5175';
const LANGUAGE_OPTIONS = ['한국', '일본', '미국', '중국'];
const FALLBACK_GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', '기타'];
const FALLBACK_GRADING_SCALE = ['10', '9.5', '9', '8', '7', '6', '5'];

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

export default function MarketPrice({ appConfig, presetCard, clearPreset }) {
  const { user, signInWithGoogle } = useAuth();
  const { cards: myCards, loading: myCardsLoading } = useOwnedCards(); // 로그인한 본인의 보유현황이 합쳐진 카드 목록
  const [watchlist, setWatchlist] = useState([]);
  const [recordedCards, setRecordedCards] = useState([]); // 관심 등록 여부와 무관하게, 실제 시세 기록이 있는 카드들
  const [recordedLoading, setRecordedLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('watchlist'); // 'watchlist' | 'recorded'

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const [pendingAdd, setPendingAdd] = useState(null); // {cardKey, cardName, series, cardNumber, imageUrl, query}
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualAddForm, setManualAddForm] = useState({ cardName: '', series: '', cardNumber: '' });
  const [editingListing, setEditingListing] = useState(null); // {id, price, url, memo, language, conditionType, gradingCompany, grade}

  const [selectedCard, setSelectedCard] = useState(null); // {cardKey, cardName, series, cardNumber, imageUrl}
  const [listings, setListings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartRange, setChartRange] = useState('all'); // 'all' | '30' | '7'
  const [langFilter, setLangFilter] = useState('한국'); // '한국' | '일본' | '미국' | '중국'
  const [conditionFilter, setConditionFilter] = useState('raw'); // 'raw' | 'graded'

  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    price: '', date: new Date().toISOString().slice(0, 10), memo: '', url: '',
    language: '한국', conditionType: 'raw', gradingCompany: '', grade: '',
  });

  const [importLanguage, setImportLanguage] = useState('한국');
  const [importConditionType, setImportConditionType] = useState('raw');
  const [importGradingCompany, setImportGradingCompany] = useState('');
  const [importGrade, setImportGrade] = useState('');

  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearchQuery, setMarketSearchQuery] = useState('');
  const [marketSearchResults, setMarketSearchResults] = useState([]);
  const [marketSearchLoading, setMarketSearchLoading] = useState(false);
  const [marketSearchError, setMarketSearchError] = useState('');
  const [importingId, setImportingId] = useState(null);

  const [photoChecks, setPhotoChecks] = useState({});

  const appliedPresetRef = useRef(null);

  function buildRecordedBy() {
    if (!user) return null;
    return { uid: user.uid, name: user.displayName || user.email || '알 수 없음' };
  }

  const gradingCompanies = appConfig?.gradingCompaniesOptions?.length ? appConfig.gradingCompaniesOptions : FALLBACK_GRADING_COMPANIES;
  const gradingScale = appConfig?.gradingScaleOptions?.length ? appConfig.gradingScaleOptions : FALLBACK_GRADING_SCALE;

  // pokemon_cards(공용 마스터) + 내 cardOwnership(개인 가격)을 합친 목록에서 카드 키 기준으로 중복을 제거한다.
  const ownedCards = useMemo(() => {
    const byKey = new Map();
    myCards.forEach((data) => {
      if (!data.cardName) return;
      const cardKey = buildCardKey(data);
      if (!cardKey) return;
      if (!byKey.has(cardKey)) {
        byKey.set(cardKey, {
          cardKey,
          cardName: data.cardName,
          series: data.series || '',
          cardNumber: data.cardNumber || '',
          imageUrl: data.imageUrl || '',
          price: Number(data.price) || 0,
        });
      } else {
        const existing = byKey.get(cardKey);
        if (!existing.imageUrl && data.imageUrl) existing.imageUrl = data.imageUrl;
        if (!existing.price && data.price) existing.price = Number(data.price) || 0;
      }
    });
    return Array.from(byKey.values()).sort((a, b) => a.cardName.localeCompare(b.cardName, 'ko'));
  }, [myCards]);

  useEffect(() => {
    if (myCardsLoading) return;
    const byKey = new Map(ownedCards.map((c) => [c.cardKey, c]));
    loadRecordedCards(byKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCardsLoading, ownedCards]);

  useEffect(() => {
    loadWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadRecordedCards(ownedMap) {
    setRecordedLoading(true);
    try {
      const snap = await getDocs(collection(db, 'marketListings'));
      const byKey = new Map();
      snap.forEach((d) => {
        const l = d.data();
        if (!l.cardKey || typeof l.price !== 'number') return;
        if (!(l.classification === 'normal' && ['active', 'unconfirmed', 'manual'].includes(l.status))) return;
        const owned = ownedMap.get(l.cardKey);
        const entry = byKey.get(l.cardKey) || {
          cardKey: l.cardKey,
          cardName: owned?.cardName || l.cardName,
          series: owned?.series || l.series || '',
          cardNumber: owned?.cardNumber || l.cardNumber || '',
          imageUrl: owned?.imageUrl || l.imageUrl || '',
          price: owned?.price || 0,
          prices: [],
          latestSeen: null,
        };
        entry.prices.push(l.price);
        const seenAt = l.lastSeen || l.firstSeen || '';
        if (seenAt && (!entry.latestSeen || seenAt > entry.latestSeen)) entry.latestSeen = seenAt;
        byKey.set(l.cardKey, entry);
      });
      const list = Array.from(byKey.values()).map((e) => ({
        ...e,
        count: e.prices.length,
        avgPrice: Math.round(e.prices.reduce((s, p) => s + p, 0) / e.prices.length),
      }));
      list.sort((a, b) => (b.latestSeen || '').localeCompare(a.latestSeen || ''));
      setRecordedCards(list);
    } catch (err) {
      console.error('기록된 카드 로드 실패', err);
    } finally {
      setRecordedLoading(false);
    }
  }

  useEffect(() => {
    if (presetCard && presetCard.cardName && appliedPresetRef.current !== presetCard) {
      appliedPresetRef.current = presetCard;
      const cardKey = buildCardKey(presetCard);
      if (cardKey) {
        setSelectedCard({ cardKey, cardName: presetCard.cardName, series: presetCard.series || '', cardNumber: presetCard.cardNumber || '', imageUrl: presetCard.imageUrl || '', price: Number(presetCard.price) || 0 });
      }
      if (clearPreset) clearPreset();
    }
  }, [presetCard, clearPreset]);

  useEffect(() => {
    setMarketSearchOpen(false);
    setMarketSearchResults([]);
    setMarketSearchError('');
    setLangFilter('한국');
    setConditionFilter('raw');
    setChartRange('all');
    if (!selectedCard) {
      setListings([]);
      setHistory([]);
      return;
    }
    const matchingWatchlist = watchlist.find((w) => w.cardKey === selectedCard.cardKey);
    setMarketSearchQuery(matchingWatchlist?.query || selectedCard.cardName);
    loadCardData(selectedCard.cardKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard]);

  async function loadWatchlist() {
    if (!user) { setWatchlist([]); return; }
    try {
      const snap = await getDocs(query(collection(db, 'marketWatchlist'), where('ownerId', '==', user.uid)));
      setWatchlist(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('왓치리스트 로드 실패', err);
    }
  }

  async function loadCardData(cardKey) {
    setLoading(true);
    try {
      const [listingsSnap, historySnap] = await Promise.all([
        getDocs(query(collection(db, 'marketListings'), where('cardKey', '==', cardKey))),
        getDocs(query(collection(db, 'marketPriceHistory'), where('cardKey', '==', cardKey))),
      ]);
      setListings(listingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setHistory(historySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('시세 데이터 로드 실패', err);
      setListings([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  // marketListings에 실제 변화가 생겼을 때(직접기록/가져오기/재분류/상태변경/삭제) 호출.
  // 현재 보고 있는 카드 데이터뿐 아니라 "시세 기록된 카드" 대시보드도 같이 갱신한다.
  function refreshCardAndDashboard(cardKey) {
    loadCardData(cardKey);
    loadRecordedCards(new Map(ownedCards.map((c) => [c.cardKey, c])));
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

  // 판매중 매물은 마지막으로 확인된 시점(lastSeen), 판매완료 매물은 판매완료 처리된 시점(removedAt) 기준으로 기간을 따진다.
  function listingDateForRange(l) {
    return l.status === 'sold_estimated' ? (l.removedAt || l.firstSeen) : (l.lastSeen || l.firstSeen);
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

  const pickerResults = useMemo(() => {
    const keyword = pickerFilter.trim().toLowerCase();
    if (!keyword) return [];
    return ownedCards.filter((c) => c.cardName.toLowerCase().includes(keyword)).slice(0, PICKER_RESULT_LIMIT);
  }, [ownedCards, pickerFilter]);

  const recordedByKey = useMemo(() => {
    const map = new Map();
    recordedCards.forEach((r) => map.set(r.cardKey, r));
    return map;
  }, [recordedCards]);

  function selectCard(card) {
    const owned = ownedCards.find((c) => c.cardKey === card.cardKey);
    setSelectedCard({
      cardKey: card.cardKey,
      cardName: card.cardName,
      series: card.series || '',
      cardNumber: card.cardNumber || '',
      imageUrl: card.imageUrl || owned?.imageUrl || '',
      price: Number(card.price) || Number(owned?.price) || 0,
    });
  }

  function openAddPicker(card) {
    // 검색어 기본값은 카드 이름만 사용한다. 시리즈 설명 전체("sv2a -「포켓몬 카드 151」")를
    // 그대로 붙이면 실제 매물 제목과 안 맞아 검색결과가 거의 안 나온다 — 필요하면
    // 확인 화면에서 사용자가 직접 좁혀 쓸 수 있게 안내만 해준다.
    setPendingAdd({ ...card, query: card.cardName });
  }

  // 내 도감(pokemon_cards)에 아직 없는 카드도 이름/시리즈/카드번호를 직접 입력해서
  // 관심카드로 추가할 수 있게 한다. (수집 전 단계의 카드도 시세를 추적하고 싶을 수 있음)
  function handleManualAddSubmit(e) {
    e.preventDefault();
    const cardName = manualAddForm.cardName.trim();
    if (!cardName) return;
    const card = { cardName, series: manualAddForm.series.trim(), cardNumber: manualAddForm.cardNumber.trim(), imageUrl: '', price: 0 };
    const cardKey = buildCardKey(card);
    if (!cardKey) return;
    setPendingAdd({ ...card, cardKey, query: cardName });
    setManualAddOpen(false);
    setManualAddForm({ cardName: '', series: '', cardNumber: '' });
  }

  async function handleConfirmAddWatchlist() {
    if (!pendingAdd) return;
    if (!user) { signInWithGoogle(); return; }
    const already = watchlist.some((w) => w.cardKey === pendingAdd.cardKey);
    if (!already) {
      await addDoc(collection(db, 'marketWatchlist'), {
        cardKey: pendingAdd.cardKey,
        cardName: pendingAdd.cardName,
        series: pendingAdd.series || '',
        cardNumber: pendingAdd.cardNumber || '',
        imageUrl: pendingAdd.imageUrl || '',
        query: pendingAdd.query.trim() || pendingAdd.cardName,
        ownerId: user.uid,
        addedAt: new Date().toISOString(),
      });
      await loadWatchlist();
    }
    selectCard(pendingAdd);
    setPendingAdd(null);
    setPickerOpen(false);
    setPickerFilter('');
  }

  async function handleRemoveWatchlist(id) {
    await deleteDoc(doc(db, 'marketWatchlist', id));
    loadWatchlist();
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!user) { signInWithGoogle(); return; }
    const price = parseInt(manualForm.price, 10);
    if (!selectedCard || Number.isNaN(price)) return;
    const recordedAt = new Date(manualForm.date).toISOString();
    const externalId = `manual_${Date.now()}`;
    const recordedBy = buildRecordedBy();
    const language = manualForm.language || '한국';
    const conditionType = manualForm.conditionType || 'raw';
    const gradingCompany = conditionType === 'graded' ? (manualForm.gradingCompany || '') : '';
    const grade = conditionType === 'graded' ? (manualForm.grade || '') : '';

    await addDoc(collection(db, 'marketListings'), {
      cardKey: selectedCard.cardKey,
      cardName: selectedCard.cardName,
      series: selectedCard.series || '',
      cardNumber: selectedCard.cardNumber || '',
      source: 'manual',
      externalId,
      title: manualForm.memo || '직접 입력한 시세',
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
      cardKey: selectedCard.cardKey,
      source: 'manual',
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
      price: '', date: new Date().toISOString().slice(0, 10), memo: '', url: '',
      language: '한국', conditionType: 'raw', gradingCompany: '', grade: '',
    });
    setManualFormOpen(false);
    refreshCardAndDashboard(selectedCard.cardKey);
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
    if (!selectedCard) return;
    if (!user) { signInWithGoogle(); return; }
    const importKey = `${result.source}_${result.externalId}`;
    setImportingId(importKey);
    try {
      const now = new Date().toISOString();
      const existing = listings.find((l) => l.id === importKey);
      const recordedBy = buildRecordedBy();
      const gradingCompany = importConditionType === 'graded' ? importGradingCompany : '';
      const grade = importConditionType === 'graded' ? importGrade : '';
      await setDoc(doc(db, 'marketListings', importKey), {
        cardKey: selectedCard.cardKey,
        cardName: selectedCard.cardName,
        series: selectedCard.series || '',
        cardNumber: selectedCard.cardNumber || '',
        source: result.source,
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
        cardKey: selectedCard.cardKey,
        source: result.source,
        externalId: result.externalId,
        price: result.price,
        recordedAt: now,
        language: importLanguage,
        conditionType: importConditionType,
        gradingCompany,
        grade,
        recordedBy,
      });
      await refreshCardAndDashboard(selectedCard.cardKey);
    } finally {
      setImportingId(null);
    }
  }

  function openEditListing(listing) {
    if (!user) { signInWithGoogle(); return; }
    setEditingListing({
      id: listing.id,
      price: listing.price ?? '',
      url: listing.url || '',
      memo: listing.memo || '',
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
      url: editingListing.url.trim() || null,
      memo: editingListing.memo,
      language: editingListing.language,
      conditionType: editingListing.conditionType,
      gradingCompany,
      grade,
    });
    setEditingListing(null);
    refreshCardAndDashboard(selectedCard.cardKey);
  }

  async function handleStatusToggle(listing) {
    const nextStatus = listing.status === 'sold_estimated' ? 'active' : 'sold_estimated';
    await updateDoc(doc(db, 'marketListings', listing.id), {
      status: nextStatus,
      missedCount: nextStatus === 'sold_estimated' ? 2 : 0,
      removedAt: nextStatus === 'sold_estimated' ? new Date().toISOString() : null,
    });
    refreshCardAndDashboard(selectedCard.cardKey);
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
    refreshCardAndDashboard(selectedCard.cardKey);
  }

  async function handlePhotoCheck(listing) {
    setPhotoChecks((prev) => ({ ...prev, [listing.id]: { loading: true } }));
    try {
      const result = await analyzeListingImage(listing.imageUrl, listing.cardName);
      setPhotoChecks((prev) => ({ ...prev, [listing.id]: { loading: false, result } }));
    } catch (err) {
      setPhotoChecks((prev) => ({ ...prev, [listing.id]: { loading: false, error: err.message } }));
    }
  }

  return (
    <main className="market-page fade-in">
      <div className="market-header">
        <h2>📊 시세 조회</h2>
        <p className="subtitle">번개장터 · 당근마켓 실시간 시세 + 직접 기록한 시세를 한 번에 확인하세요.</p>
      </div>

      <div className="market-tabs">
        <button type="button" className={`market-tab ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => setActiveTab('watchlist')}>
          ⭐ 관심카드 <span className="market-tab-count">{watchlist.length}</span>
        </button>
        <button type="button" className={`market-tab ${activeTab === 'recorded' ? 'active' : ''}`} onClick={() => setActiveTab('recorded')}>
          📈 기록된 카드 <span className="market-tab-count">{recordedCards.length}</span>
        </button>
      </div>

      {activeTab === 'watchlist' && (
        <>
          <div className="market-gallery-header">
            <p className="market-hint" style={{ marginTop: 0 }}>팔로우만 해둔 목록이에요. 시세 기록 여부와 무관합니다. 카드에 마우스를 올리면 이름/가격이 보여요.</p>
            <button type="button" className="btn btn-primary" onClick={() => setPickerOpen((p) => !p)}>
              {pickerOpen ? '닫기' : '+ 카드 추가'}
            </button>
          </div>

          <div className="market-card-grid">
            {watchlist.map((w) => {
              const recorded = recordedByKey.get(w.cardKey);
              return (
                <CardTile
                  key={w.id}
                  card={w}
                  active={selectedCard?.cardKey === w.cardKey}
                  onClick={() => selectCard(w)}
                  onRemove={() => handleRemoveWatchlist(w.id)}
                  subLabel={recorded ? `${fmtPrice(recorded.avgPrice)} · ${recorded.count}건` : '시세 기록 없음'}
                />
              );
            })}
            {watchlist.length === 0 && (
              <div className="empty-results">등록된 관심카드가 없습니다. "+ 카드 추가"로 도감에서 카드를 골라주세요.</div>
            )}
          </div>
          {watchlist.length > 0 && (
            <p className="market-hint">
              카드를 클릭한 뒤 "🔍 마켓에서 검색"을 누르면 번개장터/당근마켓 검색 결과를 볼 수 있어요.
              (처음 한 번, 터미널에서 <code>npm run market-server</code>를 실행해둬야 합니다)
            </p>
          )}
        </>
      )}

      {activeTab === 'recorded' && (
        <>
          <div className="market-gallery-header">
            <p className="market-hint" style={{ marginTop: 0 }}>관심 등록 여부와 무관하게, 실제로 시세 데이터가 쌓인 카드만 모았어요.</p>
          </div>
          <div className="market-card-grid">
            {recordedLoading && <div className="market-hint">불러오는 중...</div>}
            {!recordedLoading && recordedCards.map((r) => (
              <CardTile
                key={r.cardKey}
                card={r}
                active={selectedCard?.cardKey === r.cardKey}
                onClick={() => selectCard(r)}
                subLabel={`${fmtPrice(r.avgPrice)} · ${r.count}건`}
              />
            ))}
            {!recordedLoading && recordedCards.length === 0 && (
              <div className="empty-results">아직 시세가 기록된 카드가 없습니다. 관심카드를 등록하고 매물을 가져오거나 직접 기록해보세요.</div>
            )}
          </div>
        </>
      )}

      {pickerOpen && (
        <div className="market-picker-panel">
          <input
            type="text"
            className="market-picker-filter"
            placeholder="도감에서 카드 이름으로 찾기... (사진을 보고 정확한 카드를 골라주세요)"
            value={pickerFilter}
            onChange={(e) => setPickerFilter(e.target.value)}
            autoFocus
          />
          {!pickerFilter.trim() && <p className="market-hint">카드 이름을 입력하면 도감에서 사진과 함께 찾아줍니다.</p>}
          {pickerFilter.trim() && (
            <div className="market-card-grid">
              {pickerResults.map((c) => (
                <CardTile key={c.cardKey} card={c} onClick={() => openAddPicker(c)} />
              ))}
              {pickerResults.length === 0 && <div className="empty-results">일치하는 카드가 없습니다.</div>}
              {pickerResults.length === PICKER_RESULT_LIMIT && <div className="market-hint">결과가 많아 {PICKER_RESULT_LIMIT}개까지만 표시했습니다. 이름을 더 구체적으로 입력해보세요.</div>}
            </div>
          )}

          <div className="market-manual-add">
            {!manualAddOpen ? (
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setManualAddOpen(true)}>
                + 도감에 없는 카드 직접 입력해서 추가
              </button>
            ) : (
              <form className="market-manual-form" onSubmit={handleManualAddSubmit}>
                <input type="text" placeholder="카드 이름*" value={manualAddForm.cardName} onChange={(e) => setManualAddForm((f) => ({ ...f, cardName: e.target.value }))} required autoFocus />
                <input type="text" placeholder="시리즈 (선택)" value={manualAddForm.series} onChange={(e) => setManualAddForm((f) => ({ ...f, series: e.target.value }))} />
                <input type="text" placeholder="카드번호 (선택)" value={manualAddForm.cardNumber} onChange={(e) => setManualAddForm((f) => ({ ...f, cardNumber: e.target.value }))} />
                <button type="submit" className="btn btn-primary">다음</button>
                <button type="button" className="btn" onClick={() => setManualAddOpen(false)}>취소</button>
              </form>
            )}
            <p className="market-hint">아직 수집하지 않은 카드도 시세만 미리 추적할 수 있어요.</p>
          </div>
        </div>
      )}

      {pendingAdd && (
        <div className="market-confirm-backdrop" onClick={() => setPendingAdd(null)}>
          <div className="market-confirm-card" onClick={(e) => e.stopPropagation()}>
            <img src={pendingAdd.imageUrl || '/placeholder.png'} alt={pendingAdd.cardName} />
            <div className="market-confirm-body">
              <h4>{pendingAdd.cardName}</h4>
              <p className="market-hint">{cardLabel(pendingAdd) || '시리즈/카드번호 정보 없음'}</p>
              <label className="market-confirm-label">번개장터/당근마켓 검색어</label>
              <input
                type="text"
                value={pendingAdd.query}
                onChange={(e) => setPendingAdd((p) => ({ ...p, query: e.target.value }))}
              />
              <p className="market-hint">보통은 카드 이름만으로 충분합니다. 결과가 다른 카드와 너무 섞이면 시리즈 축약형(예: sv2a) 정도만 추가해보세요.</p>
              <div className="market-confirm-actions">
                <button type="button" className="btn btn-primary" onClick={handleConfirmAddWatchlist}>⭐ 관심카드로 추가</button>
                <button type="button" className="btn" onClick={() => setPendingAdd(null)}>취소</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingListing && (
        <div className="market-confirm-backdrop" onClick={() => setEditingListing(null)}>
          <div className="market-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="market-confirm-body">
              <h4>매물 정보 수정</h4>
              <form className="market-manual-form" onSubmit={handleUpdateListing}>
                <input type="number" placeholder="가격(원)" value={editingListing.price} onChange={(e) => setEditingListing((l) => ({ ...l, price: e.target.value }))} required />
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
                <input type="text" placeholder="메모" value={editingListing.memo} onChange={(e) => setEditingListing((l) => ({ ...l, memo: e.target.value }))} />
                <input type="url" placeholder="원본 링크" value={editingListing.url} onChange={(e) => setEditingListing((l) => ({ ...l, url: e.target.value }))} />
                <button type="submit" className="btn btn-primary">저장</button>
                <button type="button" className="btn" onClick={() => setEditingListing(null)}>취소</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {selectedCard && (
        <div className="market-drawer-backdrop fade-in" onClick={() => setSelectedCard(null)}>
          <div className="market-drawer-panel slide-in-right" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setSelectedCard(null)}>✕</button>

            <div className="market-detail-header">
            <img
              className="market-preview-image"
              src={selectedCard.imageUrl || '/placeholder.png'}
              alt={selectedCard.cardName}
            />
            <div className="market-preview-info">
              <h3 className="market-selected-title">{selectedCard.cardName}</h3>
              <p className="market-hint">{cardLabel(selectedCard) || ' '}</p>
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
            </div>
            </div>

              <p className="market-hint" style={{ marginBottom: '0.3rem' }}>👁️ 아래 매물 중 뭘 보여줄지 고르는 필터예요. 통계와 그래프에 모두 적용돼요. (기록할 때는 따로 선택해요)</p>
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
                    <h5>판매완료 기준</h5>
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
                    <h5>판매완료 기준 (10등급/9등급)</h5>
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
                  🔍 마켓에서 검색
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
                    <input type="text" placeholder="메모 (예: 직거래, 트위터 등)" value={manualForm.memo} onChange={(e) => setManualForm((f) => ({ ...f, memo: e.target.value }))} />
                    <input type="url" placeholder="원본 링크 (선택, 예: 트윗/카페글 주소)" value={manualForm.url} onChange={(e) => setManualForm((f) => ({ ...f, url: e.target.value }))} />
                    <button type="submit" className="btn btn-primary">저장</button>
                    <button type="button" className="btn" onClick={() => setManualFormOpen(false)}>취소</button>
                  </form>
                )}
              </div>

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
                            <img src={r.imageUrl || '/placeholder.png'} alt={r.title} className="market-search-result-image" />
                            <div className="market-search-result-body">
                              <span className={`badge-source badge-source-${r.source}`}>{SOURCE_LABELS[r.source] || r.source}</span>
                              {looksLikeBundle(r.title) && <span className="badge-classification">⚠️ 묶음의심</span>}
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
                onPhotoCheck={PHOTO_CHECK_ENABLED ? handlePhotoCheck : undefined}
                photoChecks={photoChecks}
                statusActionLabel="판매완료로 표시"
              />

              <ListingSection
                title="판매완료 표시됨"
                listings={soldEstimated}
                emptyText="판매완료로 표시한 매물이 없습니다."
                onEdit={openEditListing}
                onToggleStatus={handleStatusToggle}
                onDelete={handleDeleteListing}
                photoChecks={photoChecks}
                statusActionLabel="판매중으로 되돌리기"
                dateField="removedAt"
              />

          </div>
        </div>
      )}
    </main>
  );
}

function CardTile({ card, onClick, active, onRemove, subLabel }) {
  return (
    <div className={`market-tile ${active ? 'active' : ''}`} onClick={onClick}>
      {onRemove && (
        <button type="button" className="market-tile-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="관심카드에서 삭제">✕</button>
      )}
      <div className="card-image-wrapper">
        <img src={card.imageUrl || '/placeholder.png'} alt={card.cardName} loading="lazy" />
        <div className="market-tile-hover-info">
          <strong>{card.cardName}</strong>
          {(card.series || card.cardNumber) && (
            <small>{[card.series, card.cardNumber && `No.${card.cardNumber}`].filter(Boolean).join(' · ')}</small>
          )}
          {subLabel && <small>{subLabel}</small>}
        </div>
      </div>
    </div>
  );
}

function ListingSection({ title, listings, emptyText, onEdit, onToggleStatus, onDelete, onPhotoCheck, photoChecks, statusActionLabel, dateField = 'firstSeen' }) {
  return (
    <div className="market-section">
      {title && <h4>{title} ({listings.length})</h4>}
      {listings.length === 0 && <div className="empty-results">{emptyText}</div>}
      {listings.length > 0 && (
        <div className="market-listing-table">
          {listings.map((l) => {
            const check = photoChecks?.[l.id];
            return (
              <div key={l.id} className="market-listing-row">
                <span className={`badge-source badge-source-${l.source}`}>{SOURCE_LABELS[l.source] || l.source}</span>
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
                  <span className="market-listing-recorder" title="기록한 사용자">👤 {l.recordedBy.name}</span>
                )}
                <span className="market-listing-actions">
                  {onPhotoCheck && l.imageUrl && (
                    <button type="button" className="btn" onClick={() => onPhotoCheck(l)} disabled={check?.loading}>
                      {check?.loading ? '분석중...' : '🔍 사진으로 확인'}
                    </button>
                  )}
                  {onToggleStatus && (
                    <button type="button" className="btn" onClick={() => onToggleStatus(l)}>{statusActionLabel}</button>
                  )}
                  {onEdit && (
                    <button type="button" className="btn" onClick={() => onEdit(l)}>✏️ 수정</button>
                  )}
                  {onDelete && (
                    <button type="button" className="btn btn-danger" onClick={() => onDelete(l)}>🗑 삭제</button>
                  )}
                </span>
                {check?.result && (
                  <span className="market-photo-result">
                    {check.result.matchesExpected ? '✅' : '⚠️'} {check.result.cardName || '?'} (확신도 {check.result.confidence}%){check.result.cardCount > 1 ? ' · 묶음의심' : ''} — {check.result.note}
                  </span>
                )}
                {check?.error && <span className="market-photo-result market-photo-error">⚠️ {check.error}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
