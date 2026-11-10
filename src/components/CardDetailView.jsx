import React, { useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { UNKNOWN_GRADER, activeRows, cardLanguage, copyBreakdown, copyGrade, gradeLabel, isForSale, isPulledCopy, langShort, ownedCount, parsePossessions, soldRows } from '../utils/cardStats';
import { recordSaleToMarket, removeSaleFromMarket, sellCopy, statusFromRows, unsellCopy } from '../utils/sales';
import SaleForm from './SaleForm';
import { invalidateMarketIndex, useMarketIndex } from '../hooks/useMarketIndex';
import { cardListings, copyMarketPrice, copyTypeKey, priceTable, typeLabel } from '../utils/marketPrice';
import { rarityTone } from '../utils/rarityTone';
import { navigate } from '../utils/hashRoute';
import { displayPokedexNumber } from '../utils/numberUtils';
import CardThumbnail from './CardThumbnail';
import { useWatchEntry } from '../hooks/useWatchlist';
import { buildCardKey } from '../utils/cardKey';

const text = (v) => String(v ?? '').trim();
const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const signedWon = (n) => `${n >= 0 ? '+' : '-'}${Math.abs(Math.round(n)).toLocaleString()}원`;

// 보유 기록 한 줄의 제목 (등급 카드 · PSA 10 / Raw · 민트)
function copyTitle(p) {
  const g = copyGrade(p);
  if (!g) return `Raw · ${p.condition || '상태 기록 없음'}`;
  const name = g.company === UNKNOWN_GRADER ? `업체 미기록${g.grade ? ` ${g.grade}` : ''}` : gradeLabel(g);
  return `등급 카드 · ${name}${g.grade ? '' : ' (점수 미기록)'}`;
}
function CopyMark({ p }) {
  const g = copyGrade(p);
  return (
    <span className="own-copy-mark" aria-hidden="true">
      {g ? <><small>{g.company === UNKNOWN_GRADER ? '등급' : g.company}</small><b>{g.grade || '-'}</b></> : <b>Raw</b>}
    </span>
  );
}

// 이름 끝의 ex/EX/V/VMAX/GX 등을 떼고 같은 포켓몬끼리 묶을 때 쓰는 이름
function baseName(name) {
  return text(name).replace(/\s*(ex|EX|GX|V|VMAX|VSTAR|BREAK|☆|◇)$/u, '').replace(/^메가|^M(?=[가-힣])/, '').trim();
}

// 카드 상세 "보기" 화면 (수정은 [수정] 버튼으로)
export default function CardDetailView({ card, isAdmin, onEdit, onViewMarket, onOpenCard }) {
  const { user, nickname, signInWithGoogle } = useAuth();
  const watch = useWatchEntry(card?.id ? buildCardKey(card) : '');
  async function toggleWatch() {
    if (!watch.signedIn) { signInWithGoogle(); return; }
    try {
      if (watch.entry) await watch.remove(); else await watch.add(card);
    } catch (err) {
      console.error('관심 카드 변경 실패', err);
      alert('관심 카드를 바꾸지 못했어요.');
    }
  }
  const { cards, catalog, saveOwnership } = useOwnedCards();
  const [sellingId, setSellingId] = useState(null); // 판매완료 입력창을 연 보유 기록 줄
  const [busy, setBusy] = useState(false);
  const marketIndex = useMarketIndex();
  const index = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const set = findSetForCard(card, index);
  const no = card.cardNo ?? parseCardNo(card.cardNumber);
  const split = copyBreakdown(card);
  const count = split.total;
  const copies = activeRows(card);
  const sold = soldRows(card).sort((a, b) => String(b.soldDate || '').localeCompare(String(a.soldDate || '')));
  const language = cardLanguage(card);


  // 종류별 시세 표 (판매완료 평균 우선, 없으면 판매중 평균)
  const table = useMemo(() => priceTable(cardListings(marketIndex, card)), [marketIndex, card]);
  const myTypes = new Set(copies.map((p) => copyTypeKey(card, p)).filter(Boolean));
  const tableRows = [...table.values()].sort((a, b) => {
    const mine = Number(myTypes.has(b.key)) - Number(myTypes.has(a.key));
    if (mine) return mine;
    const [la, ka] = a.key.split('|');
    const [lb, kb] = b.key.split('|');
    if ((ka === 'raw') !== (kb === 'raw')) return ka === 'raw' ? -1 : 1;
    return la.localeCompare(lb) || kb.localeCompare(ka, 'ko', { numeric: true });
  });
  const myValue = copies.reduce((sum, p) => {
    const m = copyMarketPrice(table, card, p);
    return m ? sum + m.price * (Number(p.count) || 1) : sum;
  }, 0);

  const saveRows = async (rows) => {
    await saveOwnership(card.id, { possessions: rows, status: statusFromRows(rows, card.status || '미보유') });
  };

  const handleSell = async (row, form) => {
    setBusy(true);
    try {
      let listingId = null;
      if (form.toMarket) {
        try {
          const recordedBy = { uid: user.uid, name: nickname || user.displayName || '알 수 없음' };
          listingId = await recordSaleToMarket({ card, row, price: form.price, date: form.date, via: form.via, note: form.note, recordedBy });
        } catch (err) {
          console.error('시세 기록 실패', err);
          alert('판매는 기록하지만, 시세 기록 추가는 실패했어요.');
        }
      }
      await saveRows(sellCopy(parsePossessions(card.possessions), row.id, { ...form, listingId }));
      setSellingId(null);
      if (listingId) invalidateMarketIndex();
    } catch (err) {
      console.error(err);
      alert('판매 기록 저장에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnsell = async (row) => {
    const msg = row.soldListingId
      ? '이 판매 기록을 취소하고 다시 보유로 돌릴까요?\n같이 남긴 시세 기록(판매완료 매물)도 지워져요.'
      : '이 판매 기록을 취소하고 다시 보유로 돌릴까요?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      if (row.soldListingId) {
        try { await removeSaleFromMarket(card, row.soldListingId); invalidateMarketIndex(); } catch (err) { console.error('시세 기록 삭제 실패', err); }
      }
      await saveRows(unsellCopy(parsePossessions(card.possessions), row.id));
    } catch (err) {
      console.error(err);
      alert('되돌리기에 실패했어요.');
    } finally {
      setBusy(false);
    }
  };

  // 같은 포켓몬(도감번호가 같거나 이름이 같은) 다른 카드
  const relatives = useMemo(() => {
    const dex = Number(card.pokedexNumber) || 0;
    const name = baseName(card.cardName);
    return cards
      .filter((c) => c.id !== card.id && ((dex && Number(c.pokedexNumber) === dex) || (!dex && name && baseName(c.cardName) === name)))
      .map((c) => ({ c, set: findSetForCard(c, index) }))
      .sort((a, b) => text(b.set?.releaseDate).localeCompare(text(a.set?.releaseDate)))
      .slice(0, 18);
  }, [cards, card, index]);

  const rows = [
    ['세트', set ? (
      <button type="button" className="link-btn" onClick={() => navigate(['sets', set.code])}>{set.name} <span className="muted">({set.code})</span></button>
    ) : (card.series || '-')],
    ['카드 번호', card.cardNumber ? `${card.cardNumber}${no != null && set?.printedTotal ? `  (${no}/${set.printedTotal})` : ''}` : '-'],
    ['레어도', card.rarity ? <span className={`rar-badge ${rarityTone(card.rarity)}`}>{card.rarity}</span> : '-'],
    ['종류', card.type || '-'],
    ['도감 번호', card.pokedexNumber ? `No.${displayPokedexNumber(card.pokedexNumber)}` : '-'],
    ['발매일', set?.releaseDate ? set.releaseDate.replaceAll('-', '.') : '-'],
  ];

  return (
    <div className="cdv">
      <div className="cdv-image">
        <CardThumbnail imageUrl={card.imageUrl} alt={card.cardName || '카드'} type="modal" />
      </div>
      <div className="cdv-info">
        <div className="cdv-title">
          <h2>{card.cardName || '이름 없음'}</h2>
          <p className="sub">{set ? `${set.name} · ` : ''}{card.cardNumber || ''}</p>
        </div>

        <div className="cdv-actions">
          <button type="button" className="btn btn-primary" onClick={onEdit}>
            {isAdmin ? '수정' : user ? '보유 정보 기록' : '로그인하고 기록하기'}
          </button>
          {onViewMarket && <button type="button" className="btn btn-secondary" onClick={onViewMarket}>시세 보기</button>}
          {card?.id && (
            <button
              type="button"
              className={`btn btn-secondary cdv-watch${watch.entry ? ' is-on' : ''}`}
              onClick={toggleWatch}
              disabled={watch.busy}
              aria-pressed={!!watch.entry}
              title={watch.entry ? '관심 카드에서 빼기' : '관심 카드에 추가'}
            >
              <span aria-hidden="true">{watch.entry ? '★' : '☆'}</span> {watch.entry ? '관심 카드' : '관심 카드 추가'}
            </button>
          )}
        </div>

        <dl className="cdv-rows">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        {user && (
          <section className="cdv-section">
            <h3>내 보유 {count > 0 && <em>{count}장</em>}</h3>
            {count > 0 && (
              <div className="own-summary">
                {split.gradedCount > 0 && <span className="own-chip graded">등급 카드 {split.gradedCount}장</span>}
                {split.rawCount > 0 && <span className="own-chip raw">Raw {split.rawCount}장</span>}
                {!language.includes('한국') && <span className={`own-chip lang lang-${langShort(language)}`}>{langShort(language)}</span>}
              </div>
            )}
            {count === 0 ? (
              <p className="sub">{sold.length > 0 ? '지금은 갖고 있지 않아요. (모두 판매완료)' : '아직 갖고 있지 않은 카드예요.'}</p>
            ) : copies.length === 0 ? (
              <p className="sub">
                {split.statusOnly ? '등급 카드로만 표시돼 있어요. ' : ''}
                자세한 기록(등급 업체·점수, 카드 상태, 구매가 등)은 [{isAdmin ? '수정' : '보유 정보 기록'}]에서 적을 수 있어요.
              </p>
            ) : (
              <ul className="own-copies">
                {copies.map((p, i) => {
                  const g = copyGrade(p);
                  const qty = Number(p.count) > 1 ? ` ×${p.count}` : '';
                  const meta = [
                    langShort(p.language || language),
                    isPulledCopy(p) ? (p.purchaseDate ? `${p.purchaseDate} 뽑음` : '') : [p.purchasePrice ? `구매 ${won(p.purchasePrice)}` : '', p.purchaseDate].filter(Boolean).join(' '),
                    p.location,
                    p.serial ? `인증번호 ${p.serial}` : '',
                    p.notes,
                  ].filter(Boolean).join(' · ');
                  const key = p.id || `row_${i}`;
                  const m = copyMarketPrice(table, card, p);
                  const gain = m && !isPulledCopy(p) && Number(p.purchasePrice) > 0 ? (m.price - Number(p.purchasePrice)) * (Number(p.count) || 1) : null;
                  const unknownGrade = g && (g.company === UNKNOWN_GRADER || !g.grade);
                  return (
                    <li key={key} className={`${g ? 'graded' : 'raw'} ${sellingId === key ? 'open' : ''}`}>
                      <div className="own-copy-row">
                        <CopyMark p={p} />
                        <span className="own-copy-body">
                          <span className="own-copy-title">
                            {copyTitle(p)}{qty}
                            {isPulledCopy(p) && <span className="pull-pill">직뽑</span>}
                            {isForSale(p) && <span className="sale-pill">판매중{p.askPrice ? ` · 희망 ${won(p.askPrice)}` : ''}</span>}
                          </span>
                          {meta && <span className="own-copy-meta">{meta}</span>}
                          <span className="own-copy-market">
                            {m ? (
                              <>
                                시세 약 <b>{won(m.price)}</b>
                                <small> ({m.basis === 'sold' ? `판매완료 평균 ${m.sold.count}건` : `판매중 평균 ${m.active.count}건`})</small>
                                {gain !== null && <b className={gain >= 0 ? 'up' : 'down'}> · 구매가 대비 {signedWon(gain)}</b>}
                              </>
                            ) : unknownGrade ? '등급 업체·점수를 적으면 같은 등급 시세와 연결돼요' : `아직 ${typeLabel(copyTypeKey(card, p) || 'x|raw')} 시세 기록이 없어요`}
                          </span>
                        </span>
                        {/* 판매완료 버튼은 [판매중]으로 고른 줄에만 */}
                        {sellingId !== key && p.id && isForSale(p) && (
                          <button type="button" className="btn btn-secondary btn-compact own-copy-action" onClick={() => setSellingId(key)}>판매완료</button>
                        )}
                      </div>
                      {sellingId === key && (
                        <SaleForm row={p} busy={busy} onCancel={() => setSellingId(null)} onSubmit={(f) => handleSell(p, f)} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {sold.length > 0 && (
              <div className="sold-block">
                <h4>판매 기록 <em>{sold.length}건</em></h4>
                <ul className="own-copies sold">
                  {sold.map((p) => {
                    const n = Number(p.count) || 1;
                    const profit = Number(p.purchasePrice) > 0 ? (Number(p.soldPrice) - Number(p.purchasePrice)) * n : null;
                    return (
                      <li key={p.id} className="sold">
                        <div className="own-copy-row">
                          <CopyMark p={p} />
                          <span className="own-copy-body">
                            <span className="own-copy-title">{copyTitle(p)}{n > 1 ? ` ×${n}` : ''}</span>
                            <span className="own-copy-meta">
                              {[`판매 ${won(p.soldPrice)}${n > 1 ? ' (1장)' : ''}`, p.soldDate, p.soldVia, p.soldNote].filter(Boolean).join(' · ')}
                              {profit !== null && <b className={profit >= 0 ? 'up' : 'down'}> · 손익 {signedWon(profit)}</b>}
                            </span>
                          </span>
                          <button type="button" className="btn btn-secondary btn-compact own-copy-action" onClick={() => handleUnsell(p)} disabled={busy}>되돌리기</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {myValue > 0 && <p className="cdv-value">내 카드 시세 합계 <b>{won(myValue)}</b></p>}
          </section>
        )}

        <section className="cdv-section">
          <h3>시세</h3>
          {marketIndex === null ? <p className="sub">불러오는 중...</p> : tableRows.length === 0 ? (
            <p className="sub">아직 기록된 시세가 없습니다. [시세 보기]에서 기록할 수 있어요.</p>
          ) : (
            <div className="cdv-market-table">
              <table>
                <thead><tr><th>종류</th><th className="num">시세</th><th className="num">판매완료</th><th className="num">판매중</th></tr></thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.key} className={myTypes.has(r.key) ? 'mine' : ''}>
                      <td>{typeLabel(r.key)}{myTypes.has(r.key) && <span className="mine-tag">내 카드</span>}</td>
                      <td className="num"><b>{won(r.price)}</b></td>
                      <td className="num">{r.sold ? <>{won(r.sold.avg)}<small> · {r.sold.count}건</small></> : '-'}</td>
                      <td className="num">{r.active ? <>{r.active.min === r.active.max ? won(r.active.min) : `${won(r.active.min)} ~ ${won(r.active.max)}`}<small> · {r.active.count}건</small></> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="sub">시세 = 판매완료 평균 (없으면 판매중 평균). 언어판·Raw/등급별로 따로 봐요.</p>
            </div>
          )}
        </section>

        {relatives.length > 0 && (
          <section className="cdv-section">
            <h3>같은 포켓몬의 다른 카드 <em>{relatives.length}</em></h3>
            <div className="cdv-relatives">
              {relatives.map(({ c, set: s }) => (
                <button key={c.id} type="button" className={`cdv-rel ${ownedCount(c) > 0 || !user ? '' : 'missing'}`} onClick={() => onOpenCard?.(c)} title={`${c.cardName} · ${s?.name || c.series || ''}`}>
                  <span className="cdv-rel-img"><CardThumbnail imageUrl={c.imageUrl} alt={c.cardName} type="grid" /></span>
                  <span className="cdv-rel-meta"><span className={`rar-badge ${rarityTone(c.rarity)}`}>{c.rarity || '-'}</span><span className="num">{s ? s.code.toUpperCase() : ''}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
