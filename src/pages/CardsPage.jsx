import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { useThumbnailSettings } from '../hooks/useThumbnailSettings';
import { useCardDetail } from '../hooks/useCardDetail';
import { DEFAULT_RARITIES, DEFAULT_SETS, ERA_OPTIONS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { activeRows, copyBreakdown, isForSale, isPulledCopy, langShort } from '../utils/cardStats';
import { rarityTone } from '../utils/rarityTone';
import { navigate, parseHash } from '../utils/hashRoute';
import CardTile from '../components/CardTile';
import CardThumbnail from '../components/CardThumbnail';
import ThumbnailSettings from '../components/ThumbnailSettings';
import Icon from '../components/Icon';
import SortControl from '../components/SortControl';
import { useMarketIndex } from '../hooks/useMarketIndex';
import { cardMarketValue, representativePrice } from '../utils/marketPrice';
import { readSort, sortItems, writeSort } from '../utils/sortCards';

const PAGE = 120;
const NONE = '__none__';
const LANGS = ['한국', '일본', '미국', '중국'];
// 카드 화면에서 고를 수 있는 정렬 기준 (방향은 버튼으로 따로 바꾼다)
const SORT_FIELD_KEYS = ['release', 'price', 'purchase', 'bought', 'pulled', 'rarity', 'dex', 'name', 'count', 'graded'];
const SIZES = { s: 118, m: 150, l: 190 };

const text = (v) => String(v ?? '').trim();
const readLS = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그대로 동작 */ } };

function splitList(value) {
  return text(value).split(',').map((s) => s.trim()).filter(Boolean);
}

