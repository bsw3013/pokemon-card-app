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

async function run() {
  const csvPath = path.resolve('database_backups', 'main_dataset.csv');
  const csvRows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });

  const csvKeySet = new Set();
  const csvIdSet = new Set();
  for (const row of csvRows) {
    const key = comboKey(row.series, row.cardNumber);
    if (key) csvKeySet.add(key);
    if (hasText(row.raw_database_id)) csvIdSet.add(String(row.raw_database_id).trim());
  }

  const snap = await getDocs(collection(db, 'pokemon_cards'));

  let needFill = 0;
  let hasSeriesNumber = 0;
  let keyMatch = 0;
  let idMatch = 0;
  let missingSeriesOrNumber = 0;
  const samples = [];

  for (const d of snap.docs) {
    const data = d.data();
    const needsName = !hasText(data.cardName);
    const needsDex = !hasText(data.pokedexNumber);
    if (!needsName && !needsDex) continue;

    needFill += 1;

    const key = comboKey(data.series, data.cardNumber);
    if (!key) {
      missingSeriesOrNumber += 1;
      if (samples.length < 12) {
        samples.push({ id: d.id, series: data.series || '', cardNumber: data.cardNumber || '', cardName: data.cardName || '', pokedexNumber: data.pokedexNumber || '' });
      }
      continue;
    }

    hasSeriesNumber += 1;
    if (csvKeySet.has(key)) keyMatch += 1;
    if (csvIdSet.has(d.id)) idMatch += 1;

    if (samples.length < 12) {
      samples.push({ id: d.id, series: data.series || '', cardNumber: data.cardNumber || '', cardName: data.cardName || '', pokedexNumber: data.pokedexNumber || '' });
    }
  }

  console.log('needFill', needFill);
  console.log('hasSeriesNumber', hasSeriesNumber);
  console.log('keyMatch', keyMatch);
  console.log('idMatch', idMatch);
  console.log('missingSeriesOrNumber', missingSeriesOrNumber);
  console.log('samples', JSON.stringify(samples, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
