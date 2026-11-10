import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { useThumbnailSettings } from '../hooks/useThumbnailSettings';
import { useCardDetail } from '../hooks/useCardDetail';
import { DEFAULT_RARITIES, DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { cardLanguage, gradedInfo, langShort, ownedCount, parsePossessions } from '../utils/cardStats';
import { cardIdFromKey, resolveLegacyCardKey } from '../utils/cardKey';
import { rarityTone } from '../utils/rarityTone';
import { navigate, parseHash, setHashParams } from '../utils/hashRoute';
import CardTile from '../components/CardTile';
import CardThumbnail from '../components/CardThumbnail';
import ThumbnailSettings from '../components/ThumbnailSettings';

const text = (v) => String(v ?? '').trim();
const won = (n) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const TABS = [
  ['cards', '보유 카드'],
  ['sets', '세트 완성률'],
  ['rarity', '레어도별'],
  ['watch', '관심 카드'],
];
const FILTERS = [
  ['all', '전체'],
  ['multi', '2장 이상'],
  ['graded', '등급 카드'],
  ['trade', '판매·교환 가능'],
  ['nodata', '기록 없음'],
];
// 정렬 목록 (종류별로 묶어서 보여줌)
const SORT_GROUPS = [
  ['가격', [['value', '평가액 높은순'], ['value_asc', '평가액 낮은순'], ['purchase', '구매가 높은순']]],
  ['날짜', [['recent', '최근 구매순'], ['release', '발매일 최신순'], ['release_asc', '발매일 오래된순']]],
  ['카드 정보', [['set_no', '세트·카드번호순'], ['rarity', '레어도 높은순'], ['dex', '도감번호순'], ['name', '이름순 (가나다)']]],
  ['수량·종류', [['count', '많이 가진 순'], ['graded_first', '등급 카드 먼저']]],
];
const SORT_KEYS = SORT_GROUPS.flatMap(([, items]) => items.map(([k]) => k));
const readLS = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그대로 동작 */ } };

// 카드 한 장의 보유 요약
function summarize(card) {
  const rows = parsePossessions(card.possessions);
  const count = ownedCount(card);
  const graded = gradedInfo(card).count;
  const trade = rows.some((r) => r.forTrade);
  const purchase = rows.reduce((s, r) => s + (Number(r.purchasePrice) || 0) * (Number(r.count) || 0), 0);
  const purchasedCount = rows.filter((r) => Number(r.purchasePrice) > 0).reduce((s, r) => s + (Number(r.count) || 0), 0);
  const lastBought = rows.map((r) => text(r.purchaseDate)).filter(Boolean).sort().pop() || '';
  const maxPurchase = rows.reduce((m, r) => Math.max(m, Number(r.purchasePrice) || 0), 0);
  const price = Number(card.price) || 0;
  const value = price * count;
  // 손익은 평가 가격과 구매가가 둘 다 있는 장만 비교한다.
  const paired = price > 0 ? rows.filter((r) => Number(r.purchasePrice) > 0) : [];
  const pairedCount = paired.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const pairedCost = paired.reduce((s, r) => s + (Number(r.purchasePrice) || 0) * (Number(r.count) || 0), 0);
  return { lang: langShort(cardLanguage(card)), count, graded, trade, purchase, purchasedCount, lastBought, maxPurchase, value, pairedCount, pairedCost, pairedValue: price * pairedCount, hasRows: rows.length > 0 };
}

