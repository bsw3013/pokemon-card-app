import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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

function hasText(v) {
  return String(v || '').trim().length > 0;
}

function normalize(v) {
  return String(v || '').trim().toLowerCase();
}

function comboKey(series, cardNumber) {
  const s = normalize(series);
  const n = normalize(cardNumber).replace(/\s+/g, '').replace(/_/g, '-');
  if (!s || !n) return '';
  return `${s}::${n}`;
}

function pickBetter(prev, next) {
  if (!prev) return next;
  const prevScore = (hasText(prev.cardName) ? 1 : 0) + (hasText(prev.pokedexNumber) ? 1 : 0);
  const nextScore = (hasText(next.cardName) ? 1 : 0) + (hasText(next.pokedexNumber) ? 1 : 0);
  if (nextScore > prevScore) return next;
  return prev;
}

async function run() {
  const csvPath = path.resolve('database_backups', 'main_dataset.csv');
  const csvRows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });

  const sourceMap = new Map();
  for (const row of csvRows) {
    const key = comboKey(row.series, row.cardNumber);
    if (!key) continue;
    const candidate = {
      cardName: hasText(row.cardName) ? String(row.cardName).trim() : '',
      pokedexNumber: hasText(row.pokedexNumber) ? String(row.pokedexNumber).trim() : '',
    };
    if (!hasText(candidate.cardName) && !hasText(candidate.pokedexNumber)) continue;
    sourceMap.set(key, pickBetter(sourceMap.get(key), candidate));
  }

  const snap = await getDocs(collection(db, 'pokemon_cards'));

  let docsNeedEither = 0;
  let docsNeedName = 0;
  let docsNeedDex = 0;
  let docsNeedBoth = 0;
  let fillableName = 0;
  let fillableDex = 0;
  let fillableEither = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const needsName = !hasText(data.cardName);
    const needsDex = !hasText(data.pokedexNumber);
    if (!needsName && !needsDex) continue;

    docsNeedEither += 1;
    if (needsName) docsNeedName += 1;
    if (needsDex) docsNeedDex += 1;
    if (needsName && needsDex) docsNeedBoth += 1;

    const key = comboKey(data.series, data.cardNumber);
    const src = key ? sourceMap.get(key) : null;
    const canName = needsName && hasText(src?.cardName);
    const canDex = needsDex && hasText(src?.pokedexNumber);

    if (canName) fillableName += 1;
    if (canDex) fillableDex += 1;
    if (canName || canDex) fillableEither += 1;
  }

  console.log('docsNeedEither', docsNeedEither);
  console.log('docsNeedName', docsNeedName);
  console.log('docsNeedDex', docsNeedDex);
  console.log('docsNeedBoth', docsNeedBoth);
  console.log('fillableName', fillableName);
  console.log('fillableDex', fillableDex);
  console.log('fillableEither', fillableEither);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
