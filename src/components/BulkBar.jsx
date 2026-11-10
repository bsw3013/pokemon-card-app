import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { DEFAULT_RARITIES, DEFAULT_SETS, setLabel, sortRarities, sortSets } from '../utils/catalog';
import { ownedCount, parsePossessions } from '../utils/cardStats';
import { POSSESSION_LANGS, newPossessionRow } from '../utils/possessionRow';
import { addWatchMany, removeWatchMany, restoreWatchMany } from '../hooks/useWatchlist';
import { buildCardKey } from '../utils/cardKey';

const DEFAULT_TYPES = ['포켓몬', '서포트', '아이템', '포켓몬의 도구', '스타디움', '에너지'];
const FIELD_LABEL = { series: '세트', rarity: '레어도', type: '종류' };
const UNDO_MS = 15000;

// 여러 장 선택 모드의 아래쪽 작업 막대
// selection: useBulkSelect() 결과, visibleIds: 지금 화면에 걸러진 카드 id (모두 선택용)
export default function BulkBar({ selection, visibleIds = [], appConfig }) {
  const { user, isAdmin } = useAuth();
  const { cards, catalog, saveOwnershipMany, saveMasterMany } = useOwnedCards();
  const [dialog, setDialog] = useState(null); // 'own' | 'master'
  const [ownForm, setOwnForm] = useState({ count: 1, language: '한국' });
  const [masterForm, setMasterForm] = useState({ field: 'rarity', value: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // { text, undo }

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const picked = useMemo(() => [...selection.selected].map((id) => byId.get(id)).filter(Boolean), [selection.selected, byId]);
  const n = picked.length;

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const masterOptions = useMemo(() => {
    if (masterForm.field === 'series') return sortSets(catalog?.sets || DEFAULT_SETS).reverse().map(setLabel);
    if (masterForm.field === 'rarity') return sortRarities(catalog?.rarities || DEFAULT_RARITIES).map((r) => r.code);
    return appConfig?.typeOptions?.length ? appConfig.typeOptions : DEFAULT_TYPES;
  }, [masterForm.field, catalog, appConfig]);

  if (!selection.active) return null;

  // 실행 → 결과 알림 + 되돌리기
  async function run(task) {
    setBusy(true);
    try {
      const result = await task();
      if (result) setToast(result);
      selection.clear();
      setDialog(null);
    } catch (err) {
      console.error('여러 장 바꾸기 실패', err);
      alert(`저장하지 못했어요: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }
  const undoable = (text, undo) => ({ text, undo });
  const ownBefore = (c) => ({ cardId: c.id, fields: { status: c.status || '미보유', possessions: parsePossessions(c.possessions), language: c.language || '한국' } });

  // 보유로 표시: 안 가진 카드에만 보유 기록 한 줄 추가 (이미 가진 카드는 그대로)
  const targetsOwn = picked.filter((c) => ownedCount(c) === 0);
  const markOwned = () => run(async () => {
    const count = Math.max(1, Math.min(99, Number(ownForm.count) || 1));
    const before = targetsOwn.map(ownBefore);
    await saveOwnershipMany(targetsOwn.map((c) => ({
      cardId: c.id,
      fields: {
        possessions: [...parsePossessions(c.possessions), newPossessionRow(ownForm.language, '', count)],
        status: '보유중',
        language: ownForm.language,
      },
    })));
    return undoable(`${targetsOwn.length}장을 보유로 표시했어요 (${ownForm.language} · ${count}장씩)`, () => saveOwnershipMany(before));
  });

  // 미보유로 표시: 갖고 있는 기록만 지우고 판매완료 기록은 남김
  const targetsMissing = picked.filter((c) => ownedCount(c) > 0);
  const markMissing = () => {
    if (!targetsMissing.length) return;
    if (!window.confirm(`${targetsMissing.length}장을 미보유로 바꿉니다.\n\n갖고 있는 보유 기록(구매가·날짜 등)이 지워져요. 판매완료 기록은 남아요.\n바로 뒤에 [되돌리기]로 되돌릴 수 있어요. 진행할까요?`)) return;
    run(async () => {
      const before = targetsMissing.map(ownBefore);
      await saveOwnershipMany(targetsMissing.map((c) => ({
        cardId: c.id,
        fields: { possessions: parsePossessions(c.possessions).filter((p) => p?.sold), status: '미보유' },
      })));
      return undoable(`${targetsMissing.length}장을 미보유로 바꿨어요`, () => saveOwnershipMany(before));
    });
  };

  const watchAdd = () => run(async () => {
    const added = await addWatchMany(user.uid, picked);
    return undoable(`관심 카드에 ${added.length}장 추가했어요${added.length < n ? ` (이미 있던 ${n - added.length}장 제외)` : ''}`, () => removeWatchMany(user.uid, added));
  });
  const watchRemove = () => run(async () => {
    const removed = await removeWatchMany(user.uid, picked.map(buildCardKey));
    return undoable(`관심 카드에서 ${removed.length}장 뺐어요`, () => restoreWatchMany(user.uid, removed));
  });

  // 카드 정보 바꾸기 (관리자)
  const applyMaster = () => run(async () => {
    const { field, value } = masterForm;
    const before = picked.map((c) => ({ id: c.id, patch: { [field]: c[field] ?? '' } }));
    await saveMasterMany(picked.map((c) => ({ id: c.id, patch: { [field]: value } })));
    return undoable(`${picked.length}장의 ${FIELD_LABEL[field]}를 "${value}"(으)로 바꿨어요`, () => saveMasterMany(before));
  });

  const doUndo = async () => {
    const t = toast;
    setToast(null);
    setBusy(true);
    try {
      await t.undo();
      setToast({ text: '되돌렸어요' });
    } catch (err) {
      console.error('되돌리기 실패', err);
      alert(`되돌리지 못했어요: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.selected.has(id));

  return (
    <>
      {dialog && (
        <div className="bulk-dialog-wrap" onClick={() => setDialog(null)}>
          <div className="bulk-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDialog(null); } }}>
            {dialog === 'own' ? (
              <>
                <h3>보유로 표시</h3>
                <p className="sub">
                  선택한 {n}장 중 <b>안 가진 {targetsOwn.length}장</b>에 보유 기록을 넣어요.
                  {n - targetsOwn.length > 0 && ` 이미 가진 ${n - targetsOwn.length}장은 그대로 둬요.`}
                </p>
                <div className="bulk-form">
                  <label>장수<input type="number" min="1" max="99" className="input" value={ownForm.count} onChange={(e) => setOwnForm((f) => ({ ...f, count: e.target.value }))} /></label>
                  <label>언어
                    <select className="select" value={ownForm.language} onChange={(e) => setOwnForm((f) => ({ ...f, language: e.target.value }))}>
                      {POSSESSION_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                </div>
                <p className="hint">Raw(등급 안 받은 카드)로 들어가요. 구매가·날짜는 카드마다 나중에 적을 수 있어요.</p>
                <div className="bulk-dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>취소</button>
                  <button type="button" className="btn btn-primary" disabled={busy || targetsOwn.length === 0} onClick={markOwned}>{busy ? '저장 중...' : `${targetsOwn.length}장 보유로 표시`}</button>
                </div>
              </>
            ) : (
              <>
                <h3>카드 정보 바꾸기</h3>
                <p className="sub">선택한 {n}장의 정보를 한꺼번에 바꿔요. (모든 사람에게 보이는 카드 정보)</p>
                <div className="bulk-form">
                  <label>바꿀 칸
                    <select className="select" value={masterForm.field} onChange={(e) => setMasterForm({ field: e.target.value, value: '' })}>
                      {Object.entries(FIELD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label>바꿀 값
                    <select className="select" value={masterForm.value} onChange={(e) => setMasterForm((f) => ({ ...f, value: e.target.value }))}>
                      <option value="">선택</option>
                      {masterOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                </div>
                <div className="bulk-dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>취소</button>
                  <button type="button" className="btn btn-primary" disabled={busy || !masterForm.value || n === 0} onClick={applyMaster}>{busy ? '저장 중...' : `${n}장 바꾸기`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="bulk-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="link-btn" disabled={busy} onClick={doUndo}>되돌리기</button>}
          <button type="button" className="bulk-toast-x" onClick={() => setToast(null)} aria-label="닫기">✕</button>
        </div>
      )}

      <div className="bulk-bar" role="toolbar" aria-label="여러 장 선택 작업">
        <div className="bulk-sel">
          <b>{n}장 선택됨</b>
          <button type="button" className="link-btn" onClick={() => (allSelected ? selection.clear() : selection.selectAll(visibleIds))}>
            {allSelected ? '선택 해제' : `보이는 카드 모두 선택 (${visibleIds.length.toLocaleString()})`}
          </button>
          {n > 0 && !allSelected && <button type="button" className="link-btn" onClick={selection.clear}>선택 해제</button>}
        </div>
        <div className="bulk-actions">
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy || n === 0} onClick={() => setDialog('own')}>보유로 표시</button>
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy || targetsMissing.length === 0} onClick={markMissing}>미보유로 표시</button>
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy || n === 0} onClick={watchAdd}>☆ 관심 카드 추가</button>
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy || n === 0} onClick={watchRemove}>관심 카드 해제</button>
          {isAdmin && <button type="button" className="btn btn-secondary btn-compact" disabled={busy || n === 0} onClick={() => setDialog('master')}>카드 정보 바꾸기</button>}
          <button type="button" className="btn btn-primary btn-compact" onClick={selection.stop}>완료</button>
        </div>
      </div>
    </>
  );
}
