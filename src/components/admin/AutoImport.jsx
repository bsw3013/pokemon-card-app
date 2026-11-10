import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../AuthContext';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import { DEFAULT_RARITIES, DEFAULT_SETS, buildSetIndex, withCardMeta } from '../../utils/catalog';

// 새 세트 카드 자동 등록
// 사이트와 함께 배포되는 public/imports/manifest.json 에 적힌 가져오기 파일을,
// 관리자가 로그인해서 사이트를 열 때 한 번만 자동으로 데이터베이스에 넣는다.
//  - 세트 표(settings/catalog)에 없는 세트를 추가
//  - 같은 카드 번호(예: M4-084)가 이미 있는 카드는 건너뛰고 없는 카드만 추가
//  - 끝나면 settings/imports 에 기록해서 다시 하지 않음
const norm = (v) => String(v ?? '').trim();
const numKey = (v) => norm(v).toUpperCase();

export default function AutoImport() {
  const { user, isAdmin } = useAuth();
  const { cards, loading, catalog, catalogLoaded, saveCatalog, fetchCards } = useOwnedCards();
  const startedRef = useRef(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user || !isAdmin || loading || !catalogLoaded || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/imports/manifest.json', { cache: 'no-store' });
        if (!res.ok) return;
        const manifest = await res.json();
        const ids = Array.isArray(manifest.imports) ? manifest.imports : [];
        if (ids.length === 0) return;
        const doneSnap = await getDoc(doc(db, 'settings', 'imports'));
        const done = doneSnap.exists() ? doneSnap.data() : {};
        const pending = ids.filter((id) => !done[id]);
        if (pending.length === 0) return;

        let sets = [...(catalog?.sets || DEFAULT_SETS)];
        const known = new Set(cards.map((c) => numKey(c.cardNumber)).filter(Boolean));
        const notes = [];
        for (const id of pending) {
          const pkgRes = await fetch(`/imports/${id}.json`, { cache: 'no-store' });
          if (!pkgRes.ok) continue;
          const pkg = await pkgRes.json();

          // 1) 세트 표에 없는 세트 추가
          const have = new Set(sets.map((s) => norm(s.code).toLowerCase()));
          const newSets = (pkg.sets || []).filter((s) => !have.has(norm(s.code).toLowerCase()));
          if (newSets.length) {
            sets = [...sets, ...newSets];
            await saveCatalog({ sets, rarities: catalog?.rarities || DEFAULT_RARITIES });
          }

          // 2) 없는 카드만 추가
          const index = buildSetIndex(sets);
          const toAdd = (pkg.cards || []).filter((c) => c.cardNumber && !known.has(numKey(c.cardNumber)));
          for (let i = 0; i < toAdd.length; i += 400) {
            const batch = writeBatch(db);
            toAdd.slice(i, i + 400).forEach((c) => {
              batch.set(doc(collection(db, 'pokemon_cards')), withCardMeta({ ...c }, { setIndex: index, isNew: true }));
              known.add(numKey(c.cardNumber));
            });
            await batch.commit();
          }

          // 3) 다시 하지 않도록 기록
          await setDoc(doc(db, 'settings', 'imports'), {
            [id]: { appliedAt: new Date().toISOString(), setsAdded: newSets.map((s) => s.code), cardsAdded: toAdd.length },
          }, { merge: true });
          notes.push(`${newSets.length ? `새 세트 ${newSets.map((s) => s.name).join('·')}` : '세트'} / 카드 ${toAdd.length}장`);
        }
        if (notes.length) {
          await fetchCards();
          setMessage(`새 세트 카드를 자동으로 등록했어요: ${notes.join(', ')}`);
        }
      } catch (err) {
        console.error('새 세트 자동 등록 실패', err);
        startedRef.current = false; // 다음에 다시 시도
      }
    })();
  }, [user, isAdmin, loading, catalogLoaded, catalog, cards, saveCatalog, fetchCards]);

  if (!message) return null;
  return (
    <div className="auto-import-toast" role="status">
      <span>{message}</span>
      <button type="button" onClick={() => setMessage('')} aria-label="닫기">✕</button>
    </div>
  );
}
