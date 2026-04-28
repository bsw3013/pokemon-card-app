import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { collection, deleteDoc, doc, getDocs, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeStatus } from '../utils/statusUtils';
import { normalizePokedexNumber } from '../utils/numberUtils';
import { formatCardPayload } from '../utils/cardUtils';
import { useThumbnailSettings } from '../hooks/useThumbnailSettings';
import { useMultiSort } from '../hooks/useMultiSort';
import { sortCards } from '../utils/sortUtils';
import { compareText } from '../utils/stringUtils';
import ThumbnailSettings from './ThumbnailSettings';
import CardDetailModal from './CardDetailModal';
import CardThumbnail from './CardThumbnail';
import MultiSortPanel from './MultiSortPanel';

function normalize(value) {
  return String(value || '').trim();
}

const getFlagEmoji = (lang) => {
  if (!lang) return '🇰🇷';
  if (lang.includes('한국')) return '🇰🇷';
  if (lang.includes('일본')) return '🇯🇵';
  if (lang.includes('미국') || lang.includes('영')) return '🇺🇸';
  if (lang.includes('중국')) return '🇨🇳';
  return '🇰🇷';
};

const getStatusClass = (status) => {
  if (!status || status.includes('미보유')) return 'unowned';
  if (status.includes('등급')) return 'graded';
  return 'owned';
};


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
  const { settings: thumbSettings, toggleSetting: toggleThumbSetting } = useThumbnailSettings();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState([]);
  const SERIES_VISIBLE_COUNT = 12;
  const [selectedCard, setSelectedCard] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const {
    sortLevels,
    handleLevelFieldChange,
    toggleLevelDir,
    toggleLevelEnabled,
    resetSortLevels,
    persistSortLevels,
  } = useMultiSort();
  
  const [gridColumns, setGridColumns] = useState(() => {
    try { return parseInt(localStorage.getItem('filterExplorer_gridColumns_v1')) || 6; } catch { return 6; }
  });

  useEffect(() => {
    try { localStorage.setItem('filterExplorer_gridColumns_v1', gridColumns); } catch {}
  }, [gridColumns]);

  const [seriesFilter, setSeriesFilter] = useState([]);
  const [rarityFilter, setRarityFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [languageFilter, setLanguageFilter] = useState([]);
  const [seriesExpanded, setSeriesExpanded] = useState(false);

  const fetchCards = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const optionSets = useMemo(() => {
    const fromCards = {
      series: new Set(),
      rarity: new Set(),
      type: new Set(),
      status: new Set(),
      language: new Set(),
    };

    cards.forEach((card) => {
      const s = normalize(card.series);
      const r = normalize(card.rarity);
      const t = normalize(card.type);
      const st = normalize(card.status);
      const l = normalize(card.language || '한국');
      if (s) fromCards.series.add(s);
      if (r) fromCards.rarity.add(r);
      if (t) fromCards.type.add(t);
      if (st) fromCards.status.add(st);
      if (l) fromCards.language.add(l);
    });

    return {
      series: mergeByMasterOrder(appConfig?.seriesOptions, fromCards.series),
      rarity: mergeByMasterOrder(appConfig?.rarityOptions, fromCards.rarity),
      type: mergeByMasterOrder(appConfig?.typeOptions, fromCards.type),
      status: mergeByMasterOrder(appConfig?.statusOptions, fromCards.status),
      language: mergeByMasterOrder(['한국', '일본', '영어'], fromCards.language),
    };
  }, [cards, appConfig]);

  const toggleFilter = (value, selected, setter) => {
    setter(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setSeriesFilter([]);
    setRarityFilter([]);
    setTypeFilter([]);
    setStatusFilter([]);
    setLanguageFilter([]);
  };

  const openModal = (card) => {
    setSelectedCard(card);
  };

  const handleModalSave = async (payload) => {
    if (!selectedCard?.id) return;

    const updatePayload = formatCardPayload(payload);

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

  const handleModalDuplicate = async (payload) => {
    try {
      const duplicatePayload = formatCardPayload(payload);
      const ref = await addDoc(collection(db, 'pokemon_cards'), duplicatePayload);
      setCards((prev) => [{ id: ref.id, ...duplicatePayload, status: normalizeStatus(duplicatePayload.status) }, ...prev]);
      setSelectedCard(null);
    } catch (err) {
      console.error('filter explorer duplicate error', err);
      alert('복제 중 오류가 발생했습니다.');
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





  const removeSelectedFilter = (group, value) => {
    if (group === 'series') setSeriesFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'rarity') setRarityFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'type') setTypeFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'status') setStatusFilter((prev) => prev.filter((v) => v !== value));
    if (group === 'language') setLanguageFilter((prev) => prev.filter((v) => v !== value));
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
      const language = normalize(card.language || '한국');

      if (seriesFilter.length && !seriesFilter.includes(series)) return false;
      if (rarityFilter.length && !rarityFilter.includes(rarity)) return false;
      if (typeFilter.length && !typeFilter.includes(type)) return false;
      if (statusFilter.length && !statusFilter.includes(status)) return false;
      if (languageFilter.length && !languageFilter.includes(language)) return false;

      if (!keyword) return true;

      const haystack = [
        normalize(card.cardName),
        series,
        normalize(card.cardNumber),
        normalize(card.pokedexNumber),
        rarity,
        type,
        status,
        language,
      ].join(' ').toLowerCase();

      return haystack.includes(keyword);
    });

    // Multi-level sorting: use sortUtils
    const activeLevels = sortLevels.filter(l => l.enabled && l.field);
    return sortCards(result, activeLevels, appConfig);
  }, [
    cards,
    searchTerm,
    sortLevels,
    seriesFilter,
    rarityFilter,
    typeFilter,
    statusFilter,
    languageFilter,
  ]);

  const selectedSummary = useMemo(() => {
    return [
      ...seriesFilter.map((value) => ({ group: 'series', label: `시리즈: ${value}`, value })),
      ...rarityFilter.map((value) => ({ group: 'rarity', label: `레어도: ${value}`, value })),
      ...typeFilter.map((value) => ({ group: 'type', label: `종류: ${value}`, value })),
      ...statusFilter.map((value) => ({ group: 'status', label: `상태: ${value}`, value })),
      ...languageFilter.map((value) => ({ group: 'language', label: `국가: ${value}`, value })),
    ];
  }, [seriesFilter, rarityFilter, typeFilter, statusFilter, languageFilter]);

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
        <div style={{ position: 'relative' }}>
          <button 
            type="button"
            className="btn btn-secondary btn-compact" 
            onClick={() => setSortPanelOpen(p => !p)}
          >
            정렬 설정
          </button>
          
          {sortPanelOpen && (
            <MultiSortPanel
              sortLevels={sortLevels}
              handleLevelFieldChange={handleLevelFieldChange}
              toggleLevelDir={toggleLevelDir}
              toggleLevelEnabled={toggleLevelEnabled}
              resetSortLevels={resetSortLevels}
              onClose={() => setSortPanelOpen(false)}
              align="left"
            />
          )}
        </div>
        <button type="button" className="btn btn-secondary btn-compact" onClick={clearAllFilters}>필터 초기화</button>
        <button type="button" className="btn btn-outline btn-compact" onClick={fetchCards} disabled={loading}>{loading ? '로딩중...' : '🔄 데이터 새로고침'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.05)', padding: '0.3rem 0.8rem', borderRadius: '999px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>가로칸수:</span>
          <input type="number" min="2" max="12" value={gridColumns} onChange={(e) => setGridColumns(Number(e.target.value) || 6)} style={{ width: '36px', background: 'transparent', border: 'none', color: 'white', outline: 'none', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem' }} />
        </div>
        <ThumbnailSettings settings={thumbSettings} toggleSetting={toggleThumbSetting} />
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
          {renderFilterGroup({ keyName: 'language', title: '국가', options: optionSets.language, selected: languageFilter, setter: setLanguageFilter })}
        </aside>

        <section className="filter-results">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>카드 데이터 로딩 중...</p>
            </div>
          ) : (
            <div className="card-grid filter-card-grid fade-in" style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}>
              {filteredCards.map((card) => (
                <article
                  key={card.id}
                  className={`card-item filter-editable-card ${thumbSettings.hoverMode ? 'hover-mode-active' : ''}`}
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
                  <div className={`card-image-wrapper ${(card.status === '미보유' || !card.status) ? 'filter-grayscale' : ''}`}>
                    <CardThumbnail imageUrl={card.imageUrl} alt={card.cardName || 'card'} type="grid" />
                    {card.rarity ? <span className="card-rarity">{card.rarity}</span> : null}
                    <span className="filter-card-edit-hint">클릭 수정</span>
                  </div>
                  <div className="card-info">
                    {thumbSettings.showName && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className={`status-dot ${getStatusClass(card.status)}`} title={card.status}></span>
                            <h3 className="card-name" style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }} title={card.cardName}>{card.cardName || '이름 없음'}</h3>
                         </div>
                         <span className="country-flag" title={card.language || '한국'}>{getFlagEmoji(card.language)}</span>
                      </div>
                    )}
                    <div className="card-meta">
                      {thumbSettings.showSeries && <span className="badge-series">{card.series || '-'}</span>}
                      {thumbSettings.showNumber && <span className="badge-number">No.{card.cardNumber || '-'}</span>}
                      {thumbSettings.showNumber && <span className="badge-number">도감 {card.pokedexNumber || '-'}</span>}
                      {thumbSettings.showRarity && <span className="badge-series">{card.rarity || '-'}</span>}
                    </div>
                    {thumbSettings.showPrice && (
                       <div className="card-footer" style={{ marginTop: 'auto' }}>
                          <span className="card-price" style={{ fontWeight: 'bold', color: 'var(--accent-color)' }}>
                             {card.price ? `${card.price.toLocaleString()}원` : '-'}
                          </span>
                       </div>
                    )}
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
        onDuplicate={handleModalDuplicate}
      />
    </div>
  );
}
