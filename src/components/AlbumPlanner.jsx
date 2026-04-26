import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const ALBUM_COLLECTION = 'album_plans';
const DRAFT_STORAGE_PREFIX = 'album_draft_';

const LAYOUT_OPTIONS = [
  { key: '2x2', cols: 2, rows: 2, label: '2 x 2 (4칸)' },
  { key: '3x3', cols: 3, rows: 3, label: '3 x 3 (9칸)' },
  { key: '4x3', cols: 4, rows: 3, label: '4 x 3 (12칸)' },
];

const MAX_HISTORY = 80;

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeEmptyPage(slotCount) {
  return {
    slots: Array.from({ length: slotCount }, () => null),
  };
}

function createNewAlbumPayload(name, layoutKey, pageCount = 1) {
  const layout = LAYOUT_OPTIONS.find((item) => item.key === layoutKey) || LAYOUT_OPTIONS[1];
  const slotCount = layout.cols * layout.rows;
  const pages = Array.from({ length: Math.max(1, pageCount) }, () => makeEmptyPage(slotCount));

  const now = new Date().toISOString();
  return {
    name: name?.trim() || '새 앨범',
    layoutKey: layout.key,
    cols: layout.cols,
    rows: layout.rows,
    pages,
    pageCount: pages.length,
    createdAt: now,
    updatedAt: now,
  };
}

function mapCardLite(card) {
  return {
    cardId: card.id,
    cardName: card.cardName || '',
    imageUrl: card.imageUrl || '',
    series: card.series || '',
    cardNumber: card.cardNumber || '',
    rarity: card.rarity || '',
    status: card.status || '상태 없음',
  };
}

function getStatusTone(status) {
  const normalized = String(status || '').trim();
  if (normalized.includes('등급')) return 'graded';
  if (normalized.includes('미보유') || normalized.includes('위시')) return 'unowned';
  if (normalized.includes('보유') || normalized.includes('수집') || normalized.includes('소장') || normalized.includes('배송')) return 'owned';
  return 'unknown';
}

function countFilledSlots(album) {
  if (!album?.pages?.length) return 0;
  return album.pages.reduce((acc, page) => {
    return acc + (page.slots || []).filter(Boolean).length;
  }, 0);
}

function totalSlots(album) {
  return (album?.pages?.length || 0) * ((album?.cols || 0) * (album?.rows || 0));
}

