import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// 시세 기록(marketListings)을 한 번만 읽어서 카드별로 묶어 두고 여러 화면이 같이 쓴다.
// 시세를 기록·수정·삭제하면 invalidateMarketIndex()를 불러서 다시 읽게 한다.
let cache = null; // Map<cardKey, listing[]>
let pending = null;
const listeners = new Set();

async function load() {
  if (cache) return cache;
  if (!pending) {
    pending = getDocs(collection(db, 'marketListings'))
      .then((snap) => {
        const m = new Map();
        snap.forEach((d) => {
          const l = { id: d.id, ...d.data() };
          if (!l.cardKey) return;
          if (!m.has(l.cardKey)) m.set(l.cardKey, []);
          m.get(l.cardKey).push(l);
        });
        cache = m;
        return m;
      })
      .catch((err) => {
        console.error('시세 기록 불러오기 실패', err);
        cache = new Map();
        return cache;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

export function invalidateMarketIndex() {
  cache = null;
  listeners.forEach((fn) => fn());
}

export function useMarketIndex() {
  const [index, setIndex] = useState(cache);
  useEffect(() => {
    let alive = true;
    const refresh = () => { load().then((m) => { if (alive) setIndex(m); }); };
    listeners.add(refresh);
    refresh();
    return () => { alive = false; listeners.delete(refresh); };
  }, []);
  return index; // 아직 못 읽었으면 null
}
