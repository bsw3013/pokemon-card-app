import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';
import { normalizeStatus } from '../utils/statusUtils';
import { normalizePokedexNumber, displayPokedexNumber } from '../utils/numberUtils';
import CardDetailModal from './CardDetailModal';
import CardThumbnail from './CardThumbnail';

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
          const data = doc.data();
          if (data.possessions && typeof data.possessions === 'string' && data.possessions.trim().startsWith('[')) {
             try { data.possessions = JSON.parse(data.possessions); } catch(e) {}
          }
               fetched.push({ id: doc.id, ...data, status: normalizeStatus(data.status) });
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



  // 메인 모달
  const openModal = (card) => {
     setSelectedCard(card);
  };
   const openCreate = () => {
      setSelectedCard({ isNew: true });
   };

   const handleModalSave = async (payload) => {
      try {
         const updatePayload = {
            cardName: payload.cardName || '',
            series: payload.series || '',
            cardNumber: payload.cardNumber || '',
            rarity: payload.rarity || '',
            type: payload.type || '',
            pokedexNumber: normalizePokedexNumber(payload.pokedexNumber || ''),
            status: payload.status || '미보유',
            price: parseInt(payload.price) || 0,
            imageUrl: payload.imageUrl || '',
            possessions: payload.possessions || []
         };

         if (selectedCard && selectedCard.isNew) {
            const ref = await addDoc(collection(db, 'pokemon_cards'), updatePayload);
            setCards(prev => [{ id: ref.id, ...updatePayload }, ...prev]);
         } else if (selectedCard && selectedCard.id) {
            const cardRef = doc(db, "pokemon_cards", selectedCard.id);
            await updateDoc(cardRef, updatePayload);
            setCards(prev => prev.map(c => c.id === selectedCard.id ? { ...c, ...updatePayload } : c));
         }
         setSelectedCard(null);
      } catch(err) {
         console.error(err);
         alert("저장 중 오류가 발생했습니다.");
         throw err;
      }
   };

   const handleModalDelete = async () => {
      try {
         await deleteDoc(doc(db, "pokemon_cards", selectedCard.id));
         setCards(prev => prev.filter(c => c.id !== selectedCard.id));
         setSelectedCard(null);
      } catch(err) {
         console.error(err);
         alert("삭제 실패");
         throw err;
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
      let poss = card.possessions || [];
      if (typeof poss === 'string' && poss.trim().startsWith('[')) {
         try { poss = JSON.parse(poss); } catch(e) { poss = []; }
      }
      if (!Array.isArray(poss)) poss = [];
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
                                 <CardThumbnail imageUrl={data.imageUrl} alt="preview" type="table" className="table-thumb" />
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
                   <CardThumbnail imageUrl={card.imageUrl} alt={card.cardName} type="grid" />
                   {/* 레어도(AR/SAR) 배지 - rarity 필드 사용 */}
                   {card.rarity && <span className="card-rarity">{card.rarity}</span>}
                   {/* 그레이딩(예: PSA 10) 배지 */}
                   {(() => {
                     const top = getTopGrading(card);
                     return top ? <span className="grading-badge">{top.company} {top.grade}</span> : null;
                   })()}
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

       {/* 상세 및 수정 모달 (공통 모달 컴포넌트로 분리) */}
       <CardDetailModal 
         isOpen={!!selectedCard}
         card={selectedCard}
         appConfig={appConfig}
         onClose={() => setSelectedCard(null)}
         onSave={handleModalSave}
         onDelete={!selectedCard?.isNew ? handleModalDelete : undefined}
       />
    </div>
  )
}
