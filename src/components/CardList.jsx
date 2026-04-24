import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';

const { krToEn, krToJa } = pokemonMapAll;

export default function CardList({ appConfig }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // 필터 및 정렬 상태
   const [searchTerm, setSearchTerm] = useState('');
   const deferredSearchTerm = useDeferredValue(searchTerm);
   const [sortPanelOpen, setSortPanelOpen] = useState(false);
   const [sortLevels, setSortLevels] = useState([
      { field: 'pokedexNumber', dir: 'asc', enabled: true },
      { field: '', dir: 'asc', enabled: false },
      { field: '', dir: 'asc', enabled: false },
      { field: '', dir: 'asc', enabled: false },
      { field: '', dir: 'asc', enabled: false }
   ]);

  // 첫 번째 메인 수정 모달창 상태
  const [selectedCard, setSelectedCard] = useState(null);
  const [editData, setEditData] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  
  // 📸 두 번째 초대형 멀티 언어 이미지 픽커 상태
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState('en'); // 'en', 'ja'
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // 📷 직접 업로드 및 URL 입력 상태
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  // 📝 스프레드시트 관리자 뷰
  const [viewMode, setViewMode] = useState('gallery'); // 'gallery' | 'table'
  const [currentPage, setCurrentPage] = useState(1);
  const [tableDrafts, setTableDrafts] = useState({});
  const [isRowSaving, setIsRowSaving] = useState({});
  const itemsPerPage = 50;

   const visibleDisplayFields = useMemo(() => {
      return appConfig.displayFields
         .filter(f => f.visible)
         .slice()
         .sort((a, b) => a.order - b.order);
   }, [appConfig.displayFields]);

   useEffect(() => {
      try {
         const raw = localStorage.getItem('pc_sort_levels');
         if (raw) setSortLevels(JSON.parse(raw));
      } catch (e) { /* ignore */ }
   }, []);

   const persistSortLevels = (next) => {
      setSortLevels(next);
      try { localStorage.setItem('pc_sort_levels', JSON.stringify(next)); } catch (e) {}
   };

   const SORT_OPTIONS = [
      { value: '', label: '없음' },
      { value: 'createdAt', label: '등록일' },
      { value: 'pokedexNumber', label: '전국도감번호' },
      { value: 'series', label: '시리즈' },
      { value: 'cardName', label: '카드 이름' },
      { value: 'price', label: '가격' },
      { value: 'status', label: '보유 상태' },
      { value: 'rarity', label: '레어도' },
      { value: 'type', label: '카드 종류' }
   ];

   const handleLevelFieldChange = (index, field) => {
      const next = sortLevels.slice();
      next[index] = { ...next[index], field, enabled: !!field };
      persistSortLevels(next);
   };

   const toggleLevelDir = (index) => {
      const next = sortLevels.slice();
      next[index].dir = next[index].dir === 'asc' ? 'desc' : 'asc';
      persistSortLevels(next);
   };

   const toggleLevelEnabled = (index) => {
      const next = sortLevels.slice();
      next[index].enabled = !next[index].enabled;
      // if turning off, clear field
      if (!next[index].enabled) next[index].field = '';
      persistSortLevels(next);
   };

   const resetSortLevels = () => {
      const def = [
         { field: 'pokedexNumber', dir: 'asc', enabled: true },
         { field: '', dir: 'asc', enabled: false },
         { field: '', dir: 'asc', enabled: false },
         { field: '', dir: 'asc', enabled: false },
         { field: '', dir: 'asc', enabled: false }
      ];
      persistSortLevels(def);
   };

  useEffect(() => {
    async function fetchCards() {
      try {
        const snap = await getDocs(collection(db, "pokemon_cards"));
        const fetched = [];
        snap.forEach(doc => {
          fetched.push({ id: doc.id, ...doc.data() });
        });
        setCards(fetched);
      } catch(err) {
        console.error("데이터 불러오기 실패", err);
      } finally {
        setLoading(false);
      }
    }
    fetchCards();
  }, []);

   const filteredAndSortedCards = useMemo(() => {
    let result = [...cards];
      if (deferredSearchTerm) {
         const lowerWord = deferredSearchTerm.toLowerCase();
      result = result.filter(card => 
        (card.cardName || '').toLowerCase().includes(lowerWord) ||
        (card.series || '').toLowerCase().includes(lowerWord) ||
        (card.cardNumber || '').includes(lowerWord) ||
        (card.pokedexNumber || '').includes(lowerWord)
      );
    }
      // Multi-level sorting: if any sortLevels enabled use them, otherwise fallback to previous single-sort behavior
      const activeLevels = sortLevels.filter(l => l.enabled && l.field);
      if (activeLevels.length) {
         const statusOrder = (appConfig.statusOptions && Array.isArray(appConfig.statusOptions)) ? appConfig.statusOptions : ['보유중','등급카드','미보유'];
         const statusRank = {};
         statusOrder.forEach((s,i)=> statusRank[s] = i);

         result.sort((a,b) => {
            for (const lvl of activeLevels) {
               const field = lvl.field;
               const dir = lvl.dir === 'desc' ? -1 : 1;
               let va = a[field];
               let vb = b[field];

               // Treat missing/invalid values as "absent" and always place them after present values
               const isNumericField = field === 'pokedexNumber' || field === 'price';
               const aRaw = va;
               const bRaw = vb;
               let aHas = aRaw !== undefined && aRaw !== null && String(aRaw).trim() !== '';
               let bHas = bRaw !== undefined && bRaw !== null && String(bRaw).trim() !== '';
               if (field === 'createdAt') {
                  aHas = !!a.createdAt;
                  bHas = !!b.createdAt;
               }
               if (isNumericField) {
                  aHas = aHas && Number.isFinite(Number(aRaw));
                  bHas = bHas && Number.isFinite(Number(bRaw));
               }

               if (!aHas || !bHas) {
                  if (!aHas && !bHas) {
                     // both absent -> treat as equal for this level, continue to next level
                     continue;
                  }
                  // one is absent: absent item should be after present item regardless of direction
                  if (!aHas) return 1;
                  return -1;
               }

               let cmp = 0;
               if (field === 'createdAt') {
                  const ta = new Date(a.createdAt).getTime();
                  const tb = new Date(b.createdAt).getTime();
                  cmp = ta - tb;
               } else if (isNumericField) {
                  cmp = Number(aRaw) - Number(bRaw);
               } else if (field === 'status') {
                  const ra = statusRank[aRaw] ?? 999;
                  const rb = statusRank[bRaw] ?? 999;
                  cmp = ra - rb;
               } else {
                  cmp = String(aRaw).localeCompare(String(bRaw), 'ko');
               }

               if (cmp !== 0) return cmp * dir;
            }
            return 0;
         });
      } else {
         // fallback: default to pokedexNumber ascending
         result.sort((a, b) => {
             return (Number(a.pokedexNumber) || 0) - (Number(b.pokedexNumber) || 0);
         });
      }
    return result;
   }, [cards, deferredSearchTerm, sortLevels]);
  
  const totalPages = Math.ceil(filteredAndSortedCards.length / itemsPerPage);
  const currentPageCards = viewMode === 'table' ? filteredAndSortedCards.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) : filteredAndSortedCards;
  
  // 검색이나 정렬이 변경되면 페이지를 1로 리셋합니다.
   useEffect(() => { setCurrentPage(1); }, [deferredSearchTerm, sortLevels]);

  const commitTableCell = async (id, field, rawValue) => {
     const currentCard = cards.find(card => card.id === id);
     if (!currentCard) return;
      const nextValueRaw = field === 'price' ? (parseInt(rawValue) || 0) : rawValue;
      const currentValue = field === 'price' ? (Number(currentCard[field]) || 0) : (currentCard[field] ?? '');

      // Normalize pokedexNumber for storage/display; leave cardNumber untouched
      let finalNext = nextValueRaw;
      if (field === 'pokedexNumber') finalNext = normalizePokedexNumber(String(nextValueRaw || ''));

      const normalizedFinalNext = field === 'price' ? Number(finalNext || 0) : String(finalNext ?? '');
      const normalizedCurrent = field === 'price' ? Number(currentValue || 0) : String(currentValue ?? '');
      if (normalizedFinalNext === normalizedCurrent) return;

      setIsRowSaving(prev => ({ ...prev, [id]: true }));
      try {
         const cardRef = doc(db, "pokemon_cards", id);
         await updateDoc(cardRef, { [field]: finalNext });
         setCards(prev => prev.map(card => card.id === id ? { ...card, [field]: finalNext } : card));
         setTableDrafts(prev => {
            const nextDrafts = { ...prev };
            if (nextDrafts[id]) {
               const { [field]: removed, ...rest } = nextDrafts[id];
               if (Object.keys(rest).length === 0) delete nextDrafts[id];
               else nextDrafts[id] = rest;
            }
            return nextDrafts;
         });
      } catch(err) {
         console.error("자동저장 실패:", err);
      } finally {
         setIsRowSaving(prev => ({ ...prev, [id]: false }));
      }
  };

   // Normalize pokedexNumber: pad numeric sequences to 4 digits (e.g. 1 -> 0001)
   const padTo4 = (num) => String(num).padStart(4, '0');
   const normalizePokedexNumber = (raw) => {
      if (raw === undefined || raw === null) return '';
      const s = String(raw).trim();
      if (!s) return '';
      return String(s).replace(/\d+/g, (m) => padTo4(m));
   };
   const displayPokedexNumber = (raw) => normalizePokedexNumber(raw);

  // 메인 모달
  const openModal = (card) => {
     setSelectedCard(card);
     setEditData({ ...card, possessions: (card.possessions || []).slice() });
  };
   const openCreate = () => {
      const base = {
         cardName: '',
         series: '',
         cardNumber: '',
         rarity: '',
         type: '',
         pokedexNumber: '',
         status: '미보유',
         price: 0,
         imageUrl: '',
         possessions: []
      };
      setSelectedCard({ isNew: true });
      setEditData(base);
   };
  const closeModal = () => {
    setSelectedCard(null);
    setEditData({});
    setUrlInput('');
  };
  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData(prev => ({ ...prev, [name]: value }));
  };
   const handleSave = async (e) => {
      e.preventDefault();
      setIsSaving(true);
      try {
         const updatePayload = {
            cardName: editData.cardName || '',
            series: editData.series || '',
            cardNumber: editData.cardNumber || '',
            rarity: editData.rarity || '',
            type: editData.type || '',
            pokedexNumber: normalizePokedexNumber(editData.pokedexNumber || ''),
            status: editData.status || '미보유',
            price: parseInt(editData.price) || 0,
            imageUrl: editData.imageUrl || '',
            possessions: editData.possessions || []
         };

         if (selectedCard && selectedCard.isNew) {
            const ref = await addDoc(collection(db, 'pokemon_cards'), updatePayload);
            setCards(prev => [{ id: ref.id, ...updatePayload }, ...prev]);
         } else if (selectedCard && selectedCard.id) {
            const cardRef = doc(db, "pokemon_cards", selectedCard.id);
            await updateDoc(cardRef, updatePayload);
            setCards(prev => prev.map(c => c.id === selectedCard.id ? { ...c, ...updatePayload } : c));
         }
         closeModal();
      } catch(err) {
         console.error(err);
         alert("저장 중 오류가 발생했습니다.");
      } finally {
         setIsSaving(false);
      }
   };
  const handleDelete = async () => {
    if(!window.confirm("정말로 이 카드를 창고에서 삭제할까요?")) return;
    try {
      await deleteDoc(doc(db, "pokemon_cards", selectedCard.id));
      setCards(prev => prev.filter(c => c.id !== selectedCard.id));
      closeModal();
    } catch(err) {
      console.error(err);
      alert("삭제 실패");
    }
  };

  const handleDeleteSub = async (id) => {
    if(!window.confirm("정말로 이 카드를 창고에서 삭제할까요?")) return;
    try {
      await deleteDoc(doc(db, "pokemon_cards", id));
      setCards(prev => prev.filter(c => c.id !== id));
    } catch(err) {
      console.error(err);
      alert("삭제 실패");
    }
  };

  // --- 테이블 뷰 인라인 편집기 ---
  const handleTableEditChange = (id, field, value) => {
     setTableDrafts(prev => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          [field]: value
        }
     }));
     setCards(prev => prev.map(card => card.id === id ? { ...card, [field]: field === 'price' ? (parseInt(value) || 0) : value } : card));
  };

  const handleTableEditBlur = (id, field) => {
     const draftValue = tableDrafts[id]?.[field];
     if (draftValue === undefined) return;
     commitTableCell(id, field, draftValue);
  };

  const handleTableSelectChange = (id, field, value) => {
     setTableDrafts(prev => ({
        ...prev,
        [id]: {
          ...(prev[id] || {}),
          [field]: value
        }
     }));
     commitTableCell(id, field, value);
  };

  // --- 거대 픽커 모달 관련 ---
  const openPicker = () => {
      setIsPickerOpen(true);
      setPickerTab('en');
      setPickerQuery(editData.cardName || editData.cardNumber || '');
      setPickerResults([]);
  };
  const closePicker = () => {
      setIsPickerOpen(false);
      setPickerResults([]);
  };

  // 탭이 바뀔때 바로바로 검색 재가동
  useEffect(() => {
    if (isPickerOpen && pickerQuery.trim()) {
       handlePickerSearch();
    }
  }, [pickerTab]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileName = `cards/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, fileName);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(snapshot.ref);
      setEditData(prev => ({ ...prev, imageUrl: downloadUrl }));
    } catch(err) {
      console.error(err);
      alert("이미지 업로드에 실패했습니다. 파일 용량이나 네트워크를 확인하세요.");
    } finally {
      setUploading(false);
    }
  };

  const applyUrlInput = () => {
    if (urlInput.trim()) {
      setEditData(prev => ({ ...prev, imageUrl: urlInput.trim() }));
      setUrlInput('');
    }
  };

  const handlePickerSearch = async (e) => {
    if(e) e.preventDefault();
    let queryText = pickerQuery.trim();
    if (!queryText) return;
    
    setPickerLoading(true);
    setPickerResults([]);
    
    try {
      if (pickerTab === 'en') {
        // 🇺🇸 글로벌 영문 데이터베이스 (포켓몬 TCG API) & 자동 통번역
        let enName = krToEn[queryText] || queryText;
        const parts = queryText.split(' ');
        if (krToEn[parts[0]]) {
            enName = krToEn[parts[0]] + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
        }
        
        const url = `https://api.pokemontcg.io/v2/cards?q=name:"*${enName}*" OR number:"*${queryText}*"&pageSize=50`;
        const res = await fetch(url);
        const json = await res.json();
        if (json && json.data) {
           // 화면 로딩 지연 방지를 위해 thumbnail 구조 분리
           setPickerResults(json.data.map(c => ({ 
              id: c.id, 
              thumbnail: c.images.small, 
              fullImage: c.images.large || c.images.small
           })));
        }
      }
      else if (pickerTab === 'ja') {
        // 🇯🇵 일본 오리지널 데이터베이스 (TCGdex JP) & 자동 통번역
        let jaName = krToJa[queryText] || queryText;
        const parts = queryText.split(' ');
        if (krToJa[parts[0]]) {
            jaName = krToJa[parts[0]] + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
        }
        
        const url = `https://api.tcgdex.net/v2/ja/cards?name=${encodeURIComponent(jaName)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (Array.isArray(json)) {
           // 고화질 png 파싱 과정 지연 제거를 위해 분리
           const valid = json.filter(c => c.image).slice(0, 50);
           setPickerResults(valid.map(c => ({ 
              id: c.id, 
              thumbnail: `${c.image}/low.webp`, // 브라우저 랜더링이 압도적으로 빠른 webp 썸네일
              fullImage: `${c.image}/high.png` // DB용 고화질
           })));
        }
      }
    } catch (err) {
      console.error(err);
      alert("검색 서버에 연결하는 데 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setPickerLoading(false);
    }
  };

  const selectPickerImage = (imgUrl) => {
      setEditData(prev => ({ ...prev, imageUrl: imgUrl }));
      closePicker();
  };

   const renderPossessionBadges = (card) => {
      const poss = card.possessions || [];
      return poss.map((p, i) => (
         <span key={(p.id || i)} className="badge-possession" style={{ background: '#f3f4f6', padding: '0.15rem 0.4rem', borderRadius: '4px', marginRight: '0.3rem', fontSize: '0.75rem' }}>
             {p.region}{p.count ? ` x${p.count}` : ''}
         </span>
      ));
   };

   // 카드 문서의 possessions 배열에서 가장 높은 그레이딩(예: PSA 10)을 찾음
   const getTopGrading = (card) => {
      const poss = card.possessions || [];
      let top = null;
      poss.forEach(p => {
         (p.graded || []).forEach(g => {
            if (!g || !g.company || !g.grade) return;
            // 숫자 레어도 우선 비교 (문자열이면 그대로 표시)
            const gradeNum = parseFloat(String(g.grade).replace(/[^0-9.]/g, '')) || null;
            if (!top) top = { company: g.company, grade: g.grade, gradeNum };
            else if (gradeNum && top.gradeNum && gradeNum > top.gradeNum) top = { company: g.company, grade: g.grade, gradeNum };
         });
      });
      return top; // {company, grade, gradeNum} 또는 null
   };

   // --- possessions(보유 정보) 관련 유틸 ---
   const addPossession = () => {
      setEditData(prev => ({
         ...prev,
         possessions: [
            ...(prev.possessions || []),
            { id: `p_${Date.now()}`, region: 'KR', count: 1, company: '', grade: '', serial: '', notes: '' }
         ]
      }));
   };

   const updatePossessionField = (index, field, value) => {
      setEditData(prev => {
         const poss = (prev.possessions || []).slice();
         if (!poss[index]) return prev;
         poss[index] = { ...poss[index], [field]: value };
         return { ...prev, possessions: poss };
      });
   };

   const removePossession = (index) => {
      setEditData(prev => {
         const poss = (prev.possessions || []).slice();
         poss.splice(index, 1);
         return { ...prev, possessions: poss };
      });
   };

   const addGrading = (pIndex) => {
      setEditData(prev => {
         const poss = (prev.possessions || []).slice();
         if (!poss[pIndex]) return prev;
         poss[pIndex].graded = [...(poss[pIndex].graded || []), { company: '', grade: '', serial: '' }];
         return { ...prev, possessions: poss };
      });
   };

   const updateGrading = (pIndex, gIndex, field, value) => {
      setEditData(prev => {
         const poss = (prev.possessions || []).slice();
         if (!poss[pIndex] || !poss[pIndex].graded) return prev;
         const graded = (poss[pIndex].graded || []).slice();
         graded[gIndex] = { ...graded[gIndex], [field]: value };
         poss[pIndex].graded = graded;
         return { ...prev, possessions: poss };
      });
   };

   const removeGrading = (pIndex, gIndex) => {
      setEditData(prev => {
         const poss = (prev.possessions || []).slice();
         if (!poss[pIndex] || !poss[pIndex].graded) return prev;
         const graded = (poss[pIndex].graded || []).slice();
         graded.splice(gIndex, 1);
         poss[pIndex].graded = graded;
         return { ...prev, possessions: poss };
      });
   };



  if (loading) {
     return (
        <div className="loading-gallery fade-in">
           <div className="spinner"></div>
           <h2>소중한 도감을 여는 중입니다...</h2>
           <p>1,600여 장의 카드 데이터를 고속 캐싱하고 있습니다. 잠시만 기다려주세요 🚀</p>
        </div>
     )
  }

  return (
    <div className="gallery-container slide-up">
       <div className="gallery-header">
          <h2>나만의 포켓몬 도감 <span>({filteredAndSortedCards.length}장)</span></h2>
          <div className="gallery-controls">
             <button type="button" className="btn btn-primary" style={{marginRight: '0.6rem'}} onClick={openCreate}>➕ 카드 추가</button>
             <input type="text" className="search-input" placeholder="🔍 이름, 일련번호, 도감번호 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             <button type="button" className="btn btn-secondary" style={{marginLeft: '0.6rem'}} onClick={() => setSortPanelOpen(p => !p)}>정렬 설정</button>
             {sortPanelOpen && (
               <div className="sort-panel" style={{position:'absolute', right: '2rem', top: '5.8rem', background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', zIndex:1200, width: 420}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.6rem'}}>
                     <strong>정렬 우선순위 (최대 5단계)</strong>
                     <div style={{display:'flex', gap:'0.4rem'}}>
                        <button type="button" className="btn" onClick={resetSortLevels} style={{padding:'0.25rem 0.6rem'}}>초기화</button>
                        <button type="button" className="btn btn-primary" onClick={() => setSortPanelOpen(false)} style={{padding:'0.25rem 0.6rem'}}>닫기</button>
                     </div>
                  </div>
                  {sortLevels.map((lvl, idx) => (
                    <div key={idx} style={{display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.45rem'}}>
                       <div style={{width:'24px', textAlign:'center', fontWeight:700}}>{idx+1}</div>
                       <select value={lvl.field} onChange={(e) => handleLevelFieldChange(idx, e.target.value)} style={{flex:1, padding:'0.4rem'}}>
                         {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                       </select>
                       <button type="button" className="btn" onClick={() => toggleLevelDir(idx)} style={{width:'48px'}}>{lvl.dir === 'asc' ? '▲' : '▼'}</button>
                       <button type="button" className={`btn ${lvl.enabled ? 'btn-primary' : ''}`} onClick={() => toggleLevelEnabled(idx)} style={{width:'48px'}}>{lvl.enabled ? 'ON' : 'OFF'}</button>
                    </div>
                  ))}
                  <div style={{display:'flex', justifyContent:'flex-end', gap:'0.5rem', marginTop:'0.6rem'}}>
                     <button type="button" className="btn" onClick={() => { persistSortLevels(sortLevels); setSortPanelOpen(false); }}>저장</button>
                  </div>
               </div>
             )}
             <div className="view-toggle">
                <button className={`btn-toggle ${viewMode === 'gallery' ? 'active' : ''}`} onClick={() => setViewMode('gallery')}>🖼️ 갤러리</button>
                <button className={`btn-toggle ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>📋 표</button>
             </div>
          </div>
       </div>

       {viewMode === 'table' ? (
           <div className="admin-table-container fade-in">
              <table className="admin-table">
                 <thead>
                    <tr>
                       <th>사진</th>
                        {visibleDisplayFields.map(f => (
                           <th key={f.id}>{f.label}</th>
                       ))}
                    </tr>
                 </thead>
                 <tbody>
                    {currentPageCards.map(card => {
                        const data = card;
                        const isSavingRef = isRowSaving[card.id];
                        const rowDrafts = tableDrafts[card.id] || {};

                        const cellInputs = {
                        cardName: <input type="text" className="table-input" value={rowDrafts.cardName ?? data.cardName ?? ''} onChange={(e) => handleTableEditChange(card.id, 'cardName', e.target.value)} onBlur={() => handleTableEditBlur(card.id, 'cardName')} />,
                        pokedexNumber: <input type="text" className="table-input" style={{width: '60px', textAlign: 'center'}} value={rowDrafts.pokedexNumber ?? displayPokedexNumber(data.pokedexNumber) ?? ''} onChange={(e) => handleTableEditChange(card.id, 'pokedexNumber', e.target.value)} onBlur={() => handleTableEditBlur(card.id, 'pokedexNumber')} />,
                        series: <select className="table-input" value={rowDrafts.series ?? data.series ?? ''} onChange={(e) => handleTableSelectChange(card.id, 'series', e.target.value)}><option value="">선택</option>{appConfig.seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                        cardNumber: <input type="text" className="table-input" style={{width: '90px'}} value={rowDrafts.cardNumber ?? data.cardNumber ?? ''} onChange={(e) => handleTableEditChange(card.id, 'cardNumber', e.target.value)} onBlur={() => handleTableEditBlur(card.id, 'cardNumber')} />,
                        rarity: <select className="table-input" style={{width: '90px'}} value={rowDrafts.rarity ?? data.rarity ?? ''} onChange={(e) => handleTableSelectChange(card.id, 'rarity', e.target.value)}><option value="">선택</option>{appConfig.rarityOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                        type: <select className="table-input" style={{width: '100px'}} value={rowDrafts.type ?? data.type ?? ''} onChange={(e) => handleTableSelectChange(card.id, 'type', e.target.value)}><option value="">선택</option>{appConfig.typeOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                        status: <select className="table-input" style={{width: '110px'}} value={rowDrafts.status ?? data.status ?? ''} onChange={(e) => handleTableSelectChange(card.id, 'status', e.target.value)}><option value="">선택</option>{appConfig.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                        price: <input type="number" className="table-input price-input" value={rowDrafts.price ?? data.price ?? 0} onChange={(e) => handleTableEditChange(card.id, 'price', e.target.value)} onBlur={() => handleTableEditBlur(card.id, 'price')} />
                        };

                        return (
                           <tr key={card.id} className={isSavingRef ? 'row-draft' : ''}>
                              <td className="center-cell td-photo" onClick={() => openModal(card)} style={{ position: 'relative' }}>
                                 {data.imageUrl ? <img src={data.imageUrl} alt="preview" className="table-thumb" /> : <div className="table-no-thumb-wrapper"><img src="/placeholder.png" alt="placeholder" className="table-placeholder-img" /><div className="table-placeholder-text">이미지 필요</div></div>}
                                 {isSavingRef && <div style={{position:'absolute', top: 0, right: 0, padding:'2px 4px', fontSize: '0.7rem', color: '#10b981', fontWeight:'bold', background:'rgba(0,0,0,0.5)'}}>저장됨✅</div>}
                              </td>
                              {visibleDisplayFields.map(f => (
                                 <td key={f.id}>
                                     {cellInputs[f.id] ? cellInputs[f.id] : (
                                        <input type="text" className="table-input" value={rowDrafts[f.id] ?? data[f.id] ?? ''} onChange={(e) => handleTableEditChange(card.id, f.id, e.target.value)} onBlur={() => handleTableEditBlur(card.id, f.id)} />
                                     )}
                                 </td>
                              ))}
                           </tr>
                        )
                    })}
                 </tbody>
              </table>

              {totalPages > 1 && (
                 <div className="pagination">
                    <button className="page-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>{"<"} 이전</button>
                    <span>{currentPage} / {totalPages} (총 {filteredAndSortedCards.length}장)</span>
                    <button className="page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>다음 {">"}</button>
                 </div>
              )}
           </div>
       ) : (
          <div className="card-grid">
             {filteredAndSortedCards.map(card => (
             <div className="card-item fade-in" key={card.id} onClick={() => openModal(card)}>
                <div className="card-image-wrapper">
                   {card.imageUrl ? (
                     <>
                       <img src={card.imageUrl} alt={card.cardName} loading="lazy" />
                       {/* 레어도(AR/SAR) 배지 - rarity 필드 사용 */}
                       {card.rarity && <span className="card-rarity">{card.rarity}</span>}
                       {/* 그레이딩(예: PSA 10) 배지 */}
                       {(() => {
                         const top = getTopGrading(card);
                         return top ? <span className="grading-badge">{top.company} {top.grade}</span> : null;
                       })()}
                     </>
                   ) : (
                      <div className="no-image-wrapper"><img src="/placeholder.png" alt="placeholder" className="placeholder-img" /><div className="placeholder-text">이미지<br/>필요</div></div>
                   )}
                </div>
                <div className="card-info">
                   <h3 className="card-name" title={card.cardName}>{card.cardName || '이름 없음'}</h3>
                   <div className="card-meta">
                      {card.series && <span className="badge-series">{card.series}</span>}
                      {card.cardNumber && <span className="badge-number">No.{card.cardNumber}</span>}
                      {card.pokedexNumber && <span className="badge-number">도감 번호 {displayPokedexNumber(card.pokedexNumber)}</span>}
                   </div>
                   <div className="card-bottom">
                      <span className={`card-status ${((card.status||'미보유').replace(/\s+/g,'-'))}`}>{card.status || '미보유'}</span>
                   </div>
                </div>
             </div>
          ))}
          {filteredAndSortedCards.length === 0 && <div className="empty-results">검색어와 일치하는 카드가 없습니다.</div>}
       </div>
       )}

       {/* 상세 및 수정 모달 (작은화면 모달) */}
       {selectedCard && (
          <div className="modal-backdrop fade-in" onClick={closeModal} style={{ zIndex: 1000}}>
             <div className="modal-content slide-up" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close" onClick={closeModal}>✕</button>
                <h2 className="modal-title">💎 카드 상세 / 편집기</h2>
                <div className="modal-body">
                   <div className="modal-image-col">
                      <div className="modal-card-image">
                         {editData.imageUrl ? (
                             <img src={editData.imageUrl} alt="preview" />
                         ) : (
                             <div className="placeholder-image"><img src="/placeholder.png" alt="placeholder" className="modal-placeholder-img" /><div className="modal-placeholder-text">이미지<br/>필요</div></div>
                         )}
                      </div>
                      
                      <div className="image-upload-options">
                         <h5>사진 등록 방식 선택</h5>
                         
                         {/* 1. 검색으로 불러오기 */}
                         <div className="upload-option">
                             <button type="button" className="btn btn-secondary fetch-btn" onClick={openPicker}>
                               🌐 스마트 다국어 검색
                             </button>
                         </div>

                         {/* 2. 기기에서 파일 불러오기 */}
                         <div className="upload-option">
                             <label className="btn btn-secondary file-upload-btn">
                               {uploading ? "📤 업로드 중..." : "📤 기기에서 파일 선택"}
                               <input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
                             </label>
                         </div>

                         {/* 3. URL 직접 입력 */}
                         <div className="upload-option url-input-group">
                             <input 
                                type="text" 
                                placeholder="이미지 URL 직접 입력..." 
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                             />
                             <button type="button" className="btn btn-primary" onClick={applyUrlInput}>적용</button>
                         </div>
                      </div>
                   </div>
                   <form className="modal-form" onSubmit={handleSave}>
                       <div className="dynamic-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                          {appConfig.displayFields.filter(f => f.visible).sort((a,b)=>a.order-b.order).map(f => (
                             <div className="sub-group" key={f.id} style={{ display: 'flex', flexDirection: 'column' }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{f.label}</label>
                                {f.id === 'cardName' && <input type="text" name="cardName" value={editData.cardName || ''} onChange={handleEditChange} />}
                                {f.id === 'pokedexNumber' && <input type="text" name="pokedexNumber" value={editData.pokedexNumber || ''} onChange={handleEditChange} />}
                                {f.id === 'cardNumber' && <input type="text" name="cardNumber" value={editData.cardNumber || ''} onChange={handleEditChange} />}
                                {f.id === 'price' && <input type="number" name="price" value={editData.price || 0} onChange={handleEditChange} />}
                                
                                {f.id === 'series' && (
                                   <select name="series" value={editData.series || ''} onChange={handleEditChange}>
                                      <option value="">시리즈 직접 선택</option>
                                      {appConfig.seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                   </select>
                                )}
                                {f.id === 'rarity' && (
                                   <select name="rarity" value={editData.rarity || ''} onChange={handleEditChange}>
                                      <option value="">직접 선택</option>
                                      {appConfig.rarityOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                   </select>
                                )}
                                {f.id === 'type' && (
                                   <select name="type" value={editData.type || ''} onChange={handleEditChange}>
                                      <option value="">선택</option>
                                      {appConfig.typeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                   </select>
                                )}
                                {f.id === 'status' && (
                                   <div>
                                      <div style={{ marginBottom: '0.6rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                         <div style={{ flex: '0 0 auto' }}>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '0.4rem' }}>보유여부</label>
                                         </div>
                                         <div style={{ flex: '0 0 220px' }}>
                                            <select name="status" value={editData.status || '미보유'} onChange={handleEditChange} style={{ width: '100%' }}>
                                               <option value="미보유">미보유</option>
                                               <option value="보유중">보유중</option>
                                               <option value="등급카드">등급카드</option>
                                            </select>
                                         </div>
                                      </div>

                                      <div className="possession-section">
                                         <div className="possession-header">
                                            <div className="pos-field country">국가</div>
                                            <div className="pos-field company">등급 업체</div>
                                            <div className="pos-field grade">등급</div>
                                            <div className="pos-field count">수량</div>
                                            <div className="pos-field serial">시리얼 번호</div>
                                            <div className="pos-actions"></div>
                                         </div>

                                         {(editData.possessions || []).map((p, idx) => (
                                            <div key={p.id || idx} className="possession-row">
                                               <div className="pos-field country">
                                                  <label style={{display:'none'}}>국가</label>
                                                  <select name={`poss-${idx}-region`} data-pos-field="region" value={p.region || 'KR'} onChange={(e) => updatePossessionField(idx, 'region', e.target.value)}>
                                                     <option value="KR">한국판 (KR)</option>
                                                     <option value="JP">일본판 (JP)</option>
                                                     <option value="US">미국판 (US)</option>
                                                     <option value="CN">중국판 (CN)</option>
                                                  </select>
                                               </div>

                                               <div className="pos-field company">
                                                  <label style={{display:'none'}}>등급 업체</label>
                                                  <select name={`poss-${idx}-company`} data-pos-field="company" value={p.company || ''} onChange={(e) => updatePossessionField(idx, 'company', e.target.value)}>
                                                     <option value="">선택</option>
                                                     {(appConfig.gradingCompaniesOptions || []).map(c => <option key={c} value={c}>{c}</option>)}
                                                     <option value="raw">raw</option>
                                                  </select>
                                               </div>

                                               <div className="pos-field grade">
                                                  <label style={{display:'none'}}>등급</label>
                                                  <select name={`poss-${idx}-grade`} data-pos-field="grade" value={p.grade || ''} onChange={(e) => updatePossessionField(idx, 'grade', e.target.value)} disabled={p.company === 'raw'}>
                                                     <option value="">선택</option>
                                                     {((appConfig.gradingScaleOptions && appConfig.gradingScaleOptions.length) ? appConfig.gradingScaleOptions : Array.from({length:10},(_,i)=>String(i+1))).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                                  </select>
                                               </div>

                                               <div className="pos-field count">
                                                  <label style={{display:'none'}}>수량</label>
                                                  <input name={`poss-${idx}-count`} data-pos-field="count" type="number" min={0} value={p.count || 1} onChange={(e) => updatePossessionField(idx, 'count', parseInt(e.target.value || 0))} />
                                               </div>

                                               <div className="pos-field serial">
                                                  <label style={{display:'none'}}>시리얼</label>
                                                  <input name={`poss-${idx}-serial`} data-pos-field="serial" type="text" value={p.serial || ''} onChange={(e) => updatePossessionField(idx, 'serial', e.target.value)} disabled={p.company === 'raw'} />
                                               </div>

                                               <div className="pos-actions">
                                                  <button
                                                     type="button"
                                                     className="btn btn-delete"
                                                     title="보유 정보 삭제"
                                                     onClick={() => removePossession(idx)}
                                                  >
                                                     <span className="icon" aria-hidden>🗑</span>
                                                  </button>
                                               </div>
                                            </div>
                                         ))}

                                         <div style={{ marginTop: '0.5rem' }}>
                                            <button type="button" className="btn btn-secondary" onClick={addPossession}>➕ 보유 정보 추가</button>
                                         </div>
                                      </div>
                                   </div>
                                )}
                                {!['cardName', 'pokedexNumber', 'series', 'cardNumber', 'rarity', 'type', 'status', 'price'].includes(f.id)
                                  && f.label !== '보유 여부' && f.label !== '보유여부' && (
                                   <input type="text" name={f.id} value={editData[f.id] || ''} onChange={handleEditChange} />
                                )}
                             </div>
                          ))}
                       </div>
                       <div className="modal-actions">
                          <button type="button" className="btn btn-danger" onClick={handleDelete}>🗑 카드 지우기</button>
                          <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? "저장 중..." : "수정사항 덮어쓰기"}</button>
                       </div>
                    </form>
                </div>
             </div>
          </div>
       )}

       {/* 두 번째 레이어: 초대형 이미지 픽커 팝업 */}
       {isPickerOpen && (
          <div className="picker-backdrop fade-in" onClick={closePicker} style={{ zIndex: 2000}}>
             <div className="picker-content slide-up" onClick={e=>e.stopPropagation()}>
                <button className="modal-close" onClick={closePicker}>✕</button>
                <div className="picker-header">
                   <h2>🌐 글로벌 카드 라이브러리 검색</h2>
                   <p>전 세계의 서버에서 실시간으로 정품 고해상도 카드 디자인을 끌어옵니다.</p>
                </div>
                
                <form className="picker-search-bar" onSubmit={handlePickerSearch}>
                   <input type="text" placeholder="한글 이름 또는 번호를 치세요 (알아서 다국어로 번역됩니다!)" value={pickerQuery} onChange={e=>setPickerQuery(e.target.value)} />
                   <button type="submit" className="btn btn-primary">검색</button>
                </form>

                <div className="picker-tabs">
                   <button className={`tab-btn ${pickerTab === 'en' ? 'active' : ''}`} onClick={()=>setPickerTab('en')}>🇺🇸 영문판 글로벌 (가져오기 빠름)</button>
                   <button className={`tab-btn ${pickerTab === 'ja' ? 'active' : ''}`} onClick={()=>setPickerTab('ja')}>🇯🇵 일본 오리지널판</button>
                </div>

                <div className="picker-body">
                   {pickerLoading ? (
                      <div className="picker-loading">
                         <div className="spinner"></div><div>국경을 넘어 사진을 수집하는 중입니다...</div>
                      </div>
                   ) : pickerResults.length > 0 ? (
                      <div className="picker-grid">
                         {pickerResults.map(res => (
                            <div key={res.id} className="picker-img-wrapper" onClick={() => selectPickerImage(res.fullImage)}>
                               <img src={res.thumbnail} alt="card" loading="lazy" />
                               <div className="picker-img-overlay">선택하기</div>
                            </div>
                         ))}
                      </div>
                   ) : (
                      <div className="picker-empty">해당 국가에서는 이 이름으로 된 사진을 구하지 못했습니다.</div>
                   )}
                </div>
             </div>
          </div>
       )}
    </div>
  )
}
