import React, { useState } from 'react';
import { fmtUpdatedAt } from '../../utils/cafeMarket';
import { getUpdateToken, runMarketUpdate, setUpdateToken } from '../../utils/marketUpdate';

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

// "시세 업데이트" 버튼 (관리자만). card를 주면 그 카드만, 안 주면 관심 카드 전체를 MVP 카페에서 바로 검색한다.
// 버튼 안에 마지막 업데이트 날짜·시간을 같이 보여준다.
export default function MarketUpdateButton({ card, lastAt, countFor, onDone, compact = false }) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [setupOpen, setSetupOpen] = useState(false);
  const [tokenText, setTokenText] = useState('');

  async function start() {
    if (!getUpdateToken()) { setSetupOpen(true); return; }
    const before = countFor ? countFor() : null;
    setBusy(true); setMsg(null); setStep('시작하는 중…');
    try {
      const data = await runMarketUpdate({ card, onStep: setStep });
      const after = countFor ? countFor(data) : null;
      const added = before != null && after != null ? Math.max(0, after - before) : null;
      setMsg({ ok: true, text: added == null ? '업데이트했어요.' : added > 0 ? `새로 찾은 글 ${added}건` : '새로 찾은 글은 없어요.' });
      onDone?.(data);
    } catch (err) {
      if (err.needToken) setSetupOpen(true);
      else setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false); setStep('');
    }
  }

  function saveToken() {
    const t = tokenText.trim();
    if (!t) return;
    setUpdateToken(t);
    setTokenText('');
    setSetupOpen(false);
    start();
  }

  return (
    <span className={`market-update ${compact ? 'compact' : ''}`}>
      <span className="market-update-row">
        <button type="button" className="btn btn-secondary market-update-btn" onClick={start} disabled={busy} title={card ? '이 카드만 MVP 카페에서 지금 검색해요' : '관심 카드 전체를 MVP 카페에서 지금 검색해요'}>
          <span className={`market-update-icon ${busy ? 'spin' : ''}`} aria-hidden>↻</span>
          <span className="market-update-text">
            <b>{busy ? '시세 업데이트 중…' : '시세 업데이트'}</b>
            <small>마지막 업데이트 {fmtUpdatedAt(lastAt)}</small>
          </span>
        </button>
        {getUpdateToken() && !busy && (
          <button type="button" className="link-btn market-update-gear" onClick={() => setSetupOpen((o) => !o)} title="GitHub 토큰 바꾸기">토큰</button>
        )}
      </span>
      {busy && step && <small className="market-update-step">{step}</small>}
      {!busy && msg && <small className={`market-update-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</small>}
      {setupOpen && (
        <span className="market-update-setup">
          <b>처음 한 번만: GitHub 토큰 넣기</b>
          <small>
            시세 업데이트는 GitHub의 수집 작업을 바로 실행해요. 아래 순서로 토큰을 만들어 붙여넣으세요.
            토큰은 <b>이 기기의 브라우저에만</b> 저장돼요(휴대폰·PC 각각 한 번).
          </small>
          <ol>
            <li><a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">GitHub 토큰 만들기 페이지</a>를 열어요.</li>
            <li>Token name은 아무거나(예: 시세 업데이트), Expiration은 원하는 기간(최대 1년).</li>
            <li>Repository access → <b>Only select repositories</b> → <b>pokemon-card-app</b> 선택.</li>
            <li>Permissions → Repository permissions에서 <b>Actions: Read and write</b>, <b>Contents: Read-only</b>.</li>
            <li>맨 아래 <b>Generate token</b> → 나온 토큰(github_pat_…)을 복사해서 아래에 붙여넣기.</li>
          </ol>
          <span className="market-update-token">
            <input type="password" value={tokenText} onChange={(e) => setTokenText(e.target.value)} placeholder="github_pat_로 시작하는 토큰" autoComplete="off" />
            <button type="button" className="btn btn-primary btn-compact" onClick={saveToken} disabled={!tokenText.trim()}>저장하고 업데이트</button>
            <button type="button" className="btn btn-compact" onClick={() => setSetupOpen(false)}>닫기</button>
            {getUpdateToken() && <button type="button" className="link-btn" onClick={() => { setUpdateToken(''); setSetupOpen(false); }}>이 기기에서 토큰 지우기</button>}
          </span>
        </span>
      )}
    </span>
  );
}
