import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { fmtUpdatedAt } from '../../utils/cafeMarket';
import { checkPendingUpdates, pendingFor, requestMarketUpdate, subscribeMarketUpdate } from '../../utils/marketUpdate';

function minutesAgo(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m === 0 ? '방금' : `${m}분 전`;
}

// "시세 업데이트" 버튼 (로그인한 사용자 누구나). card를 주면 그 카드만, 안 주면 관심 카드 전체.
// 누르면 업데이트 요청이 남고, GitHub가 5분마다 확인해서 MVP 카페를 검색한다. 버튼 안에 마지막 업데이트 시각을 보여준다.
export default function MarketUpdateButton({ card, lastAt, countFor, compact = false }) {
  const { user, signInWithGoogle } = useAuth();
  const [st, setSt] = useState({ pending: [] });
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const startCount = useRef(null);
  const wasPending = useRef(false);
  const cardKey = card?.cardKey || null;

  useEffect(() => { checkPendingUpdates(); return subscribeMarketUpdate(setSt); }, []);

  const mine = pendingFor(st, cardKey);
  const pending = mine.length > 0;

  // 대기 중이던 요청이 처리되면 결과를 알려준다
  useEffect(() => {
    if (pending) { wasPending.current = true; return; }
    if (!wasPending.current) return;
    wasPending.current = false;
    const after = countFor ? countFor() : null;
    const added = startCount.current != null && after != null ? Math.max(0, after - startCount.current) : null;
    startCount.current = null;
    setMsg({ ok: true, text: added ? `업데이트 완료 · 새로 찾은 글 ${added}건` : '업데이트 완료' });
  }, [pending, countFor]);

  async function start() {
    if (!user) { signInWithGoogle(); return; }
    setSending(true); setMsg(null);
    try {
      startCount.current = countFor ? countFor() : null;
      await requestMarketUpdate({ card, uid: user.uid });
    } catch (err) {
      console.error('시세 업데이트 요청 실패', err);
      setMsg({ ok: false, text: '요청을 못 보냈어요. 잠시 뒤 다시 눌러 주세요.' });
    } finally {
      setSending(false);
    }
  }

  const oldest = pending ? mine.reduce((m, p) => (p.at < m ? p.at : m), mine[0].at) : null;
  return (
    <span className={`market-update ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className="btn btn-secondary market-update-btn"
        onClick={start}
        disabled={sending || pending}
        title={card ? '이 카드만 MVP 카페에서 다시 검색해요' : '관심 카드 전체를 MVP 카페에서 다시 검색해요'}
      >
        <span className={`market-update-icon ${pending || sending ? 'spin' : ''}`} aria-hidden>↻</span>
        <span className="market-update-text">
          <b>{pending ? '시세 업데이트 대기 중…' : '시세 업데이트'}</b>
          <small>마지막 업데이트 {fmtUpdatedAt(lastAt)}</small>
        </span>
      </button>
      {pending && <small className="market-update-step">{minutesAgo(oldest)} 요청 · 보통 5~15분 뒤 반영돼요 (이 화면을 닫아도 진행돼요)</small>}
      {!pending && msg && <small className={`market-update-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</small>}
    </span>
  );
}
