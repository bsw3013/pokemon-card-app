// 데이터 분리(공용 카드 도감 vs 개인 보유현황) 이전에 쌓인 기존 데이터를
// 최초 관리자 계정 소유로 한 번 이관하기 위한 마이그레이션 스크립트.
//
// 무엇을 하는가:
//   1. pokemon_cards 문서마다 남아있는 status/price/possessions/language 필드를
//      cardOwnership/{cardId}_{adminUid} 문서로 복사한다. (ownerId = adminUid)
//   2. album_plans, marketWatchlist 문서 중 ownerId 필드가 없는 것들을
//      adminUid 소유로 채워준다.
//   3. --cleanup 옵션을 주면, 복사가 끝난 pokemon_cards 문서에서
//      status/price/possessions/language 필드를 제거해 마스터 정보를 완전히 정리한다.
//
// 사용법:
//   1) Firebase 콘솔 > 프로젝트 설정 > 서비스 계정에서 비공개 키(JSON)를 생성해
//      이 저장소 루트에 serviceAccountKey.json 으로 저장한다. (이미 .gitignore에 포함되어
//      실수로 커밋되지 않는다. 절대 저장소에 올리지 말 것.)
//   2) 관리자로 지정할 계정으로 앱에 한 번 이상 구글 로그인을 해서 Firebase Authentication에
//      사용자 레코드가 생기도록 한다.
//   3) 먼저 dry-run(기본값, 아무것도 쓰지 않고 무엇이 바뀔지만 출력)으로 확인:
//        node scripts/migrate-ownership.mjs --admin-email=you@example.com
//   4) 확인 후 실제로 반영:
//        node scripts/migrate-ownership.mjs --admin-email=you@example.com --execute
//   5) pokemon_cards 마스터 문서에서 이관된 개인 필드까지 지우려면(되돌리기 어려우니 신중히):
//        node scripts/migrate-ownership.mjs --admin-email=you@example.com --execute --cleanup
//
// admin-uid를 이미 알고 있다면 --admin-email 대신 --admin-uid=<uid> 를 사용해도 된다.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const OWNERSHIP_FIELDS = ['status', 'language', 'price', 'possessions'];
const BATCH_LIMIT = 400;

function parseArgs(argv) {
  const args = { execute: false, cleanup: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--execute') args.execute = true;
    else if (raw === '--cleanup') args.cleanup = true;
    else if (raw.startsWith('--admin-email=')) args.adminEmail = raw.slice('--admin-email='.length);
    else if (raw.startsWith('--admin-uid=')) args.adminUid = raw.slice('--admin-uid='.length);
  }
  return args;
}

function loadServiceAccount() {
  const explicitPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const candidatePaths = [
    explicitPath,
    path.join(REPO_ROOT, 'serviceAccountKey.json'),
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf-8'));
    }
  }

  throw new Error(
    '서비스 계정 키를 찾을 수 없습니다. 저장소 루트에 serviceAccountKey.json을 두거나 ' +
    'GOOGLE_APPLICATION_CREDENTIALS 환경변수로 경로를 지정해주세요.'
  );
}

async function resolveAdminUid(auth, args) {
  if (args.adminUid) return args.adminUid;
  if (!args.adminEmail) {
    throw new Error('--admin-email=<이메일> 또는 --admin-uid=<uid> 중 하나는 반드시 지정해야 합니다.');
  }
  const user = await auth.getUserByEmail(args.adminEmail);
  return user.uid;
}

async function commitInChunks(db, writes, { execute }) {
  let batch = db.batch();
  let ops = 0;
  let committed = 0;

  for (const write of writes) {
    if (execute) {
      write(batch);
    }
    ops += 1;
    committed += 1;
    if (execute && ops >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (execute && ops > 0) {
    await batch.commit();
  }
  return committed;
}

async function migrateCardOwnership(db, adminUid, { execute, cleanup }) {
  const snapshot = await db.collection('pokemon_cards').get();
  const writes = [];
  let skipped = 0;

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const hasLegacyOwnershipData = OWNERSHIP_FIELDS.some((field) => data[field] !== undefined);
    if (!hasLegacyOwnershipData) {
      skipped += 1;
      return;
    }

    const ownershipId = `${docSnap.id}_${adminUid}`;
    const ownershipPayload = { cardId: docSnap.id, ownerId: adminUid, updatedAt: new Date().toISOString() };
    OWNERSHIP_FIELDS.forEach((field) => {
      if (data[field] !== undefined) ownershipPayload[field] = data[field];
    });

    writes.push((batch) => {
      batch.set(db.collection('cardOwnership').doc(ownershipId), ownershipPayload, { merge: true });
      if (cleanup) {
        const clearPayload = {};
        OWNERSHIP_FIELDS.forEach((field) => {
          if (data[field] !== undefined) clearPayload[field] = FieldValue.delete();
        });
        batch.update(docSnap.ref, clearPayload);
      }
    });
  });

  console.log(`[cardOwnership] 이관 대상 ${writes.length}건, 건드릴 필요 없는 문서 ${skipped}건`);
  const committed = await commitInChunks(db, writes, { execute });
  console.log(`[cardOwnership] ${execute ? '반영 완료' : '(dry-run) 반영 예정'}: ${committed}건`);
}

async function migrateOwnedCollection(db, collectionName, adminUid, { execute }) {
  const snapshot = await db.collection(collectionName).get();
  const writes = [];
  let alreadyOwned = 0;

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (data.ownerId) {
      alreadyOwned += 1;
      return;
    }
    writes.push((batch) => {
      batch.update(docSnap.ref, { ownerId: adminUid });
    });
  });

  console.log(`[${collectionName}] 이관 대상 ${writes.length}건, 이미 ownerId 있는 문서 ${alreadyOwned}건`);
  const committed = await commitInChunks(db, writes, { execute });
  console.log(`[${collectionName}] ${execute ? '반영 완료' : '(dry-run) 반영 예정'}: ${committed}건`);
}

async function main() {
  const args = parseArgs(process.argv);
  const serviceAccount = loadServiceAccount();

  initializeApp({ credential: cert(serviceAccount) });
  const auth = getAuth();
  const db = getFirestore();

  const adminUid = await resolveAdminUid(auth, args);
  console.log(`관리자 UID: ${adminUid}`);
  console.log(args.execute ? '⚠️  실제 반영 모드(--execute)입니다.' : 'ℹ️  dry-run 모드입니다. 아무것도 쓰지 않습니다. (--execute를 주면 실제로 반영됩니다)');
  if (args.cleanup && !args.execute) {
    console.log('ℹ️  --cleanup은 --execute와 함께 줘야 의미가 있습니다.');
  }

  await migrateCardOwnership(db, adminUid, args);
  await migrateOwnedCollection(db, 'album_plans', adminUid, args);
  await migrateOwnedCollection(db, 'marketWatchlist', adminUid, args);

  console.log('완료되었습니다.');
  process.exit(0);
}

main().catch((err) => {
  console.error('마이그레이션 중 오류가 발생했습니다:', err);
  process.exit(1);
});
