import React from 'react';
import { IconLogin } from './icons';

// 로그인 안 한 방문자에게 보여주는 요약 카드.
export default function GuestSummaryCard({ total, loading, onLogin }) {
  return (
    <section className="home-summary-card">
      <div className="home-summary-top">
        <span className="home-summary-label">포켓몬 카드 도감</span>
        {loading ? (
          <div className="home-skeleton home-skeleton-number" />
        ) : (
          <strong className="home-summary-number">전체 {total.toLocaleString()}장</strong>
        )}
      </div>
      <p className="home-summary-guest-hint">로그인하면 내 보유 현황과 앨범을 볼 수 있어요</p>
      <button type="button" className="btn btn-primary home-login-btn" onClick={onLogin}>
        <IconLogin size={16} />
        Google로 로그인
      </button>
    </section>
  );
}
