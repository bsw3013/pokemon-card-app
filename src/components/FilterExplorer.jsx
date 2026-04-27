import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeStatus } from '../utils/statusUtils';
import CardDetailModal from './CardDetailModal';

function normalize(value) {
  return String(value || '').trim();
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ko');
}

function compareNumberLike(a, b) {
  const na = Number(String(a || '').replace(/[^0-9.-]/g, ''));
  const nb = Number(String(b || '').replace(/[^0-9.-]/g, ''));
  const va = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
  return va - vb;
}

function mergeByMasterOrder(masterOptions, cardSet) {
  const master = Array.isArray(masterOptions)
    ? masterOptions.map((v) => normalize(v)).filter(Boolean)
    : [];
  const fromCards = Array.from(cardSet || []).map((v) => normalize(v)).filter(Boolean);

  const result = [];
  const seen = new Set();

  master.forEach((item) => {
    if (seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });

  fromCards
    .filter((item) => !seen.has(item))
    .sort(compareText)
    .forEach((item) => {
      seen.add(item);
      result.push(item);
    });

  return result;
}

export default function FilterExplorer({ appConfig }) {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState([]);
  const SERIES_VISIBLE_COUNT = 12;
  const [selectedCard, setSelectedCard] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('cardName');
  const [sortDir, setSortDir] = useState('asc');

  const [seriesFilter, setSeriesFilter] = useState([]);
  const [rarityFilter, setRarityFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [seriesExpanded, setSeriesExpanded] = useState(false);

  useEffect(() => {
    async function fetchCards() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'pokemon_cards'));
        setCards(snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, status: normalizeStatus(data.status) };
        }));
      } catch (err) {
        console.error('filter explorer fetch error', err);
      } finally {
        setLoading(false);
      }
    }

    fetchCards();
  }, []);

  const optionSets = useMemo(() => {
    const fromCards = {
      series: new Set(),
      rarity: new Set(),
      type: new Set(),
      status: new Set(),
    };

    cards.forEach((card) => {
      const s = normalize(card.series);
      const r = normalize(card.rarity);
      const t = normalize(card.type);
      const st = normalize(card.status);
      if (s) fromCards.series.add(s);
      if (r) fromCards.rarity.add(r);
      if (t) fromCards.type.add(t);
      if (st) fromCards.status.add(st);
    });

    return {
      series: mergeByMasterOrder(appConfig?.seriesOptions, fromCards.series),
      rarity: mergeByMasterOrder(appConfig?.rarityOptions, fromCards.rarity),
      type: mergeByMasterOrder(appConfig?.typeOptions, fromCards.type),
      status: mergeByMasterOrder(appConfig?.statusOptions, fromCards.status),
    };
  }, [cards, appConfig]);

  const toggleFilter = (value, selected, setter) => {
    setter(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setSortField('cardName');
    setSortDir('asc');
    setSeriesFilter([]);
    setRarityFilter([]);
    setTypeFilter([]);
    setStatusFilter([]);
  };

  const openModal = (card) => {
    setSelectedCard(card);
  };

  const handleModalSave = async (payload) => {
    if (!selectedCard?.id) return;

    const updatePayload = {
      cardName: String(payload.cardName || '').trim(),
      series: String(payload.series || '').trim(),
      cardNumber: String(payload.cardNumber || '').trim(),
      pokedexNumber: normalizePokedexNumber(payload.pokedexNumber || ''),
      rarity: String(payload.rarity || '').trim(),
      type: String(payload.type || '').trim(),
      status: normalizeStatus(payload.status || '미보유'),
      price: Number(payload.price) || 0,
      imageUrl: String(payload.imageUrl || '').trim(),
      possessions: Array.isArray(payload.possessions) ? payload.possessions : [],
    };

    try {
      await updateDoc(doc(db, 'pokemon_cards', selectedCard.id), updatePayload);
      setCards((prev) => prev.map((card) => (
        card.id === selectedCard.id
          ? { ...card, ...updatePayload, status: normalizeStatus(updatePayload.status) }
          : card
      )));
      setSelectedCard(null);
    } catch (err) {
      console.error('filter explorer save error', err);
      alert('저장 중 오류가 발생했습니다.');
      throw err;
    }
  };

  const handleModalDelete = async () => {
    if (!selectedCard?.id) return;

    try {
      await deleteDoc(doc(db, 'pokemon_cards', selectedCard.id));
      setCards((prev) => prev.filter((card) => card.id !== selectedCard.id));
      setSelectedCard(null);
    } catch (err) {
      console.error('filter explorer delete error', err);
      alert('삭제 중 오류가 발생했습니다.');
      throw err;
    }
  };

  const padTo4 = (num) => String(num).padStart(4, '0');
  const normalizePokedexNumber = (raw) => {
    if (raw === undefined || raw === null) return '';
    const s = String(raw).trim();
    if (!s) return '';
    return s.replace(/\d+/g, (m) => padTo4(m));
  };



  const removeSelectedFilter = (group, value) => {
    if (group === 'series') setSeriesFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'rarity') setRarityFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'type') setTypeFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'status') setStatusFilter((prev) => prev.filter((v) => v !== value));
  };

  useEffect(() => {
    if (seriesFilter.length > 0 || searchTerm.trim()) {
      setSeriesExpanded(true);
    }
  }, [seriesFilter, searchTerm]);

  const filteredCards = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    const result = cards.filter((card) => {
      const series = normalize(card.series);
      const rarity = normalize(card.rarity);
      const type = normalize(card.type);
      const status = normalize(card.status);

      if (seriesFilter.length && !seriesFilter.includes(series)) return false;
      if (rarityFilter.length && !rarityFilter.includes(rarity)) return false;
      if (typeFilter.length && !typeFilter.includes(type)) return false;
      if (statusFilter.length && !statusFilter.includes(status)) return false;

      if (!keyword) return true;

      const haystack = [
        normalize(card.cardName),
        series,
        normalize(card.cardNumber),
        normalize(card.pokedexNumber),
        rarity,
        type,
        status,
      ].join(' ').toLowerCase();

      return haystack.includes(keyword);
    });

    result.sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      const isNumericField = sortField === 'pokedexNumber' || sortField === 'price';
      
      let aHas = va !== undefined && va !== null && String(va).trim() !== '';
      let bHas = vb !== undefined && vb !== null && String(vb).trim() !== '';
      
      if (sortField === 'createdAt') {
        aHas = !!a.createdAt;
        bHas = !!b.createdAt;
      }
      if (isNumericField) {
        aHas = aHas && Number.isFinite(Number(String(va || '').replace(/[^0-9.-]/g, '')));
        bHas = bHas && Number.isFinite(Number(String(vb || '').replace(/[^0-9.-]/g, '')));
      }

      if (!aHas || !bHas) {
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        return -1;
      }

      let cmp = 0;
      if (isNumericField) {
        cmp = compareNumberLike(va, vb);
      } else if (sortField === 'createdAt') {
        cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      } else {
        cmp = compareText(va, vb);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [
    cards,
    searchTerm,
    sortField,
    sortDir,
    seriesFilter,
    rarityFilter,
    typeFilter,
    statusFilter,
  ]);

  const selectedSummary = useMemo(() => {
    return [
      ...seriesFilter.map((value) => ({ group: 'series', label: `시리즈: ${value}`, value })),
      ...rarityFilter.map((value) => ({ group: 'rarity', label: `레어도: ${value}`, value })),
      ...typeFilter.map((value) => ({ group: 'type', label: `종류: ${value}`, value })),
      ...statusFilter.map((value) => ({ group: 'status', label: `상태: ${value}`, value })),
    ];
  }, [seriesFilter, rarityFilter, typeFilter, statusFilter]);

  const renderFilterGroup = ({
    keyName,
    title,
    options,
    selected,
    setter,
    collapsible = false,
    expanded = false,
    onToggleExpanded,
  }) => {
    const visibleOptions = collapsible && !expanded ? options.slice(0, SERIES_VISIBLE_COUNT) : options;
    const hiddenCount = Math.max(0, options.length - visibleOptions.length);

    return (
      <section className={`filter-group ${selected.length ? 'has-selected' : ''}`}>
        <div className="filter-group-head">
          <h4>{title} <span className="filter-group-count">{selected.length}</span></h4>
          {collapsible && options.length > SERIES_VISIBLE_COUNT ? (
            <button
              type="button"
              className="filter-group-toggle"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
            >
              {expanded ? '접기' : `더 보기 (${options.length})`}
            </button>
          ) : null}
        </div>

        <div className="filter-chip-list">
          {visibleOptions.map((option) => (
            <button
              key={`${title}-${option}`}
              type="button"
              className={`filter-chip ${selected.includes(option) ? 'active' : ''}`}
              onClick={() => toggleFilter(option, selected, setter)}
              aria-pressed={selected.includes(option)}
              data-group={keyName}
            >
              <span className="filter-chip-check">✓</span>
              {option}
            </button>
          ))}
        </div>

        {collapsible && hiddenCount > 0 && !expanded ? (
          <p className="filter-group-more-hint">{hiddenCount}개 항목이 더 있습니다.</p>
        ) : null}
      </section>
    );
  };

  return (
    <div className={`filter-page slide-up ${selectedCard ? 'modal-open' : ''}`}>
      <div className="filter-header">
        <div>
          <h2>필터 탐색기</h2>
          <p>시리즈, 레어도, 종류, 상태 조합으로 원하는 카드만 빠르게 찾을 수 있습니다.</p>
        </div>
        <div className="filter-header-stats">
          <span className="badge-number">결과 {filteredCards.length}장</span>
          <span className="badge-number">전체 {cards.length}장</span>
        </div>
      </div>

      <div className="filter-toolbar">
        <input
          type="text"
          className="search-input compact"
          placeholder="이름/시리즈/번호/도감번호 검색"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select className="sort-select compact" value={sortField} onChange={(e) => setSortField(e.target.value)}>
          <option value="cardName">이름</option>
          <option value="series">시리즈</option>
          <option value="rarity">레어도</option>
          <option value="type">종류</option>
          <option value="status">상태</option>
          <option value="pokedexNumber">도감번호</option>
          <option value="createdAt">등록일</option>
        </select>
        <select className="sort-select compact" value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
          <option value="asc">오름차순</option>
          <option value="desc">내림차순</option>
        </select>
        <button type="button" className="btn btn-secondary btn-compact" onClick={clearAllFilters}>필터 초기화</button>
      </div>

      <section className="selected-filter-summary" aria-live="polite">
        <div className="selected-filter-head">
          <h3>선택된 필터</h3>
          <span className="badge-number">{selectedSummary.length}개</span>
        </div>
        {selectedSummary.length ? (
          <div className="selected-filter-chip-list">
            {selectedSummary.map((item) => (
              <button
                key={`${item.group}-${item.value}`}
                type="button"
                className="selected-filter-chip"
                onClick={() => removeSelectedFilter(item.group, item.value)}
                title="클릭해서 해제"
              >
                {item.label}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="selected-filter-empty">선택된 필터가 없습니다.</p>
        )}
      </section>

      <div className="filter-layout">
        <aside className="filter-panel">
          {renderFilterGroup({
            keyName: 'series',
            title: '시리즈',
            options: optionSets.series,
            selected: seriesFilter,
            setter: setSeriesFilter,
            collapsible: true,
            expanded: seriesExpanded,
            onToggleExpanded: () => setSeriesExpanded((prev) => !prev),
          })}
          {renderFilterGroup({ keyName: 'rarity', title: '레어도', options: optionSets.rarity, selected: rarityFilter, setter: setRarityFilter })}
          {renderFilterGroup({ keyName: 'type', title: '종류', options: optionSets.type, selected: typeFilter, setter: setTypeFilter })}
          {renderFilterGroup({ keyName: 'status', title: '상태', options: optionSets.status, selected: statusFilter, setter: setStatusFilter })}
        </aside>

        <section className="filter-results">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>카드 데이터 로딩 중...</p>
            </div>
          ) : (
            <div className="card-grid filter-card-grid">
              {filteredCards.map((card) => (
                <article
                  key={card.id}
                  className="card-item filter-editable-card"
                  onClick={() => openModal(card)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openModal(card);
                    }
                  }}
                  title="클릭해서 카드 상세 수정"
                >
                  <div className="card-image-wrapper">
                    {card.imageUrl ? (
                      <img src={card.imageUrl} alt={card.cardName || 'card'} loading="lazy" />
                    ) : (
                      <div className="no-image-wrapper">
                        <img src="/placeholder.png" alt="placeholder" className="placeholder-img" />
                        <div className="placeholder-text">이미지<br />필요</div>
                      </div>
                    )}
                    {card.rarity ? <span className="card-rarity">{card.rarity}</span> : null}
                    <span className="filter-card-edit-hint">클릭 수정</span>
                  </div>
                  <div className="card-info">
                    <h3 className="card-name" title={card.cardName}>{card.cardName || '이름 없음'}</h3>
                    <div className="card-meta">
                      <span className="badge-series">{card.series || '-'}</span>
                      <span className="badge-number">No.{card.cardNumber || '-'}</span>
                      <span className="badge-number">도감 {card.pokedexNumber || '-'}</span>
                    </div>
                    <div className="card-bottom">
                      <span className={`card-status ${String(card.status || '미보유').replace(/\s+/g, '-')}`}>{card.status || '미보유'}</span>
                    </div>
                  </div>
                </article>
              ))}
              {!filteredCards.length && <div className="empty-results">선택한 필터에 맞는 카드가 없습니다.</div>}
            </div>
          )}
        </section>
      </div>

      <CardDetailModal 
        isOpen={!!selectedCard}
        card={selectedCard}
        appConfig={appConfig}
        onClose={() => setSelectedCard(null)}
        onSave={handleModalSave}
        onDelete={handleModalDelete}
      />
    </div>
  );
}
