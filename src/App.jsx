import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import './index.css';
import CardUpload from './components/CardUpload';
import CardList from './components/CardList';
import AdminSettings from './components/AdminSettings';
import StatsDashboard from './components/StatsDashboard';
import AlbumPlanner from './components/AlbumPlanner';
import { defaultConfig } from './defaultConfig';

const NAV_ITEMS = [
  { id: 'home', label: '홈', description: '메인 대시보드' },
  { id: 'upload', label: '카드 등록', description: 'AI 이미지 분석 등록' },
  { id: 'gallery', label: '도감 갤러리', description: '보유 카드 조회/편집' },
  { id: 'album', label: '앨범 꾸미기', description: '페이지 배치 시뮬레이션' },
  { id: 'stats', label: '통계', description: '레어도/상태 집계' },
  { id: 'admin', label: '마스터 설정', description: '환경설정/백업/복원' },
];

const DEFAULT_VIEW = 'home';

function getViewFromHash() {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (!raw) return DEFAULT_VIEW;
  const normalized = raw.split('?')[0].split('&')[0].replace(/^\/+|\/+$/g, '').trim();
  if (!normalized) return DEFAULT_VIEW;
  return NAV_ITEMS.some((item) => item.id === normalized) ? normalized : DEFAULT_VIEW;
}

