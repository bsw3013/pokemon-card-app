import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import './index.css';
import CardsPage from './pages/CardsPage';
import SetsPage from './pages/SetsPage';
import CollectionPage from './pages/CollectionPage';
import AdminSettings from './components/AdminSettings';
import AlbumPlanner from './components/AlbumPlanner';
import MarketPrice from './components/MarketPrice';
import NicknameModal from './components/NicknameModal';
import HomeDashboard from './components/home/HomeDashboard';
import TopNav from './components/TopNav';
import AutoImport from './components/admin/AutoImport';
import { defaultConfig } from './defaultConfig';
import { sanitizeStatusOptions } from './utils/statusUtils';
import { useAuth } from './AuthContext';
import { useOwnedCards } from './hooks/useOwnedCards';
import { applyCatalogToConfig } from './utils/catalog';
import { navigate, parseHash } from './utils/hashRoute';

const VIEWS = ['home', 'cards', 'sets', 'collection', 'market', 'album', 'admin'];
// 예전 주소로 들어와도 새 화면으로 연결한다.
const LEGACY = { gallery: 'cards', filter: 'cards', stats: 'collection' };
const DEFAULT_VIEW = 'home';
const LAST_VIEW_KEY = 'pc_last_view';

function readRoute() {
  const { path, params } = parseHash();
  let view = path[0] || '';
  if (LEGACY[view]) view = LEGACY[view];
  if (!VIEWS.includes(view)) {
    let stored = '';
    try { stored = String(window.localStorage.getItem(LAST_VIEW_KEY) || ''); } catch { /* 무시 */ }
    view = VIEWS.includes(LEGACY[stored] || stored) ? (LEGACY[stored] || stored) : DEFAULT_VIEW;
  }
  return { view, param: path[1] || '', params };
}

function App() {
  const { user, loading: authLoading, isAdmin, needsNickname, signInWithGoogle } = useAuth();
  const [showNicknameEditor, setShowNicknameEditor] = useState(false);
  const [route, setRoute] = useState(readRoute);
  const [rawAppConfig, setAppConfig] = useState(null);
  // 세트·레어도 표(settings/catalog)가 있으면 그 순서대로 시리즈·레어도 선택지를 만든다.
  const { catalog } = useOwnedCards();
  const appConfig = useMemo(() => applyCatalogToConfig(rawAppConfig, catalog), [rawAppConfig, catalog]);
  const [marketPresetCard, setMarketPresetCard] = useState(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const currentView = route.view;

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    // 예전 주소(#/gallery 등)나 빈 주소는 새 주소로 바꿔 둔다.
    const { path, params } = parseHash();
    if (!path[0] || LEGACY[path[0]] || !VIEWS.includes(path[0])) {
      const r = readRoute();
      navigate([r.view, ...(r.param ? [r.param] : [])], params, { replace: true });
    }
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(LAST_VIEW_KEY, currentView); } catch { /* 무시 */ }
    window.scrollTo({ top: 0 });
  }, [currentView, route.param]);

  useEffect(() => {
    const handleScroll = () => setShowScrollBtn(window.scrollY > 600);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const viewMarketForCard = (card) => {
    setMarketPresetCard(card);
    navigate(['market']);
  };

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
              statusOptions: sanitizeStatusOptions(fetched.statusOptions || defaultConfig.statusOptions)
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
            // 문서가 없으면 기본값으로 진행 (관리자라면 백그라운드에서 생성)
            setAppConfig(defaultConfig);
            if (isAdmin) {
              setDoc(docRef, defaultConfig).catch(err =>
                console.warn("Config save failed (will retry): ", err)
              );
            }
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
  }, [user, isAdmin]);

  if (authLoading) {
    return (
      <div className="loading-config fade-in">
        <div className="spinner"></div>
        <h2>로그인 상태 확인 중...</h2>
      </div>
    );
  }

  const needLogin = (title, desc) => (
    <main className="page">
      <div className="empty-page">
        <h1>{title}</h1>
        <p className="sub">{desc}</p>
        <button type="button" className="btn btn-primary" onClick={signInWithGoogle}>Google로 로그인</button>
      </div>
    </main>
  );

  return (
    <>
      <TopNav current={currentView} onEditNickname={() => setShowNicknameEditor(true)} />
      <AutoImport />

      {!appConfig ? (
        <div className="loading-config fade-in">
          <div className="spinner"></div>
          <h2>불러오는 중...</h2>
        </div>
      ) : (
        <div className="app-main" key={currentView}>
          {currentView === 'home' && <HomeDashboard appConfig={appConfig} onViewMarket={viewMarketForCard} />}
          {currentView === 'cards' && <CardsPage appConfig={appConfig} onViewMarket={viewMarketForCard} />}
          {currentView === 'sets' && <SetsPage code={route.param} appConfig={appConfig} onViewMarket={viewMarketForCard} />}
          {currentView === 'collection' && (user
            ? <CollectionPage appConfig={appConfig} onViewMarket={viewMarketForCard} />
            : needLogin('내 컬렉션', '로그인하면 내가 가진 카드와 평가액, 세트 완성률을 볼 수 있어요.'))}
          {currentView === 'market' && (
            <MarketPrice appConfig={appConfig} presetCard={marketPresetCard} clearPreset={() => setMarketPresetCard(null)} />
          )}
          {currentView === 'album' && (user
            ? <AlbumPlanner appConfig={appConfig} />
            : needLogin('앨범 꾸미기', '앨범은 로그인한 계정별로 저장돼요.'))}
          {currentView === 'admin' && (isAdmin ? (
            <main className="admin-page">
              <AdminSettings appConfig={appConfig} setAppConfig={setAppConfig} />
            </main>
          ) : (
            <main className="page"><div className="empty-page"><h1>접근 권한이 없습니다.</h1><p className="sub">마스터 설정은 관리자 계정만 사용할 수 있습니다.</p></div></main>
          ))}
        </div>
      )}

      {showScrollBtn && (
        <button type="button" className="scroll-to-top-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="맨 위로 이동" aria-label="맨 위로 이동">▲</button>
      )}

      {needsNickname && <NicknameModal forced />}
      {!needsNickname && showNicknameEditor && <NicknameModal onClose={() => setShowNicknameEditor(false)} />}
    </>
  );
}

export default App;
