import React, { useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { useThumbnailSettings } from '../hooks/useThumbnailSettings';
import { useCardDetail } from '../hooks/useCardDetail';
import { DEFAULT_RARITIES, DEFAULT_SETS, ERA_OPTIONS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { ownedCount } from '../utils/cardStats';
import { rarityTone } from '../utils/rarityTone';
import { navigate } from '../utils/hashRoute';
import CardTile from '../components/CardTile';
import Icon from '../components/Icon';

const text = (v) => String(v ?? '').trim();
const fmtDate = (d) => (d ? d.replaceAll('-', '.') : '발매일 미입력');

// 세트별로 카드 수·보유 수를 미리 계산
function useSetStats() {
  const { cards, catalog } = useOwnedCards();
  const sets = useMemo(() => catalog?.sets || DEFAULT_SETS, [catalog]);
  return useMemo(() => {
    const index = buildSetIndex(sets);
    const bySet = new Map(sets.map((s) => [s.code, { set: s, cards: [], owned: 0 }]));
    cards.forEach((card) => {
      const s = findSetForCard(card, index);
      if (!s || !bySet.has(s.code)) return;
      const entry = bySet.get(s.code);
      entry.cards.push(card);
      if (ownedCount(card) > 0) entry.owned += 1;
    });
    return { sets, bySet };
  }, [cards, sets]);
}

function Progress({ owned, total }) {
  const pct = total ? Math.round((owned / total) * 100) : 0;
  return (
    <div className="sp-progress" aria-label={`보유 ${owned} / ${total}`}>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <span><b>{owned}</b> / {total}</span>
    </div>
  );
}

function SetList() {
  const { user } = useAuth();
  const { bySet } = useSetStats();
  const [onlyCollecting, setOnlyCollecting] = useState(false);
  const eras = useMemo(() => {
    const groups = new Map(ERA_OPTIONS.map((e) => [e, []]));
    bySet.forEach((entry) => {
      if (entry.cards.length === 0) return;
      if (onlyCollecting && entry.owned === 0) return;
      const era = groups.has(entry.set.era) ? entry.set.era : '기타';
      groups.get(era).push(entry);
    });
    return [...groups.entries()]
      .map(([era, list]) => [era, list.sort((a, b) => text(b.set.releaseDate).localeCompare(text(a.set.releaseDate)))])
      .filter(([, list]) => list.length);
  }, [bySet, onlyCollecting]);
  const total = [...bySet.values()].filter((e) => e.cards.length).length;

  return (
    <main className="page sp">
      <div className="page-head">
        <div>
          <h1>세트</h1>
          <p className="sub">{total}개 세트 · 최신 발매 순</p>
        </div>
        {user && (
          <div className="seg">
            <button type="button" className={!onlyCollecting ? 'on' : ''} onClick={() => setOnlyCollecting(false)}>전체</button>
            <button type="button" className={onlyCollecting ? 'on' : ''} onClick={() => setOnlyCollecting(true)}>모으는 중</button>
          </div>
        )}
      </div>
      {eras.map(([era, list]) => (
        <section key={era} className="sp-era">
          <h2>{era} <em>{list.length}</em></h2>
          <div className="sp-grid">
            {list.map(({ set, cards, owned }) => (
              <button key={set.code} type="button" className="sp-card" onClick={() => navigate(['sets', set.code])}>
                <span className="sp-code">{set.code}</span>
                <span className="sp-body">
                  <span className="sp-name">{set.name}</span>
                  <span className="sp-meta">{set.kind} · {fmtDate(set.releaseDate)}</span>
                  {user ? <Progress owned={owned} total={cards.length} /> : <span className="sp-meta">등록된 카드 {cards.length}장</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {eras.length === 0 && <div className="cp-empty">아직 모으는 세트가 없습니다.</div>}
    </main>
  );
}

function SetDetail({ code, appConfig, onViewMarket }) {
  const { user } = useAuth();
  const { catalog } = useOwnedCards();
  const { bySet } = useSetStats();
  const { settings } = useThumbnailSettings();
  const detail = useCardDetail({ appConfig, onViewMarket });
  const [show, setShow] = useState('all');
  const entry = bySet.get(code) || [...bySet.values()].find((e) => e.set.code.toLowerCase() === String(code).toLowerCase());
  const rarityOrder = useMemo(() => new Map((catalog?.rarities || DEFAULT_RARITIES).map((r) => [text(r.code), Number(r.order) || 0])), [catalog]);

  const sections = useMemo(() => {
    if (!entry) return [];
    const list = entry.cards
      .map((card) => ({ card, no: card.cardNo ?? parseCardNo(card.cardNumber), count: ownedCount(card) }))
      .filter((x) => (show === 'owned' ? x.count > 0 : show === 'missing' ? x.count === 0 : true))
      .sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9));
    const groups = new Map();
    list.forEach((x) => {
      const r = text(x.card.rarity) || '레어도 없음';
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(x);
    });
    return [...groups.entries()]
      .map(([rarity, items]) => ({ rarity, items, first: items[0]?.no ?? 1e9 }))
      .sort((a, b) => a.first - b.first || (rarityOrder.get(a.rarity) || 0) - (rarityOrder.get(b.rarity) || 0));
  }, [entry, show, rarityOrder]);

  if (!entry) {
    return (
      <main className="page sp">
        <div className="crumbs"><button type="button" onClick={() => navigate(['sets'])}>세트</button></div>
        <div className="cp-empty">'{code}' 세트를 찾을 수 없습니다.</div>
      </main>
    );
  }

  const { set, cards, owned } = entry;
  const byRarity = new Map();
  cards.forEach((c) => {
    const r = text(c.rarity) || '레어도 없음';
    const v = byRarity.get(r) || { total: 0, owned: 0 };
    v.total += 1;
    if (ownedCount(c) > 0) v.owned += 1;
    byRarity.set(r, v);
  });
  const rarityRows = [...byRarity.entries()].sort((a, b) => (rarityOrder.get(a[0]) || 0) - (rarityOrder.get(b[0]) || 0));

  return (
    <main className="page sp">
      <nav className="crumbs" aria-label="위치">
        <button type="button" onClick={() => navigate(['sets'])}>세트</button>
        <Icon name="chevron" size={13} />
        <span className="muted">{set.era}</span>
        <Icon name="chevron" size={13} />
        <span>{set.name}</span>
      </nav>

      <section className="set-hero">
        <div className="set-title">
          <div className="set-code">{set.code}</div>
          <div>
            <h1>{set.name}</h1>
            <p className="sub">
              {set.kind} · {fmtDate(set.releaseDate)} 발매
              {set.printedTotal ? ` · 기본 ${set.printedTotal}장` : ''} · 등록된 카드 {cards.length}장
            </p>
          </div>
        </div>
        <div className="set-progress">
          {user ? (
            <>
              <div className="prog-top"><span>등록된 카드 중 보유</span><strong>{owned} <em>/ {cards.length}</em></strong></div>
              <div className="bar"><i style={{ width: `${cards.length ? Math.round((owned / cards.length) * 100) : 0}%` }} /></div>
            </>
          ) : (
            <p className="sub">로그인하면 이 세트를 얼마나 모았는지 볼 수 있어요.</p>
          )}
          <div className="prog-rows">
            {rarityRows.map(([r, v]) => (
              <div key={r}><span className={`rar-badge ${rarityTone(r)}`}>{r}</span><span className="pr-n">{user ? `${v.owned}/${v.total}` : `${v.total}장`}</span></div>
            ))}
          </div>
        </div>
      </section>

      <div className="set-tools">
        {user ? (
          <div className="seg">
            {[['all', `전체 ${cards.length}`], ['owned', `보유 ${owned}`], ['missing', `미보유 ${cards.length - owned}`]].map(([k, l]) => (
              <button key={k} type="button" className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>
            ))}
          </div>
        ) : <span />}
        <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate(['cards'], { set: set.code })}>카드 화면에서 거르기</button>
      </div>

      {sections.map(({ rarity, items }) => {
        const nums = items.map((x) => x.no).filter((n) => n != null);
        const ownedHere = items.filter((x) => x.count > 0).length;
        return (
          <section key={rarity} className="r-section">
            <div className="r-head">
              <span className={`rar-badge ${rarityTone(rarity)}`}>{rarity}</span>
              {nums.length > 0 && <span className="r-range">{Math.min(...nums)}{nums.length > 1 ? `–${Math.max(...nums)}` : ''}</span>}
              {user && <span className="r-own">{ownedHere}/{items.length} 보유</span>}
            </div>
            <div className="card-grid ctile-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {items.map(({ card }) => (
                <CardTile key={card.id} card={card} settings={{ ...settings, showSeries: false }} onClick={() => detail.openCard(card)} />
              ))}
            </div>
          </section>
        );
      })}
      {sections.length === 0 && <div className="cp-empty">보여줄 카드가 없습니다.</div>}
      {detail.modal}
    </main>
  );
}

export default function SetsPage({ code, appConfig, onViewMarket }) {
  return code ? <SetDetail code={code} appConfig={appConfig} onViewMarket={onViewMarket} /> : <SetList />;
}