function App() {
  const [currentView, setCurrentView] = useState(getViewFromHash);
  const [appConfig, setAppConfig] = useState(null);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isNavPinned, setIsNavPinned] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 960 : false));
  const closeTimerRef = useRef(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openSideNav = () => {
    clearCloseTimer();
    setIsNavOpen(true);
  };

  const closeSideNav = () => {
    clearCloseTimer();
    setIsNavOpen(false);
  };

  const scheduleCloseSideNav = () => {
    if (isNavPinned || isMobile) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setIsNavOpen(false);
    }, 240);
  };

  const navigateTo = (viewId) => {
    const target = NAV_ITEMS.some((item) => item.id === viewId) ? viewId : DEFAULT_VIEW;
    setCurrentView(target);
    if (typeof window !== 'undefined') {
      const nextHash = `#/${target}`;
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentView(getViewFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 960;
      setIsMobile(mobile);
      if (mobile) {
        setIsNavPinned(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    async function fetchConfig() {
       try {
         // 타임아웃 설정 (3초 이상 걸리면 기본값 사용)
         const timeoutPromise = new Promise((_, reject) =>
           setTimeout(() => reject(new Error('Firebase timeout')), 3000)
         );
         
         const docRef = doc(db, 'settings', 'appConfig');
         
         try {
          const snap = await Promise.race([getDoc(docRef), timeoutPromise]);
          if (snap && snap.exists()) {
            const fetched = snap.data() || {};
            // Merge fetched config with defaultConfig to ensure required keys exist
            const merged = {
              ...defaultConfig,
              ...fetched,
              gradingCompaniesOptions: fetched.gradingCompaniesOptions || defaultConfig.gradingCompaniesOptions,
              gradingScaleOptions: fetched.gradingScaleOptions || defaultConfig.gradingScaleOptions,
              seriesOptions: fetched.seriesOptions || defaultConfig.seriesOptions,
              rarityOptions: fetched.rarityOptions || defaultConfig.rarityOptions,
              typeOptions: fetched.typeOptions || defaultConfig.typeOptions,
              statusOptions: fetched.statusOptions || defaultConfig.statusOptions
            };

            // Merge displayFields by id, favor fetched values but ensure 'status' exists and is visible
            const defaultFields = Array.isArray(defaultConfig.displayFields) ? defaultConfig.displayFields : [];
            const fetchedFields = Array.isArray(fetched.displayFields) ? fetched.displayFields : [];
            const fieldMap = new Map(defaultFields.map(f => [f.id, { ...f }]));
            fetchedFields.forEach(f => {
              fieldMap.set(f.id, { ...fieldMap.get(f.id), ...f });
            });
            if (!fieldMap.has('status')) {
              fieldMap.set('status', { id: 'status', label: '보유 정보', visible: true, order: fieldMap.size + 1 });
            } else {
              const st = fieldMap.get('status');
              fieldMap.set('status', { ...st, visible: true });
            }
            const mergedFields = Array.from(fieldMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0)).map((f, i) => ({ ...f, order: i + 1 }));
            merged.displayFields = mergedFields;

            setAppConfig(merged);
          } else {
            // 문서가 없으면 기본값으로 진행 (백그라운드에서 생성)
            setAppConfig(defaultConfig);
            // 백그라운드에서 설정 저장 (기다리지 않음)
            setDoc(docRef, defaultConfig).catch(err => 
              console.warn("Config save failed (will retry): ", err)
            );
          }
         } catch (timeoutErr) {
           console.warn("Firebase config load timeout - using default config", timeoutErr);
           setAppConfig(defaultConfig);
         }
       } catch (err) {
         console.error("Config load error", err);
         setAppConfig(defaultConfig); // 오류 시 기본값 진행
       }
    }
    fetchConfig();
  }, []);

  return (
    <>
      <button
        type="button"
        className={`side-nav-trigger ${isNavOpen ? 'open' : ''}`}
        aria-label="페이지 목차 열기"
        aria-expanded={isNavOpen}
        onMouseEnter={() => {
          if (!isMobile) openSideNav();
        }}
        onMouseLeave={scheduleCloseSideNav}
        onClick={() => {
          if (isNavOpen) closeSideNav();
          else openSideNav();
        }}
      >
        ☰
      </button>

      <aside
        className={`side-nav-panel ${isNavOpen ? 'open' : ''} ${isNavPinned ? 'pinned' : ''}`}
        onMouseEnter={() => {
          if (!isMobile) openSideNav();
        }}
        onMouseLeave={scheduleCloseSideNav}
      >
        <div className="side-nav-header">
          <h3>페이지 목차</h3>
          <button
            type="button"
            className={`side-nav-pin ${isNavPinned ? 'active' : ''}`}
            onClick={() => {
              setIsNavPinned((prev) => !prev);
              openSideNav();
            }}
            disabled={isMobile}
            title={isMobile ? '모바일에서는 고정 모드가 비활성화됩니다.' : '목차 패널 고정'}
          >
            📌
          </button>
        </div>

        <nav className="side-nav-menu" aria-label="사이드 페이지 메뉴">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`side-nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => {
                navigateTo(item.id);
                if (isMobile || !isNavPinned) closeSideNav();
              }}
            >
              <span className="side-nav-item-label">{item.label}</span>
              <small className="side-nav-item-desc">{item.description}</small>
            </button>
          ))}
        </nav>
      </aside>

      {isMobile && isNavOpen && <div className="side-nav-backdrop" onClick={closeSideNav} />}

      <nav className="navbar">
        <div className="logo" onClick={() => navigateTo('home')} style={{cursor: 'pointer'}}>PokéDex AI</div>
        <div className="btn-group" style={{ gap: '1rem' }}>
          <button type="button" className="btn btn-secondary" style={{ padding: '0.5rem 1.5rem', fontSize: '0.9rem' }} onClick={() => navigateTo('gallery')}>나의 도감</button>
          <button type="button" className="btn btn-primary" style={{ padding: '0.5rem 1.5rem', fontSize: '0.9rem' }} onClick={() => navigateTo('admin')}>⚙️ 마스터 설정</button>
        </div>
      </nav>

      {!appConfig ? (
        <div className="loading-config fade-in">
           <div className="spinner"></div>
           <h2>마스터 시스템 동기화 중...</h2>
        </div>
      ) : (
        <>
          {currentView === 'upload' && (
        <main className="upload-page slide-up">
          <div className="upload-header">
              <h2>📸 보유 카드 AI 등록</h2>
              <p className="subtitle">스마트폰 갤러리의 사진이나 카메라로 바로 찍어서 올리세요.</p>
          </div>
          <CardUpload />
        </main>
      )}

      {currentView === 'gallery' && (
         <main className="gallery-page">
            <CardList appConfig={appConfig} />
         </main>
      )}

      {currentView === 'admin' && (
         <main className="admin-page">
            <AdminSettings appConfig={appConfig} setAppConfig={setAppConfig} />
         </main>
      )}

      {currentView === 'stats' && (
        <StatsDashboard />
      )}

      {currentView === 'album' && (
        <AlbumPlanner />
      )}

      {currentView === 'home' && (
        <main className="hero fade-in">
          <h1>세상에서 가장 똑똑한<br />포켓몬 카드 도감 관리자</h1>
          <p>카드를 사진으로 찍기만 하세요. 구글 Gemini AI가 복잡한 카드 이름, 번호, 확장팩 시리즈 정보를 모두 찾아 노션 도감 형태로 자동 기록합니다.</p>
          
          <div className="btn-group">
            <button type="button" className="btn btn-primary" onClick={() => navigateTo('upload')}>➕ AI로 카드 등록하기</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigateTo('gallery')}>내 도감 갤러리 입장 ({">"}) </button>
          </div>

          <div className="ai-preview-card">
            <span>🚀</span>
            <h3>1,600장의 도감 부활 완료!</h3>
            <p>기존 노션 데이터들이 완벽하게 Firebase로 이사했습니다.</p>
          </div>
        </main>
      )}
      </>
      )}
    </>
  );
}

export default App;
