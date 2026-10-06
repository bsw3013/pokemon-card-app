import React from 'react';
import { IconDot } from './icons';

// 로그인한 사용자의 "내 컬렉션" 요약 카드.
export default function CollectionSummaryCard({ summary, loading }) {
  const { total, owned, unowned, graded, ownedOrGraded, percent } = summary;

  if (loading) {
    return (
      <section className="home-summary-card">
        <div className="home-summary-top">
          <span className="home-summary-label">내 컬렉션</span>
          <div className="home-skeleton home-skeleton-number" />
        </div>
      </section>
    );
  }

  return (
    <section className="home-summary-card">
      <div className="home-summary-top">
        <span className="home-summary-label">내 컬렉션</span>
        <strong className="home-summary-number">
          {ownedOrGraded.toLocaleString()} / {total.toLocaleString()}장
        </strong>
        <div className="home-summary-chips">
          <span className="home-chip home-chip-owned"><IconDot />보유 {owned.toLocaleString()}</span>
          <span className="home-chip home-chip-unowned"><IconDot />미보유 {unowned.toLocaleString()}</span>
          <span className="home-chip home-chip-graded"><IconDot />등급카드 {graded.toLocaleString()}</span>
        </div>
      </div>
      <div className="home-progress-row">
        <div className="home-progress-bar">
          <div className="home-progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
        <span className="home-progress-label">완성률 {percent}%</span>
      </div>
    </section>
  );
}