export default function CollectionPage({ appConfig, onViewMarket }) {
  const { user } = useAuth();
  const { cards, loading, catalog } = useOwnedCards();
  const { settings, toggleSetting, updateSettings } = useThumbnailSettings();
  const detail = useCardDetail({ appConfig, onViewMarket });
  const [tab, setTab] = useState(() => (TABS.some(([k]) => k === parseHash().params.tab) ? parseHash().params.tab : 'cards'));
  const [filter, setFilter] = useState('all');
  const [lang, setLang] = useState('all');
  const [sort, setSort] = useState(() => { const v = readLS('collection_sort_v1', 'value'); return SORT_KEYS.includes(v) ? v : 'value'; });
  useEffect(() => writeLS('collection_sort_v1', sort), [sort]);
  const [watchlist, setWatchlist] = useState(null);

  const selectTab = (k) => { setTab(k); setHashParams({ tab: k === 'cards' ? null : k }, { replace: true }); };

  const setIndex = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const rarityOrder = useMemo(() => new Map((catalog?.rarities || DEFAULT_RARITIES).map((r) => [text(r.code), Number(r.order) || 0])), [catalog]);
  const owned = useMemo(() => cards
    .map((card) => {
      const set = findSetForCard(card, setIndex);
      return {
        card, set, ...summarize(card),
        release: text(set?.releaseDate),
        no: Number(card.cardNo ?? parseCardNo(card.cardNumber)) || 0,
        rarityRank: rarityOrder.get(text(card.rarity)) || 0,
      };
    })
    .filter((x) => x.count > 0), [cards, setIndex, rarityOrder]);

  const totals = useMemo(() => {
    const t = { kinds: owned.length, count: 0, graded: 0, value: 0, purchase: 0, purchasedCount: 0, unpriced: 0, trade: 0, gradedKinds: 0, pairedCount: 0, pairedCost: 0, pairedValue: 0 };
    owned.forEach((x) => {
      t.count += x.count; t.graded += x.graded; t.value += x.value; t.purchase += x.purchase; t.purchasedCount += x.purchasedCount;
      t.pairedCount += x.pairedCount; t.pairedCost += x.pairedCost; t.pairedValue += x.pairedValue;
      if (!Number(x.card.price)) t.unpriced += 1;
      if (x.trade) t.trade += 1;
      if (x.graded > 0) t.gradedKinds += 1;
    });
    return t;
  }, [owned]);

  const list = useMemo(() => {
    const f = owned.filter((x) => (lang === 'all' || x.lang === lang) && (
      filter === 'multi' ? x.count >= 2
        : filter === 'graded' ? x.graded > 0
          : filter === 'trade' ? x.trade
            : filter === 'nodata' ? !x.hasRows
              : true));
    // 같은 값이면 발매일 최신 → 세트 → 카드 번호 순으로 정리
    const tie = (a, b) => b.release.localeCompare(a.release) || text(a.set?.code).localeCompare(text(b.set?.code)) || a.no - b.no;
    const cmp = {
      value: (a, b) => b.value - a.value || b.count - a.count || tie(a, b),
      value_asc: (a, b) => (a.value || Infinity) - (b.value || Infinity) || tie(a, b),
      purchase: (a, b) => b.maxPurchase - a.maxPurchase || tie(a, b),
      recent: (a, b) => b.lastBought.localeCompare(a.lastBought) || tie(a, b),
      release: tie,
      release_asc: (a, b) => a.release.localeCompare(b.release) || text(a.set?.code).localeCompare(text(b.set?.code)) || a.no - b.no,
      set_no: (a, b) => b.release.localeCompare(a.release) || text(a.set?.code || a.card.series).localeCompare(text(b.set?.code || b.card.series)) || a.no - b.no,
      rarity: (a, b) => b.rarityRank - a.rarityRank || tie(a, b),
      dex: (a, b) => ((Number(a.card.pokedexNumber) || 99999) - (Number(b.card.pokedexNumber) || 99999)) || tie(a, b),
      name: (a, b) => text(a.card.cardName).localeCompare(text(b.card.cardName), 'ko') || tie(a, b),
      count: (a, b) => b.count - a.count || tie(a, b),
      graded_first: (a, b) => (b.graded > 0) - (a.graded > 0) || b.graded - a.graded || tie(a, b),
    }[sort] || tie;
    return f.sort(cmp);
  }, [owned, filter, sort, lang]);

  // 언어판별 보유 종류 수 (한판·일판·영문판·중국판)
  const langCounts = useMemo(() => {
    const m = new Map();
    owned.forEach((x) => m.set(x.lang, (m.get(x.lang) || 0) + 1));
    return ['한판', '일판', '영문판', '중국판'].filter((l) => m.get(l)).map((l) => [l, m.get(l)])
      .concat([...m.entries()].filter(([l]) => !['한판', '일판', '영문판', '중국판'].includes(l)));
  }, [owned]);

  // 세트별 완성률 (보유한 세트만, 완성률 높은 순)
  const setRows = useMemo(() => {
    const m = new Map();
    cards.forEach((card) => {
      const s = findSetForCard(card, setIndex);
      if (!s) return;
      const v = m.get(s.code) || { set: s, total: 0, owned: 0 };
      v.total += 1;
      if (ownedCount(card) > 0) v.owned += 1;
      m.set(s.code, v);
    });
    return [...m.values()].filter((v) => v.owned > 0).sort((a, b) => (b.owned / b.total) - (a.owned / a.total) || b.owned - a.owned);
  }, [cards, setIndex]);

  const rarityRows = useMemo(() => {
    const order = new Map((catalog?.rarities || DEFAULT_RARITIES).map((r) => [text(r.code), Number(r.order) || 0]));
    const m = new Map();
    cards.forEach((card) => {
      const r = text(card.rarity) || '미분류';
      const v = m.get(r) || { rarity: r, total: 0, owned: 0, copies: 0 };
      v.total += 1;
      const c = ownedCount(card);
      if (c > 0) { v.owned += 1; v.copies += c; }
      m.set(r, v);
    });
    return [...m.values()].sort((a, b) => (order.get(b.rarity) || 0) - (order.get(a.rarity) || 0));
  }, [cards, catalog]);

  // 관심 카드 (시세 화면에서 등록한 목록)
  useEffect(() => {
    if (tab !== 'watch' || !user || watchlist !== null) return undefined;
    let cancelled = false;
    getDocs(query(collection(db, 'marketWatchlist'), where('ownerId', '==', user.uid)))
      .then((snap) => { if (!cancelled) setWatchlist(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch((err) => { console.error('관심 카드 로드 실패', err); if (!cancelled) setWatchlist([]); });
    return () => { cancelled = true; };
  }, [tab, user, watchlist]);

  const gain = totals.pairedCount > 0 ? totals.pairedValue - totals.pairedCost : null;

  return (
    <main className="page col">
      <div className="page-head">
        <div>
          <h1>내 컬렉션</h1>
          <p className="sub">내가 가진 카드와 평가액, 세트 완성률을 한눈에 봐요.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(['album'])}>앨범 꾸미기</button>
      </div>

      <section className="kpis">
        <div className="kpi"><span>보유 종류</span><strong>{totals.kinds.toLocaleString()}<em>종</em></strong><small>전체 {cards.length.toLocaleString()}종 중 {cards.length ? Math.round((totals.kinds / cards.length) * 100) : 0}%</small></div>
        <div className="kpi"><span>총 장수</span><strong>{totals.count.toLocaleString()}<em>장</em></strong><small>등급 카드 {totals.graded}장</small></div>
        <div className="kpi"><span>평가액</span><strong>{won(totals.value)}</strong><small>{totals.unpriced > 0 ? `평가 가격 없는 카드 ${totals.unpriced}종` : '내가 적은 평가 가격 × 장수'}</small></div>
        <div className="kpi"><span>구매가 대비</span>
          {gain === null ? <><strong className="muted">-</strong><small>{totals.purchasedCount > 0 ? '구매가를 적은 카드에 평가 가격도 적으면 손익이 보여요' : '보유 기록에 구매가를 적으면 손익이 보여요'}</small></>
            : <><strong className={gain >= 0 ? 'up' : 'down'}>{gain >= 0 ? '+' : '-'}{won(Math.abs(gain))}</strong><small>구매가 {won(totals.pairedCost)} → 평가 {won(totals.pairedValue)} ({totals.pairedCount}장 기준)</small></>}
        </div>
      </section>

      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => selectTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'cards' && (
        <>
          <div className="cp-toolbar">
            <div className="seg">
              {FILTERS.map(([k, l]) => (
                <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {l}{k === 'trade' && totals.trade ? ` ${totals.trade}` : ''}{k === 'graded' && totals.gradedKinds ? ` ${totals.gradedKinds}` : ''}
                </button>
              ))}
            </div>
            <div className="tools">
              {langCounts.length > 1 && (
                <div className="seg" aria-label="언어판">
                  <button type="button" className={lang === 'all' ? 'on' : ''} onClick={() => setLang('all')}>모든 언어</button>
                  {langCounts.map(([l, n]) => (
                    <button key={l} type="button" className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l} {n}</button>
                  ))}
                </div>
              )}
              <span className="count">{list.length.toLocaleString()}종</span>
              <span className="sort-label">정렬</span>
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                {SORT_GROUPS.map(([g, items]) => (
                  <optgroup key={g} label={g}>
                    {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </optgroup>
                ))}
              </select>
              <ThumbnailSettings settings={settings} toggleSetting={toggleSetting} updateSettings={updateSettings} hide={['showPrice']} />
            </div>
          </div>
          {loading ? <div className="cp-empty">불러오는 중...</div> : list.length === 0 ? (
            <div className="cp-empty">
              {owned.length === 0 ? <>아직 기록한 카드가 없어요. <button type="button" className="link-btn" onClick={() => navigate(['cards'])}>카드 화면</button>에서 카드를 눌러 보유 정보를 기록해 보세요.</> : '조건에 맞는 카드가 없습니다.'}
            </div>
          ) : (
            <div className="card-grid ctile-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {list.map(({ card, value, count }) => (
                <div key={card.id} className="col-item">
                  <CardTile card={card} settings={{ ...settings, showPrice: false }} onClick={() => detail.openCard(card)} />
                  {value > 0 && <div className="col-value">{won(value)}{count > 1 ? <small> ({won(card.price)} × {count})</small> : null}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'sets' && (
        <div className="col-sets">
          {setRows.length === 0 && <div className="cp-empty">아직 모으는 세트가 없습니다.</div>}
          {setRows.map(({ set, total, owned: o }) => {
            const pct = Math.round((o / total) * 100);
            return (
              <button key={set.code} type="button" className="col-set" onClick={() => navigate(['sets', set.code])}>
                <span className="sp-code">{set.code}</span>
                <span className="col-set-body">
                  <span className="col-set-top"><b>{set.name}</b><span>{o}/{total} · {pct}%</span></span>
                  <span className="bar"><i style={{ width: `${pct}%` }} /></span>
                  <span className="sp-meta">{set.era} · {set.kind}{pct === 100 ? ' · 완성!' : total - o <= 3 ? ` · ${total - o}장 남음` : ''}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'rarity' && (
        <div className="cp-table-wrap">
          <table className="cp-table col-rarity">
            <thead><tr><th>레어도</th><th className="num">보유 종류</th><th className="num">전체</th><th className="num">장수</th><th>진행</th></tr></thead>
            <tbody>
              {rarityRows.map((r) => {
                const pct = r.total ? Math.round((r.owned / r.total) * 100) : 0;
                return (
                  <tr key={r.rarity} onClick={() => navigate(['cards'], { rarity: r.rarity === '미분류' ? '__none__' : r.rarity, owned: 'owned' })}>
                    <td><span className={`rar-badge ${rarityTone(r.rarity)}`}>{r.rarity}</span></td>
                    <td className="num">{r.owned}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.copies}</td>
                    <td className="col-bar"><span className="bar"><i style={{ width: `${pct}%` }} /></span><span className="pct">{pct}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'watch' && (
        <div>
          <div className="cp-toolbar">
            <p className="sub" style={{ margin: 0 }}>시세 화면에서 "관심카드"로 등록한 카드예요.</p>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate(['market'])}>시세 화면에서 관리</button>
          </div>
          {watchlist === null ? <div className="cp-empty">불러오는 중...</div> : watchlist.length === 0 ? (
            <div className="cp-empty">아직 관심 카드가 없어요.</div>
          ) : (
            <ul className="col-watch">
              {watchlist.map((w) => {
                const card = cards.find((c) => c.id === (cardIdFromKey(w.cardKey) || resolveLegacyCardKey(w.cardKey, cards)));
                return (
                  <li key={w.id}>
                    <button type="button" onClick={() => (card ? detail.openCard(card) : navigate(['market']))}>
                      <span className="col-watch-img"><CardThumbnail imageUrl={card?.imageUrl || w.imageUrl} alt="" type="grid" /></span>
                      <span className="col-watch-body">
                        <b>{card?.cardName || w.cardName}</b>
                        <span className="sp-meta">{card ? (findSetForCard(card, setIndex)?.name || card.series) : w.series} · {card?.cardNumber || w.cardNumber || ''}</span>
                        {card && ownedCount(card) > 0 && <span className="col-badge">보유 중</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {detail.modal}
    </main>
  );
}
