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
import { analyzeListingImage } from '../gemini';
import { buildCardKey } from '../utils/cardKey';
import { looksLikeBundle } from '../utils/bundleHint';
import PriceTrendChart from './PriceTrendChart';

const SOURCE_LABELS = { bunjang: '번개장터', danggeun: '당근마켓', manual: '직접입력' };
const CLASSIFICATION_LABELS = { normal: '정상', bundle: '묶음판매', outlier: '이상치', unpriced: '가격미정' };

// Gemini API 키를 새로 발급받아 .env.local에 넣은 뒤 true로 바꾸면
// "🔍 사진으로 확인" 버튼이 바로 다시 나타난다. (로직/핸들러는 그대로 남겨둠)
const PHOTO_CHECK_ENABLED = false;

const PICKER_RESULT_LIMIT = 60;
const MARKET_SERVER_URL = 'http://localhost:5175';

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

export default function MarketPrice({ presetCard, clearPreset }) {
  const [ownedCards, setOwnedCards] = useState([]); // [{cardKey, cardName, series, cardNumber, imageUrl}]
  const [watchlist, setWatchlist] = useState([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const [pendingAdd, setPendingAdd] = useState(null); // {cardKey, cardName, series, cardNumber, imageUrl, query}

  const [selectedCard, setSelectedCard] = useState(null); // {cardKey, cardName, series, cardNumber, imageUrl}
  const [detailOpen, setDetailOpen] = useState(false);
  const [listings, setListings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showBundlePanel, setShowBundlePanel] = useState(false);

  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ price: '', date: new Date().toISOString().slice(0, 10), memo: '', url: '' });

  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearchQuery, setMarketSearchQuery] = useState('');
  const [marketSearchResults, setMarketSearchResults] = useState([]);
  const [marketSearchLoading, setMarketSearchLoading] = useState(false);
  const [marketSearchError, setMarketSearchError] = useState('');
  const [importingId, setImportingId] = useState(null);

  const [photoChecks, setPhotoChecks] = useState({});

  const appliedPresetRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'pokemon_cards'));
        const byKey = new Map();
        snap.forEach((d) => {
          const data = d.data() || {};
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
            });
          } else if (!byKey.get(cardKey).imageUrl && data.imageUrl) {
            byKey.get(cardKey).imageUrl = data.imageUrl;
          }
        });
        setOwnedCards(Array.from(byKey.values()).sort((a, b) => a.cardName.localeCompare(b.cardName, 'ko')));
      } catch (err) {
        console.error('도감 카드 목록 로드 실패', err);
      }
    })();
    loadWatchlist();
  }, []);

  useEffect(() => {
    if (presetCard && presetCard.cardName && appliedPresetRef.current !== presetCard) {
      appliedPresetRef.current = presetCard;
      const cardKey = buildCardKey(presetCard);
      if (cardKey) {
        setSelectedCard({ cardKey, cardName: presetCard.cardName, series: presetCard.series || '', cardNumber: presetCard.cardNumber || '', imageUrl: presetCard.imageUrl || '' });
      }
      if (clearPreset) clearPreset();
    }
  }, [presetCard, clearPreset]);

  useEffect(() => {
    setDetailOpen(false);
    setMarketSearchOpen(false);
    setMarketSearchResults([]);
    setMarketSearchError('');
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
    try {
      const snap = await getDocs(collection(db, 'marketWatchlist'));
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

  const activeNormal = useMemo(
    () => listings.filter((l) => l.classification === 'normal' && (l.status === 'active' || l.status === 'unconfirmed' || l.status === 'manual'))
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
    [listings]
  );
  const soldEstimated = useMemo(
    () => listings.filter((l) => l.status === 'sold_estimated').sort((a, b) => new Date(b.removedAt || 0) - new Date(a.removedAt || 0)),
    [listings]
  );
  const bundleOutlier = useMemo(
    () => listings.filter((l) => ['bundle', 'outlier', 'unpriced'].includes(l.classification)),
    [listings]
  );

  const summary = useMemo(() => {
    const priced = activeNormal.filter((l) => typeof l.price === 'number');
    if (priced.length === 0) return null;
    const sorted = [...priced].sort((a, b) => a.price - b.price);
    const prices = sorted.map((l) => l.price);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0 ? Math.round((prices[mid - 1] + prices[mid]) / 2) : prices[mid];
    const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    return { count: priced.length, min: sorted[0], max: sorted[sorted.length - 1], avg, median };
  }, [activeNormal]);

  const pickerResults = useMemo(() => {
    const keyword = pickerFilter.trim().toLowerCase();
    if (!keyword) return [];
    return ownedCards.filter((c) => c.cardName.toLowerCase().includes(keyword)).slice(0, PICKER_RESULT_LIMIT);
  }, [ownedCards, pickerFilter]);

  function selectCard(card) {
    setSelectedCard({ cardKey: card.cardKey, cardName: card.cardName, series: card.series || '', cardNumber: card.cardNumber || '', imageUrl: card.imageUrl || '' });
  }

  function openAddPicker(card) {
    // 검색어 기본값은 카드 이름만 사용한다. 시리즈 설명 전체("sv2a -「포켓몬 카드 151」")를
    // 그대로 붙이면 실제 매물 제목과 안 맞아 검색결과가 거의 안 나온다 — 필요하면
    // 확인 화면에서 사용자가 직접 좁혀 쓸 수 있게 안내만 해준다.
    setPendingAdd({ ...card, query: card.cardName });
  }

  async function handleConfirmAddWatchlist() {
    if (!pendingAdd) return;
    const already = watchlist.some((w) => w.cardKey === pendingAdd.cardKey);
    if (!already) {
      await addDoc(collection(db, 'marketWatchlist'), {
        cardKey: pendingAdd.cardKey,
        cardName: pendingAdd.cardName,
        series: pendingAdd.series || '',
        cardNumber: pendingAdd.cardNumber || '',
        imageUrl: pendingAdd.imageUrl || '',
        query: pendingAdd.query.trim() || pendingAdd.cardName,
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
    const price = parseInt(manualForm.price, 10);
    if (!selectedCard || Number.isNaN(price)) return;
    const recordedAt = new Date(manualForm.date).toISOString();
    const externalId = `manual_${Date.now()}`;

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
    });
    await addDoc(collection(db, 'marketPriceHistory'), {
      cardKey: selectedCard.cardKey,
      source: 'manual',
      externalId,
      price,
      recordedAt,
    });

    setManualForm({ price: '', date: new Date().toISOString().slice(0, 10), memo: '', url: '' });
    setManualFormOpen(false);
    loadCardData(selectedCard.cardKey);
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
    const importKey = `${result.source}_${result.externalId}`;
    setImportingId(importKey);
    try {
      const now = new Date().toISOString();
      const existing = listings.find((l) => l.id === importKey);
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
      });
      await addDoc(collection(db, 'marketPriceHistory'), {
        cardKey: selectedCard.cardKey,
        source: result.source,
        externalId: result.externalId,
        price: result.price,
        recordedAt: now,
      });
      await loadCardData(selectedCard.cardKey);
    } finally {
      setImportingId(null);
    }
  }

  async function handleReclassify(listingId, classification) {
    await updateDoc(doc(db, 'marketListings', listingId), {
      classification,
      classificationOverride: true,
    });
    loadCardData(selectedCard.cardKey);
  }

  async function handleStatusToggle(listing) {
    const nextStatus = listing.status === 'sold_estimated' ? 'active' : 'sold_estimated';
    await updateDoc(doc(db, 'marketListings', listing.id), {
      status: nextStatus,
      missedCount: nextStatus === 'sold_estimated' ? 2 : 0,
      removedAt: nextStatus === 'sold_estimated' ? new Date().toISOString() : null,
    });
    loadCardData(selectedCard.cardKey);
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
    loadCardData(selectedCard.cardKey);
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

      <div className="market-gallery-header">
        <h3>⭐ 관심카드</h3>
        <button type="button" className="btn btn-primary" onClick={() => setPickerOpen((p) => !p)}>
          {pickerOpen ? '닫기' : '+ 카드 추가'}
        </button>
      </div>

      <div className="market-card-grid">
        {watchlist.map((w) => (
          <CardTile
            key={w.id}
            card={w}
            active={selectedCard?.cardKey === w.cardKey}
            onClick={() => selectCard(w)}
            onRemove={() => handleRemoveWatchlist(w.id)}
          />
        ))}
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

      {!selectedCard && (
        <div className="market-empty-state">위 관심카드 목록에서 카드를 클릭해주세요.</div>
      )}

      {selectedCard && (
        <div className="market-result fade-in">
          <button type="button" className="market-preview-card" onClick={() => setDetailOpen((o) => !o)}>
            <img
              className="market-preview-image"
              src={selectedCard.imageUrl || '/placeholder.png'}
              alt={selectedCard.cardName}
            />
            <div className="market-preview-info">
              <h3 className="market-selected-title">{selectedCard.cardName}</h3>
              <p className="market-hint">{cardLabel(selectedCard) || ' '}</p>
              {loading && <span className="market-hint">불러오는 중...</span>}
              {!loading && summary && (
                <span className="market-preview-range">
                  {fmtPrice(summary.min.price)} ~ {fmtPrice(summary.max.price)} · 활성 매물 {summary.count}건
                </span>
              )}
              {!loading && !summary && <span className="market-hint">아직 통계를 낼 만한 정상 매물이 없습니다.</span>}
              <span className="market-preview-toggle">{detailOpen ? '▾ 접기' : '▸ 시세 추이 · 매물 보기'}</span>
            </div>
          </button>

          {detailOpen && (
            <>
              {summary && (
                <div className="market-summary-cards">
                  <div className="market-summary-card">
                    <span className="label">활성 매물</span>
                    <span className="value">{summary.count}건</span>
                  </div>
                  <div className="market-summary-card">
                    <span className="label">최저가</span>
                    <span className="value">{fmtPrice(summary.min.price)} <small>({SOURCE_LABELS[summary.min.source] || summary.min.source})</small></span>
                  </div>
                  <div className="market-summary-card">
                    <span className="label">평균가</span>
                    <span className="value">{fmtPrice(summary.avg)}</span>
                  </div>
                  <div className="market-summary-card">
                    <span className="label">중앙값</span>
                    <span className="value">{fmtPrice(summary.median)}</span>
                  </div>
                  <div className="market-summary-card">
                    <span className="label">최고가</span>
                    <span className="value">{fmtPrice(summary.max.price)} <small>({SOURCE_LABELS[summary.max.source] || summary.max.source})</small></span>
                  </div>
                </div>
              )}

              <PriceTrendChart history={history} />

              <div className="market-add-row">
                <button type="button" className="btn btn-primary" onClick={() => setMarketSearchOpen((o) => !o)}>
                  🔍 마켓에서 검색
                </button>
                {!manualFormOpen ? (
                  <button type="button" className="btn btn-secondary" onClick={() => setManualFormOpen(true)}>+ 시세 직접 기록</button>
                ) : (
                  <form className="market-manual-form" onSubmit={handleManualSubmit}>
                    <input type="number" placeholder="가격(원)" value={manualForm.price} onChange={(e) => setManualForm((f) => ({ ...f, price: e.target.value }))} required />
                    <input type="date" value={manualForm.date} onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))} required />
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
                onReclassify={handleReclassify}
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
                onReclassify={handleReclassify}
                onToggleStatus={handleStatusToggle}
                onDelete={handleDeleteListing}
                photoChecks={photoChecks}
                statusActionLabel="판매중으로 되돌리기"
                dateField="removedAt"
              />

              <div className="market-collapsible">
                <button type="button" className="btn btn-secondary" onClick={() => setShowBundlePanel((p) => !p)}>
                  {showBundlePanel ? '▾' : '▸'} 묶음/이상치 {bundleOutlier.length}건 보기
                </button>
                {showBundlePanel && (
                  <ListingSection
                    listings={bundleOutlier}
                    emptyText="묶음/이상치로 분류된 매물이 없습니다."
                    onReclassify={handleReclassify}
                    onDelete={handleDeleteListing}
                    photoChecks={photoChecks}
                    showClassificationBadge
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}

function CardTile({ card, onClick, active, onRemove }) {
  return (
    <div className={`market-tile ${active ? 'active' : ''}`} onClick={onClick}>
      {onRemove && (
        <button type="button" className="market-tile-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="관심카드에서 삭제">✕</button>
      )}
      <div className="card-image-wrapper">
        <img src={card.imageUrl || '/placeholder.png'} alt={card.cardName} loading="lazy" />
        {(card.series || card.cardNumber) && (
          <div className="market-tile-hover-info">
            {card.series && <span>{card.series}</span>}
            {card.cardNumber && <span>No.{card.cardNumber}</span>}
          </div>
        )}
      </div>
      <div className="card-info">
        <h3 className="card-name" title={card.cardName}>{card.cardName}</h3>
      </div>
    </div>
  );
}

function ListingSection({ title, listings, emptyText, onReclassify, onToggleStatus, onDelete, onPhotoCheck, photoChecks, statusActionLabel, dateField = 'firstSeen', showClassificationBadge }) {
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
                {showClassificationBadge && <span className="badge-classification">{CLASSIFICATION_LABELS[l.classification] || l.classification}</span>}
                <span className="market-listing-title">
                  {l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a> : l.title}
                </span>
                <span className="market-listing-price">{fmtPrice(l.price)}</span>
                <span className="market-listing-region">{l.region || '-'}</span>
                <span className="market-listing-date">{fmtDate(l[dateField])}</span>
                <span className="market-listing-actions">
                  {onPhotoCheck && l.imageUrl && (
                    <button type="button" className="btn" onClick={() => onPhotoCheck(l)} disabled={check?.loading}>
                      {check?.loading ? '분석중...' : '🔍 사진으로 확인'}
                    </button>
                  )}
                  {onToggleStatus && (
                    <button type="button" className="btn" onClick={() => onToggleStatus(l)}>{statusActionLabel}</button>
                  )}
                  {onReclassify && (
                    <select value={l.classification} onChange={(e) => onReclassify(l.id, e.target.value)}>
                      {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
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
