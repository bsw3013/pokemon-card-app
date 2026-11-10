import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { normalizeStatus } from './utils/statusUtils';
import { absorbGradedStatus } from './utils/cardStats';
import { ownershipDocId, splitCardPayload } from './utils/ownershipUtils';
import { DEFAULT_SETS, buildSetIndex, withCardMeta } from './utils/catalog';
import { loadMasterCards, recordCardDeletes } from './utils/cardSync';
import { CardsContext } from './cardsContextObject';

function parsePossessions(raw) {
  let possessions = raw;
  if (typeof possessions === 'string' && possessions.trim().startsWith('[')) {
    try { possessions = JSON.parse(possessions); } catch { possessions = []; }
  }
  return Array.isArray(possessions) ? possessions : [];
}

// pokemon_cards(공용 마스터 정보) + cardOwnership(로그인한 사용자 본인의 보유 현황)을
// 하나로 합쳐서 기존 화면들이 쓰던 것과 동일한 모양의 카드 객체 배열로 제공한다.
// 앱 전체에서 한 번만 불러오고(로그인 계정이 바뀔 때만 다시 읽음) 모든 페이지가 같은 목록을 함께 쓴다.
// 예전에는 페이지를 옮길 때마다 카드 전체를 다시 읽어서 느리고 Firestore 읽기 횟수가 많았다.
export function CardsProvider({ children }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const uid = user?.uid || null;
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  // 내 보유 현황 문서(cardOwnership)가 실제로 있는 카드 id 목록. (데이터 정리 도구가 사용)
  const [ownershipCardIds, setOwnershipCardIds] = useState(() => new Set());
  const requestRef = useRef(0);
  // 세트·레어도 표(settings/catalog). 아직 만들지 않았으면 null.
  const [catalog, setCatalog] = useState(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // 카드 저장 시 세트 코드를 찾기 위한 색인 (표가 아직 없으면 기본 세트 목록 사용)
  const setIndex = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const cardsRef = useRef(cards);
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  const fetchCatalog = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', 'catalog'));
      const data = snap.exists() ? snap.data() : null;
      setCatalog(data && Array.isArray(data.sets) && Array.isArray(data.rarities) ? data : null);
    } catch (err) {
      console.error('세트·레어도 표 로드 실패', err);
    } finally {
      setCatalogLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // 세트·레어도 표 저장 (관리자만 가능 — firestore.rules 의 settings 규칙)
  const saveCatalog = useCallback(async (nextCatalog) => {
    if (!isAdmin) throw new Error('관리자만 세트·레어도 표를 바꿀 수 있습니다.');
    const payload = {
      sets: nextCatalog.sets || [],
      rarities: nextCatalog.rarities || [],
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'settings', 'catalog'), payload);
    setCatalog(payload);
    return payload;
  }, [isAdmin]);

  const fetchCards = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      // 로그인 안 한 게스트는 공용 카드 도감(pokemon_cards)만 읽고, 개인 보유현황(cardOwnership)은 건너뛴다.
      // 카드 도감은 사이트에 함께 올라간 카드 목록 파일 + 그 뒤에 바뀐 카드만 읽는다 (utils/cardSync.js)
      const [masterCards, ownershipSnap] = await Promise.all([
        loadMasterCards(),
        uid
          ? getDocs(query(collection(db, 'cardOwnership'), where('ownerId', '==', uid)))
          : Promise.resolve(null),
      ]);

      const ownershipByCardId = new Map();
      if (ownershipSnap) {
        ownershipSnap.forEach((d) => {
          const data = d.data() || {};
          if (data.cardId) ownershipByCardId.set(data.cardId, data);
        });
      }

      const merged = masterCards.map(({ id, ...master }) => {
        const ownership = ownershipByCardId.get(id) || {};
        const own = absorbGradedStatus(ownership.status, ownership.possessions, ownership.language);
        return {
          id,
          ...master,
          status: normalizeStatus(own.status),
          language: ownership.language || '한국',
          price: Number(ownership.price) || 0,
          possessions: own.possessions,
        };
      });

      // 그 사이 로그인 계정이 바뀌어 새로 불러오기 시작했다면, 늦게 도착한 옛 결과는 버린다.
      if (requestId !== requestRef.current) return;
      setCards(merged);
      setOwnershipCardIds(new Set(ownershipByCardId.keys()));
    } catch (err) {
      console.error('카드/보유현황 로드 실패', err);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    // 로그인 확인이 끝난 뒤에 한 번만 읽는다. (확인 전에 손님으로 한 번, 확인 후 다시 한 번 읽지 않도록)
    if (authLoading) return;
    fetchCards();
  }, [fetchCards, authLoading]);

  // 로그인한 본인의 보유 현황(status/language/price/possessions)만 저장.
  const saveOwnership = useCallback(async (cardId, fields) => {
    if (!user || !cardId) return;
    const ownershipFields = splitCardPayload(fields).ownership;
    if (Object.keys(ownershipFields).length === 0) return;
    const id = ownershipDocId(cardId, user.uid);
    await setDoc(doc(db, 'cardOwnership', id), {
      cardId,
      ownerId: user.uid,
      ...ownershipFields,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    setOwnershipCardIds((prev) => (prev.has(cardId) ? prev : new Set(prev).add(cardId)));
    setCards((prev) => prev.map((c) => (
      c.id === cardId
        ? { ...c, ...ownershipFields, status: normalizeStatus(ownershipFields.status ?? c.status) }
        : c
    )));
  }, [user]);

  // 카드 마스터 정보(이름/시리즈/카드번호 등) + 보유현황을 함께 저장. 마스터 필드 저장은 관리자만 실제로 반영된다.
  const saveCard = useCallback(async (cardId, payload) => {
    if (!cardId) return;
    const split = splitCardPayload(payload);
    const { ownership } = split;
    const hasMaster = Object.keys(split.master).length > 0;
    const existing = cardsRef.current.find((c) => c.id === cardId) || {};
    const master = hasMaster ? withCardMeta(split.master, { setIndex, existing }) : split.master;
    const tasks = [];
    if (isAdmin && hasMaster) {
      tasks.push(updateDoc(doc(db, 'pokemon_cards', cardId), master));
    }
    if (Object.keys(ownership).length > 0) {
      tasks.push(saveOwnership(cardId, ownership));
    }
    await Promise.all(tasks);
    if (isAdmin && hasMaster) {
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...master } : c)));
    }
  }, [isAdmin, saveOwnership, setIndex]);

  // 새 카드(마스터 정보) 생성. 관리자만 가능.
  const createCard = useCallback(async (payload) => {
    if (!isAdmin) throw new Error('관리자만 카드를 추가할 수 있습니다.');
    const split = splitCardPayload(payload);
    const { ownership } = split;
    const master = withCardMeta(split.master, { setIndex, isNew: true });
    const ref = await addDoc(collection(db, 'pokemon_cards'), master);
    const newCard = {
      id: ref.id,
      ...master,
      status: normalizeStatus(ownership.status),
      language: ownership.language || '한국',
      price: Number(ownership.price) || 0,
      possessions: parsePossessions(ownership.possessions),
    };
    setCards((prev) => [newCard, ...prev]);
    if (Object.keys(ownership).length > 0) {
      await saveOwnership(ref.id, ownership);
    }
    return newCard;
  }, [isAdmin, saveOwnership, setIndex]);

  // 카드 마스터 정보 복제. 관리자만 가능. (보유현황은 각자 새로 입력)
  const duplicateCard = useCallback(async (payload) => {
    if (!isAdmin) throw new Error('관리자만 카드를 복제할 수 있습니다.');
    const master = withCardMeta(splitCardPayload(payload).master, { setIndex, isNew: true });
    const ref = await addDoc(collection(db, 'pokemon_cards'), master);
    const newCard = { id: ref.id, ...master, status: '미보유', language: '한국', price: 0, possessions: [] };
    setCards((prev) => [newCard, ...prev]);
    return newCard;
  }, [isAdmin, setIndex]);

  // 카드 마스터 정보 삭제. 관리자만 가능. 내 보유현황 문서도 함께 정리한다.
  const deleteCard = useCallback(async (cardId) => {
    if (!isAdmin) throw new Error('관리자만 카드를 삭제할 수 있습니다.');
    const tasks = [deleteDoc(doc(db, 'pokemon_cards', cardId)), recordCardDeletes([cardId])];
    if (user) {
      tasks.push(deleteDoc(doc(db, 'cardOwnership', ownershipDocId(cardId, user.uid))).catch(() => {}));
    }
    await Promise.all(tasks);
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  }, [isAdmin, user]);

  const value = useMemo(
    () => ({
      cards, setCards, loading, fetchCards, ownershipCardIds,
      catalog, catalogLoaded, fetchCatalog, saveCatalog,
      saveOwnership, saveCard, createCard, duplicateCard, deleteCard,
    }),
    [cards, loading, fetchCards, ownershipCardIds, catalog, catalogLoaded, fetchCatalog, saveCatalog, saveOwnership, saveCard, createCard, duplicateCard, deleteCard],
  );
  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>;
}
