import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc } from 'firebase/firestore';
import { parse } from 'csv-parse/sync';
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
const CSV_PATH = path.resolve('database_backups', 'main_dataset.csv');

function hasText(v) {
  return String(v || '').trim().length > 0;
}

function normalize(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeSeries(v) {
  return normalize(v).replace(/\s+/g, ' ');
}

function normalizeCardNumber(v) {
  return normalize(v).replace(/\s+/g, '').replace(/_/g, '-');
}

function comboKey(series, cardNumber) {
  const s = normalizeSeries(series);
  const n = normalizeCardNumber(cardNumber);
  if (!s || !n) return '';
  return `${s}::${n}`;
}

function buildSourceMapFromCsv(rows) {
  const sourceMap = new Map();

  for (const row of rows) {
    const key = comboKey(row.series, row.cardNumber);
    if (!key) continue;

    const candidate = {
      cardName: hasText(row.cardName) ? String(row.cardName).trim() : '',
      pokedexNumber: hasText(row.pokedexNumber) ? String(row.pokedexNumber).trim() : '',
    };

    if (!hasText(candidate.cardName) && !hasText(candidate.pokedexNumber)) continue;

    const prev = sourceMap.get(key);
    if (!prev) {
      sourceMap.set(key, candidate);
      continue;
    }

    // Prefer candidate with more non-empty fields.
    const prevScore = (hasText(prev.cardName) ? 1 : 0) + (hasText(prev.pokedexNumber) ? 1 : 0);
    const nextScore = (hasText(candidate.cardName) ? 1 : 0) + (hasText(candidate.pokedexNumber) ? 1 : 0);
    if (nextScore > prevScore) {
      sourceMap.set(key, candidate);
    }
  }

  return { sourceMap };
}

async function run() {
  console.log('🔎 CSV 기반 cardName/pokedexNumber 백필 시작...');

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${CSV_PATH}`);
  }

  const csvRaw = fs.readFileSync(CSV_PATH, 'utf8');
  const csvRows = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  const { sourceMap } = buildSourceMapFromCsv(csvRows);
  console.log(`- CSV 소스 키 수: ${sourceMap.size}`);

  const snap = await getDocs(collection(db, 'pokemon_cards'));
  const docs = snap.docs;

  let touched = 0;
  let filledName = 0;
  let filledDex = 0;
  let skippedNoSource = 0;

  let pending = [];

  for (const d of docs) {
    const data = d.data();
    const needsName = !hasText(data.cardName);
    const needsDex = !hasText(data.pokedexNumber);
    if (!needsName && !needsDex) continue;

    const key = comboKey(data.series, data.cardNumber);
    if (!key) {
      skippedNoSource += 1;
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

    // 요청사항: 전국도감번호를 못 찾으면 그냥 스킵
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

  console.log('✅ CSV 백필 완료');
  console.log(`- 수정 문서 수: ${touched}`);
  console.log(`- cardName 채움: ${filledName}`);
  console.log(`- pokedexNumber 채움: ${filledDex}`);
  console.log(`- 소스 없음/값 없음 스킵: ${skippedNoSource}`);
}

run().catch((err) => {
  console.error('❌ CSV 백필 실패', err);
  process.exit(1);
});
