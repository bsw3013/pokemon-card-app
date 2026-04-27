import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';
import { normalizeStatus } from '../utils/statusUtils';
import CardDetailModal from './CardDetailModal';

const ALBUM_COLLECTION = 'album_plans';
const DRAFT_STORAGE_PREFIX = 'album_draft_';
const CANVAS_COLUMNS_STORAGE_KEY = 'album_canvas_columns_v1';

const LAYOUT_OPTIONS = [
  { key: '2x2', cols: 2, rows: 2, label: '2 x 2 (4칸)' },
  { key: '3x3', cols: 3, rows: 3, label: '3 x 3 (9칸)' },
  { key: '4x3', cols: 4, rows: 3, label: '4 x 3 (12칸)' },
];

const MAX_HISTORY = 80;

const { krToEn, krToJa } = pokemonMapAll;

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
    status: normalizeStatus(card.status),
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

function countOwnedAndPlacedSlots(album) {
  if (!album?.pages?.length) return { ownedPlaced: 0, placed: 0 };

  return album.pages.reduce((acc, page) => {
    const slots = page?.slots || [];
    slots.forEach((slot) => {
      if (!slot) return;
      acc.placed += 1;
      if (String(slot.status || '').includes('보유중')) {
        acc.ownedPlaced += 1;
      }
    });
    return acc;
  }, { ownedPlaced: 0, placed: 0 });
}

function totalSlots(album) {
  return (album?.pages?.length || 0) * ((album?.cols || 0) * (album?.rows || 0));
}

function clampCanvasColumns(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(1, Math.min(3, Math.round(numeric)));
}

