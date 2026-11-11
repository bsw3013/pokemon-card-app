import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { buildCardKey, isIdCardKey, resolveLegacyCardKey } from '../utils/cardKey';
import MarketDrawer, { LangConditionTable } from './MarketDrawer';
import { invalidateWatchlist } from '../hooks/useWatchlist';
import { normalizeImageUrl } from '../utils/thumbKey';

const PICKER_RESULT_LIMIT = 60;

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

  const [selectedCard, setSelectedCard] = useState(null); // {cardKey, cardName, series, cardNumber, imageUrl}

  const appliedPresetRef = useRef(null);

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
        if (!l.cardKey || typeof l.price !== 'number' || l.classification !== 'normal') return;
        const isActive = ['active', 'unconfirmed', 'manual'].includes(l.status);
        const isSold = l.status === 'sold_estimated';
        if (!isActive && !isSold) return;
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
          breakdown: {}, // { 언어: { raw: 건수, graded: 건수 } }, 판매중+판매완료 합계
        };
        // "기록된 카드" 목록의 평균가/건수는 지금 판매중인 매물 기준으로만 보여준다 (기존 동작 유지).
        if (isActive) entry.prices.push(l.price);
        const lang = l.language || '한국';
        const cond = l.conditionType === 'graded' ? 'graded' : 'raw';
        if (!entry.breakdown[lang]) entry.breakdown[lang] = { raw: 0, graded: 0 };
        entry.breakdown[lang][cond] += 1;
        const seenAt = l.lastSeen || l.firstSeen || '';
        if (seenAt && (!entry.latestSeen || seenAt > entry.latestSeen)) entry.latestSeen = seenAt;
        byKey.set(l.cardKey, entry);
      });
      const list = Array.from(byKey.values()).map((e) => ({
        ...e,
        count: e.prices.length,
        avgPrice: e.prices.length ? Math.round(e.prices.reduce((s, p) => s + p, 0) / e.prices.length) : 0,
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

  // 예전 방식(이름+시리즈+번호) 키로 저장된 내 관심카드를 카드 ID 키로 바꿔 둔다. (한 번만 하면 됨)
  useEffect(() => {
    if (!user || myCardsLoading || myCards.length === 0) return;
    const stale = watchlist
      .filter((w) => w.cardKey && !isIdCardKey(w.cardKey))
      .map((w) => ({ w, cardId: resolveLegacyCardKey(w.cardKey, myCards) }))
      .filter((x) => x.cardId);
    if (stale.length === 0) return;
    (async () => {
      try {
        await Promise.all(stale.map(({ w, cardId }) => updateDoc(doc(db, 'marketWatchlist', w.id), { cardKey: `id:${cardId}`, legacyCardKey: w.cardKey })));
        await loadWatchlist();
      } catch (err) {
        console.error('관심카드 연결 변경 실패', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, myCardsLoading, myCards, watchlist]);

  async function loadWatchlist() {
    if (!user) { setWatchlist([]); return; }
    try {
      const snap = await getDocs(query(collection(db, 'marketWatchlist'), where('ownerId', '==', user.uid)));
      setWatchlist(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('왓치리스트 로드 실패', err);
    }
  }

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
      invalidateWatchlist();
    }
    selectCard(pendingAdd);
    setPendingAdd(null);
    setPickerOpen(false);
    setPickerFilter('');
  }

  async function handleRemoveWatchlist(id) {
    await deleteDoc(doc(db, 'marketWatchlist', id));
    invalidateWatchlist();
    loadWatchlist();
  }

  return (
    <main className="market-page fade-in">
      <div className="market-header">
        <h2>시세 조회</h2>
        <p className="subtitle">번개장터 · 당근마켓 실시간 시세 + 직접 기록한 시세를 한 번에 확인하세요.</p>
      </div>

      <div className="market-tabs">
        <button type="button" className={`market-tab ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => setActiveTab('watchlist')}>
          관심카드 <span className="market-tab-count">{watchlist.length}</span>
        </button>
        <button type="button" className={`market-tab ${activeTab === 'recorded' ? 'active' : ''}`} onClick={() => setActiveTab('recorded')}>
          기록된 카드 <span className="market-tab-count">{recordedCards.length}</span>
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
                  breakdown={recorded?.breakdown}
                />
              );
            })}
            {watchlist.length === 0 && (
              <div className="empty-results">등록된 관심카드가 없습니다. "+ 카드 추가"로 도감에서 카드를 골라주세요.</div>
            )}
          </div>
          {watchlist.length > 0 && (
            <p className="market-hint">
              카드를 클릭한 뒤 "마켓에서 검색"을 누르면 번개장터/당근마켓 검색 결과를 볼 수 있어요.
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
                breakdown={r.breakdown}
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
            <img src={normalizeImageUrl(pendingAdd.imageUrl) || '/placeholder.png'} alt={pendingAdd.cardName} />
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
                <button type="button" className="btn btn-primary" onClick={handleConfirmAddWatchlist}>관심카드로 추가</button>
                <button type="button" className="btn" onClick={() => setPendingAdd(null)}>취소</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCard && (
        <MarketDrawer
          key={selectedCard.cardKey}
          card={selectedCard}
          appConfig={appConfig}
          onClose={() => setSelectedCard(null)}
          onChanged={() => { loadWatchlist(); loadRecordedCards(new Map(ownedCards.map((c) => [c.cardKey, c]))); }}
        />
      )}
    </main>
  );
}

function CardTile({ card, onClick, active, onRemove, subLabel, breakdown }) {
  const hasBreakdown = breakdown && Object.keys(breakdown).length > 0;
  return (
    <div className={`market-tile ${active ? 'active' : ''}`} onClick={onClick}>
      {onRemove && (
        <button type="button" className="market-tile-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="관심카드에서 삭제">✕</button>
      )}
      <div className="card-image-wrapper">
        <img src={normalizeImageUrl(card.imageUrl) || '/placeholder.png'} alt={card.cardName} loading="lazy" />
        <div className="market-tile-hover-info">
          <strong>{card.cardName}</strong>
          {(card.series || card.cardNumber) && (
            <small>{[card.series, card.cardNumber && `No.${card.cardNumber}`].filter(Boolean).join(' · ')}</small>
          )}
          {subLabel && <small>{subLabel}</small>}
          {hasBreakdown ? (
            <LangConditionTable counts={breakdown} className="market-tile-lang-table" compact />
          ) : (
            !subLabel && <small>시세 기록 없음</small>
          )}
        </div>
      </div>
    </div>
  );
}

