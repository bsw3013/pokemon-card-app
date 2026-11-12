import { useCallback, useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { buildCardKey } from '../utils/cardKey';
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

function watchDoc(card, uid) {
  return {
    cardKey: buildCardKey(card),
    cardName: card.cardName || '',
    series: card.series || '',
    cardNumber: card.cardNumber || '',
    imageUrl: card.imageUrl || '',
    query: card.cardName || '',
    ownerId: uid,
    addedAt: new Date().toISOString(),
  };
}

// 여러 카드를 한 번에 관심 카드에 추가 (이미 있는 카드는 건너뜀). 새로 추가한 카드의 cardKey 목록을 돌려준다.
export async function addWatchMany(uid, cards) {
  const list = await load(uid);
  const have = new Set(list.map((w) => w.cardKey));
  const docs = cards.map((c) => watchDoc(c, uid)).filter((d) => d.cardKey && !have.has(d.cardKey) && have.add(d.cardKey));
  const added = [];
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => {
      const ref = doc(collection(db, 'marketWatchlist'));
      batch.set(ref, d);
      added.push({ id: ref.id, ...d });
    });
    await batch.commit();
  }
  if (cache && cache.uid === uid) cache = { uid, list: [...cache.list, ...added] };
  notify();
  return added.map((d) => d.cardKey);
}

// 여러 카드를 한 번에 관심 카드에서 빼기. 뺀 카드 정보(되돌리기용)를 돌려준다.
export async function removeWatchMany(uid, cardKeys) {
  const list = await load(uid);
  const keys = new Set(cardKeys);
  const targets = list.filter((w) => keys.has(w.cardKey));
  for (let i = 0; i < targets.length; i += 400) {
    const batch = writeBatch(db);
    targets.slice(i, i + 400).forEach((w) => batch.delete(doc(db, 'marketWatchlist', w.id)));
    await batch.commit();
  }
  const gone = new Set(targets.map((w) => w.id));
  if (cache && cache.uid === uid) cache = { uid, list: cache.list.filter((w) => !gone.has(w.id)) };
  notify();
  return targets;
}

// 되돌리기: 뺐던 관심 카드 문서를 다시 넣는다
export async function restoreWatchMany(uid, entries) {
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    entries.slice(i, i + 400).forEach(({ id, ...data }) => batch.set(doc(db, 'marketWatchlist', id), data));
    await batch.commit();
  }
  if (cache && cache.uid === uid) cache = { uid, list: [...cache.list, ...entries] };
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

// 다른 곳(시세 수집 대상 옮겨 적기 등)에서 관심 카드 목록을 읽고, 바뀔 때 알림을 받기 위한 함수
export function getWatchlist(uid) {
  return load(uid);
}
export function subscribeWatchlist(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
