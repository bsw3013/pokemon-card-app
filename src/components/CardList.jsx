import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';
import { normalizeStatus } from '../utils/statusUtils';
import { normalizePokedexNumber, displayPokedexNumber } from '../utils/numberUtils';
import { formatCardPayload } from '../utils/cardUtils';
import { useThumbnailSettings } from '../hooks/useThumbnailSettings';
import { useMultiSort } from '../hooks/useMultiSort';
import { sortCards } from '../utils/sortUtils';
import ThumbnailSettings from './ThumbnailSettings';
import CardDetailModal from './CardDetailModal';
import CardThumbnail from './CardThumbnail';
import MultiSortPanel from './MultiSortPanel';

const { krToEn, krToJa } = pokemonMapAll;

const getFlagEmoji = (lang) => {
  if (!lang) return '🇰🇷';
  if (lang.includes('한국')) return '🇰🇷';
  if (lang.includes('일본')) return '🇯🇵';
  if (lang.includes('미국') || lang.includes('영')) return '🇺🇸';
  if (lang.includes('중국')) return '🇨🇳';
  return '🇰🇷';
};

const getStatusClass = (status) => {
  if (!status || status.includes('미보유')) return 'unowned';
  if (status.includes('등급')) return 'graded';
  return 'owned';
};

export default function CardList({ appConfig }) {
  const [cards, setCards] = useState([]);
   const { settings: thumbSettings, toggleSetting: toggleThumbSetting } = useThumbnailSettings();

   const [loading, setLoading] = useState(true);
  
  // 필터 및 정렬 상태
   const [searchTerm, setSearchTerm] = useState('');
   const deferredSearchTerm = useDeferredValue(searchTerm);
   const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const {
    sortLevels,
    handleLevelFieldChange,
    toggleLevelDir,
    toggleLevelEnabled,
    resetSortLevels,
    persistSortLevels,
  } = useMultiSort();

   const [gridColumns, setGridColumns] = useState(() => {
      try { return parseInt(localStorage.getItem('cardList_gridColumns_v1')) || 6; } catch { return 6; }
   });

   useEffect(() => {
      try { localStorage.setItem('cardList_gridColumns_v1', gridColumns); } catch {}
   }, [gridColumns]);

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
      // Multi-level sorting: use sortUtils
      return sortCards(result, sortLevels.filter(l => l.enabled && l.field), appConfig);
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
         const updatePayload = formatCardPayload(payload);

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

   const handleModalDuplicate = async (payload) => {
      try {
         const duplicatePayload = formatCardPayload(payload);
         const ref = await addDoc(collection(db, 'pokemon_cards'), duplicatePayload);
         setCards(prev => [{ id: ref.id, ...duplicatePayload }, ...prev]);
         setSelectedCard(null);
      } catch(err) {
         console.error(err);
         alert("복제 중 오류가 발생했습니다.");
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
             <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.05)', padding: '0.3rem 0.8rem', borderRadius: '999px', border: '1px solid var(--border-color)', height: '100%', marginRight: '0.6rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>가로칸수:</span>
                <input type="number" min="2" max="12" value={gridColumns} onChange={(e) => setGridColumns(Number(e.target.value) || 6)} style={{ width: '36px', background: 'transparent', border: 'none', color: 'white', outline: 'none', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem' }} />
             </div>
             <ThumbnailSettings settings={thumbSettings} toggleSetting={toggleThumbSetting} />
             <button type="button" className="btn btn-primary" style={{marginRight: '0.6rem'}} onClick={openCreate}>➕ 카드 추가</button>
             <input type="text" className="search-input" placeholder="🔍 이름, 일련번호, 도감번호 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             <div style={{ position: 'relative' }}>
               <button type="button" className="btn btn-secondary" style={{marginLeft: '0.6rem'}} onClick={() => setSortPanelOpen(p => !p)}>정렬 설정</button>
               {sortPanelOpen && (
                 <MultiSortPanel
                   sortLevels={sortLevels}
                   handleLevelFieldChange={handleLevelFieldChange}
                   toggleLevelDir={toggleLevelDir}
                   toggleLevelEnabled={toggleLevelEnabled}
                   resetSortLevels={resetSortLevels}
                   onClose={() => setSortPanelOpen(false)}
                 />
               )}
             </div>
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
          <div className="card-grid fade-in" style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}>
             {filteredAndSortedCards.map(card => (
             <div className={`card-item fade-in ${thumbSettings.hoverMode ? 'hover-mode-active' : ''}`} key={card.id} onClick={() => openModal(card)}>
                <div className={`card-image-wrapper ${(card.status === '미보유' || !card.status) ? 'filter-grayscale' : ''}`}>
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
                   {thumbSettings.showName && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className={`status-dot ${getStatusClass(card.status)}`} title={card.status}></span>
                            <h3 className="card-name" style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }} title={card.cardName}>{card.cardName || '이름 없음'}</h3>
                         </div>
                         <span className="country-flag" title={card.language || '한국'}>{getFlagEmoji(card.language)}</span>
                      </div>
                   )}
                    <div className="card-meta">
                       {thumbSettings.showSeries && card.series && <span className="badge-series">{card.series}</span>}
                       {thumbSettings.showNumber && card.cardNumber && <span className="badge-number">No.{card.cardNumber}</span>}
                       {thumbSettings.showNumber && card.pokedexNumber && <span className="badge-number">도감 번호 {displayPokedexNumber(card.pokedexNumber)}</span>}
                       {thumbSettings.showRarity && card.rarity && <span className="badge-series">{card.rarity}</span>}
                    </div>
                    {thumbSettings.showPrice && (
                       <div className="card-footer" style={{ marginTop: 'auto' }}>
                          <span className="card-price" style={{ fontWeight: 'bold', color: 'var(--accent-color)' }}>
                             {card.price ? `${card.price.toLocaleString()}원` : '-'}
                          </span>
                       </div>
                    )}
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
         onDuplicate={!selectedCard?.isNew ? handleModalDuplicate : undefined}
       />
    </div>
  )
}
