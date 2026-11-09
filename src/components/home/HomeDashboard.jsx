import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../AuthContext';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import { useCardDetail } from '../../hooks/useCardDetail';
import { useThumbnailSettings } from '../../hooks/useThumbnailSettings';
import pokemonMapAll from '../../utils/pokemonMapAll.json';
import { buildPokedexEntries, computeGenerationStats, computePokedexHeaderStats } from '../../utils/homeStats';
import { DEFAULT_RARITIES, DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../../utils/catalog';
import { ownedCount } from '../../utils/cardStats';
import { cardIdFromKey, resolveLegacyCardKey } from '../../utils/cardKey';
import { navigate } from '../../utils/hashRoute';
import CardTile from '../CardTile';
import CardThumbnail from '../CardThumbnail';
import Icon from '../Icon';
import PokedexGridWidget from './PokedexGridWidget';
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

  const totals = useMemo(() => {
    const t = { kinds: 0, count: 0, value: 0 };
    cards.forEach((c) => {
      const n = ownedCount(c);
      if (!n) return;
      t.kinds += 1; t.count += n; t.value += (Number(c.price) || 0) * n;
    });
    return t;
  }, [cards]);

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
        <div>
          <p className="sub">{nickname ? `${nickname}님의 컬렉션` : '내 컬렉션'}</p>
          <div className="home-stats">
            <div><strong>{totals.kinds.toLocaleString()}</strong><span>보유 종류 / {cards.length.toLocaleString()}</span></div>
            <div><strong>{totals.count.toLocaleString()}</strong><span>총 장수</span></div>
            <div><strong>{won(totals.value)}</strong><span>평가액</span></div>
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(['collection'])}>내 컬렉션 보기</button>
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

      <section className="home-sec">
        <PokedexGridWidget loading={loading} entries={entries} generationStats={generationStats} headerStats={headerStats} onSelectEntry={setSelectedNumber} />
      </section>

      {selectedEntry && (
        <PokedexEntryModal entry={selectedEntry} onClose={() => setSelectedNumber(null)} onNavigate={(id) => navigate([id === 'gallery' ? 'cards' : id], id === 'gallery' ? { q: selectedEntry.name } : {})} />
      )}
      {detail.modal}
    </main>
  );
}
