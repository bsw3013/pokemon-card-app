import React, { useMemo, useState } from 'react';
import { collection, deleteField, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../AuthContext';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import { DEFAULT_SETS, buildSetIndex, findSetForCard, parseCardNo } from '../../utils/catalog';
import { thumbUrlFor } from '../../utils/thumbKey';
import { ownershipDocId } from '../../utils/ownershipUtils';
import { isIdCardKey, resolveLegacyCardKey } from '../../utils/cardKey';
import { setHashParams } from '../../utils/hashRoute';

const BATCH_LIMIT = 400;
const LIST_LIMIT = 300;
// 예전에 공용 카드 정보(pokemon_cards)에 같이 저장하던 개인 보유 정보 칸
const LEGACY_FIELDS = ['status', 'price', 'possessions', 'language', 'isLegacy'];
// 도감번호가 없어도 정상인 종류
const NON_POKEMON_TYPES = ['서포트', '도구', '스타디움', '에너지'];

const text = (v) => String(v ?? '').trim();

function parseLegacyPossessions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

// 예전 칸에 "실제로 의미 있는" 보유 정보가 들어 있는지
function legacyOwnership(data) {
  const status = text(data.status);
  const possessions = parseLegacyPossessions(data.possessions);
  const price = Number(data.price) || 0;
  const meaningful = status === '보유중' || status === '등급카드' || possessions.length > 0 || price > 0;
  if (!meaningful) return null;
  const out = { status: status || '보유중', price, possessions };
  if (text(data.language)) out.language = text(data.language);
  return out;
}

const planSize = (plan) => plan.updates.length + plan.ownershipCopies.length + plan.marketUpdates.length;

function openCard(id) {
  setHashParams({ cardId: id });
}

// 마스터 설정 → 데이터 점검
export default function DataCheck() {
  const { user } = useAuth();
  const { cards, loading, catalog, ownershipCardIds, fetchCards } = useOwnedCards();
  const [openKey, setOpenKey] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [thumbState, setThumbState] = useState({ checking: false, missing: null, done: 0 });

  const setIndex = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const rarityCodes = useMemo(
    () => new Set((catalog?.rarities || []).map((r) => text(r.code))),
    [catalog],
  );

  const checks = useMemo(() => {
    const noSet = [];
    const noSetCode = [];
    const noName = [];
    const noNumber = [];
    const noRarity = [];
    const unknownRarity = [];
    const noType = [];
    const noDex = [];
    const noImage = [];
    const byNumber = new Map();

    cards.forEach((card) => {
      const found = findSetForCard(card, setIndex);
      if (!found) noSet.push(card);
      else if (text(card.setCode) !== found.code) noSetCode.push(card);
      if (!text(card.cardName)) noName.push(card);
      if (!text(card.cardNumber)) noNumber.push(card);
      const rarity = text(card.rarity);
      if (!rarity) noRarity.push(card);
      else if (catalog && !rarityCodes.has(rarity)) unknownRarity.push(card);
      const type = text(card.type);
      if (!type) noType.push(card);
      if (!text(card.pokedexNumber) && !NON_POKEMON_TYPES.includes(type)) noDex.push(card);
      if (!text(card.imageUrl)) noImage.push(card);
      const num = text(card.cardNumber).toUpperCase();
      if (num) byNumber.set(num, [...(byNumber.get(num) || []), card]);
    });

    const duplicates = [...byNumber.values()].filter((group) => group.length > 1).flat()
      .sort((a, b) => text(a.cardNumber).localeCompare(text(b.cardNumber)));

    const setsMissingInfo = (catalog?.sets || []).filter((s) => !text(s.releaseDate) || s.printedTotal === null || s.printedTotal === undefined || s.printedTotal === '');

    return [
      { key: 'noSetCode', label: '세트 코드가 아직 기록되지 않은 카드', hint: '위의 "카드 정보 정리하기"를 실행하면 채워집니다.', cards: noSetCode },
      { key: 'noSet', label: '어느 세트인지 모르는 카드', hint: '시리즈(세트)를 골라 주세요.', cards: noSet },
      { key: 'noName', label: '이름 없음', cards: noName },
      { key: 'noNumber', label: '카드번호 없음', cards: noNumber },
      { key: 'noRarity', label: '레어도 없음', cards: noRarity },
      ...(catalog ? [{ key: 'unknownRarity', label: '레어도 표에 없는 레어도', hint: '세트·레어도 탭에서 추가하거나 카드의 레어도를 고쳐 주세요.', cards: unknownRarity }] : []),
      { key: 'noType', label: '종류 없음', hint: '포켓몬 / 서포트 / 도구 / 스타디움 / 에너지 중 하나를 골라 주세요.', cards: noType },
      { key: 'noDex', label: '도감번호 없음 (포켓몬 카드)', hint: '종류가 비어 있는 카드도 여기에 포함됩니다.', cards: noDex },
      { key: 'noImage', label: '이미지 주소 없음', cards: noImage },
      { key: 'duplicates', label: '같은 카드번호가 2장 이상', hint: '같은 카드가 두 번 들어갔는지 확인해 주세요. (일부러 나눈 카드라면 그대로 두세요)', cards: duplicates },
      ...(catalog ? [{ key: 'setsMissingInfo', label: '발매일·총 장수가 빈 세트', hint: '세트·레어도 탭에서 채워 주세요.', sets: setsMissingInfo }] : []),
    ];
  }, [cards, setIndex, catalog, rarityCodes]);

  // ---------- 1-3. 카드 정보 정리 (미리보기 → 실행) ----------
  const buildPlan = async () => {
    setPlanning(true);
    setStatus('');
    try {
      // 공용 카드 정보를 원본 그대로 다시 읽는다. (화면용 카드 목록에는 예전 칸이 가려져 있음)
      const snap = await getDocs(collection(db, 'pokemon_cards'));
      const updates = [];
      const ownershipCopies = [];
      let setCodeCount = 0;
      let cardNoCount = 0;
      let legacyCount = 0;
      let keepMine = 0;
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        const patch = {};
        const found = findSetForCard(data, setIndex);
        const nextSetCode = found ? found.code : '';
        if (text(data.setCode) !== nextSetCode && (nextSetCode || data.setCode !== undefined)) {
          patch.setCode = nextSetCode;
          setCodeCount += 1;
        }
        const nextCardNo = parseCardNo(data.cardNumber);
        if ((data.cardNo ?? null) !== nextCardNo) {
          patch.cardNo = nextCardNo;
          cardNoCount += 1;
        }
        const legacyPresent = LEGACY_FIELDS.filter((f) => data[f] !== undefined);
        if (legacyPresent.length > 0) {
          legacyPresent.forEach((f) => { patch[f] = deleteField(); });
          legacyCount += 1;
          const legacy = legacyOwnership(data);
          if (legacy) {
            if (ownershipCardIds.has(d.id)) keepMine += 1;
            else ownershipCopies.push({ cardId: d.id, legacy });
          }
        }
        if (Object.keys(patch).length > 0) updates.push({ id: d.id, patch });
      });

      // 1-5. 시세 기록(매물·가격 기록)을 카드 ID로 연결하도록 바꾼다.
      const marketUpdates = [];
      let marketUnresolved = 0;
      for (const col of ['marketListings', 'marketPriceHistory']) {
        const marketSnap = await getDocs(collection(db, col));
        marketSnap.docs.forEach((d) => {
          const key = text(d.data()?.cardKey);
          if (!key || isIdCardKey(key)) return;
          const cardId = resolveLegacyCardKey(key, cards);
          if (cardId) marketUpdates.push({ col, id: d.id, cardKey: `id:${cardId}`, legacyCardKey: key });
          else marketUnresolved += 1;
        });
      }
      setPlan({ total: snap.size, updates, ownershipCopies, setCodeCount, cardNoCount, legacyCount, keepMine, marketUpdates, marketUnresolved });
    } catch (err) {
      console.error(err);
      setStatus('❌ 확인 실패: ' + err.message);
    } finally {
      setPlanning(false);
    }
  };

  const runPlan = async () => {
    if (!plan || !user) return;
    const ok = window.confirm(
      `카드 ${plan.updates.length}장의 정보를 정리하고, 내 보유 정보 ${plan.ownershipCopies.length}건을 옮기고, ` +
      `시세 기록 ${plan.marketUpdates.length}건을 카드 ID로 연결합니다.\n\n` +
      '실행 전에 깃허브 자동 백업(기본 설정·백업 탭의 "깃허브에서 지금 백업 실행하기")을 한 번 해 두면 안전합니다.\n진행할까요?'
    );
    if (!ok) return;
    setRunning(true);
    try {
      const ops = [];
      // 먼저 보유 정보를 내 cardOwnership 으로 옮긴 다음, 공용 카드에서 예전 칸을 지운다.
      plan.ownershipCopies.forEach(({ cardId, legacy }) => {
        ops.push((batch) => batch.set(doc(db, 'cardOwnership', ownershipDocId(cardId, user.uid)), {
          cardId,
          ownerId: user.uid,
          ...legacy,
          migratedFromLegacy: true,
          updatedAt: new Date().toISOString(),
        }));
      });
      plan.updates.forEach(({ id, patch }) => {
        ops.push((batch) => batch.update(doc(db, 'pokemon_cards', id), { ...patch, updatedAt: new Date().toISOString() }));
      });
      plan.marketUpdates.forEach(({ col, id, cardKey, legacyCardKey }) => {
        ops.push((batch) => batch.update(doc(db, col, id), { cardKey, legacyCardKey }));
      });
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
        await batch.commit();
        setStatus(`⏳ 저장 중... (${Math.min(i + BATCH_LIMIT, ops.length)}/${ops.length})`);
      }
      setStatus(`✅ 정리 완료: 카드 ${plan.updates.length}장, 보유 정보 ${plan.ownershipCopies.length}건, 시세 기록 ${plan.marketUpdates.length}건`);
      setPlan(null);
      await fetchCards();
    } catch (err) {
      console.error(err);
      setStatus('❌ 정리 중 오류: ' + err.message + ' (이미 저장된 부분은 그대로 두고 다시 실행하면 이어서 정리됩니다)');
    } finally {
      setRunning(false);
    }
  };

  // ---------- 썸네일 확인 (요청할 때만) ----------
  const checkThumbs = async () => {
    const targets = cards.filter((c) => thumbUrlFor(c.imageUrl));
    setThumbState({ checking: true, missing: null, done: 0 });
    const missing = [];
    let done = 0;
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const card = queue.shift();
        try {
          const res = await fetch(thumbUrlFor(card.imageUrl), { method: 'HEAD' });
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !type.startsWith('image/')) missing.push(card);
        } catch {
          missing.push(card);
        }
        done += 1;
        if (done % 50 === 0) setThumbState((prev) => ({ ...prev, done }));
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    setThumbState({ checking: false, missing, done });
  };

  if (loading) {
    return <div className="admin-section full-width"><h3>데이터 점검</h3><p className="help-text">카드를 불러오는 중...</p></div>;
  }

  const thumbRow = { key: 'thumbs', label: '목록용 썸네일이 없는 카드', hint: '내 컴퓨터에서 npm run thumbs 를 실행하면 만들어집니다.', cards: thumbState.missing || [] };

  const renderCardList = (list) => (
    <ul className="check-card-list">
      {list.slice(0, LIST_LIMIT).map((card) => (
        <li key={card.id}>
          <button type="button" className="check-card-link" onClick={() => openCard(card.id)}>
            <span className="check-card-name">{text(card.cardName) || '(이름 없음)'}</span>
            <span className="check-card-meta">{text(card.cardNumber) || '번호 없음'} · {text(card.series) || '시리즈 없음'} · {text(card.rarity) || '레어도 없음'}</span>
          </button>
        </li>
      ))}
      {list.length > LIST_LIMIT && <li className="help-text">…외 {list.length - LIST_LIMIT}장 (먼저 위의 카드들을 고쳐 주세요)</li>}
    </ul>
  );

  return (
    <div className="data-check">
      <div className="admin-section full-width">
        <h3>카드 정보 정리하기</h3>
        <p className="help-text">
          모든 카드에 <b>세트 코드</b>와 <b>정렬용 번호</b>를 기록하고, 공용 카드 정보에 남아 있던 <b>예전 보유 정보</b>(보유중/가격 등)를 지웁니다.
          예전 보유 정보 중 내 보유 정보에 아직 없는 것은 지우기 전에 내 보유 정보로 옮깁니다.
          시세 기록(매물·가격 기록)은 이름 대신 <b>카드 ID</b>로 연결되도록 바꿉니다.
          먼저 "정리할 내용 확인"으로 무엇이 바뀌는지 보고 실행하세요.
        </p>
        <div className="check-actions">
          <button type="button" className="btn btn-secondary" disabled={planning || running} onClick={buildPlan}>
            {planning ? '확인 중...' : '정리할 내용 확인'}
          </button>
          {plan && (
            <button type="button" className="btn btn-primary" disabled={running || planSize(plan) === 0} onClick={runPlan}>
              {running ? '정리 중...' : '이대로 실행'}
            </button>
          )}
        </div>
        {plan && (
          <ul className="check-plan">
            <li>전체 카드 <b>{plan.total}</b>장 중 바뀌는 카드 <b>{plan.updates.length}</b>장</li>
            <li>세트 코드 기록 <b>{plan.setCodeCount}</b>장 · 정렬용 번호 기록 <b>{plan.cardNoCount}</b>장</li>
            <li>예전 보유 정보 지우기 <b>{plan.legacyCount}</b>장</li>
            <li>그중 내 보유 정보로 옮길 것 <b>{plan.ownershipCopies.length}</b>건 (이미 내 보유 정보가 있어서 그대로 두는 것 {plan.keepMine}건)</li>
            <li>시세 기록을 카드 ID로 연결 <b>{plan.marketUpdates.length}</b>건{plan.marketUnresolved > 0 ? ` (어느 카드인지 몰라 그대로 두는 것 ${plan.marketUnresolved}건 — 도감에 없는 카드를 직접 입력한 기록)` : ''}</li>
            {planSize(plan) === 0 && <li>이미 모두 정리되어 있습니다.</li>}
          </ul>
        )}
        {status && <p className="catalog-message">{status}</p>}
      </div>

      <div className="admin-section full-width">
        <h3>데이터 점검</h3>
        <p className="help-text">항목을 누르면 해당 카드 목록이 펼쳐지고, 카드를 누르면 바로 열어서 고칠 수 있습니다. 여러 장을 한꺼번에 고치려면 카드 관리 탭을 쓰세요.</p>
        <ul className="check-list">
          {checks.map((check) => {
            const count = check.cards ? check.cards.length : check.sets.length;
            const isOpen = openKey === check.key;
            return (
              <li key={check.key} className={`check-row ${count === 0 ? 'ok' : 'warn'}`}>
                <button type="button" className="check-row-head" disabled={count === 0} onClick={() => setOpenKey(isOpen ? null : check.key)} aria-expanded={isOpen}>
                  <span className="check-count">{count === 0 ? '✓' : count}</span>
                  <span className="check-label">{check.label}</span>
                </button>
                {isOpen && (
                  <div className="check-detail">
                    {check.hint && <p className="help-text">{check.hint}</p>}
                    {check.cards && renderCardList(check.cards)}
                    {check.sets && (
                      <ul className="check-card-list">
                        {check.sets.map((s) => (
                          <li key={s.code}><span className="check-card-name">{s.code}</span> <span className="check-card-meta">{s.name} · 발매일 {s.releaseDate || '없음'} · 총 장수 {s.printedTotal ?? '없음'}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          <li className={`check-row ${thumbState.missing === null ? '' : thumbState.missing.length === 0 ? 'ok' : 'warn'}`}>
            {thumbState.missing === null ? (
              <div className="check-row-head static">
                <span className="check-count">?</span>
                <span className="check-label">목록용 썸네일이 없는 카드</span>
                <button type="button" className="btn btn-secondary btn-compact" disabled={thumbState.checking} onClick={checkThumbs}>
                  {thumbState.checking ? `확인 중... (${thumbState.done})` : '확인하기'}
                </button>
              </div>
            ) : (
              <>
                <button type="button" className="check-row-head" disabled={thumbRow.cards.length === 0} onClick={() => setOpenKey(openKey === 'thumbs' ? null : 'thumbs')}>
                  <span className="check-count">{thumbRow.cards.length === 0 ? '✓' : thumbRow.cards.length}</span>
                  <span className="check-label">{thumbRow.label}</span>
                </button>
                {openKey === 'thumbs' && (
                  <div className="check-detail">
                    <p className="help-text">{thumbRow.hint}</p>
                    {renderCardList(thumbRow.cards)}
                  </div>
                )}
              </>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}
