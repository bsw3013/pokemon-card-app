import React, { useMemo, useState } from 'react';
import {
  fmtDeadline, fmtFound, fmtWon, highestBid, isComplete, isEnded, parseKrw,
} from '../../utils/cafeMarket';

// MVP 카페에서 매일 자동으로 모아 둔 "후보 글"을 확인하는 칸.
// 판매글은 [저장] → 판매중(또는 판매완료) 매물, 경매글은 [경매 추적] → 경매 진행중 목록.
// 이미 마감된 경매는 여기서 바로 낙찰가를 넣는다.
const LANGS = ['한국', '일본', '미국', '중국'];

function defaults(c) {
  return {
    language: c.language || '',
    conditionType: c.conditionType || 'raw',
    gradingCompany: c.gradingCompany || '',
    grade: c.grade || '',
    priceText: c.price ? String(c.price) : '',
    sold: !!(c.soldMark || c.flags?.includes('itemSold')),
  };
}

function withPrice(v) {
  return { ...v, price: parseKrw(v.priceText) };
}

function Fields({ v, set, gradingCompanies, gradingScale }) {
  const companies = v.gradingCompany && !gradingCompanies.includes(v.gradingCompany) ? [...gradingCompanies, v.gradingCompany] : gradingCompanies;
  const scale = v.grade && !gradingScale.includes(v.grade) ? [...gradingScale, v.grade] : gradingScale;
  return (
    <>
      <select value={v.language} onChange={(e) => set({ language: e.target.value })} className={v.language ? '' : 'cafe-unknown'} aria-label="언어">
        {!v.language && <option value="">언어?</option>}
        {LANGS.map((l) => <option key={l} value={l}>{l}판</option>)}
      </select>
      <select value={v.conditionType} onChange={(e) => set({ conditionType: e.target.value })} aria-label="싱글/등급">
        <option value="raw">싱글</option>
        <option value="graded">등급카드</option>
      </select>
      {v.conditionType === 'graded' && (
        <>
          <select value={v.gradingCompany} onChange={(e) => set({ gradingCompany: e.target.value })} className={v.gradingCompany ? '' : 'cafe-unknown'} aria-label="등급사">
            <option value="">등급사?</option>
            {companies.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={v.grade} onChange={(e) => set({ grade: e.target.value })} className={v.grade ? '' : 'cafe-unknown'} aria-label="등급">
            <option value="">등급?</option>
            {scale.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </>
      )}
    </>
  );
}

function CandidateRow({ c, v, set, checked, onCheck, busy, gradingCompanies, gradingScale, onSave, onTrack, onDismiss, onAuctionDirect }) {
  const auction = c.kind === 'auction';
  const ended = auction && isEnded(c.endsAt);
  const [pasteOpen, setPasteOpen] = useState(false);
  const full = withPrice(v);
  const won = parseKrw(v.priceText);
  const canBulk = !auction && isComplete(full);
  return (
    <div className={`market-search-result cafe-cand ${auction ? 'is-auction' : ''}`}>
      {!auction && (
        <input
          type="checkbox"
          className="cafe-check"
          checked={checked}
          disabled={!canBulk}
          onChange={(e) => onCheck(e.target.checked)}
          title={canBulk ? '한 번에 저장할 후보로 고르기' : '언어·가격·등급을 다 채워야 고를 수 있어요'}
        />
      )}
      <div className="market-search-result-body">
        <span className="badge-source badge-source-cafe">MVP 카페</span>
        <span className={`badge-kind ${auction ? 'auction' : 'sale'}`}>{auction ? '경매글' : '판매글'}</span>
        {auction && <span className={`cafe-deadline ${ended ? 'ended' : ''}`}>{ended ? `${fmtDeadline(c.endsAt)} 마감됨` : `⏰ ${fmtDeadline(c.endsAt)} 마감`}</span>}
        <span className="market-listing-region">{fmtFound(c)}</span>
        {c.flags?.includes('bundle') && <span className="badge-classification cafe-warn">여러 장 글</span>}
        {!auction && !full.price && <span className="badge-classification cafe-warn">가격 확인 필요</span>}
        {(c.soldMark || c.flags?.includes('itemSold')) && <span className="badge-classification">판매완료 표시된 글</span>}
        <a href={c.url} target="_blank" rel="noopener noreferrer" className="market-search-result-title">{c.title}</a>
        {c.snippet && <span className="cafe-snippet">{c.snippet}</span>}
        <div className="cafe-fields">
          {auction ? (
            <span className="cafe-start">시작가 <b>{fmtWon(c.startPrice)}</b> <small>(시세에 안 들어가요)</small></span>
          ) : (
            <label className="cafe-price">가격 <input value={v.priceText} onChange={(e) => set({ priceText: e.target.value })} inputMode="decimal" placeholder="예: 4.2" /> <small>{won ? fmtWon(won) : ''}</small></label>
          )}
          <Fields v={v} set={set} gradingCompanies={gradingCompanies} gradingScale={gradingScale} />
          {!auction && (
            <label className="cafe-sold-toggle"><input type="checkbox" checked={v.sold} onChange={(e) => set({ sold: e.target.checked })} /> 판매완료로 저장</label>
          )}
        </div>
        {ended && (
          <div className="cafe-fields auction-result">
            <span className="auction-input"><input value={v.priceText} placeholder="낙찰가" inputMode="decimal" onChange={(e) => set({ priceText: e.target.value })} /><small>만원</small></span>
            {won && <small className="auction-won">= {fmtWon(won)}</small>}
            <button type="button" className="link-btn" onClick={() => setPasteOpen((o) => !o)}>댓글 붙여넣기</button>
            {pasteOpen && (
              <textarea
                className="auction-paste"
                placeholder="카페 글의 댓글을 복사해서 붙여넣으면 가장 높은 입찰가를 찾아줘요"
                onChange={(e) => { const h = highestBid(e.target.value); if (h) set({ priceText: String(h / 10000) }); }}
              />
            )}
          </div>
        )}
      </div>
      <div className="cafe-actions">
        {!auction && <button type="button" className="btn btn-primary" disabled={busy || !full.price || !full.language} onClick={() => onSave([{ c, v: full }])} title={!full.language ? '언어를 골라 주세요' : ''}>✅ 저장</button>}
        {auction && !ended && <button type="button" className="btn btn-auction" disabled={busy} onClick={() => onTrack(c, full)}>경매 추적</button>}
        {ended && <button type="button" className="btn btn-primary" disabled={busy || !won || !full.language} onClick={() => onAuctionDirect(c, full, won)}>판매완료로 저장</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => onDismiss([c.id])}>{ended ? '유찰' : '버리기'}</button>
      </div>
    </div>
  );
}

export default function CafeCandidates({ groups, gradingCompanies, gradingScale, busy, onSave, onTrack, onDismiss, onRestore, onAuctionDirect, lastRun }) {
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('new');
  const [showOld, setShowOld] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [vals, setVals] = useState({});
  const [checked, setChecked] = useState({});

  const valOf = (c) => ({ ...defaults(c), ...(vals[c.id] || {}) });
  const setVal = (id) => (patch) => setVals((s) => ({ ...s, [id]: { ...(s[id] || {}), ...patch } }));

  const pool = useMemo(() => (showOld ? [...groups.active, ...groups.old] : groups.active), [groups, showOld]);
  const shown = useMemo(() => pool
    .filter((c) => kind === 'all' || c.kind === kind)
    .sort((a, b) => {
      const d = Date.parse(b.foundAt) - Date.parse(a.foundAt) || Number(b.articleId) - Number(a.articleId);
      return sort === 'new' ? d : -d;
    }), [pool, kind, sort]);
  const nSale = pool.filter((c) => c.kind === 'sale').length;
  const picked = shown.filter((c) => checked[c.id] && c.kind === 'sale' && isComplete(withPrice(valOf(c))));
  const rest = shown.filter((c) => !checked[c.id]);

  const saveBulk = () => {
    if (!picked.length) return;
    onSave(picked.map((c) => ({ c, v: withPrice(valOf(c)) })));
    setChecked({});
  };
  const dismissRest = () => {
    if (!rest.length) return;
    if (!window.confirm(`체크하지 않은 후보 ${rest.length}건을 모두 버릴까요?\n(버린 글은 다시 후보로 안 떠요)`)) return;
    onDismiss(rest.map((c) => c.id));
  };

  return (
    <div className="market-search-panel cafe-panel" id="cafe-candidates">
      <div className="cafe-panel-head">
        <h4>MVP 카페 후보 ({groups.active.length})</h4>
        <div className="cafe-head-controls">
          <div className="view-toggle">
            <button type="button" className={`btn-toggle ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>전체</button>
            <button type="button" className={`btn-toggle ${kind === 'sale' ? 'active' : ''}`} onClick={() => setKind('sale')}>판매글 {nSale}</button>
            <button type="button" className={`btn-toggle ${kind === 'auction' ? 'active' : ''}`} onClick={() => setKind('auction')}>경매글 {pool.length - nSale}</button>
          </div>
          <div className="view-toggle">
            <button type="button" className={`btn-toggle ${sort === 'new' ? 'active' : ''}`} onClick={() => setSort('new')}>최신순</button>
            <button type="button" className={`btn-toggle ${sort === 'old' ? 'active' : ''}`} onClick={() => setSort('old')}>오래된 순</button>
          </div>
        </div>
      </div>
      <p className="market-hint">
        매일 새벽 MVP 카페에서 이 카드 글을 찾아 뒀어요. 언어·등급·가격은 제목과 요약에서 읽은 값이라, 틀리면 고친 뒤 저장하세요.
        {lastRun && <> · 마지막 수집 {new Date(lastRun.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{lastRun.errors?.length ? ` (문제: ${lastRun.errors[0]})` : ''}</>}
      </p>

      {shown.length > 0 && (
        <div className="cafe-bulk-bar">
          <button type="button" className="btn btn-primary" disabled={busy || picked.length === 0} onClick={saveBulk}>✅ 체크한 {picked.length}건 한 번에 저장</button>
          <button type="button" className="btn" disabled={busy || rest.length === 0} onClick={dismissRest}>나머지 {rest.length}건 모두 버리기</button>
          <span className="market-hint">언어·가격·등급이 다 채워진 판매글만 체크할 수 있어요.</span>
        </div>
      )}

      {shown.length === 0 && <div className="empty-results">확인할 후보가 없어요.</div>}
      <div className="market-search-results">
        {shown.map((c) => (
          <CandidateRow
            key={c.id}
            c={c}
            v={valOf(c)}
            set={setVal(c.id)}
            checked={!!checked[c.id]}
            onCheck={(on) => setChecked((s) => ({ ...s, [c.id]: on }))}
            busy={busy}
            gradingCompanies={gradingCompanies}
            gradingScale={gradingScale}
            onSave={onSave}
            onTrack={onTrack}
            onDismiss={onDismiss}
            onAuctionDirect={onAuctionDirect}
          />
        ))}
      </div>

      <div className="cafe-more">
        {groups.old.length > 0 && (
          <button type="button" className="link-btn" onClick={() => setShowOld((o) => !o)}>
            {showOld ? '오래된 후보 접기' : `오래된 후보 ${groups.old.length}건 보기 (30일 지난 판매글·2주 지난 경매)`}
          </button>
        )}
        {groups.hidden.length > 0 && (
          <button type="button" className="link-btn" onClick={() => setShowHidden((o) => !o)}>
            {showHidden ? '숨긴 글 접기' : `자동으로 숨긴 글 ${groups.hidden.length}건 보기 (구합니다·잡담 등)`}
          </button>
        )}
      </div>
      {showHidden && (
        <div className="cafe-hidden-list">
          {groups.hidden.map((c) => (
            <div key={c.id} className="cafe-hidden-row">
              <span className="badge-classification">{c.hidden === 'buy' ? '구매글' : '기타'}</span>
              <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a>
              <span className="market-listing-region">{fmtFound(c)}</span>
              <button type="button" className="btn btn-compact" disabled={busy} onClick={() => onRestore(c)}>후보로 올리기</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
