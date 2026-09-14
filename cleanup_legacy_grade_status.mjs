import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, setDoc } from 'firebase/firestore';
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

const LEGACY_GRADE_STATUS_REGEX = /^[A-Za-z가-힣]\s*급/;
const CLEAN_STATUS_OPTIONS = ['미보유', '보유중', '등급카드', '손상됨', '상태 없음'];

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function normalizeStatus(status) {
  const s = String(status || '').trim();
  if (!s) return '상태 없음';
  if (LEGACY_GRADE_STATUS_REGEX.test(s)) return '보유중';
  return s;
}

async function run() {
  console.log('🧹 레거시 상태(S급/A급 등) 정리 시작');

  // 1) settings/appConfig의 statusOptions 정리
  const settingsRef = doc(db, 'settings', 'appConfig');
  const settingsSnap = await getDoc(settingsRef);
  if (settingsSnap.exists()) {
    const data = settingsSnap.data() || {};
    const rawOptions = Array.isArray(data.statusOptions) ? data.statusOptions : [];
    const cleaned = Array.from(new Set([
      ...rawOptions.filter((item) => hasText(item) && !LEGACY_GRADE_STATUS_REGEX.test(String(item).trim())),
      ...CLEAN_STATUS_OPTIONS,
    ].map((item) => String(item).trim()).filter(Boolean)));

    await updateDoc(settingsRef, { statusOptions: cleaned });
    console.log(`- settings/appConfig statusOptions 정리 완료 (${cleaned.length}개)`);
  } else {
    await setDoc(settingsRef, { statusOptions: CLEAN_STATUS_OPTIONS }, { merge: true });
    console.log('- settings/appConfig 없음: 기본 statusOptions 생성');
  }

  // 2) pokemon_cards status 값 정리
  const snap = await getDocs(collection(db, 'pokemon_cards'));
  let updated = 0;
  const tasks = [];
  for (const d of snap.docs) {
    const data = d.data();
    const current = String(data.status || '').trim();
    const next = normalizeStatus(current);
    if (current !== next) {
      tasks.push(updateDoc(d.ref, { status: next }));
      updated += 1;
      if (tasks.length >= 200) {
        await Promise.all(tasks.splice(0, tasks.length));
      }
    }
  }

  if (tasks.length) {
    await Promise.all(tasks);
  }

  console.log(`- 카드 status 정리 완료: ${updated}건 업데이트`);
  console.log('✅ 정리 완료');
}

run().catch((err) => {
  console.error('❌ 정리 실패', err);
  process.exit(1);
});
