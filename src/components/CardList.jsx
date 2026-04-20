import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';

const { krToEn, krToJa } = pokemonMapAll;

export default function CardList({ appConfig }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // 필터 및 정렬 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('newest');

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
    if (searchTerm) {
      const lowerWord = searchTerm.toLowerCase();
      result = result.filter(card => 
        (card.cardName || '').toLowerCase().includes(lowerWord) ||
        (card.series || '').toLowerCase().includes(lowerWord) ||
        (card.cardNumber || '').includes(lowerWord) ||
        (card.pokedexNumber || '').includes(lowerWord)
      );
    }
    result.sort((a, b) => {
      if (sortBy === 'newest') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      } else if (sortBy === 'price_high') {
        return (b.price || 0) - (a.price || 0); 
      } else if (sortBy === 'pokedex_asc') {
        return parseInt(a.pokedexNumber || '9999') - parseInt(b.pokedexNumber || '9999');
      } else if (sortBy === 'name_asc') {
        return (a.cardName || '').localeCompare(b.cardName || '');
      }
      return 0;
    });
    return result;
  }, [cards, searchTerm, sortBy]);
  
  const totalPages = Math.ceil(filteredAndSortedCards.length / itemsPerPage);
  const currentPageCards = viewMode === 'table' ? filteredAndSortedCards.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) : filteredAndSortedCards;
  
  // 검색이나 정렬이 변경되면 페이지를 1로 리셋합니다.
  useEffect(() => { setCurrentPage(1); }, [searchTerm, sortBy]);

  // 메인 모달
  const openModal = (card) => {
    setSelectedCard(card);
    setEditData({ ...card });
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
      const cardRef = doc(db, "pokemon_cards", selectedCard.id);
      const updatePayload = {
        cardName: editData.cardName || '',
        series: editData.series || '',
        cardNumber: editData.cardNumber || '',
        rarity: editData.rarity || '',
        type: editData.type || '',
        pokedexNumber: editData.pokedexNumber || '',
        status: editData.status || '',
        price: parseInt(editData.price) || 0,
        imageUrl: editData.imageUrl || ''
      };
      await updateDoc(cardRef, updatePayload);
      setCards(prev => prev.map(c => c.id === selectedCard.id ? { ...c, ...updatePayload } : c));
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

  // --- 테이블 뷰 인라인 편집기 (자동저장) ---
  const saveTimeoutRef = React.useRef({});

  const handleTableEditChange = (id, field, value) => {
     // 즉시 UI 업데이트
     setCards(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
     
     // 800ms 디바운싱: 타이핑 중에는 네트워크 요청 보류, 타이핑 멈추면 전송
     if (saveTimeoutRef.current[id + field]) {
        clearTimeout(saveTimeoutRef.current[id + field]);
     }
     
     saveTimeoutRef.current[id + field] = setTimeout(async () => {
        setIsRowSaving(prev => ({ ...prev, [id]: true }));
        try {
           const cardRef = doc(db, "pokemon_cards", id);
           let finalValue = value;
           if (field === 'price') finalValue = parseInt(value) || 0;
           await updateDoc(cardRef, { [field]: finalValue });
           // 동적 필드 지원을 위해 [field]: finalValue 사용
        } catch(err) {
           console.error("자동저장 실패:", err);
        } finally {
           setIsRowSaving(prev => ({ ...prev, [id]: false }));
        }
     }, 800);
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
             <input type="text" className="search-input" placeholder="🔍 이름, 일련번호, 도감번호 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
             <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="newest">최신 등록순</option>
                <option value="pokedex_asc">도감 번호순</option>
                <option value="price_high">높은 시세순</option>
                <option value="name_asc">카드 이름순</option>
             </select>
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
                       {appConfig.displayFields.filter(f => f.visible).sort((a,b)=>a.order-b.order).map(f => (
                           <th key={f.id}>{f.label}</th>
                       ))}
                    </tr>
                 </thead>
                 <tbody>
                    {currentPageCards.map(card => {
                        const data = card;
                        const isSavingRef = isRowSaving[card.id];

                        const cellInputs = {
                            cardName: <input type="text" className="table-input" value={data.cardName || ''} onChange={(e) => handleTableEditChange(card.id, 'cardName', e.target.value)} />,
                            pokedexNumber: <input type="text" className="table-input" style={{width: '60px', textAlign: 'center'}} value={data.pokedexNumber || ''} onChange={(e) => handleTableEditChange(card.id, 'pokedexNumber', e.target.value)} />,
                            series: <select className="table-input" value={data.series || ''} onChange={(e) => handleTableEditChange(card.id, 'series', e.target.value)}><option value="">선택</option>{appConfig.seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                            cardNumber: <input type="text" className="table-input" style={{width: '90px'}} value={data.cardNumber || ''} onChange={(e) => handleTableEditChange(card.id, 'cardNumber', e.target.value)} />,
                            rarity: <select className="table-input" style={{width: '90px'}} value={data.rarity || ''} onChange={(e) => handleTableEditChange(card.id, 'rarity', e.target.value)}><option value="">선택</option>{appConfig.rarityOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                            type: <select className="table-input" style={{width: '100px'}} value={data.type || ''} onChange={(e) => handleTableEditChange(card.id, 'type', e.target.value)}><option value="">선택</option>{appConfig.typeOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                            status: <select className="table-input" style={{width: '110px'}} value={data.status || ''} onChange={(e) => handleTableEditChange(card.id, 'status', e.target.value)}><option value="">선택</option>{appConfig.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}</select>,
                            price: <input type="number" className="table-input price-input" value={data.price || 0} onChange={(e) => handleTableEditChange(card.id, 'price', e.target.value)} />
                        };

                        return (
                           <tr key={card.id} className={isSavingRef ? 'row-draft' : ''}>
                              <td className="center-cell td-photo" onClick={() => openModal(card)} style={{ position: 'relative' }}>
                                 {data.imageUrl ? <img src={data.imageUrl} alt="preview" className="table-thumb" /> : <div className="table-no-thumb-wrapper"><img src="/placeholder.png" alt="placeholder" className="table-placeholder-img" /><div className="table-placeholder-text">이미지 필요</div></div>}
                                 {isSavingRef && <div style={{position:'absolute', top: 0, right: 0, padding:'2px 4px', fontSize: '0.7rem', color: '#10b981', fontWeight:'bold', background:'rgba(0,0,0,0.5)'}}>저장됨✅</div>}
                              </td>
                              {appConfig.displayFields.filter(f => f.visible).sort((a,b)=>a.order-b.order).map(f => (
                                 <td key={f.id}>
                                     {cellInputs[f.id] ? cellInputs[f.id] : (
                                        <input type="text" className="table-input" value={data[f.id] || ''} onChange={(e) => handleTableEditChange(card.id, f.id, e.target.value)} />
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
                      <img src={card.imageUrl} alt={card.cardName} loading="lazy" />
                   ) : (
                      <div className="no-image-wrapper"><img src="/placeholder.png" alt="placeholder" className="placeholder-img" /><div className="placeholder-text">이미지<br/>필요</div></div>
                   )}
                   {card.rarity && <span className="card-rarity">{card.rarity}</span>}
                </div>
                <div className="card-info">
                   <h3 className="card-name" title={card.cardName}>{card.cardName || '이름 없음'}</h3>
                   <div className="card-meta">
                      {card.series && <span className="badge-series">{card.series}</span>}
                      {card.pokedexNumber && <span className="badge-number">No.{card.pokedexNumber}</span>}
                   </div>
                   <div className="card-bottom">
                      <span className="card-price">₩{Number(card.price || 0).toLocaleString()}</span>
                      <span className="card-status">{card.status || '상태 없음'}</span>
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
                                   <select name="status" value={editData.status || ''} onChange={handleEditChange}>
                                      <option value="">선택</option>
                                      {appConfig.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                   </select>
                                )}
                                {!['cardName', 'pokedexNumber', 'series', 'cardNumber', 'rarity', 'type', 'status', 'price'].includes(f.id) && (
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
