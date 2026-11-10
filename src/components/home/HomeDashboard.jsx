import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../AuthContext';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import { useCardDetail } from '../../hooks/useCardDetail';
import { useThumbnailSettings } from '../../hooks/useThumbnailSettings';
import pokemonMapAll from '../../utils/pokemonMapAll.json';
import { buildPokedexEntries, computeGenerationStats, computePokedexHeaderStats } from '../../utils/homeStats';
import { DEFAULT_RARITIES, DEFAULT_SETS, buildSetIndex, findSetForCard, makeRarityCompare, parseCardNo } from '../../utils/catalog';
import { copyBreakdown, ownedCount } from '../../utils/cardStats';
import { cardIdFromKey, resolveLegacyCardKey } from '../../utils/cardKey';
import { navigate } from '../../utils/hashRoute';
import { rarityTone } from '../../utils/rarityTone';
import CardTile from '../CardTile';
import CardThumbnail from '../CardThumbnail';
import Icon from '../Icon';
import PokedexGridWidget from './PokedexGridWidget';
import { useMarketIndex } from '../../hooks/useMarketIndex';
import { cardMarketValue } from '../../utils/marketPrice';
import PokedexEntryModal from './PokedexEntryModal';

// 전국도감 순서 그대로인 이름 배열 (krToEn 의 키 순서 = 1~1025번).
const POKEMON_NAMES = Object.keys(pokemonMapAll.krToEn || {});
const text = (v) => String(v ?? '').trim();
const won = (n) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const fmtDate = (d) => (d ? d.replaceAll('-', '.') : '');

function SectionHead({ title, action, onAction }) {
  return (
    <div className="home-sec-head">
      <h2>{title}</h2>
      {action && <button type="button" className="link-more" onClick={onAction}>{action} <Icon name="chevron" size={14} /></button>}
    </div>
  );
}

function SetCard({ set, owned, total, showProgress }) {
  const pct = total ? Math.round((owned / total) * 100) : 0;
  return (
    <button type="button" className="sp-card" onClick={() => navigate(['sets', set.code])}>
      <span className="sp-code">{set.code}</span>
      <span className="sp-body">
        <span className="sp-name">{set.name}</span>
        <span className="sp-meta">{set.kind} · {fmtDate(set.releaseDate) || '발매일 미입력'}</span>
        {showProgress ? (
          <span className="sp-progress"><span className="bar"><i style={{ width: `${pct}%` }} /></span><span><b>{owned}</b> / {total}</span></span>
        ) : <span className="sp-meta">등록된 카드 {total}장</span>}
      </span>
    </button>
  );
}