export default function AlbumPlanner({ appConfig }) {
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [albums, setAlbums] = useState([]);
  const [albumViewMode, setAlbumViewMode] = useState('grid');

  const [showCreate, setShowCreate] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newLayout, setNewLayout] = useState('3x3');
  const [newPageCount, setNewPageCount] = useState(1);

  const [editingAlbum, setEditingAlbum] = useState(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [editorViewMode, setEditorViewMode] = useState('page');
  const [canvasColumns, setCanvasColumns] = useState(2);
  const [activeSlotIndex, setActiveSlotIndex] = useState(null);
  const [draggingSlotIndex, setDraggingSlotIndex] = useState(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState(null);
  const [canvasDraggingLocation, setCanvasDraggingLocation] = useState(null);
  const [canvasDragOverLocation, setCanvasDragOverLocation] = useState(null);
  const [albumNameDraft, setAlbumNameDraft] = useState('');

  const [allCards, setAllCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [cardSearch, setCardSearch] = useState('');

  const [slotEditingCard, setSlotEditingCard] = useState(null);

  const [saveStatus, setSaveStatus] = useState('idle');

  const [historyPast, setHistoryPast] = useState([]);
  const [historyFuture, setHistoryFuture] = useState([]);

  const albumRef = useRef(null);
  const autosaveTimerRef = useRef(null);

  useEffect(() => {
    albumRef.current = editingAlbum;
  }, [editingAlbum]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CANVAS_COLUMNS_STORAGE_KEY);
      if (!raw) return;
      setCanvasColumns(clampCanvasColumns(raw));
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CANVAS_COLUMNS_STORAGE_KEY, String(canvasColumns));
    } catch {
      // noop
    }
  }, [canvasColumns]);

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
          .map((d) => {
            const data = d.data();
            return { id: d.id, ...data, status: normalizeStatus(data.status) };
          })
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

  const cardsById = useMemo(() => {
    const map = new Map();
    allCards.forEach((card) => {
      if (card?.id) map.set(card.id, card);
    });
    return map;
  }, [allCards]);

  const findMasterCardBySlot = (slot) => {
    if (!slot) return null;

    if (slot.cardId) {
      const byId = cardsById.get(slot.cardId);
      if (byId) return byId;
    }

    const keyName = String(slot.cardName || '').trim().toLowerCase();
    const keyNumber = String(slot.cardNumber || '').trim().toLowerCase();
    const keySeries = String(slot.series || '').trim().toLowerCase();
    if (!keyName && !keyNumber && !keySeries) return null;

    return allCards.find((card) => {
      return String(card.cardName || '').trim().toLowerCase() === keyName
        && String(card.cardNumber || '').trim().toLowerCase() === keyNumber
        && String(card.series || '').trim().toLowerCase() === keySeries;
    }) || null;
  };

  const resolveSlotCard = (slot) => {
    if (!slot) return null;

    const masterCard = findMasterCardBySlot(slot);
    if (!masterCard) return slot;

    // 슬롯에는 최소 데이터만 저장되어도, 화면에서는 항상 원본 카드 최신 정보를 우선 반영한다.
    return {
      ...slot,
      ...mapCardLite(masterCard),
      cardId: masterCard.id,
    };
  };

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
    setEditorViewMode('page');
    setActiveSlotIndex(null);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    setAlbumNameDraft((album.name || '').trim());
  };

  const closeEditor = () => {
    setEditingAlbum(null);
    setCurrentPageIndex(0);
    setEditorViewMode('page');
    setActiveSlotIndex(null);
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
    setCanvasDraggingLocation(null);
    setCanvasDragOverLocation(null);
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
    if (!editingAlbum) return;

    const pageSlots = editingAlbum?.pages?.[currentPageIndex]?.slots || [];
    const pageCount = editingAlbum?.pages?.length || 0;
    const hasActiveSlot = activeSlotIndex !== null && activeSlotIndex !== undefined;
    let targetPageIndex = currentPageIndex;
    let targetSlotIndex = null;

    if (hasActiveSlot) {
      targetSlotIndex = activeSlotIndex;
    } else if (editorViewMode === 'canvas' && pageCount > 0) {
      for (let offset = 0; offset < pageCount; offset += 1) {
        const pageIndex = (currentPageIndex + offset) % pageCount;
        const slots = editingAlbum?.pages?.[pageIndex]?.slots || [];
        const emptyIndex = slots.findIndex((slot) => !slot);
        if (emptyIndex !== -1) {
          targetPageIndex = pageIndex;
          targetSlotIndex = emptyIndex;
          break;
        }
      }
    } else {
      const nextEmptySlotIndex = pageSlots.findIndex((slot) => !slot);
      targetSlotIndex = nextEmptySlotIndex;
    }

    if (targetSlotIndex === -1 || targetSlotIndex === null || targetSlotIndex === undefined) {
      alert(editorViewMode === 'canvas'
        ? '캔버스 전체에 빈 슬롯이 없습니다. 슬롯을 직접 선택해 교체해주세요.'
        : '현재 페이지에 빈 슬롯이 없습니다. 슬롯을 직접 선택해 교체해주세요.');
      return;
    }

    const existingSlotCard = editingAlbum?.pages?.[targetPageIndex]?.slots?.[targetSlotIndex] || null;
    if (existingSlotCard) {
      const shouldReplace = window.confirm('이미 카드가 있는 슬롯입니다. 교체할까요?');
      if (!shouldReplace) return;
    }

    const cardLite = mapCardLite(card);
    applyAlbumUpdate((draft) => {
      draft.pages[targetPageIndex].slots[targetSlotIndex] = cardLite;
      return draft;
    });

    setCurrentPageIndex(targetPageIndex);

    // 슬롯을 직접 선택하지 않은 자동 배치 모드에서는 계속 순차 배치되도록 선택 상태를 유지하지 않는다.
    if (!hasActiveSlot) {
      setActiveSlotIndex(null);
    }
  };

  const clearDragState = () => {
    setDraggingSlotIndex(null);
    setDragOverSlotIndex(null);
  };

  const clearCanvasDragState = () => {
    setCanvasDraggingLocation(null);
    setCanvasDragOverLocation(null);
  };

  const moveOrSwapSlotCard = (fromPageIndex, fromSlotIndex, toPageIndex, toSlotIndex) => {
    if (!editingAlbum) return;
    if (fromPageIndex === toPageIndex && fromSlotIndex === toSlotIndex) return;

    applyAlbumUpdate((draft) => {
      const fromSlots = draft?.pages?.[fromPageIndex]?.slots;
      const toSlots = draft?.pages?.[toPageIndex]?.slots;
      if (!Array.isArray(fromSlots) || !Array.isArray(toSlots)) return draft;

      const fromCard = fromSlots[fromSlotIndex] || null;
      if (!fromCard) return draft;
      const toCard = toSlots[toSlotIndex] || null;

      // 빈 슬롯 드롭은 이동, 카드가 있는 슬롯 드롭은 교환.
      if (!toCard) {
        toSlots[toSlotIndex] = fromCard;
        fromSlots[fromSlotIndex] = null;
      } else {
        toSlots[toSlotIndex] = fromCard;
        fromSlots[fromSlotIndex] = toCard;
      }

      return draft;
    });
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

  const handleCanvasSlotDrop = (targetPageIndex, targetSlotIndex) => {
    if (!canvasDraggingLocation) {
      clearCanvasDragState();
      return;
    }

    moveOrSwapSlotCard(
      canvasDraggingLocation.pageIndex,
      canvasDraggingLocation.slotIndex,
      targetPageIndex,
      targetSlotIndex,
    );

    setCurrentPageIndex(targetPageIndex);
    setActiveSlotIndex(targetSlotIndex);
    clearCanvasDragState();
  };

  const clearSlotAt = (pageIndex, slotIndex) => {
    if (!editingAlbum || pageIndex === null || pageIndex === undefined || slotIndex === null || slotIndex === undefined) return;
    applyAlbumUpdate((draft) => {
      draft.pages[pageIndex].slots[slotIndex] = null;
      return draft;
    });
    if (pageIndex === currentPageIndex && activeSlotIndex === slotIndex) {
      setActiveSlotIndex(null);
    }
  };

  const clearSlotByIndex = (slotIndex) => {
    clearSlotAt(currentPageIndex, slotIndex);
  };

  const closeSlotCardEditor = () => {
    setSlotEditingCard(null);
  };

  const openSlotCardEditor = (slotCard, pageIndex, slotIndex) => {
    const fullCard = findMasterCardBySlot(slotCard);

    if (!fullCard) {
      alert('원본 카드 정보를 찾을 수 없습니다. 도감을 새로고침한 뒤 다시 시도해주세요.');
      return;
    }

    setCurrentPageIndex(pageIndex);
    setActiveSlotIndex(slotIndex);
    setSlotEditingCard(fullCard);
  };

  const handleModalSave = async (payload) => {
    if (!slotEditingCard?.id) return;

    const updatePayload = {
      cardName: payload.cardName || '',
      series: payload.series || '',
      cardNumber: payload.cardNumber || '',
      rarity: payload.rarity || '',
      type: payload.type || '',
      pokedexNumber: payload.pokedexNumber || '',
      status: payload.status || '미보유',
      price: parseInt(payload.price, 10) || 0,
      imageUrl: payload.imageUrl || '',
      possessions: payload.possessions || [],
    };

    try {
      await updateDoc(doc(db, 'pokemon_cards', slotEditingCard.id), updatePayload);

      setAllCards((prev) => prev.map((card) => (
        card.id === slotEditingCard.id ? { ...card, ...updatePayload } : card
      )));

      applyAlbumUpdate((draft) => {
        const updatedLite = mapCardLite({ id: slotEditingCard.id, ...updatePayload });
        draft.pages = (draft.pages || []).map((page) => {
          const slots = Array.isArray(page.slots) ? page.slots : [];
          return {
            ...page,
            slots: slots.map((slot) => {
              if (!slot || slot.cardId !== slotEditingCard.id) return slot;
              return { ...slot, ...updatedLite };
            }),
          };
        });
        return draft;
      });

      closeSlotCardEditor();
    } catch (err) {
      console.error('album slot card save error', err);
      alert('카드 상세 정보 저장에 실패했습니다.');
      throw err;
    }
  };

  const handleModalDelete = async () => {
    if (!slotEditingCard?.id) return;

    try {
      await deleteDoc(doc(db, 'pokemon_cards', slotEditingCard.id));
      setAllCards((prev) => prev.filter((card) => card.id !== slotEditingCard.id));

      applyAlbumUpdate((draft) => {
        draft.pages = (draft.pages || []).map((page) => ({
          ...page,
          slots: (page.slots || []).map((slot) => (slot?.cardId === slotEditingCard.id ? null : slot)),
        }));
        return draft;
      });

      closeSlotCardEditor();
    } catch (err) {
      console.error('album slot card delete error', err);
      alert('삭제 실패');
      throw err;
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
            const completion = countOwnedAndPlacedSlots(album);
            return (
              <article key={album.id} className={`album-card ${albumViewMode}`}>
                <div className="album-card-main" onClick={() => openAlbumEditor(album)}>
                  <h3>{album.name}</h3>
                  <p>레이아웃: {album.layoutKey} · 페이지 {album.pageCount || album.pages?.length || 1}장</p>
                  <p>완성도(보유중/배치): {completion.ownedPlaced}/{completion.placed}</p>
                  <small>배치 현황: {filled}/{total}</small>
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
          <p>레이아웃 {editingAlbum.layoutKey} · 페이지 {currentPageIndex + 1}/{editingAlbum.pages.length} · 보기 {editorViewMode === 'page' ? '페이지' : '캔버스'}</p>
        </div>
        <div className="album-editor-actions">
          <button type="button" className="btn btn-secondary" onClick={closeEditor}>목록으로</button>
          <div className="view-toggle">
            <button type="button" className={`btn-toggle ${editorViewMode === 'page' ? 'active' : ''}`} onClick={() => setEditorViewMode('page')}>페이지 보기</button>
            <button type="button" className={`btn-toggle ${editorViewMode === 'canvas' ? 'active' : ''}`} onClick={() => setEditorViewMode('canvas')}>전체 캔버스</button>
          </div>
          {editorViewMode === 'canvas' && (
            <div className="canvas-columns-control" title="캔버스 페이지 열 수 선택">
              <span>캔버스 배치</span>
              <div className="view-toggle">
                <button type="button" className={`btn-toggle ${canvasColumns === 1 ? 'active' : ''}`} onClick={() => setCanvasColumns(1)}>1열</button>
                <button type="button" className={`btn-toggle ${canvasColumns === 2 ? 'active' : ''}`} onClick={() => setCanvasColumns(2)}>2열</button>
                <button type="button" className={`btn-toggle ${canvasColumns === 3 ? 'active' : ''}`} onClick={() => setCanvasColumns(3)}>3열</button>
              </div>
            </div>
          )}
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
          {editorViewMode === 'page' && (
            <>
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
              const resolvedSlot = resolveSlotCard(slot);
              const isActive = activeSlotIndex === index;
              const isEmpty = !resolvedSlot;
              const isDragging = draggingSlotIndex === index;
              const isDragOver = dragOverSlotIndex === index && draggingSlotIndex !== index;
              return (
                <button
                  type="button"
                  key={`slot-${index}`}
                  className={`album-slot ${isActive ? 'active' : ''} ${isEmpty ? 'empty' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                  onClick={() => {
                    if (isEmpty) {
                      setActiveSlotIndex(index);
                      return;
                    }
                    openSlotCardEditor(resolvedSlot, currentPageIndex, index);
                  }}
                  title={isEmpty ? '빈 슬롯' : `${resolvedSlot.cardName || '카드'} 슬롯`}
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
                  <div className="album-slot-visual">
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

                    {resolvedSlot?.imageUrl ? (
                      <img src={resolvedSlot.imageUrl} alt={resolvedSlot.cardName || 'card'} />
                    ) : (
                      <div className="album-slot-empty">비어있음</div>
                    )}

                    {!isEmpty && (
                      <div className="album-slot-details">
                        <small>{resolvedSlot?.series || '-'}</small>
                        <small>{resolvedSlot?.cardNumber || '-'}</small>
                        <small>레어도: {resolvedSlot?.rarity || '-'}</small>
                      </div>
                    )}
                  </div>

                  <div className="album-slot-meta">
                    <strong>{resolvedSlot?.cardName || `슬롯 ${index + 1}`}</strong>
                    <span className={`album-slot-status ${getStatusTone(resolvedSlot?.status)}`}>{resolvedSlot?.status || '미배치'}</span>
                  </div>
                </button>
              );
            })}
          </div>
            </>
          )}

          {editorViewMode === 'canvas' && (
            <div
              className="album-canvas-board"
              style={{
                gridTemplateColumns: `repeat(${canvasColumns}, minmax(0, 1fr))`,
              }}
            >
              {editingAlbum.pages.map((page, pageIndex) => {
                const filledCount = (page.slots || []).filter(Boolean).length;
                const totalCount = (page.slots || []).length;
                return (
                  <article
                    key={`canvas-page-${pageIndex}`}
                    className={`album-canvas-page-card ${currentPageIndex === pageIndex ? 'active' : ''}`}
                    onClick={() => {
                      setCurrentPageIndex(pageIndex);
                    }}
                  >
                    <header className="album-canvas-page-header">
                      <strong>P{pageIndex + 1}</strong>
                      <small>{filledCount}/{totalCount}</small>
                    </header>
                    <div
                      className="album-canvas-page-grid"
                      style={{
                        gridTemplateColumns: `repeat(${selectedLayout?.cols || editingAlbum.cols}, minmax(0, 1fr))`,
                      }}
                    >
                      {(page.slots || []).map((slot, slotIndex) => {
                        const resolvedSlot = resolveSlotCard(slot);
                        const isEmpty = !resolvedSlot;
                        const isDragging = canvasDraggingLocation?.pageIndex === pageIndex && canvasDraggingLocation?.slotIndex === slotIndex;
                        const isDragOver = canvasDragOverLocation?.pageIndex === pageIndex && canvasDragOverLocation?.slotIndex === slotIndex && !isDragging;
                        return (
                          <button
                            type="button"
                            key={`canvas-slot-${pageIndex}-${slotIndex}`}
                            className={`album-slot ${isEmpty ? 'empty' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                            onClick={() => {
                              setCurrentPageIndex(pageIndex);
                              setActiveSlotIndex(slotIndex);
                              if (!resolvedSlot) return;
                              openSlotCardEditor(resolvedSlot, pageIndex, slotIndex);
                            }}
                            title={isEmpty ? '빈 슬롯' : `${resolvedSlot.cardName || '카드'} 슬롯`}
                            draggable={!isEmpty}
                            onDragStart={(e) => {
                              if (isEmpty) {
                                e.preventDefault();
                                return;
                              }
                              setCanvasDraggingLocation({ pageIndex, slotIndex });
                              setCanvasDragOverLocation({ pageIndex, slotIndex });
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnter={() => {
                              if (!canvasDraggingLocation) return;
                              setCanvasDragOverLocation({ pageIndex, slotIndex });
                            }}
                            onDragOver={(e) => {
                              if (!canvasDraggingLocation) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleCanvasSlotDrop(pageIndex, slotIndex);
                            }}
                            onDragEnd={clearCanvasDragState}
                          >
                            <div className="album-slot-visual">
                              {!isEmpty && (
                                <button
                                  type="button"
                                  className="album-slot-remove"
                                  title="이 슬롯에서 카드 제거"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearSlotAt(pageIndex, slotIndex);
                                  }}
                                >
                                  ✕
                                </button>
                              )}

                              {resolvedSlot?.imageUrl ? (
                                <img src={resolvedSlot.imageUrl} alt={resolvedSlot.cardName || 'card'} />
                              ) : (
                                <div className="album-slot-empty">비어있음</div>
                              )}

                              {!isEmpty && (
                                <div className="album-slot-details">
                                  <small>{resolvedSlot?.series || '-'}</small>
                                  <small>{resolvedSlot?.cardNumber || '-'}</small>
                                  <small>레어도: {resolvedSlot?.rarity || '-'}</small>
                                </div>
                              )}
                            </div>

                            <div className="album-slot-meta">
                              <strong>{resolvedSlot?.cardName || `슬롯 ${slotIndex + 1}`}</strong>
                              <span className={`album-slot-status ${getStatusTone(resolvedSlot?.status)}`}>{resolvedSlot?.status || '미배치'}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="album-card-picker">
          <h3>카드 배치 패널</h3>
          <p>슬롯 선택 시 해당 위치에 배치되고, 미선택 시 빈 슬롯에 자동으로 순차 배치됩니다. (캔버스 모드는 전체 페이지 기준)</p>

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

      <CardDetailModal 
        isOpen={!!slotEditingCard}
        card={slotEditingCard}
        appConfig={appConfig}
        onClose={closeSlotCardEditor}
        onSave={handleModalSave}
        onDelete={handleModalDelete}
      />
    </main>
  );
}
