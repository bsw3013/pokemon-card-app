import { useCallback, useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';

// 내 관심 카드(marketWatchlist)를 한 번만 읽어 두고 여러 화면이 같이 쓴다.
// 다른 화면(시세 페이지 등)에서 관심 카드를 바꾸면 invalidateWatchlist()로 다시 읽게 한다.
let cache = null; // { uid, list }
let pending = null;
const listeners = new Set();

async function load(uid) {
  if (cache && cache.uid === uid) return cache.list;
  if (!pending) {
    pending = getDocs(query(collection(db, 'marketWatchlist'), where('ownerId', '==', uid)))
      .then((snap) => {
        cache = { uid, list: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
        return cache.list;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

function notify() { listeners.forEach((fn) => fn()); }

export function invalidateWatchlist() {
  cache = null;
  notify();
}

// cardKey 하나에 대한 관심 카드 여부와 추가·해제
export function useWatchEntry(cardKey) {
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [list, setList] = useState(() => (cache && cache.uid === uid ? cache.list : []));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    const refresh = () => load(uid).then((l) => { if (alive) setList(l); }).catch((err) => console.error('관심 카드 불러오기 실패', err));
    refresh();
    listeners.add(refresh);
    return () => { alive = false; listeners.delete(refresh); };
  }, [uid]);

  const entry = uid && cardKey ? list.find((w) => w.cardKey === cardKey) || null : null;

  const add = useCallback(async (card) => {
    if (!uid || !cardKey) return;
    setBusy(true);
    try {
      const data = {
        cardKey,
        cardName: card.cardName || '',
        series: card.series || '',
        cardNumber: card.cardNumber || '',
        imageUrl: card.imageUrl || '',
        query: card.cardName || '',
        ownerId: uid,
        addedAt: new Date().toISOString(),
      };
      const ref = await addDoc(collection(db, 'marketWatchlist'), data);
      if (cache && cache.uid === uid) cache = { uid, list: [...cache.list, { id: ref.id, ...data }] };
      notify();
    } finally {
      setBusy(false);
    }
  }, [uid, cardKey]);

  const remove = useCallback(async () => {
    if (!entry) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'marketWatchlist', entry.id));
      if (cache && cache.uid === uid) cache = { uid, list: cache.list.filter((w) => w.id !== entry.id) };
      notify();
    } finally {
      setBusy(false);
    }
  }, [entry, uid]);

  return { entry, busy, add, remove, signedIn: !!uid };
}