export default function HomeDashboard({ appConfig, onViewMarket }) {
  const { user, nickname, signInWithGoogle } = useAuth();
  const { cards, loading, catalog } = useOwnedCards();
  const { settings } = useThumbnailSettings();
  const detail = useCardDetail({ appConfig, onViewMarket });
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [q, setQ] = useState('');
  const [watchlist, setWatchlist] = useState([]);

  const sets = useMemo(() => catalog?.sets || DEFAULT_SETS, [catalog]);
  const setIndex = useMemo(() => buildSetIndex(sets), [sets]);
  const rarityOrder = useMemo(() => new Map((catalog?.rarities || DEFAULT_RARITIES).map((r) => [text(r.code), Number(r.order) || 0])), [catalog]);

  // 세트별 카드 수·보유 수
  const setStats = useMemo(() => {
    const m = new Map();
    cards.forEach((card) => {
      const s = findSetForCard(card, setIndex);
      if (!s) return;
      const v = m.get(s.code) || { set: s, total: 0, owned: 0, cards: [] };
      v.total += 1;
      v.cards.push(card);
      if (ownedCount(card) > 0) v.owned += 1;
      m.set(s.code, v);
    });
    return [...m.values()];
  }, [cards, setIndex]);

  const latestSets = useMemo(() => [...setStats].sort((a, b) => text(b.set.releaseDate).localeCompare(text(a.set.releaseDate))).slice(0, 6), [setStats]);
  const nearComplete = useMemo(() => setStats
    .filter((v) => v.owned > 0 && v.owned < v.total)
    .sort((a, b) => (b.owned / b.total) - (a.owned / a.total) || (a.total - a.owned) - (b.total - b.owned))
    .slice(0, 4), [setStats]);

  // 최근 추가된 카드 (추가 날짜가 있는 카드), 없으면 최신 세트의 힛카드
  const recentCards = useMemo(() => {
    const dated = cards.filter((c) => text(c.createdAt)).sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt)));
    if (dated.length >= 6) return { title: '최근 추가된 카드', list: dated.slice(0, 12) };
    const latest = latestSets[0];
    if (!latest) return { title: '', list: [] };
    const list = [...latest.cards].sort((a, b) => (rarityOrder.get(text(b.rarity)) || 0) - (rarityOrder.get(text(a.rarity)) || 0)
      || ((a.cardNo ?? parseCardNo(a.cardNumber) ?? 0) - (b.cardNo ?? parseCardNo(b.cardNumber) ?? 0)));
    return { title: `최신 세트 「${latest.set.name}」의 카드`, list: list.slice(0, 12), set: latest.set };
  }, [cards, latestSets, rarityOrder]);

  const marketIndex = useMarketIndex();
  const totals = useMemo(() => {
    const t = { kinds: 0, gradedKinds: 0, count: 0, value: 0 };
    cards.forEach((c) => {
      const n = ownedCount(c);
      if (!n) return;
      t.kinds += 1; t.count += n; t.value += cardMarketValue(marketIndex, c).value;
      if (copyBreakdown(c).gradedCount > 0) t.gradedKinds += 1;
    });
    return t;
  }, [cards, marketIndex]);

  // 도감 완성률 막대 (전체 카드 종류 중 보유 비율)
  const completion = useMemo(() => {
    const all = cards.length || 1;
    const exact = (totals.kinds / all) * 100;
    return {
      pct: cards.length ? Math.floor(exact * 10) / 10 : 0,
      ownedPct: ((totals.kinds - totals.gradedKinds) / all) * 100,
      gradedPct: (totals.gradedKinds / all) * 100,
    };
  }, [cards.length, totals]);

  // 레어도별 모음: 레어도마다 전체 종류 중 몇 종을 모았는지 (높은 레어도부터)
  const rarityRows = useMemo(() => {
    const m = new Map();
    cards.forEach((c) => {
      const r = text(c.rarity) || '미분류';
      const v = m.get(r) || { rarity: r, total: 0, owned: 0, copies: 0 };
      v.total += 1;
      const n = ownedCount(c);
      if (n > 0) { v.owned += 1; v.copies += n; }
      m.set(r, v);
    });
    const cmp = makeRarityCompare(catalog?.rarities || DEFAULT_RARITIES);
    return [...m.values()].sort((a, b) => cmp(a.rarity, b.rarity) || b.total - a.total);
  }, [cards, catalog]);

  // 포켓몬 도감판
  const entries = useMemo(() => buildPokedexEntries(cards, POKEMON_NAMES), [cards]);
  const generationStats = useMemo(() => computeGenerationStats(entries), [entries]);
  const headerStats = useMemo(() => computePokedexHeaderStats(entries), [entries]);
  const selectedEntry = selectedNumber ? entries[selectedNumber - 1] : null;

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    getDocs(query(collection(db, 'marketWatchlist'), where('ownerId', '==', user.uid)))
      .then((snap) => { if (!cancelled) setWatchlist(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch(() => { /* 관심 카드를 못 읽어도 홈은 그대로 보여준다 */ });
    return () => { cancelled = true; };
  }, [user]);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(['cards'], { q: q.trim() });
  };

  const recentSection = recentCards.list.length > 0 && (
    <section className="home-sec">
      <SectionHead title={recentCards.title} action={recentCards.set ? '세트 보기' : '카드 전체'} onAction={() => (recentCards.set ? navigate(['sets', recentCards.set.code]) : navigate(['cards'], { owned: 'all' }))} />
      <div className="card-grid ctile-grid home-cards">
        {recentCards.list.map((card) => (
          <CardTile key={card.id} card={card} settings={{ ...settings, showPrice: false }} onClick={() => detail.openCard(card)} />
        ))}
      </div>
    </section>
  );

  if (!user) {
    return (
      <main className="page home">
        <section className="home-hero">
          <h1>한국판 포켓몬 카드 도감</h1>
          <p className="sub">카드 {cards.length.toLocaleString()}장을 세트·레어도별로 찾아보고, 로그인하면 내 컬렉션을 기록할 수 있어요.</p>
          <form className="home-search" onSubmit={submitSearch} role="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="카드 이름, 번호, 세트로 검색" aria-label="카드 검색" />
            <button type="submit" className="btn btn-primary">검색</button>
          </form>
          <div className="home-hero-actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate(['cards'])}>카드 둘러보기</button>
            <button type="button" className="btn btn-secondary" onClick={signInWithGoogle}>Google로 로그인</button>
          </div>
        </section>
        <section className="home-sec">
          <SectionHead title="최신 세트" action="세트 전체" onAction={() => navigate(['sets'])} />
          <div className="sp-grid">
            {latestSets.map((v) => <SetCard key={v.set.code} set={v.set} owned={v.owned} total={v.total} />)}
          </div>
        </section>
        {loading ? <div className="cp-empty">불러오는 중...</div> : recentSection}
        {detail.modal}
      </main>
    );
  }

  return (
    <main className="page home">
      <section className="home-top">
        <div className="home-top-head">
          <p className="sub">{nickname ? `${nickname}님의 컬렉션` : '내 컬렉션'}</p>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate(['collection'])}>내 컬렉션 보기</button>
        </div>
        {/* 도감 완성률 막대: 등급 카드가 있는 종류는 금색, 나머지 보유 종류는 진한 색 */}
        <div className="home-progress">
          <div className="home-progress-line">
            <strong>{completion.pct}%</strong>
            <span><b>{totals.kinds.toLocaleString()}</b> / {cards.length.toLocaleString()}종 모음</span>
          </div>
          <div className="home-progress-bar" role="img" aria-label={`도감 완성률 ${completion.pct}%`}>
            <i className="owned" style={{ width: `${completion.ownedPct}%` }} />
            <i className="graded" style={{ width: `${completion.gradedPct}%` }} />
          </div>
          <div className="home-progress-legend">
            <span><i className="dot owned" />보유 {(totals.kinds - totals.gradedKinds).toLocaleString()}종</span>
            <span><i className="dot graded" />등급 카드 보유 {totals.gradedKinds.toLocaleString()}종</span>
            <span><i className="dot empty" />미보유 {(cards.length - totals.kinds).toLocaleString()}종</span>
          </div>
        </div>
        <div className="home-stats">
          <div><strong>{totals.count.toLocaleString()}</strong><span>총 장수</span></div>
          {totals.value > 0 && <div><strong>{won(totals.value)}</strong><span>평가액</span></div>}
        </div>
      </section>

      {rarityRows.length > 0 && (
        <section className="home-sec">
          <SectionHead title="레어도별 모음" action="레어도별 자세히" onAction={() => navigate(['collection'], { tab: 'rarity' })} />
          <div className="home-rarity-grid">
            {rarityRows.map((r) => {
              const pct = r.total ? Math.round((r.owned / r.total) * 100) : 0;
              return (
                <button
                  key={r.rarity}
                  type="button"
                  className={`home-rarity-item ${r.owned === 0 ? 'none' : ''}`}
                  onClick={() => navigate(['cards'], { rarity: r.rarity === '미분류' ? '__none__' : r.rarity })}
                  title={`${r.rarity} 카드 보기`}
                >
                  <span className="home-rarity-top">
                    <span className={`rar-badge ${rarityTone(r.rarity)}`}>{r.rarity}</span>
                    <span className="home-rarity-num"><b>{r.owned}</b> / {r.total}종</span>
                  </span>
                  <span className={`home-rarity-bar2 ${rarityTone(r.rarity)}`}><i style={{ width: `${pct}%` }} /></span>
                  <span className="home-rarity-meta">{pct}%{r.copies > r.owned ? ` · ${r.copies}장` : ''}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 내 포켓몬 도감 (레어도별 모음 바로 아래) */}
      <section className="home-sec">
        <PokedexGridWidget loading={loading} entries={entries} generationStats={generationStats} headerStats={headerStats} onSelectEntry={setSelectedNumber} />
      </section>

      {nearComplete.length > 0 && (
        <section className="home-sec">
          <SectionHead title="완성에 가까운 세트" action="세트 완성률 전체" onAction={() => navigate(['collection'], { tab: 'sets' })} />
          <div className="sp-grid">
            {nearComplete.map((v) => <SetCard key={v.set.code} set={v.set} owned={v.owned} total={v.total} showProgress />)}
          </div>
        </section>
      )}

      {loading ? <div className="cp-empty">불러오는 중...</div> : recentSection}

      {watchlist.length > 0 && (
        <section className="home-sec">
          <SectionHead title="관심 카드" action="시세 화면" onAction={() => navigate(['market'])} />
          <div className="home-watch">
            {watchlist.slice(0, 8).map((w) => {
              const card = cards.find((c) => c.id === (cardIdFromKey(w.cardKey) || resolveLegacyCardKey(w.cardKey, cards)));
              return (
                <button key={w.id} type="button" className="home-watch-item" onClick={() => (card ? detail.openCard(card) : navigate(['market']))}>
                  <span className="col-watch-img"><CardThumbnail imageUrl={card?.imageUrl || w.imageUrl} alt="" type="grid" /></span>
                  <span className="col-watch-body"><b>{card?.cardName || w.cardName}</b><span className="sp-meta">{card?.cardNumber || w.cardNumber || ''}</span></span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="home-sec">
        <SectionHead title="최신 세트" action="세트 전체" onAction={() => navigate(['sets'])} />
        <div className="sp-grid">
          {latestSets.slice(0, 3).map((v) => <SetCard key={v.set.code} set={v.set} owned={v.owned} total={v.total} showProgress />)}
        </div>
      </section>

      {selectedEntry && (
        <PokedexEntryModal entry={selectedEntry} onClose={() => setSelectedNumber(null)} onNavigate={(id) => navigate([id === 'gallery' ? 'cards' : id], id === 'gallery' ? { q: selectedEntry.name } : {})} />
      )}
      {detail.modal}
    </main>
  );
}
