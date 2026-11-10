import React, { useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../utils/catalog';
import { UNKNOWN_GRADER, cardLanguage, copyBreakdown, copyGrade, gradeLabel, langShort, ownedCount, parsePossessions } from '../utils/cardStats';
import { rarityTone } from '../utils/rarityTone';
import { navigate } from '../utils/hashRoute';
import { displayPokedexNumber } from '../utils/numberUtils';
import CardThumbnail from './CardThumbnail';

const text = (v) => String(v ?? '').trim();
const won = (n) => `${Number(n || 0).toLocaleString()}원`;

// 이름 끝의 ex/EX/V/VMAX/GX 등을 떼고 같은 포켓몬끼리 묶을 때 쓰는 이름
function baseName(name) {
  return text(name).replace(/\s*(ex|EX|GX|V|VMAX|VSTAR|BREAK|☆|◇)$/u, '').replace(/^메가|^M(?=[가-힣])/, '').trim();
}

// 카드 상세 "보기" 화면 (수정은 [수정] 버튼으로)
export default function CardDetailView({ card, isAdmin, marketSummary, onEdit, onViewMarket, onOpenCard }) {
  const { user } = useAuth();
  const { cards, catalog } = useOwnedCards();
  const index = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const set = findSetForCard(card, index);
  const no = card.cardNo ?? parseCardNo(card.cardNumber);
  const split = copyBreakdown(card);
  const count = split.total;
  const copies = parsePossessions(card.possessions).filter((p) => p && Number(p.count ?? 1) > 0);
  const language = cardLanguage(card);

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
              <p className="sub">아직 갖고 있지 않은 카드예요.</p>
            ) : copies.length === 0 ? (
              <p className="sub">
                {split.statusOnly ? '등급 카드로만 표시돼 있어요. ' : ''}
                자세한 기록(등급 업체·점수, 카드 상태, 구매가 등)은 [{isAdmin ? '수정' : '보유 정보 기록'}]에서 적을 수 있어요.
              </p>
            ) : (
              <ul className="own-copies">
                {copies.map((p, i) => {
                  const g = copyGrade(p);
                  const rowLang = langShort(p.language || language);
                  const qty = Number(p.count) > 1 ? ` ×${p.count}` : '';
                  const meta = [
                    rowLang,
                    p.purchasePrice ? `구매 ${won(p.purchasePrice)}` : '',
                    p.purchaseDate, p.location,
                    p.forTrade ? '판매·교환 가능' : '',
                    p.serial ? `인증번호 ${p.serial}` : '',
                    p.notes,
                  ].filter(Boolean).join(' · ');
                  return (
                    <li key={p.id || i} className={g ? 'graded' : 'raw'}>
                      <span className="own-copy-mark" aria-hidden="true">
                        {g ? <><small>{g.company === UNKNOWN_GRADER ? '등급' : g.company}</small><b>{g.grade || '-'}</b></> : <b>Raw</b>}
                      </span>
                      <span className="own-copy-body">
                        <span className="own-copy-title">
                          {g ? `등급 카드 · ${g.company === UNKNOWN_GRADER ? `업체 미기록${g.grade ? ` ${g.grade}` : ''}` : gradeLabel(g)}${g.grade ? '' : ' (점수 미기록)'}` : `Raw · ${p.condition || '상태 기록 없음'}`}{qty}
                        </span>
                        {meta && <span className="own-copy-meta">{meta}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {Number(card.price) > 0 && <p className="cdv-value">내 평가 가격 <b>{won(card.price)}</b>{count > 1 ? ` × ${count}장 = ${won(card.price * count)}` : ''}</p>}
          </section>
        )}

        <section className="cdv-section">
          <h3>시세</h3>
          {marketSummary === null && <p className="sub">불러오는 중...</p>}
          {marketSummary === 'none' && <p className="sub">아직 기록된 시세가 없습니다.</p>}
          {marketSummary && marketSummary !== 'none' && (
            <p className="cdv-market">
              <b>{won(marketSummary.min)} ~ {won(marketSummary.max)}</b>
              <span className="sub"> 평균 {won(marketSummary.avg)} · 매물 {marketSummary.count}건</span>
            </p>
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
