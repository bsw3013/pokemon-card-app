import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc } from 'firebase/firestore';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const BATCH_SIZE = 200;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function comboKey(series, cardNumber) {
  const s = normalize(series);
  const n = normalize(cardNumber);
  if (!s || !n) return '';
  return `${s}::${n}`;
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function pickBetter(prev, next) {
  if (!prev) return next;

  // Prefer candidate that has both fields.
  const prevScore = (hasText(prev.cardName) ? 1 : 0) + (hasText(prev.pokedexNumber) ? 1 : 0);
  const nextScore = (hasText(next.cardName) ? 1 : 0) + (hasText(next.pokedexNumber) ? 1 : 0);
  if (nextScore > prevScore) return next;
  if (nextScore < prevScore) return prev;

  // If tie, prefer longer cardName (usually less placeholder-like).
  const prevNameLen = String(prev.cardName || '').trim().length;
  const nextNameLen = String(next.cardName || '').trim().length;
  if (nextNameLen > prevNameLen) return next;
  return prev;
}

async function run() {
  console.log('🔎 시리즈+카드번호 기준 cardName/pokedexNumber 백필 시작...');

  const snap = await getDocs(collection(db, 'pokemon_cards'));
  const docs = snap.docs;

  const sourceMap = new Map();
  const nameConflictKeys = new Set();
  const dexConflictKeys = new Set();

  // Build source map from all usable rows.
  for (const d of docs) {
    const data = d.data();
    const key = comboKey(data.series, data.cardNumber);
    if (!key) continue;

    const candidate = {
      cardName: hasText(data.cardName) ? String(data.cardName).trim() : '',
      pokedexNumber: hasText(data.pokedexNumber) ? String(data.pokedexNumber).trim() : '',
    };

    if (!hasText(candidate.cardName) && !hasText(candidate.pokedexNumber)) continue;

    const prev = sourceMap.get(key);
    if (!prev) {
      sourceMap.set(key, candidate);
      continue;
    }

    if (
      hasText(prev.cardName) &&
      hasText(candidate.cardName) &&
      normalize(prev.cardName) !== normalize(candidate.cardName)
    ) {
      nameConflictKeys.add(key);
    }
    if (
      hasText(prev.pokedexNumber) &&
      hasText(candidate.pokedexNumber) &&
      normalize(prev.pokedexNumber) !== normalize(candidate.pokedexNumber)
    ) {
      dexConflictKeys.add(key);
    }

    sourceMap.set(key, pickBetter(prev, candidate));
  }

  let touched = 0;
  let filledName = 0;
  let filledDex = 0;
  let skippedNoSource = 0;
  let skippedConflict = 0;

  let pending = [];

  for (const d of docs) {
    const data = d.data();
    const key = comboKey(data.series, data.cardNumber);
    if (!key) continue;

    const needsName = !hasText(data.cardName);
    const needsDex = !hasText(data.pokedexNumber);
    if (!needsName && !needsDex) continue;

    if (nameConflictKeys.has(key) || dexConflictKeys.has(key)) {
      skippedConflict += 1;
      continue;
    }

    const source = sourceMap.get(key);
    if (!source) {
      skippedNoSource += 1;
      continue;
    }

    const patch = {};

    if (needsName && hasText(source.cardName)) {
      patch.cardName = source.cardName;
      filledName += 1;
    }

    // User requested: skip if pokedexNumber cannot be found.
    if (needsDex && hasText(source.pokedexNumber)) {
      patch.pokedexNumber = source.pokedexNumber;
      filledDex += 1;
    }

    if (!Object.keys(patch).length) {
      skippedNoSource += 1;
      continue;
    }

    pending.push(updateDoc(d.ref, patch));
    touched += 1;

    if (pending.length >= BATCH_SIZE) {
      await Promise.all(pending);
      pending = [];
    }
  }

  if (pending.length) {
    await Promise.all(pending);
  }

  console.log('✅ 백필 완료');
  console.log(`- 수정 문서 수: ${touched}`);
  console.log(`- cardName 채움: ${filledName}`);
  console.log(`- pokedexNumber 채움: ${filledDex}`);
  console.log(`- 소스 없음/값 없음 스킵: ${skippedNoSource}`);
  console.log(`- 충돌 스킵: ${skippedConflict}`);

  process.exit(0);
}

run().catch((err) => {
  console.error('❌ 백필 실패', err);
  process.exit(1);
});
