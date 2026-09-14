import { useCallback, useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { normalizeStatus } from '../utils/statusUtils';
import { ownershipDocId, splitCardPayload } from '../utils/ownershipUtils';

function parsePossessions(raw) {
  let possessions = raw;
  if (typeof possessions === 'string' && possessions.trim().startsWith('[')) {
    try { possessions = JSON.parse(possessions); } catch { possessions = []; }
  }
  return Array.isArray(possessions) ? possessions : [];
}

// pokemon_cards(공용 마스터 정보) + cardOwnership(로그인한 사용자 본인의 보유 현황)을
// 하나로 합쳐서 기존 화면들이 쓰던 것과 동일한 모양의 카드 객체 배열로 제공하는 훅.
export function useOwnedCards() {
  const { user, isAdmin } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCards = useCallback(async () => {
    if (!user) {
      setCards([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [masterSnap, ownershipSnap] = await Promise.all([
        getDocs(collection(db, 'pokemon_cards')),
        getDocs(query(collection(db, 'cardOwnership'), where('ownerId', '==', user.uid))),
      ]);

      const ownershipByCardId = new Map();
      ownershipSnap.forEach((d) => {
        const data = d.data() || {};
        if (data.cardId) ownershipByCardId.set(data.cardId, data);
      });

      const merged = masterSnap.docs.map((d) => {
        const master = d.data() || {};
        const ownership = ownershipByCardId.get(d.id) || {};
        return {
          id: d.id,
          ...master,
          status: normalizeStatus(ownership.status),
          language: ownership.language || '한국',
          price: Number(ownership.price) || 0,
          possessions: parsePossessions(ownership.possessions),
        };
      });

      setCards(merged);
    } catch (err) {
      console.error('카드/보유현황 로드 실패', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

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
    setCards((prev) => prev.map((c) => (
      c.id === cardId
        ? { ...c, ...ownershipFields, status: normalizeStatus(ownershipFields.status ?? c.status) }
        : c
    )));
  }, [user]);

  // 카드 마스터 정보(이름/시리즈/카드번호 등) + 보유현황을 함께 저장. 마스터 필드 저장은 관리자만 실제로 반영된다.
  const saveCard = useCallback(async (cardId, payload) => {
    if (!cardId) return;
    const { master, ownership } = splitCardPayload(payload);
    const tasks = [];
    if (isAdmin && Object.keys(master).length > 0) {
      tasks.push(updateDoc(doc(db, 'pokemon_cards', cardId), master));
    }
    if (Object.keys(ownership).length > 0) {
      tasks.push(saveOwnership(cardId, ownership));
    }
    await Promise.all(tasks);
    if (isAdmin && Object.keys(master).length > 0) {
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...master } : c)));
    }
  }, [isAdmin, saveOwnership]);

  // 새 카드(마스터 정보) 생성. 관리자만 가능.
  const createCard = useCallback(async (payload) => {
    if (!isAdmin) throw new Error('관리자만 카드를 추가할 수 있습니다.');
    const { master, ownership } = splitCardPayload(payload);
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
  }, [isAdmin, saveOwnership]);

  // 카드 마스터 정보 복제. 관리자만 가능. (보유현황은 각자 새로 입력)
  const duplicateCard = useCallback(async (payload) => {
    if (!isAdmin) throw new Error('관리자만 카드를 복제할 수 있습니다.');
    const { master } = splitCardPayload(payload);
    const ref = await addDoc(collection(db, 'pokemon_cards'), master);
    const newCard = { id: ref.id, ...master, status: '미보유', language: '한국', price: 0, possessions: [] };
    setCards((prev) => [newCard, ...prev]);
    return newCard;
  }, [isAdmin]);

  // 카드 마스터 정보 삭제. 관리자만 가능. 내 보유현황 문서도 함께 정리한다.
  const deleteCard = useCallback(async (cardId) => {
    if (!isAdmin) throw new Error('관리자만 카드를 삭제할 수 있습니다.');
    const tasks = [deleteDoc(doc(db, 'pokemon_cards', cardId))];
    if (user) {
      tasks.push(deleteDoc(doc(db, 'cardOwnership', ownershipDocId(cardId, user.uid))).catch(() => {}));
    }
    await Promise.all(tasks);
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  }, [isAdmin, user]);

  return { cards, setCards, loading, fetchCards, saveOwnership, saveCard, createCard, duplicateCard, deleteCard };
}
