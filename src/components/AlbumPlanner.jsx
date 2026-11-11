import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import AlbumLibrary from './album/AlbumLibrary';
import AlbumEditor from './album/AlbumEditor';
import { shrinkImage } from './album/albumUtils';
import { normalizeStatus } from '../utils/statusUtils';
import { formatCardPayload } from '../utils/cardUtils';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { useAuth } from '../AuthContext';
import CardDetailModal from './CardDetailModal';
import CardThumbnail from './CardThumbnail';
import CardsPage from '../pages/CardsPage';
import { normalizeImageUrl } from '../utils/thumbKey';

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

function createNewAlbumPayload(name, layoutKey, pageCount = 1, coverColor = '#334155') {
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
    coverColor: coverColor || '#334155',
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


export default function AlbumPlanner({ appConfig }) {
  const { user, isAdmin } = useAuth();
  const { cards: ownedCards, saveCard, deleteCard, catalog } = useOwnedCards();
  const [loadingAlbums, setLoadingAlbums] = useState(true);
  const [albums, setAlbums] = useState([]);

  const [showCreate, setShowCreate] = useState(false);

  const [editingAlbum, setEditingAlbum] = useState(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const allCards = useMemo(() => (
    [...ownedCards].sort((a, b) => String(a.cardName || '').localeCompare(String(b.cardName || '')))
  ), [ownedCards]);

  const [slotEditingCard, setSlotEditingCard] = useState(null);

  const [saveStatus, setSaveStatus] = useState('idle');

  const [historyPast, setHistoryPast] = useState([]);
  const [historyFuture, setHistoryFuture] = useState([]);

  const albumRef = useRef(null);
  const autosaveTimerRef = useRef(null);

  const [showCardPicker, setShowCardPicker] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSourceAlbumId, setImportSourceAlbumId] = useState('');
  const [importSelectedPageIndex, setImportSelectedPageIndex] = useState(null);

  useEffect(() => {
    albumRef.current = editingAlbum;
  }, [editingAlbum]);


  useEffect(() => {
    async function fetchAlbums() {
      if (!user) { setAlbums([]); setLoadingAlbums(false); return; }
      setLoadingAlbums(true);
      try {
        const albumSnap = await getDocs(query(collection(db, ALBUM_COLLECTION), where('ownerId', '==', user.uid)));
        const loadedAlbums = albumSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setAlbums(loadedAlbums);
      } catch (err) {
        console.error('album planner init error', err);
      } finally {
        setLoadingAlbums(false);
      }
    }

    fetchAlbums();
  }, [user]);



  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;


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

  const updateHashQueryParams = (params, options = {}) => {
    const currentHash = window.location.hash;
    const path = currentHash.split('?')[0] || '#album';
    const searchParams = new URLSearchParams(currentHash.split('?')[1] || '');
    
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) {
        searchParams.delete(key);
      } else {
        searchParams.set(key, String(value));
      }
    });
    
    const qs = searchParams.toString();
    const nextHash = qs ? `${path}?${qs}` : path;
    if (window.location.hash !== nextHash) {
      if (options.replace) {
        window.history.replaceState(null, '', nextHash);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        window.location.hash = nextHash;
      }
    }
  };

  const openCreateModal = () => {
    setShowCreate(true);
    updateHashQueryParams({ action: 'createAlbum' });
  };
  const closeCreateModal = () => {
    setShowCreate(false);
    updateHashQueryParams({ action: null }, { replace: true });
  };

  const openCardPicker = () => {
    setShowCardPicker(true);
    updateHashQueryParams({ action: 'cardPicker' });
  };
  const closeCardPicker = () => {
    setShowCardPicker(false);
    updateHashQueryParams({ action: null }, { replace: true });
  };


  const openImportModal = () => {
    setShowImportModal(true);
    setImportSourceAlbumId('');
    setImportSelectedPageIndex(null);
    updateHashQueryParams({ action: 'importPage' });
  };
  const closeImportModal = () => {
    setShowImportModal(false);
    setImportSourceAlbumId('');
    setImportSelectedPageIndex(null);
    updateHashQueryParams({ action: null }, { replace: true });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHashChange = () => {
      const hash = window.location.hash;
      const searchParams = new URLSearchParams(hash.split('?')[1] || '');
      
      const albumId = searchParams.get('albumId');
      const action = searchParams.get('action');
      
      if (albumId) {
        if (!editingAlbum || editingAlbum.id !== albumId) {
          const matchedAlbum = albums.find(a => a.id === albumId);
          if (matchedAlbum) {
            const normalized = deepCopy(matchedAlbum);
            normalized.pageCount = normalized.pages?.length || normalized.pageCount || 1;
            setEditingAlbum(normalized);
          }
        }
      } else {
        if (editingAlbum) {
          setEditingAlbum(null);
        }
      }
      
      setShowCreate(action === 'createAlbum');
      setShowCardPicker(action === 'cardPicker');
      setShowImportModal(action === 'importPage');
    };

    window.addEventListener('hashchange', handleHashChange);
    if (albums.length > 0) {
      handleHashChange();
    }
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [albums, editingAlbum]);

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
            // 표지·색은 앨범 목록에서 바꾼 최신 값을 쓴다
            setEditingAlbum({ ...localDraft, cover: normalized.cover, coverColor: normalized.coverColor ?? localDraft.coverColor });
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
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    updateHashQueryParams({ albumId: album.id });
  };

  const closeEditor = () => {
    setEditingAlbum(null);
    setCurrentPageIndex(0);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    updateHashQueryParams({ albumId: null, action: null }, { replace: true });
  };

  const handleImportPage = () => {
    if (!editingAlbum || !importSourceAlbumId || importSelectedPageIndex === null) return;
    
    const sourceAlbum = albums.find(a => a.id === importSourceAlbumId);
    if (!sourceAlbum) {
      alert('가져올 대상 앨범을 찾을 수 없습니다.');
      return;
    }
    
    const sourcePage = sourceAlbum.pages?.[importSelectedPageIndex];
    if (!sourcePage) {
      alert('선택한 페이지의 정보가 유효하지 않습니다.');
      return;
    }
    
    const slotsCopy = deepCopy(sourcePage.slots);
    
    const targetCols = editingAlbum.cols || 3;
    const targetRows = editingAlbum.rows || 3;
    const targetSlotCount = targetCols * targetRows;
    
    const chunks = [];
    for (let i = 0; i < slotsCopy.length; i += targetSlotCount) {
      const chunk = slotsCopy.slice(i, i + targetSlotCount);
      while (chunk.length < targetSlotCount) {
        chunk.push(null);
      }
      chunks.push(chunk);
    }
    
    const originalPageCount = editingAlbum.pages?.length || 0;
    
    applyAlbumUpdate((draft) => {
      chunks.forEach((chunk) => {
        draft.pages.push({ slots: chunk });
      });
      return draft;
    });
    
    setCurrentPageIndex(originalPageCount);
    
    closeImportModal();
    
    if (chunks.length > 1) {
      alert(`'${sourceAlbum.name}' 앨범의 ${importSelectedPageIndex + 1}페이지를 가져왔습니다.\n(슬롯 초과로 인해 새로운 페이지 ${chunks.length}개가 추가되었습니다.)`);
    } else {
      alert(`'${sourceAlbum.name}' 앨범의 ${importSelectedPageIndex + 1}페이지를 성공적으로 가져왔습니다.`);
    }
  };



  const handleCreateAlbum = async ({ name, layoutKey, pageCount, coverColor }) => {
    if (!user) return;
    const payload = { ...createNewAlbumPayload(name, layoutKey, Number(pageCount) || 1, coverColor), cover: { type: 'pages' }, ownerId: user.uid };

    try {
      const ref = await addDoc(collection(db, ALBUM_COLLECTION), payload);
      const newAlbum = { id: ref.id, ...payload };
      setAlbums((prev) => [newAlbum, ...prev]);
      closeCreateModal();
      openAlbumEditor(newAlbum);
    } catch (err) {
      console.error('create album error', err);
      alert('앨범 생성에 실패했습니다.');
    }
  };

  // 앨범 목록에서 이름·표지·색 바꾸기
  const handlePatchAlbum = async (albumId, patch) => {
    const next = { ...patch, updatedAt: new Date().toISOString() };
    await updateDoc(doc(db, ALBUM_COLLECTION, albumId), next);
    setAlbums((prev) => prev.map((a) => (a.id === albumId ? { ...a, ...next } : a)));
  };

  const handleDuplicateAlbum = async (album) => {
    if (!user) return;
    const now = new Date().toISOString();
    const { id: _omit, isDeleted: _deleted, ...rest } = deepCopy(album);
    const payload = { ...rest, name: `${album.name || '앨범'} (복사본)`, ownerId: user.uid, createdAt: now, updatedAt: now };
    try {
      const ref = await addDoc(collection(db, ALBUM_COLLECTION), payload);
      setAlbums((prev) => [{ id: ref.id, ...payload }, ...prev]);
    } catch (err) {
      console.error('duplicate album error', err);
      alert('앨범을 복제하지 못했어요.');
    }
  };

  // 표지 사진 올리기: 작게 줄여서 albumCovers/{내 uid}/ 에 저장하고 주소를 돌려준다
  const uploadAlbumCover = async (albumId, file) => {
    if (!user) throw new Error('로그인이 필요해요');
    const blob = await shrinkImage(file, 1200, 0.85);
    const fileRef = storageRef(storage, `albumCovers/${user.uid}/${albumId}_${Date.now()}.jpg`);
    const snap = await uploadBytes(fileRef, blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
    return getDownloadURL(snap.ref);
  };

  const handleDeleteAlbum = async (albumId) => {
    if (!window.confirm('정말 이 앨범을 휴지통으로 보낼까요?')) return;
    try {
      await updateDoc(doc(db, ALBUM_COLLECTION, albumId), { isDeleted: true });
      setAlbums((prev) => prev.map((a) => a.id === albumId ? { ...a, isDeleted: true } : a));
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${albumId}`);
      if (editingAlbum?.id === albumId) closeEditor();
    } catch (err) {
      console.error('delete album error', err);
      alert('앨범 휴지통 이동에 실패했습니다.');
    }
  };

  const handleRestoreAlbum = async (albumId) => {
    try {
      await updateDoc(doc(db, ALBUM_COLLECTION, albumId), { isDeleted: false });
      setAlbums((prev) => prev.map((a) => a.id === albumId ? { ...a, isDeleted: false } : a));
    } catch (err) {
      console.error('restore album error', err);
      alert('앨범 복구 중 오류가 발생했습니다.');
    }
  };

  const handlePermanentDeleteAlbum = async (albumId) => {
    if (!window.confirm('정말 영구적으로 삭제할까요? 복구할 수 없습니다.')) return;
    try {
      await deleteDoc(doc(db, ALBUM_COLLECTION, albumId));
      setAlbums((prev) => prev.filter((a) => a.id !== albumId));
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${albumId}`);
      if (editingAlbum?.id === albumId) closeEditor();
    } catch (err) {
      console.error('permanent delete album error', err);
      alert('앨범 영구 삭제 중 오류가 발생했습니다.');
    }
  };





  const handleBatchAssign = (selectedCards) => {
    if (!editingAlbum || !selectedCards.length) return;

    applyAlbumUpdate((draft) => {
      let cardIdx = 0;
      const pageCount = draft.pages.length;
      const slotCount = (draft.cols || 0) * (draft.rows || 0);

      // 현재 페이지부터 시작하여 빈 슬롯을 채움
      for (let offset = 0; offset < pageCount && cardIdx < selectedCards.length; offset++) {
        const pIdx = (currentPageIndex + offset) % pageCount;
        const page = draft.pages[pIdx];
        
        for (let sIdx = 0; sIdx < slotCount && cardIdx < selectedCards.length; sIdx++) {
          if (!page.slots[sIdx]) {
            page.slots[sIdx] = mapCardLite(selectedCards[cardIdx]);
            cardIdx++;
          }
        }
      }

      // 그래도 남은 카드가 있다면 새 페이지 생성
      while (cardIdx < selectedCards.length) {
        const newPage = makeEmptyPage(slotCount);
        const limit = Math.min(cardIdx + slotCount, selectedCards.length);
        for (let sIdx = 0; cardIdx < limit; sIdx++, cardIdx++) {
          newPage.slots[sIdx] = mapCardLite(selectedCards[cardIdx]);
        }
        draft.pages.push(newPage);
      }

      return draft;
    });

    closeCardPicker();
    alert(`${selectedCards.length}장의 카드가 배치되었습니다.`);
  };











  const closeSlotCardEditor = () => {
    setSlotEditingCard(null);
  };

  const openSlotCardEditor = (slotCard, pageIndex) => {
    const fullCard = findMasterCardBySlot(slotCard);

    if (!fullCard) {
      alert('원본 카드 정보를 찾을 수 없습니다. 도감을 새로고침한 뒤 다시 시도해주세요.');
      return;
    }

    setCurrentPageIndex(pageIndex);
    setSlotEditingCard(fullCard);
  };

  const handleModalSave = async (payload) => {
    if (!slotEditingCard?.id) return;

    const updatePayload = formatCardPayload(payload);

    try {
      await saveCard(slotEditingCard.id, updatePayload);

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
      await deleteCard(slotEditingCard.id);

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
      <AlbumLibrary
        albums={albums}
        cardsById={cardsById}
        layouts={LAYOUT_OPTIONS}
        createOpen={showCreate}
        onOpenCreate={openCreateModal}
        onCloseCreate={closeCreateModal}
        onCreate={handleCreateAlbum}
        onOpen={openAlbumEditor}
        onTrash={handleDeleteAlbum}
        onRestore={handleRestoreAlbum}
        onPurge={handlePermanentDeleteAlbum}
        onPatch={handlePatchAlbum}
        onDuplicate={handleDuplicateAlbum}
        uploadCover={uploadAlbumCover}
      />
    );
  }

  return (
    <main className="album-page ae-page">
      <AlbumEditor
        album={editingAlbum}
        cards={allCards}
        cardsById={cardsById}
        catalog={catalog}
        apply={applyAlbumUpdate}
        undo={handleUndo}
        redo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        saveStatus={saveStatus}
        onClose={closeEditor}
        onRename={(name) => applyAlbumUpdate((draft) => { draft.name = name; return draft; })}
        onOpenSlotCard={openSlotCardEditor}
        onOpenImport={openImportModal}
        onOpenBatch={openCardPicker}
      />

      <CardDetailModal 
        isOpen={!!slotEditingCard}
        card={slotEditingCard}
        appConfig={appConfig}
        isAdmin={isAdmin}
        onClose={closeSlotCardEditor}
        onSave={handleModalSave}
        onDelete={isAdmin ? handleModalDelete : undefined}
      />

      {showCardPicker && (
        <div className="modal-backdrop" style={{ zIndex: 1500 }}>
          <div className="modal-content" style={{ maxWidth: '95vw', height: '90vh', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <CardsPage 
              appConfig={appConfig} 
              isPicker={true} 
              onSelectCards={handleBatchAssign} 
              onClose={closeCardPicker} 
            />
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-backdrop" style={{ zIndex: 1500 }} onClick={closeImportModal}>
          <div className="modal-content" style={{ maxWidth: '850px', height: '80vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={closeImportModal}>✕</button>
            <h2 className="modal-title">다른 앨범에서 페이지 가져오기</h2>
            
            <div className="import-select-group" style={{ marginBottom: '1.5rem', flex: 'none' }}>
              <label style={{ fontSize: '1rem', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>대상 앨범 선택</label>
              <select 
                value={importSourceAlbumId} 
                onChange={(e) => {
                  setImportSourceAlbumId(e.target.value);
                  setImportSelectedPageIndex(null);
                }}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', background: 'var(--surface-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
              >
                <option value="" style={{ background: 'var(--surface-color)', color: 'var(--text-main)' }}>-- 복사해 올 대상 앨범을 골라주세요 --</option>
                {albums.filter(a => a.id !== editingAlbum.id && !a.isDeleted).map(album => (
                  <option key={album.id} value={album.id} style={{ background: 'var(--surface-color)', color: 'var(--text-main)' }}>{album.name} ({album.layoutKey} · 페이지 {album.pages?.length || 1}장)</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
              {importSourceAlbumId ? (
                (() => {
                  const source = albums.find(a => a.id === importSourceAlbumId);
                  if (!source || !source.pages?.length) {
                    return <div className="album-empty">해당 앨범에 페이지가 없습니다.</div>;
                  }
                  return (
                    <div className="album-import-grid">
                      {source.pages.map((page, pageIdx) => {
                        const isSelected = importSelectedPageIndex === pageIdx;
                        return (
                          <div 
                            key={`import-page-${pageIdx}`}
                            className={`page-preview-card ${isSelected ? 'selected' : ''}`}
                            onClick={() => setImportSelectedPageIndex(pageIdx)}
                          >
                            <div className="preview-card-header">
                              <input 
                                type="radio" 
                                name="importPageIndex" 
                                checked={isSelected} 
                                onChange={() => setImportSelectedPageIndex(pageIdx)} 
                              />
                              <strong>페이지 {pageIdx + 1}</strong>
                            </div>
                            
                            <div 
                              className="mini-page-preview"
                              style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${source.cols || 3}, minmax(0, 1fr))`,
                                gap: '4px',
                                padding: '6px',
                                background: 'rgba(0, 0, 0, 0.4)',
                                borderRadius: '8px',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                aspectRatio: `${source.cols} / ${source.rows}`
                              }}
                            >
                              {(page.slots || []).map((slot, slotIdx) => {
                                const resolvedSlot = resolveSlotCard(slot);
                                const isEmpty = !resolvedSlot;
                                return (
                                  <div 
                                    key={`mini-slot-${pageIdx}-${slotIdx}`}
                                    className={`mini-slot ${isEmpty ? 'empty' : ''}`}
                                    style={{
                                      position: 'relative',
                                      borderRadius: '4px',
                                      background: isEmpty ? 'rgba(255, 255, 255, 0.02)' : 'var(--bg-lighter)',
                                      border: isEmpty ? '1px dashed rgba(255, 255, 255, 0.1)' : 'none',
                                      overflow: 'hidden',
                                      aspectRatio: '2.5 / 3.5'
                                    }}
                                  >
                                    {!isEmpty && resolvedSlot.imageUrl && (
                                      <img 
                                        src={normalizeImageUrl(resolvedSlot.imageUrl)} 
                                        alt={resolvedSlot.cardName} 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              ) : (
                <div className="album-empty" style={{ padding: '3rem' }}>
                  대상 앨범을 선택하시면 각 페이지의 카드 배치 그림이 여기에 나타납니다.
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={closeImportModal}>취소</button>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={handleImportPage}
                disabled={!importSourceAlbumId || importSelectedPageIndex === null}
              >
                이 페이지 배치 복사해오기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
