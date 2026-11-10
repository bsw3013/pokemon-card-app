import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { useThumbnailSettings } from '../hooks/useThumbnailSettings';
import { useCardDetail } from '../hooks/useCardDetail';
import { DEFAULT_RARITIES, DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { activeRows, cardLanguage, gradedInfo, isForSale, isPulledCopy, langShort, ownedCount, possessionLabel, soldRows } from '../utils/cardStats';
import { cardIdFromKey, resolveLegacyCardKey } from '../utils/cardKey';
import { rarityTone } from '../utils/rarityTone';
import { navigate, parseHash, setHashParams } from '../utils/hashRoute';
import { todayStr } from '../utils/sales';
import CardTile from '../components/CardTile';
import CardThumbnail from '../components/CardThumbnail';
import ThumbnailSettings from '../components/ThumbnailSettings';
import SortControl from '../components/SortControl';
import { readSort, sortItems, writeSort } from '../utils/sortCards';

const text = (v) => String(v ?? '').trim();
const won = (n) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const TABS = [
  ['cards', '보유 카드'],
  ['sets', '세트 완성률'],
  ['rarity', '레어도별'],
  ['sales', '판매'],
  ['watch', '관심 카드'],
];
const FILTERS = [
  ['all', '전체'],
  ['multi', '2장 이상'],
  ['graded', '등급 카드'],
  ['pull', '직뽑'],
  ['trade', '판매중'],
  ['nodata', '기록 없음'],
];
// 내 컬렉션에서 고를 수 있는 정렬 기준 (방향은 버튼으로 따로 바꾼다)
const SORT_FIELD_KEYS = ['value', 'price', 'purchase', 'bought', 'pulled', 'release', 'rarity', 'dex', 'name', 'count', 'graded'];

// 카드 한 장의 보유 요약
function summarize(card) {
  const rows = activeRows(card); // 판매완료한 장은 빼고 계산

  const count = ownedCount(card);
  const graded = gradedInfo(card).count;
  const trade = rows.some(isForSale);
  const pulled = rows.filter(isPulledCopy).reduce((n, r) => n + (Number(r.count) || 1), 0);
  const bought = rows.filter((r) => !isPulledCopy(r)); // 직뽑은 구매가가 없으니 구매·손익 계산에서 뺀다
  const purchase = bought.reduce((s, r) => s + (Number(r.purchasePrice) || 0) * (Number(r.count) || 0), 0);
  const purchasedCount = bought.filter((r) => Number(r.purchasePrice) > 0).reduce((s, r) => s + (Number(r.count) || 0), 0);
  const lastBought = rows.map((r) => text(r.purchaseDate)).filter(Boolean).sort().pop() || '';
  const maxPurchase = rows.reduce((m, r) => Math.max(m, Number(r.purchasePrice) || 0), 0);
  const price = Number(card.price) || 0;
  const value = price * count;
  // 손익은 평가 가격과 구매가가 둘 다 있는 장만 비교한다.
  const paired = price > 0 ? bought.filter((r) => Number(r.purchasePrice) > 0) : [];
  const pairedCount = paired.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const pairedCost = paired.reduce((s, r) => s + (Number(r.purchasePrice) || 0) * (Number(r.count) || 0), 0);
  return { lang: langShort(cardLanguage(card)), count, graded, pulled, trade, purchase, purchasedCount, lastBought, maxPurchase, value, pairedCount, pairedCost, pairedValue: price * pairedCount, hasRows: rows.length > 0 };
}

export default function CollectionPage({ appConfig, onViewMarket }) {
  const { user } = useAuth();
  const { cards, loading, catalog } = useOwnedCards();
  const { settings, toggleSetting, updateSettings } = useThumbnailSettings();
  const detail = useCardDetail({ appConfig, onViewMarket });
  const [tab, setTab] = useState(() => (TABS.some(([k]) => k === parseHash().params.tab) ? parseHash().params.tab : 'cards'));
  const [filter, setFilter] = useState('all');
  const [lang, setLang] = useState('all');
  const [sort, setSort] = useState(() => readSort('collection_sort_v2', SORT_FIELD_KEYS, { field: 'value', dir: 'desc' }));
  useEffect(() => writeSort('collection_sort_v2', sort), [sort]);
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
        setCode: text(set?.code) || '~',
        rarityOrder: rarityOrder.get(text(card.rarity)) || 0,
      };
    })
    .filter((x) => x.count > 0), [cards, setIndex, rarityOrder]);

  const totals = useMemo(() => {
    const t = { kinds: owned.length, count: 0, graded: 0, value: 0, purchase: 0, purchasedCount: 0, unpriced: 0, trade: 0, pullKinds: 0, gradedKinds: 0, pairedCount: 0, pairedCost: 0, pairedValue: 0 };
    owned.forEach((x) => {
      t.count += x.count; t.graded += x.graded; t.value += x.value; t.purchase += x.purchase; t.purchasedCount += x.purchasedCount;
      t.pairedCount += x.pairedCount; t.pairedCost += x.pairedCost; t.pairedValue += x.pairedValue;
      if (!Number(x.card.price)) t.unpriced += 1;
      if (x.trade) t.trade += 1;
      if (x.graded > 0) t.gradedKinds += 1;
      if (x.pulled > 0) t.pullKinds += 1;
    });
    return t;
  }, [owned]);

  const list = useMemo(() => {
    const f = owned.filter((x) => (lang === 'all' || x.lang === lang) && (
      filter === 'multi' ? x.count >= 2
        : filter === 'graded' ? x.graded > 0
          : filter === 'pull' ? x.pulled > 0
          : filter === 'trade' ? x.trade
            : filter === 'nodata' ? !x.hasRows
              : true));
    return sortItems(f, sort.field, sort.dir);
  }, [owned, filter, sort, lang]);

  // 판매: 지금 판매중인 장 + 판매완료 기록 (전부 판 카드도 포함하려고 전체 카드에서 모은다)
  const [salesView, setSalesView] = useState('sold');
  const sales = useMemo(() => {
    const listed = [];
    const done = [];
    const month = todayStr().slice(0, 7); // 이번 달 (내 컴퓨터 날짜 기준)
    const t = { listedCount: 0, askTotal: 0, soldCount: 0, soldTotal: 0, profit: 0, profitCount: 0, monthTotal: 0 };
    cards.forEach((card) => {
      const lang = cardLanguage(card);
      const set = findSetForCard(card, setIndex);
      activeRows(card).filter(isForSale).forEach((row) => {
        const n = Number(row.count) || 1;
        listed.push({ card, set, row, n, label: possessionLabel({ ...row, count: 1 }, lang) });
        t.listedCount += n;
        t.askTotal += (Number(row.askPrice) || 0) * n;
      });
      soldRows(card).forEach((row) => {
        const n = Number(row.count) || 1;
        const total = (Number(row.soldPrice) || 0) * n;
        const profit = Number(row.purchasePrice) > 0 ? total - Number(row.purchasePrice) * n : null;
        done.push({ card, set, row, n, total, profit, label: possessionLabel({ ...row, count: 1 }, lang) });
        t.soldCount += n;
        t.soldTotal += total;
        if (profit !== null) { t.profit += profit; t.profitCount += n; }
        if (String(row.soldDate || '').startsWith(month)) t.monthTotal += total;
      });
    });
    done.sort((a, b) => String(b.row.soldDate || '').localeCompare(String(a.row.soldDate || '')));
    listed.sort((a, b) => (Number(b.row.askPrice) || 0) - (Number(a.row.askPrice) || 0));
    return { listed, done, t };
  }, [cards, setIndex]);

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
                  {l}{k === 'trade' && totals.trade ? ` ${totals.trade}` : ''}{k === 'graded' && totals.gradedKinds ? ` ${totals.gradedKinds}` : ''}{k === 'pull' && totals.pullKinds ? ` ${totals.pullKinds}` : ''}
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
              <SortControl fields={SORT_FIELD_KEYS} value={sort} onChange={setSort} />
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

      {tab === 'sales' && (
        <div className="col-sales">
          <section className="kpis">
            <div className="kpi"><span>판매중</span><strong>{sales.t.listedCount}<em>장</em></strong><small>{sales.t.askTotal > 0 ? `희망 가격 합계 ${won(sales.t.askTotal)}` : '수정 화면에서 [판매중]으로 바꾸면 여기에 모여요'}</small></div>
            <div className="kpi"><span>총 판매액</span><strong>{won(sales.t.soldTotal)}</strong><small>판매완료 {sales.t.soldCount}장</small></div>
            <div className="kpi"><span>실현 손익</span>
              {sales.t.profitCount > 0
                ? <><strong className={sales.t.profit >= 0 ? 'up' : 'down'}>{sales.t.profit >= 0 ? '+' : '-'}{won(Math.abs(sales.t.profit))}</strong><small>구매가를 적은 {sales.t.profitCount}장 기준</small></>
                : <><strong className="muted">-</strong><small>구매가를 적은 카드를 팔면 손익이 보여요</small></>}
            </div>
            <div className="kpi"><span>이번 달 판매액</span><strong>{won(sales.t.monthTotal)}</strong><small>{new Date().getMonth() + 1}월 판매완료 기준</small></div>
          </section>
          <div className="cp-toolbar">
            <div className="seg">
              <button type="button" className={salesView === 'sold' ? 'on' : ''} onClick={() => setSalesView('sold')}>판매 기록 {sales.done.length}</button>
              <button type="button" className={salesView === 'listed' ? 'on' : ''} onClick={() => setSalesView('listed')}>판매중 {sales.listed.length}</button>
            </div>
            <span className="sub">카드를 누르면 상세에서 [판매완료]·[되돌리기]를 할 수 있어요.</span>
          </div>
          {salesView === 'sold' ? (sales.done.length === 0 ? (
            <div className="cp-empty">아직 판매 기록이 없어요. 카드 상세의 "내 보유"에서 [판매완료]를 눌러 기록해 보세요.</div>
          ) : (
            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead><tr><th></th><th>카드</th><th>상태</th><th>판매일</th><th>판매처</th><th className="num">수량</th><th className="num">판매가(1장)</th><th className="num">구매가(1장)</th><th className="num">손익</th></tr></thead>
                <tbody>
                  {sales.done.map(({ card, set, row, n, profit, label }) => (
                    <tr key={`${card.id}_${row.id}`} onClick={() => detail.openCard(card)}>
                      <td className="thumb"><CardThumbnail imageUrl={card.imageUrl} alt="" type="table" /></td>
                      <td><span className="name">{card.cardName}</span><div className="mono">{set ? set.code.toUpperCase() : ''} {card.cardNumber || ''}</div></td>
                      <td>{label}</td>
                      <td className="mono">{row.soldDate || '-'}</td>
                      <td>{row.soldVia || '-'}</td>
                      <td className="num">{n}</td>
                      <td className="num">{won(row.soldPrice)}</td>
                      <td className="num">{isPulledCopy(row) ? '직뽑' : Number(row.purchasePrice) > 0 ? won(row.purchasePrice) : '-'}</td>
                      <td className={`num ${profit === null ? '' : profit >= 0 ? 'up' : 'down'}`}>{profit === null ? '-' : `${profit >= 0 ? '+' : '-'}${won(Math.abs(profit))}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : (sales.listed.length === 0 ? (
            <div className="cp-empty">지금 판매중인 카드가 없어요. 카드 수정 화면의 보유 기록에서 [판매중]을 고르면 여기에 모여요.</div>
          ) : (
            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead><tr><th></th><th>카드</th><th>상태</th><th className="num">수량</th><th className="num">희망 가격(1장)</th><th className="num">구매가(1장)</th><th className="num">내 평가 가격</th></tr></thead>
                <tbody>
                  {sales.listed.map(({ card, set, row, n, label }) => (
                    <tr key={`${card.id}_${row.id}`} onClick={() => detail.openCard(card)}>
                      <td className="thumb"><CardThumbnail imageUrl={card.imageUrl} alt="" type="table" /></td>
                      <td><span className="name">{card.cardName}</span><div className="mono">{set ? set.code.toUpperCase() : ''} {card.cardNumber || ''}</div></td>
                      <td>{label}</td>
                      <td className="num">{n}</td>
                      <td className="num">{Number(row.askPrice) > 0 ? won(row.askPrice) : '-'}</td>
                      <td className="num">{Number(row.purchasePrice) > 0 ? won(row.purchasePrice) : '-'}</td>
                      <td className="num">{Number(card.price) > 0 ? won(card.price) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
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
