import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { navigate } from '../utils/hashRoute';
import ThemeToggle from './ThemeToggle';
import Icon from './Icon';

const MAIN_NAV = [
  { id: 'home', label: '홈', icon: 'home' },
  { id: 'cards', label: '카드', icon: 'cards' },
  { id: 'sets', label: '세트', icon: 'sets' },
  { id: 'collection', label: '내 컬렉션', icon: 'me' },
  { id: 'market', label: '시세', icon: 'chart' },
];

// 상단 메뉴(데스크톱) + 하단 탭바(모바일). 앨범·설정·로그아웃은 오른쪽 프로필 메뉴 안에 둔다.
export default function TopNav({ current, onEditNickname }) {
  const { user, isAdmin, nickname, signInWithGoogle, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  // "/" 키로 검색창 바로 가기
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (id) => { setMenuOpen(false); navigate([id]); };
  const submitSearch = (e) => {
    e.preventDefault();
    navigate(['cards'], { q: q.trim() });
    setQ('');
    searchRef.current?.blur();
  };
  const displayName = nickname || user?.displayName || user?.email || '';

  return (
    <>
      <header className="topnav">
        <div className="topnav-inner">
          <a className="brand" href="#/home" onClick={(e) => { e.preventDefault(); go('home'); }}>PokéDex</a>
          <nav className="topnav-links" aria-label="주 메뉴">
            {MAIN_NAV.map((item) => (
              <a key={item.id} href={`#/${item.id}`} className={current === item.id ? 'active' : ''} aria-current={current === item.id ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); go(item.id); }}>{item.label}</a>
            ))}
          </nav>
          <div className="topnav-right">
            <form className="topnav-search" onSubmit={submitSearch} role="search">
              <Icon name="search" size={16} />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="카드 이름, 번호, 세트 검색" aria-label="카드 검색" />
              <kbd>/</kbd>
            </form>
            <ThemeToggle />
            {user ? (
              <div className="usermenu" ref={menuRef}>
                <button type="button" className="avatar-btn" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} title={displayName}>
                  {String(displayName).trim().slice(0, 1) || '나'}
                </button>
                {menuOpen && (
                  <div className="usermenu-pop" role="menu">
                    <div className="usermenu-head">
                      <strong>{displayName}</strong>
                      {isAdmin && <span>관리자</span>}
                    </div>
                    <button type="button" role="menuitem" onClick={() => go('album')}><Icon name="album" size={16} />앨범 꾸미기</button>
                    {isAdmin && <button type="button" role="menuitem" onClick={() => go('admin')}><Icon name="settings" size={16} />마스터 설정</button>}
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEditNickname?.(); }}><Icon name="edit" size={16} />닉네임 변경</button>
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); signOut(); }}><Icon name="logout" size={16} />로그아웃</button>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-compact" onClick={signInWithGoogle}>로그인</button>
            )}
          </div>
        </div>
      </header>

      <nav className="tabbar" aria-label="주 메뉴">
        {MAIN_NAV.map((item) => (
          <a key={item.id} href={`#/${item.id}`} className={current === item.id ? 'active' : ''} aria-current={current === item.id ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); go(item.id); }}>
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
