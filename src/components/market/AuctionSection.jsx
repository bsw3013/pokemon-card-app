import React, { useState } from 'react';
import { fmtDeadline, fmtWon, highestBid, isEnded, parseKrw } from '../../utils/cafeMarket';

// [경매 추적]한 카페 경매. 마감 전에는 마감 시간만, 마감 후에는 낙찰가를 넣는 칸이 열린다.
// 낙찰가를 넣으면 마감일 날짜로 "경매 낙찰" 판매완료 매물이 되고, [유찰]은 시세에서 뺀다.
export default function AuctionSection({ auctions, busy, onResult, onUnsold }) {
  const [values, setValues] = useState({});
  const [pasteOpen, setPasteOpen] = useState({});
  if (auctions.length === 0) return null;
  const sorted = [...auctions].sort((a, b) => Date.parse(a.auctionEndsAt) - Date.parse(b.auctionEndsAt));
  return (
    <div className="market-section" id="cafe-auctions">
      <h4>경매 진행중 ({auctions.length})</h4>
      <div className="market-listing-table">
        {sorted.map((l) => {
          const ended = isEnded(l.auctionEndsAt);
          const v = values[l.id] ?? '';
          const won = parseKrw(v);
          return (
            <div key={l.id} className={`market-listing-row auction-row ${ended ? 'ended' : ''}`}>
              <span className="badge-source badge-source-cafe">{l.marketplace || 'MVP'}</span>
              <span className="badge-kind auction">경매</span>
              {l.language && <span className="badge-classification">{l.language}판</span>}
              {l.conditionType === 'graded' && <span className="badge-classification">{[l.gradingCompany, l.grade].filter(Boolean).join(' ') || '등급카드'}</span>}
              <span className="market-listing-title">{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a> : l.title}</span>
              <span className="market-listing-region">시작가 {fmtWon(l.startPrice)}</span>
              {ended ? (
                <span className="auction-result">
                  <span className="cafe-deadline ended">{fmtDeadline(l.auctionEndsAt)} 마감됨</span>
                  <span className="auction-input"><input value={v} placeholder="낙찰가" inputMode="decimal" onChange={(e) => setValues((s) => ({ ...s, [l.id]: e.target.value }))} /><small>만원</small></span>
                  {won && <small className="auction-won">= {fmtWon(won)}</small>}
                  <button type="button" className="btn btn-primary" disabled={busy || !won} onClick={() => onResult(l, won)}>판매완료로 저장</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => onUnsold(l)}>유찰</button>
                  <button type="button" className="link-btn" onClick={() => setPasteOpen((s) => ({ ...s, [l.id]: !s[l.id] }))}>댓글 붙여넣기</button>
                </span>
              ) : (
                <span className="cafe-deadline">⏰ {fmtDeadline(l.auctionEndsAt)} 마감</span>
              )}
              {ended && pasteOpen[l.id] && (
                <textarea
                  className="auction-paste"
                  placeholder="카페 글의 댓글을 복사해서 붙여넣으면 가장 높은 입찰가를 찾아줘요"
                  onChange={(e) => { const h = highestBid(e.target.value); if (h) setValues((s) => ({ ...s, [l.id]: String(h / 10000) })); }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
