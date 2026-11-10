import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';

// 카드 도감(pokemon_cards)을 적게 읽어서 빠르게 불러오기
//
// 매일 백업 작업(GitHub Actions)이 카드 전체를 사이트 파일(/data/cards.json)로 함께 올린다.
// 사이트는
//   1) 그 파일로 카드 목록을 먼저 만들고 (데이터베이스 읽기 0번)
//   2) 파일을 만든 뒤에 바뀐 카드만 데이터베이스에 물어보고 (updatedAt 기준)
//   3) 그 뒤에 지운 카드는 settings/cardsMeta 의 삭제 기록으로 뺀다.
// 파일이 없거나 읽기에 실패하면 예전처럼 데이터베이스에서 전체를 읽는다.
//
// 그래서 카드를 바꾸는 곳은 모두 updatedAt(바꾼 시각)을 함께 저장하고,
// 카드를 지우는 곳은 recordCardDeletes 로 삭제 기록을 남겨야 한다.

export const CARDS_SNAPSHOT_URL = '/data/cards.json';
const META_REF = () => doc(db, 'settings', 'cardsMeta');
// 컴퓨터마다 시계가 조금씩 달라도 놓치지 않도록, 파일 만든 시각보다 2시간 앞부터 다시 확인한다.
const CLOCK_MARGIN_MS = 2 * 60 * 60 * 1000;

export const nowStamp = () => new Date().toISOString();

// 카드를 지웠다는 기록 (관리자만 쓸 수 있는 settings 문서)
export async function recordCardDeletes(ids) {
  const list = (ids || []).filter(Boolean);
  if (list.length === 0) return;
  const at = nowStamp();
  await setDoc(META_REF(), { deleted: Object.fromEntries(list.map((id) => [id, at])), updatedAt: at }, { merge: true });
}

async function loadAllFromDatabase() {
  const snap = await getDocs(collection(db, 'pokemon_cards'));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function loadSnapshotFile() {
  // no-cache: 매번 서버에 "바뀌었나?"만 확인하고, 안 바뀌었으면 브라우저에 있는 걸 그대로 쓴다.
  const res = await fetch(CARDS_SNAPSHOT_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json(); // 파일이 없으면 사이트 첫 화면(HTML)이 와서 여기서 실패한다
  const time = Date.parse(json?.generatedAt);
  if (!Array.isArray(json?.cards) || json.cards.length === 0 || Number.isNaN(time)) throw new Error('카드 목록 파일 형식이 맞지 않음');
  return { cards: json.cards, time };
}

// 카드 마스터 목록을 불러온다. 결과: [{ id, ...카드 정보 }]
export async function loadMasterCards() {
  let snapshot;
  try {
    snapshot = await loadSnapshotFile();
  } catch (err) {
    console.info('카드 목록 파일을 쓰지 못해 데이터베이스에서 전체를 읽습니다:', err.message);
    return loadAllFromDatabase();
  }

  try {
    const since = new Date(snapshot.time - CLOCK_MARGIN_MS).toISOString();
    const [changedSnap, metaSnap] = await Promise.all([
      getDocs(query(collection(db, 'pokemon_cards'), where('updatedAt', '>', since))),
      getDoc(META_REF()),
    ]);
    const byId = new Map(snapshot.cards.map((c) => [c.id, c]));
    changedSnap.forEach((d) => byId.set(d.id, { id: d.id, ...(d.data() || {}) }));

    // 지운 카드 빼기 (지운 뒤에 같은 id로 다시 저장된 카드는 남긴다)
    const deleted = (metaSnap.exists() && metaSnap.data()?.deleted) || {};
    Object.entries(deleted).forEach(([id, at]) => {
      const card = byId.get(id);
      if (card && !(String(card.updatedAt || '') > String(at))) byId.delete(id);
    });
    return [...byId.values()];
  } catch (err) {
    console.warn('바뀐 카드 확인 실패, 데이터베이스에서 전체를 읽습니다:', err);
    return loadAllFromDatabase();
  }
}