export default function AlbumPlanner() {
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [albums, setAlbums] = useState([]);
  const [albumViewMode, setAlbumViewMode] = useState('grid');

  const [showCreate, setShowCreate] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newLayout, setNewLayout] = useState('3x3');
  const [newPageCount, setNewPageCount] = useState(1);

  const [editingAlbum, setEditingAlbum] = useState(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [activeSlotIndex, setActiveSlotIndex] = useState(null);
  const [draggingSlotIndex, setDraggingSlotIndex] = useState(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState(null);
  const [albumNameDraft, setAlbumNameDraft] = useState('');

  const [allCards, setAllCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [cardSearch, setCardSearch] = useState('');

  const [saveStatus, setSaveStatus] = useState('idle');

  const [historyPast, setHistoryPast] = useState([]);
  const [historyFuture, setHistoryFuture] = useState([]);

  const albumRef = useRef(null);
  const autosaveTimerRef = useRef(null);

  useEffect(() => {
    albumRef.current = editingAlbum;
  }, [editingAlbum]);

  useEffect(() => {
    async function fetchInitialData() {
      setLoadingAlbums(true);
      setLoadingCards(true);
      try {
        const [albumSnap, cardSnap] = await Promise.all([
          getDocs(collection(db, ALBUM_COLLECTION)),
          getDocs(collection(db, 'pokemon_cards')),
        ]);

        const loadedAlbums = albumSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setAlbums(loadedAlbums);

        const loadedCards = cardSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.cardName || '').localeCompare(String(b.cardName || '')));
        setAllCards(loadedCards);
      } catch (err) {
        console.error('album planner init error', err);
      } finally {
        setLoadingAlbums(false);
        setLoadingCards(false);
      }
    }

    fetchInitialData();
  }, []);

  const selectedLayout = useMemo(() => {
    if (!editingAlbum) return null;
    return LAYOUT_OPTIONS.find((item) => item.key === editingAlbum.layoutKey) || null;
  }, [editingAlbum]);

  const currentPage = useMemo(() => {
    if (!editingAlbum?.pages?.length) return null;
    return editingAlbum.pages[currentPageIndex] || null;
  }, [editingAlbum, currentPageIndex]);

  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;

  const filteredCards = useMemo(() => {
    const keyword = cardSearch.trim().toLowerCase();
    if (!keyword) return allCards;

    const scored = allCards
      .map((card) => {
        const name = String(card.cardName || '').toLowerCase();
        const series = String(card.series || '').toLowerCase();
        const number = String(card.cardNumber || '').toLowerCase();

        let score = -1;

        // 카드명 우선순위
        if (name === keyword) score = 300;
        else if (name.startsWith(keyword)) score = 260;
        else if (name.includes(keyword)) score = 220;
        else if (number === keyword) score = 170;
        else if (number.startsWith(keyword)) score = 150;
        else if (number.includes(keyword)) score = 130;
        else if (series === keyword) score = 110;
        else if (series.startsWith(keyword)) score = 90;
        else if (series.includes(keyword)) score = 70;

        return { card, score };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.card.cardName || '').localeCompare(String(b.card.cardName || ''));
      })
      .map((item) => item.card);

    return scored;
  }, [allCards, cardSearch]);

  const persistAlbumDraftLocal = (album) => {
    if (!album?.id) return;
    const storageKey = `${DRAFT_STORAGE_PREFIX}${album.id}`;
    localStorage.setItem(storageKey, JSON.stringify(album));
  };

  const scheduleAutoSave = (album) => {
    if (!album?.id) return;

    persistAlbumDraftLocal(album);

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    setSaveStatus('saving');
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, ALBUM_COLLECTION, album.id), {
          ...album,
          pageCount: album.pages?.length || 0,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        setAlbums((prev) => {
          const next = prev.map((item) => (item.id === album.id ? { ...item, ...album, updatedAt: new Date().toISOString(), pageCount: album.pages?.length || 0 } : item));
          return next.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        });

        setSaveStatus('saved');
      } catch (err) {
        console.error('album autosave error', err);
        setSaveStatus('error');
      }
    }, 700);
  };

  useEffect(() => {
    if (!editingAlbum) return;
    scheduleAutoSave(editingAlbum);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [editingAlbum]);

  const applyAlbumUpdate = (updater, options = { recordHistory: true }) => {
    const current = albumRef.current;
    if (!current) return;

    const currentSnapshot = deepCopy(current);
    const nextDraft = deepCopy(current);
    const maybeUpdated = updater(nextDraft);
    const finalDraft = maybeUpdated || nextDraft;
    finalDraft.updatedAt = new Date().toISOString();
    finalDraft.pageCount = finalDraft.pages?.length || 0;

    if (options.recordHistory) {
      setHistoryPast((prev) => {
        const pushed = [...prev, currentSnapshot];
        return pushed.slice(Math.max(0, pushed.length - MAX_HISTORY));
      });
      setHistoryFuture([]);
    }

    setEditingAlbum(finalDraft);
  };

  const handleUndo = () => {
    if (!historyPast.length || !albumRef.current) return;
    setHistoryPast((prevPast) => {
      const previous = prevPast[prevPast.length - 1];
      const remaining = prevPast.slice(0, -1);
      setHistoryFuture((prevFuture) => [deepCopy(albumRef.current), ...prevFuture].slice(0, MAX_HISTORY));
      setEditingAlbum(previous);
      return remaining;
    });
  };

  const handleRedo = () => {
    if (!historyFuture.length || !albumRef.current) return;
    setHistoryFuture((prevFuture) => {
      const [next, ...rest] = prevFuture;
      setHistoryPast((prevPast) => [...prevPast, deepCopy(albumRef.current)].slice(Math.max(0, prevPast.length + 1 - MAX_HISTORY)));
      setEditingAlbum(next);
      return rest;
    });
  };

  const openAlbumEditor = (album) => {
    if (!album) return;
    const normalized = deepCopy(album);
    normalized.pageCount = normalized.pages?.length || normalized.pageCount || 1;

    const storageKey = `${DRAFT_STORAGE_PREFIX}${album.id}`;
    const localDraftRaw = localStorage.getItem(storageKey);

    if (localDraftRaw) {
      try {
        const localDraft = JSON.parse(localDraftRaw);
        if (localDraft?.updatedAt && String(localDraft.updatedAt) > String(normalized.updatedAt || '')) {
          const shouldRestore = window.confirm('마지막 자동 저장된 편집본이 있습니다. 이어서 복원할까요?');
          if (shouldRestore) {
            setEditingAlbum(localDraft);
          } else {
            setEditingAlbum(normalized);
          }
        } else {
          setEditingAlbum(normalized);
        }
      } catch {
        setEditingAlbum(normalized);
      }
    } else {
      setEditingAlbum(normalized);
    }

    setCurrentPageIndex(0);
    setActiveSlotIndex(null);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    setAlbumNameDraft((album.name || '').trim());
  };

  const closeEditor = () => {
    setEditingAlbum(null);
    setCurrentPageIndex(0);
    setActiveSlotIndex(null);
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    setAlbumNameDraft('');
  };

  const commitAlbumName = () => {
    if (!editingAlbum) return;
    const nextName = String(albumNameDraft || '').trim();
    if (!nextName) {
      setAlbumNameDraft(editingAlbum.name || '');
      return;
    }
    if (nextName === editingAlbum.name) return;

    applyAlbumUpdate((draft) => {
      draft.name = nextName;
      return draft;
    });
  };

  const handleCreateAlbum = async () => {
    const payload = createNewAlbumPayload(newAlbumName, newLayout, Number(newPageCount) || 1);

    try {
      const ref = await addDoc(collection(db, ALBUM_COLLECTION), payload);
      const newAlbum = { id: ref.id, ...payload };
      setAlbums((prev) => [newAlbum, ...prev]);
      setShowCreate(false);
      setNewAlbumName('');
      setNewLayout('3x3');
      setNewPageCount(1);
      openAlbumEditor(newAlbum);
    } catch (err) {
      console.error('create album error', err);
      alert('앨범 생성에 실패했습니다.');
    }
  };

  const handleDeleteAlbum = async (albumId) => {
    if (!window.confirm('정말 이 앨범을 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, ALBUM_COLLECTION, albumId));
      setAlbums((prev) => prev.filter((a) => a.id !== albumId));
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${albumId}`);
      if (editingAlbum?.id === albumId) closeEditor();
    } catch (err) {
      console.error('delete album error', err);
      alert('앨범 삭제에 실패했습니다.');
    }
  };

  const addNewPage = () => {
    if (!editingAlbum) return;
    const slotCount = (editingAlbum.cols || 0) * (editingAlbum.rows || 0);
    applyAlbumUpdate((draft) => {
      draft.pages.push(makeEmptyPage(slotCount));
      return draft;
    });
    setCurrentPageIndex((prev) => prev + 1);
    setActiveSlotIndex(null);
  };

  const duplicateCurrentPage = () => {
    if (!editingAlbum || !currentPage) return;
    applyAlbumUpdate((draft) => {
      const source = deepCopy(draft.pages[currentPageIndex]);
      draft.pages.splice(currentPageIndex + 1, 0, source);
      return draft;
    });
    setCurrentPageIndex((prev) => prev + 1);
    setActiveSlotIndex(null);
  };

  const removeCurrentPage = () => {
    if (!editingAlbum) return;
    if ((editingAlbum.pages?.length || 0) <= 1) {
      alert('페이지는 최소 1개가 필요합니다.');
      return;
    }

    if (!window.confirm('현재 페이지를 삭제할까요?')) return;

    applyAlbumUpdate((draft) => {
      draft.pages.splice(currentPageIndex, 1);
      return draft;
    });

    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
    setActiveSlotIndex(null);
  };

  const assignCardToSlot = (card) => {
    if (!editingAlbum || activeSlotIndex === null || activeSlotIndex === undefined) {
      alert('먼저 채울 슬롯을 선택해주세요.');
      return;
    }

    const cardLite = mapCardLite(card);
    applyAlbumUpdate((draft) => {
      draft.pages[currentPageIndex].slots[activeSlotIndex] = cardLite;
      return draft;
    });
  };

  const clearDragState = () => {
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
  };

  const handleSlotDrop = (targetIndex) => {
    if (!editingAlbum || draggingSlotIndex === null || draggingSlotIndex === undefined) {
      clearDragState();
      return;
    }

    if (draggingSlotIndex === targetIndex) {
      clearDragState();
      return;
    }

    applyAlbumUpdate((draft) => {
      const slots = draft.pages[currentPageIndex].slots;
      if (!Array.isArray(slots)) return draft;
      const from = draggingSlotIndex;
      const to = targetIndex;
      const temp = slots[from];
      slots[from] = slots[to] || null;
      slots[to] = temp || null;
      return draft;
    });

    setActiveSlotIndex(targetIndex);
    clearDragState();
  };

  const clearSlotByIndex = (slotIndex) => {
    if (!editingAlbum || slotIndex === null || slotIndex === undefined) return;
    applyAlbumUpdate((draft) => {
      draft.pages[currentPageIndex].slots[slotIndex] = null;
      return draft;
    });
    if (activeSlotIndex === slotIndex) {
      setActiveSlotIndex(null);
    }
  };

  if (loadingAlbums) {
    return (
      <main className="album-page fade-in">
        <div className="stats-loading">
          <div className="spinner"></div>
          <h2>앨범 작업실을 불러오는 중입니다...</h2>
        </div>
      </main>
    );
  }

  if (!editingAlbum) {
    return (
      <main className="album-page slide-up">
        <div className="album-header">
          <div>
            <h2>🖼️ 앨범 꾸미기</h2>
            <p>카드 배치를 미리 설계하고 페이지 구성을 저장하세요.</p>
          </div>
          <div className="album-header-actions">
            <div className="view-toggle">
              <button type="button" className={`btn-toggle ${albumViewMode === 'grid' ? 'active' : ''}`} onClick={() => setAlbumViewMode('grid')}>앨범형</button>
              <button type="button" className={`btn-toggle ${albumViewMode === 'list' ? 'active' : ''}`} onClick={() => setAlbumViewMode('list')}>목록형</button>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>➕ 새 앨범 만들기</button>
          </div>
        </div>

        <section className={albumViewMode === 'grid' ? 'album-grid' : 'album-list'}>
          {albums.map((album) => {
            const filled = countFilledSlots(album);
            const total = totalSlots(album);
            return (
              <article key={album.id} className={`album-card ${albumViewMode}`}>
                <div className="album-card-main" onClick={() => openAlbumEditor(album)}>
                  <h3>{album.name}</h3>
                  <p>레이아웃: {album.layoutKey} · 페이지 {album.pageCount || album.pages?.length || 1}장</p>
                  <p>완성도: {filled}/{total}</p>
                  <small>최근 수정: {String(album.updatedAt || '').replace('T', ' ').slice(0, 16) || '-'}</small>
                </div>
                <button type="button" className="btn btn-danger" onClick={() => handleDeleteAlbum(album.id)}>삭제</button>
              </article>
            );
          })}
          {albums.length === 0 && (
            <div className="album-empty">
              아직 앨범이 없습니다. 새 앨범을 만들어 시작해보세요.
            </div>
          )}
        </section>

        {showCreate && (
          <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
            <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
              <h2 className="modal-title">새 앨범 만들기</h2>

              <div className="form-group">
                <label>앨범 이름</label>
                <input type="text" value={newAlbumName} onChange={(e) => setNewAlbumName(e.target.value)} placeholder="예: SV SAR 전시 앨범" />
              </div>

              <div className="form-group">
                <label>페이지 배치</label>
                <select value={newLayout} onChange={(e) => setNewLayout(e.target.value)}>
                  {LAYOUT_OPTIONS.map((layout) => (
                    <option key={layout.key} value={layout.key}>{layout.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>시작 페이지 수</label>
                <input type="number" min={1} max={30} value={newPageCount} onChange={(e) => setNewPageCount(Number(e.target.value) || 1)} />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>취소</button>
                <button type="button" className="btn btn-primary" onClick={handleCreateAlbum}>생성</button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="album-page slide-up">
      <div className="album-editor-header">
        <div>
          <h2>🎨 앨범 편집</h2>
          <div className="album-name-edit-row">
            <input
              type="text"
              className="album-name-input"
              value={albumNameDraft}
              onChange={(e) => setAlbumNameDraft(e.target.value)}
              onBlur={commitAlbumName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitAlbumName();
                }
              }}
              placeholder="앨범 이름"
            />
            <button type="button" className="btn btn-secondary" onClick={commitAlbumName}>이름 저장</button>
          </div>
          <p>레이아웃 {editingAlbum.layoutKey} · 페이지 {currentPageIndex + 1}/{editingAlbum.pages.length}</p>
        </div>
        <div className="album-editor-actions">
          <button type="button" className="btn btn-secondary" onClick={closeEditor}>목록으로</button>
          <button type="button" className="btn btn-secondary" onClick={handleUndo} disabled={!canUndo}>↶ 실행 취소</button>
          <button type="button" className="btn btn-secondary" onClick={handleRedo} disabled={!canRedo}>↷ 다시 실행</button>
          <button type="button" className="btn btn-secondary" onClick={addNewPage}>＋ 페이지 추가</button>
          <button type="button" className="btn btn-secondary" onClick={duplicateCurrentPage}>📄 페이지 복제</button>
          <button type="button" className="btn btn-danger" onClick={removeCurrentPage}>현재 페이지 삭제</button>
          <span className={`album-save-status ${saveStatus}`}>{saveStatus === 'saving' ? '자동 저장 중...' : saveStatus === 'saved' ? '자동 저장됨' : saveStatus === 'error' ? '저장 실패' : '편집 대기'}</span>
        </div>
      </div>

      <div className="album-editor-layout">
        <section className="album-page-preview-wrap">
          <div className="album-page-tabs">
            {editingAlbum.pages.map((_, index) => (
              <button
                type="button"
                key={`page-${index}`}
                className={`album-page-tab ${currentPageIndex === index ? 'active' : ''}`}
                onClick={() => {
                  setCurrentPageIndex(index);
                  setActiveSlotIndex(null);
                  clearDragState();
                }}
              >
                P{index + 1}
              </button>
            ))}
          </div>

          <div
            className="album-page-preview"
            style={{
              gridTemplateColumns: `repeat(${selectedLayout?.cols || editingAlbum.cols}, minmax(0, 1fr))`,
            }}
          >
            {(currentPage?.slots || []).map((slot, index) => {
              const isActive = activeSlotIndex === index;
              const isEmpty = !slot;
              const isDragging = draggingSlotIndex === index;
              const isDragOver = dragOverSlotIndex === index && draggingSlotIndex !== index;
              return (
                <button
                  type="button"
                  key={`slot-${index}`}
                  className={`album-slot ${isActive ? 'active' : ''} ${isEmpty ? 'empty' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                  onClick={() => setActiveSlotIndex(index)}
                  title={isEmpty ? '빈 슬롯' : `${slot.cardName || '카드'} 슬롯`}
                  draggable={!isEmpty}
                  onDragStart={(e) => {
                    if (isEmpty) {
                      e.preventDefault();
                      return;
                    }
                    setDraggingSlotIndex(index);
                    setDragOverSlotIndex(index);
                    setActiveSlotIndex(index);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnter={() => {
                    if (draggingSlotIndex === null || draggingSlotIndex === undefined) return;
                    setDragOverSlotIndex(index);
                  }}
                  onDragOver={(e) => {
                    if (draggingSlotIndex === null || draggingSlotIndex === undefined) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSlotDrop(index);
                  }}
                  onDragEnd={clearDragState}
                >
                  {!isEmpty && (
                    <button
                      type="button"
                      className="album-slot-remove"
                      title="이 슬롯에서 카드 제거"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearSlotByIndex(index);
                      }}
                    >
                      ✕
                    </button>
                  )}

                  {slot?.imageUrl ? (
                    <img src={slot.imageUrl} alt={slot.cardName || 'card'} />
                  ) : (
                    <div className="album-slot-empty">비어있음</div>
                  )}

                  <div className="album-slot-meta">
                    <strong>{slot?.cardName || `슬롯 ${index + 1}`}</strong>
                    <small>{slot?.series || '-'}</small>
                    <small>{slot?.cardNumber || '-'}</small>
                    <small>레어도: {slot?.rarity || '-'}</small>
                    <span className={`album-slot-status ${getStatusTone(slot?.status)}`}>{slot?.status || '미배치'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="album-card-picker">
          <h3>카드 배치 패널</h3>
          <p>슬롯 선택 후 카드를 클릭하면 해당 위치에 배치됩니다.</p>

          <div className="album-picker-top-actions">
            <input
              type="text"
              className="search-input"
              placeholder="이름/시리즈/번호 검색"
              value={cardSearch}
              onChange={(e) => setCardSearch(e.target.value)}
            />
          </div>

          {loadingCards ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>카드 목록 로딩 중...</p>
            </div>
          ) : (
            <div className="album-card-list">
              {filteredCards.slice(0, 200).map((card) => (
                <button type="button" className="album-card-item" key={card.id} onClick={() => assignCardToSlot(card)}>
                  <div className="thumb-wrap">
                    {card.imageUrl ? <img src={card.imageUrl} alt={card.cardName || 'card'} /> : <div className="thumb-placeholder">No Img</div>}
                  </div>
                  <div className="info">
                    <strong>{card.cardName || '이름 없음'}</strong>
                    <small>{card.series || '-'}</small>
                    <small>{card.cardNumber || '-'}</small>
                    <small>레어도: {card.rarity || '-'}</small>
                    <small className={`picker-status ${getStatusTone(card.status)}`}>{card.status || '상태 없음'}</small>
                  </div>
                </button>
              ))}
              {filteredCards.length === 0 && <div className="album-empty">검색 결과가 없습니다.</div>}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
