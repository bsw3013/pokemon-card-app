import React from 'react';
import { useAuth } from '../AuthContext';

export default function LoginScreen() {
  const { signInWithGoogle, error } = useAuth();

  return (
    <main className="hero fade-in">
      <h1>편리하고 아름다운<br />포켓몬 카드 도감 관리자</h1>
      <p>내 카드 보유 현황과 앨범은 로그인한 계정별로 안전하게 저장됩니다.<br />구글 계정으로 로그인하고 시작해보세요.</p>

      <div className="btn-group">
        <button type="button" className="btn btn-primary" onClick={signInWithGoogle}>
          🔐 Google로 로그인
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger-color, #ef4444)', marginTop: '1rem' }}>{error}</p>}
    </main>
  );
}
