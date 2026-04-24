import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import './index.css';
import CardUpload from './components/CardUpload';
import CardList from './components/CardList';
import AdminSettings from './components/AdminSettings';
import { defaultConfig } from './defaultConfig';

function App() {
  const [currentView, setCurrentView] = useState('home'); // 화면 라우팅 상태
  const [appConfig, setAppConfig] = useState(null);

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
      <nav className="navbar">
        <div className="logo" onClick={() => setCurrentView('home')} style={{cursor: 'pointer'}}>PokéDex AI</div>
        <div className="btn-group" style={{ gap: '1rem' }}>
          <button className="btn btn-secondary" style={{ padding: '0.5rem 1.5rem', fontSize: '0.9rem' }} onClick={() => setCurrentView('gallery')}>나의 도감</button>
          <button className="btn btn-primary" style={{ padding: '0.5rem 1.5rem', fontSize: '0.9rem' }} onClick={() => setCurrentView('admin')}>⚙️ 마스터 설정</button>
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

      {currentView === 'home' && (
        <main className="hero fade-in">
          <h1>세상에서 가장 똑똑한<br />포켓몬 카드 도감 관리자</h1>
          <p>카드를 사진으로 찍기만 하세요. 구글 Gemini AI가 복잡한 카드 이름, 번호, 확장팩 시리즈 정보를 모두 찾아 노션 도감 형태로 자동 기록합니다.</p>
          
          <div className="btn-group">
            <button className="btn btn-primary" onClick={() => setCurrentView('upload')}>➕ AI로 카드 등록하기</button>
            <button className="btn btn-secondary" onClick={() => setCurrentView('gallery')}>내 도감 갤러리 입장 ({">"}) </button>
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