// "카드" 화면: 예전 "도감 갤러리"와 "필터 탐색기"를 하나로 합친 화면.
// 앨범 꾸미기의 카드 고르기(isPicker)에서도 같은 화면을 쓴다.
export default function CardsPage({ appConfig, onViewMarket, isPicker = false, onSelectCards, onClose }) {
  const { user, isAdmin } = useAuth();
  const { cards, loading, catalog } = useOwnedCards();
  const { settings: thumbSettings, toggleSetting, updateSettings } = useThumbnailSettings();
  const detail = useCardDetail({ appConfig, onViewMarket });

  const initial = useMemo(() => (isPicker ? { params: {} } : parseHash()), [isPicker]);
  const [query, setQuery] = useState(initial.params.q || '');
  const [owned, setOwned] = useState(initial.params.owned || 'all');
  const [setFilter, setSetFilter] = useState(() => splitList(initial.params.set));
  const [rarityFilter, setRarityFilter] = useState(() => splitList(initial.params.rarity));
  const [typeFilter, setTypeFilter] = useState([]);
  const [langFilter, setLangFilter] = useState([]);
  const [openEras, setOpenEras] = useState(() => new Set(['메가']));
  const [sort, setSort] = useState(() => readSort('cards_sort_v2', SORT_FIELD_KEYS, { field: 'release', dir: 'desc' }));
  const [view, setView] = useState(() => (isPicker ? 'grid' : readLS('cards_view_v1', 'grid')));
  const [size, setSize] = useState(() => readLS('cards_size_v1', 'm'));
  const [visibleState, setVisibleState] = useState({ key: '', n: PAGE });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const sentinelRef = useRef(null);

  useEffect(() => writeSort('cards_sort_v2', sort), [sort]);
  useEffect(() => { if (!isPicker) writeLS('cards_view_v1', view); }, [view, isPicker]);
  useEffect(() => writeLS('cards_size_v1', size), [size]);

  // 상단 검색창이나 세트 화면에서 #/cards?q=…, ?set=… 로 들어오면 그 조건으로 새로 거른다.
  // 적용한 뒤에는 주소에서 지워서, 카드 창을 열고 닫을 때 다시 적용되지 않게 한다.
  useEffect(() => {
    if (isPicker) return undefined;
    const KEYS = ['q', 'set', 'rarity', 'owned'];
    const apply = () => {
      const { path, params } = parseHash();
      if (path[0] !== 'cards' || !KEYS.some((k) => params[k] !== undefined)) return;
      setQuery(params.q || '');
      setSetFilter(splitList(params.set));
      setRarityFilter(splitList(params.rarity));
      setOwned(params.owned || 'all');
      setTypeFilter([]);
      setLangFilter([]);
      const rest = Object.fromEntries(Object.entries(params).filter(([k]) => !KEYS.includes(k)));
      navigate(['cards'], rest, { replace: true });
    };
    window.addEventListener('hashchange', apply);
    apply();
    return () => window.removeEventListener('hashchange', apply);
  }, [isPicker]);

  const sets = useMemo(() => catalog?.sets || DEFAULT_SETS, [catalog]);
  const setIndex = useMemo(() => buildSetIndex(sets), [sets]);
  const rarities = useMemo(() => catalog?.rarities || DEFAULT_RARITIES, [catalog]);
  const rarityInfo = useMemo(() => new Map(rarities.map((r) => [text(r.code), r])), [rarities]);

  // 카드마다 세트를 한 번만 찾아 둔다.
  const marketIndex = useMarketIndex();
  const enriched = useMemo(() => cards.map((card) => {
    const set = findSetForCard(card, setIndex);
    const rows = activeRows(card); // 판매완료한 장은 빼고
    const split = copyBreakdown(card);
    // 1장 시세: 내 카드가 있으면 내 카드 종류의 시세만, 없는 카드는 그 언어판 Raw 시세
    const unit = split.total > 0 ? cardMarketValue(marketIndex, card).unit : representativePrice(marketIndex, card);
    return {
      unit,
      graded: split.gradedCount,
      pulled: rows.filter(isPulledCopy).reduce((n, r) => n + (Number(r.count) || 1), 0),
      trade: rows.some(isForSale),
      maxPurchase: rows.reduce((m, r) => Math.max(m, Number(r.purchasePrice) || 0), 0),
      lastBought: rows.map((r) => text(r.purchaseDate)).filter(Boolean).sort().pop() || '',
      card,
      set,
      setCode: set ? set.code : NONE,
      release: set?.releaseDate || '',
      no: card.cardNo ?? parseCardNo(card.cardNumber) ?? 0,
      count: split.total,
      rarityOrder: Number(rarityInfo.get(text(card.rarity))?.order) || 0,
    };
  }), [cards, setIndex, rarityInfo, marketIndex]);

  const setCounts = useMemo(() => {
    const m = new Map();
    enriched.forEach((e) => m.set(e.setCode, (m.get(e.setCode) || 0) + 1));
    return m;
  }, [enriched]);

  const eraGroups = useMemo(() => {
    const byEra = new Map(ERA_OPTIONS.map((e) => [e, []]));
    sets.forEach((s) => {
      if (!setCounts.get(s.code)) return;
      const era = byEra.has(s.era) ? s.era : '기타';
      byEra.get(era).push(s);
    });
    return [...byEra.entries()]
      .map(([era, list]) => [era, list.sort((a, b) => text(b.releaseDate).localeCompare(text(a.releaseDate)))])
      .filter(([, list]) => list.length > 0);
  }, [sets, setCounts]);

  const rarityGroups = useMemo(() => {
    const present = new Set(cards.map((c) => text(c.rarity)).filter(Boolean));
    const groups = [['힛카드', []], ['일반', []], ['기타', []]];
    [...rarities].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).forEach((r) => {
      if (!present.has(text(r.code))) return;
      const g = groups.find(([name]) => name === r.group) || groups[2];
      g[1].push(text(r.code));
    });
    present.forEach((code) => { if (!rarityInfo.has(code)) groups[2][1].push(code); });
    return groups.filter(([, list]) => list.length > 0);
  }, [cards, rarities, rarityInfo]);

  const typeOptions = useMemo(() => {
    const present = new Set(cards.map((c) => text(c.type)).filter(Boolean));
    const ordered = (appConfig?.typeOptions || []).filter((t) => present.has(t));
    present.forEach((t) => { if (!ordered.includes(t)) ordered.push(t); });
    return ordered;
  }, [cards, appConfig]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = enriched.filter((e) => {
      const { card } = e;
      if (owned === 'owned' && e.count === 0) return false;
      if (owned === 'missing' && e.count > 0) return false;
      if (owned === 'multi' && e.count < 2) return false;
      if (owned === 'graded' && !(e.count > 0 && e.graded > 0)) return false;
      if (owned === 'trade' && !(e.count > 0 && e.trade)) return false;
      if (setFilter.length && !setFilter.includes(e.setCode)) return false;
      if (rarityFilter.length && !rarityFilter.includes(text(card.rarity) || NONE)) return false;
      if (typeFilter.length && !typeFilter.includes(text(card.type) || NONE)) return false;
      if (langFilter.length && !langFilter.includes(text(card.language) || '한국')) return false;
      if (!keyword) return true;
      const hay = [card.cardName, card.cardNumber, card.pokedexNumber, card.series, card.rarity, card.type, e.set?.name, e.set?.code]
        .map(text).join(' ').toLowerCase();
      return hay.includes(keyword);
    });
    return sortItems(list, sort.field, sort.dir);
  }, [enriched, query, owned, setFilter, rarityFilter, typeFilter, langFilter, sort]);

  // 조건이 바뀌면 처음부터 다시 조금씩 그린다. (조건마다 따로 개수를 기억)
  const filterKey = JSON.stringify([query, owned, setFilter, rarityFilter, typeFilter, langFilter, sort]);
  const visible = visibleState.key === filterKey ? visibleState.n : PAGE;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        setVisibleState((prev) => ({ key: filterKey, n: (prev.key === filterKey ? prev.n : PAGE) + PAGE }));
      }
    }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, view, filterKey, visible]);

  const toggle = (value, list, setter) => setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const clearAll = () => { setQuery(''); setOwned('all'); setSetFilter([]); setRarityFilter([]); setTypeFilter([]); setLangFilter([]); };
  const setName = (code) => (code === NONE ? '세트 없음' : (sets.find((s) => s.code === code)?.name || code));
  const activeChips = [
    ...(query.trim() ? [{ key: 'q', label: `"${query.trim()}"`, remove: () => setQuery('') }] : []),
    ...(owned !== 'all' ? [{ key: 'owned', label: { owned: '보유', missing: '미보유', graded: '등급 카드', trade: '판매중', multi: '2장 이상' }[owned], remove: () => setOwned('all') }] : []),
    ...setFilter.map((c) => ({ key: `s-${c}`, label: setName(c), remove: () => toggle(c, setFilter, setSetFilter) })),
    ...rarityFilter.map((r) => ({ key: `r-${r}`, label: r === NONE ? '레어도 없음' : r, remove: () => toggle(r, rarityFilter, setRarityFilter) })),
    ...typeFilter.map((t) => ({ key: `t-${t}`, label: t === NONE ? '종류 없음' : t, remove: () => toggle(t, typeFilter, setTypeFilter) })),
    ...langFilter.map((l) => ({ key: `l-${l}`, label: langShort(l), remove: () => toggle(l, langFilter, setLangFilter) })),
  ];
  const ownedTotal = useMemo(() => enriched.filter((e) => e.count > 0).length, [enriched]);
  const shown = filtered.slice(0, visible);

  const filterPanel = (
    <aside className={`cp-filters ${filtersOpen ? 'open' : ''}`} aria-label="필터">
      <div className="cp-filters-mobile-head">
        <strong>필터</strong>
        <button type="button" className="btn btn-secondary btn-compact" onClick={clearAll}>초기화</button>
      </div>
      <label className="cp-search">
        <Icon name="search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름, 번호, 세트 검색" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기">✕</button>}
      </label>

      {user && (
        <section>
          <h3>보유 상태</h3>
          <div className="chips" role="radiogroup" aria-label="보유 상태">
            {[['all', '전체'], ['owned', '보유'], ['missing', '미보유'], ['graded', '등급 카드'], ['trade', '판매중']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={owned === k} className={`chip ${owned === k ? 'on' : ''}`} onClick={() => setOwned(k)}>{l}</button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>세트</h3>
        {eraGroups.map(([era, list]) => {
          const open = openEras.has(era) || list.some((s) => setFilter.includes(s.code));
          const selectedCount = list.filter((s) => setFilter.includes(s.code)).length;
          return (
            <div key={era} className={`f-era ${open ? 'open' : ''}`}>
              <button type="button" className="f-era-head" onClick={() => setOpenEras((prev) => { const n = new Set(prev); if (n.has(era)) n.delete(era); else n.add(era); return n; })} aria-expanded={open}>
                <Icon name={open ? 'down' : 'chevron'} size={14} />
                <span>{era}</span>
                {selectedCount > 0 && <b className="f-sel">{selectedCount}</b>}
                <em>{list.length}</em>
              </button>
              {open && (
                <ul className="f-sets">
                  {list.map((s) => (
                    <li key={s.code}>
                      <label className={setFilter.includes(s.code) ? 'on' : ''}>
                        <input type="checkbox" checked={setFilter.includes(s.code)} onChange={() => toggle(s.code, setFilter, setSetFilter)} />
                        <span className="code">{s.code}</span>
                        <span className="nm">{s.name}</span>
                        <em>{setCounts.get(s.code) || 0}</em>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {setCounts.get(NONE) > 0 && (
          <label className={`f-none ${setFilter.includes(NONE) ? 'on' : ''}`}>
            <input type="checkbox" checked={setFilter.includes(NONE)} onChange={() => toggle(NONE, setFilter, setSetFilter)} />
            세트 없음 <em>{setCounts.get(NONE)}</em>
          </label>
        )}
      </section>

      <section>
        <h3>레어도</h3>
        {rarityGroups.map(([group, list]) => (
          <div key={group} className="f-group">
            <div className="f-group-label">{group}</div>
            <div className="chips">
              {list.map((r) => (
                <button key={r} type="button" className={`chip ${rarityFilter.includes(r) ? 'on' : ''}`} onClick={() => toggle(r, rarityFilter, setRarityFilter)} aria-pressed={rarityFilter.includes(r)}>{r}</button>
              ))}
            </div>
          </div>
        ))}
        <button type="button" className={`chip chip-muted ${rarityFilter.includes(NONE) ? 'on' : ''}`} onClick={() => toggle(NONE, rarityFilter, setRarityFilter)}>레어도 없음</button>
      </section>

      <section>
        <h3>종류</h3>
        <div className="chips">
          {typeOptions.map((t) => (
            <button key={t} type="button" className={`chip ${typeFilter.includes(t) ? 'on' : ''}`} onClick={() => toggle(t, typeFilter, setTypeFilter)}>{t}</button>
          ))}
          <button type="button" className={`chip chip-muted ${typeFilter.includes(NONE) ? 'on' : ''}`} onClick={() => toggle(NONE, typeFilter, setTypeFilter)}>종류 없음</button>
        </div>
      </section>

      {user && (
        <section>
          <h3>언어판</h3>
          <div className="chips">
            {LANGS.map((l) => (
              <button key={l} type="button" className={`chip ${langFilter.includes(l) ? 'on' : ''}`} onClick={() => toggle(l, langFilter, setLangFilter)}>{langShort(l)}</button>
            ))}
          </div>
        </section>
      )}
      <button type="button" className="btn btn-primary cp-filters-done" onClick={() => setFiltersOpen(false)}>결과 {filtered.length.toLocaleString()}장 보기</button>
    </aside>
  );

  return (
    <main className={`page cp ${isPicker ? 'cp-picker' : ''}`}>
      {!isPicker && (
        <div className="page-head">
          <div>
            <h1>카드</h1>
            <p className="sub">전체 {cards.length.toLocaleString()}장{user ? ` · 내가 보유 ${ownedTotal.toLocaleString()}장` : ''}</p>
          </div>
          {isAdmin && <button type="button" className="btn btn-primary" onClick={detail.openNew}>카드 추가</button>}
        </div>
      )}

      <div className="cp-layout">
        {filterPanel}
        {filtersOpen && <div className="cp-backdrop" onClick={() => setFiltersOpen(false)} />}

        <section className="cp-results">
          <div className="cp-toolbar">
            <button type="button" className="btn btn-secondary btn-compact cp-filter-btn" onClick={() => setFiltersOpen(true)}>
              <Icon name="filter" size={15} /> 필터{activeChips.length ? ` ${activeChips.length}` : ''}
            </button>
            <div className="active-filters">
              {activeChips.map((c) => (
                <button key={c.key} type="button" className="af" onClick={c.remove} title="눌러서 빼기">{c.label}<b aria-hidden>×</b></button>
              ))}
              {activeChips.length > 0 && <button type="button" className="af-clear" onClick={clearAll}>모두 지우기</button>}
            </div>
            <div className="tools">
              <span className="count">{loading ? '불러오는 중' : `${filtered.length.toLocaleString()}장`}</span>
              <SortControl fields={SORT_FIELD_KEYS} value={sort} onChange={setSort} />
              {!isPicker && (
                <div className="view" role="group" aria-label="보기 방식">
                  <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="카드로 보기" title="카드로 보기"><Icon name="grid" size={16} /></button>
                  <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} aria-label="표로 보기" title="표로 보기"><Icon name="list" size={16} /></button>
                </div>
              )}
              {view === 'grid' && (
                <div className="view cp-size" role="group" aria-label="카드 크기">
                  {[['s', '작게'], ['m', '보통'], ['l', '크게']].map(([k, l]) => (
                    <button key={k} type="button" className={size === k ? 'on' : ''} onClick={() => setSize(k)} title={`카드 ${l}`}>{l}</button>
                  ))}
                </div>
              )}
              {view === 'grid' && <ThumbnailSettings settings={thumbSettings} toggleSetting={toggleSetting} updateSettings={updateSettings} />}
            </div>
          </div>

          {isPicker && (
            <div className="cp-picker-bar">
              <span>{selectedIds.length}장 선택됨</span>
              <div className="cp-picker-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
                <button type="button" className="btn btn-secondary" disabled={filtered.length === 0} onClick={() => onSelectCards(filtered.map((e) => e.card))}>검색된 {filtered.length}장 모두 추가</button>
                <button type="button" className="btn btn-primary" disabled={selectedIds.length === 0} onClick={() => onSelectCards(selectedIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean))}>선택한 {selectedIds.length}장 추가</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="cp-empty">카드를 불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="cp-empty">조건에 맞는 카드가 없습니다. <button type="button" className="link-btn" onClick={clearAll}>필터 지우기</button></div>
          ) : view === 'grid' ? (
            <div className="card-grid ctile-grid cp-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${SIZES[size] || 150}px, 1fr))` }}>
              {shown.map(({ card }) => (
                <CardTile
                  key={card.id}
                  card={card}
                  settings={thumbSettings}
                  selected={isPicker && selectedIds.includes(card.id)}
                  onClick={() => (isPicker ? toggle(card.id, selectedIds, setSelectedIds) : detail.openCard(card))}
                  overlay={isPicker ? <div className="picker-checkbox">{selectedIds.includes(card.id) ? '✓' : ''}</div> : null}
                />
              ))}
            </div>
          ) : (
            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr><th></th><th>이름</th><th>세트</th><th>번호</th><th>레어도</th><th>종류</th><th>도감</th>{user && <th className="num">보유</th>}<th className="num">시세</th></tr>
                </thead>
                <tbody>
                  {shown.map(({ card, set, no, count, unit }) => (
                    <tr key={card.id} onClick={() => detail.openCard(card)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') detail.openCard(card); }}>
                      <td className="thumb"><CardThumbnail imageUrl={card.imageUrl} alt="" type="table" /></td>
                      <td className="name">{card.cardName || '이름 없음'}</td>
                      <td className="set">{set ? <><span className="code">{set.code}</span> {set.name}</> : (card.series || '-')}</td>
                      <td className="mono">{no ? `${no}${set?.printedTotal ? `/${set.printedTotal}` : ''}` : (card.cardNumber || '-')}</td>
                      <td>{card.rarity ? <span className={`rar-badge ${rarityTone(card.rarity)}`}>{card.rarity}</span> : '-'}</td>
                      <td>{card.type || '-'}</td>
                      <td className="mono">{card.pokedexNumber || '-'}</td>
                      {user && <td className="num">{count ? `${count}장` : '-'}</td>}
                      <td className="num">{unit ? `${unit.toLocaleString()}원` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown.length < filtered.length && <div ref={sentinelRef} className="cp-more">더 불러오는 중… ({shown.length}/{filtered.length})</div>}
        </section>
      </div>
      {!isPicker && detail.modal}
    </main>
  );
}
