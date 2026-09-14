import React, { useState } from 'react';
import { useAuth } from '../AuthContext';

// forced=true: 최초 로그인 시 닫기 불가능한 필수 입력 팝업.
// forced=false: 네비게이션 바에서 언제든 닉네임을 바꾸는 팝업 (닫기 가능).
export default function NicknameModal({ forced = false, onClose }) {
  const { nickname, setNickname } = useAuth();
  const [value, setValue] = useState(nickname || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await setNickname(value);
      if (onClose) onClose();
    } catch (err) {
      setError(err.message || '닉네임 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="market-confirm-backdrop" onClick={forced ? undefined : onClose} style={{ zIndex: 1400 }}>
      <div className="market-confirm-card" onClick={(e) => e.stopPropagation()} style={{ flexDirection: 'column', maxWidth: '380px' }}>
        <h4 style={{ margin: 0 }}>{forced ? '👋 닉네임을 정해주세요' : '닉네임 변경'}</h4>
        <p className="market-hint" style={{ marginTop: '0.3rem' }}>
          {forced
            ? '구글 계정 실명 대신, 시세 기록 등에 표시될 닉네임을 정해주세요.'
            : '시세 기록 등에 표시되는 이름이에요.'}
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.6rem' }}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="닉네임 (최대 20자)"
            maxLength={20}
            autoFocus
            required
          />
          {error && <p className="market-hint market-photo-error" style={{ margin: 0 }}>{error}</p>}
          <div className="market-confirm-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
            {!forced && <button type="button" className="btn" onClick={onClose}>취소</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
