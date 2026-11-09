import React, { useMemo, useState } from 'react';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import {
  ERA_OPTIONS,
  KIND_OPTIONS,
  RARITY_GROUPS,
  buildInitialCatalog,
  buildSetIndex,
  findSetForCard,
  setLabel,
  sortRarities,
  sortSets,
} from '../../utils/catalog';

const emptySet = { code: '', name: '', era: '스칼렛&바이올렛', kind: '확장팩', releaseDate: '', printedTotal: '' };

// 마스터 설정 → 세트·레어도 관리
// 세트(확장팩) 표와 레어도 표를 settings/catalog 문서에 저장한다.
export default function CatalogSettings({ appConfig, initialMessage = '', onSaved }) {
  const { cards, catalog, catalogLoaded, saveCatalog } = useOwnedCards();
  // 표를 저장하면 부모가 key 를 바꿔 이 화면을 새로 그리므로, 처음 값만 표에서 가져오면 된다.
  const [sets, setSets] = useState(() => (catalog ? sortSets(catalog.sets).map((s) => ({ ...s })) : []));
  const [rarities, setRarities] = useState(() => (catalog ? sortRarities(catalog.rarities).map((r) => ({ ...r })) : []));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newSet, setNewSet] = useState(emptySet);
  const [newRarity, setNewRarity] = useState({ code: '', group: '힛카드' });
  const [message, setMessage] = useState(initialMessage);

  // 세트별·레어도별 카드 수
  const { setCounts, rarityCounts } = useMemo(() => {
    const index = buildSetIndex(sets);
    const sc = new Map();
    const rc = new Map();
    cards.forEach((card) => {
      const found = findSetForCard(card, index);
      if (found) sc.set(found.code, (sc.get(found.code) || 0) + 1);
      const r = String(card.rarity || '').trim();
      if (r) rc.set(r, (rc.get(r) || 0) + 1);
    });
    return { setCounts: sc, rarityCounts: rc };
  }, [cards, sets]);

  if (!catalogLoaded) {
    return <div className="admin-section full-width"><h3>세트·레어도 관리</h3><p className="help-text">불러오는 중...</p></div>;
  }

  if (!catalog) {
    const handleCreate = async () => {
      const initial = buildInitialCatalog({
        seriesOptions: appConfig?.seriesOptions || [],
        rarityOptions: appConfig?.rarityOptions || [],
        cards,
      });
      const ok = window.confirm(
        `세트 ${initial.sets.length}개, 레어도 ${initial.rarities.length}개로 표를 만듭니다.\n` +
        '발매일은 포켓몬 카드 공식 사이트의 한국 발매일, 총 장수는 카드에 인쇄된 숫자 기준입니다.\n' +
        '만든 뒤에도 이 화면에서 언제든 고칠 수 있어요. 진행할까요?'
      );
      if (!ok) return;
      setSaving(true);
      try {
        await saveCatalog(initial);
        onSaved?.('✅ 세트·레어도 표를 만들었습니다.');
      } catch (err) {
        console.error(err);
        setMessage('❌ 저장 실패: ' + err.message);
      } finally {
        setSaving(false);
      }
    };
    return (
      <div className="admin-section full-width catalog-settings">
        <h3>세트·레어도 관리</h3>
        <p className="help-text">
          아직 세트·레어도 표가 없습니다. 버튼을 누르면 지금 쓰고 있는 시리즈·레어도 목록을 바탕으로
          발매일·총 장수·시대가 채워진 표를 만듭니다.
        </p>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={handleCreate}>
          {saving ? '만드는 중...' : '세트·레어도 표 만들기'}
        </button>
        {message && <p className="catalog-message">{message}</p>}
      </div>
    );
  }

  const markDirty = () => { setDirty(true); setMessage(''); };

  const updateSet = (code, field, value) => {
    setSets((prev) => prev.map((s) => (s.code === code ? { ...s, [field]: value } : s)));
    markDirty();
  };

  const addSet = () => {
    const code = newSet.code.trim();
    const name = newSet.name.trim();
    if (!code || !name) { alert('코드와 이름을 입력해 주세요.'); return; }
    if (sets.some((s) => s.code.toLowerCase() === code.toLowerCase())) { alert(`'${code}' 코드는 이미 있습니다.`); return; }
    setSets((prev) => sortSets([...prev, {
      ...newSet, code, name, label: `${code} -「${name}」`,
      printedTotal: newSet.printedTotal === '' ? null : Number(newSet.printedTotal),
    }]));
    setNewSet(emptySet);
    markDirty();
  };

  const removeSet = (code) => {
    if (setCounts.get(code)) { alert('이 세트에 카드가 있어서 지울 수 없습니다. 카드의 시리즈를 먼저 바꿔 주세요.'); return; }
    if (!window.confirm(`'${code}' 세트를 표에서 지울까요?`)) return;
    setSets((prev) => prev.filter((s) => s.code !== code));
    markDirty();
  };

  const updateRarity = (code, field, value) => {
    setRarities((prev) => prev.map((r) => (r.code === code ? { ...r, [field]: value } : r)));
    markDirty();
  };

  const moveRarity = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= rarities.length) return;
    setRarities((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markDirty();
  };

  const addRarity = () => {
    const code = newRarity.code.trim();
    if (!code) return;
    if (rarities.some((r) => r.code === code)) { alert(`'${code}' 레어도는 이미 있습니다.`); return; }
    setRarities((prev) => [...prev, { code, group: newRarity.group, order: prev.length + 1 }]);
    setNewRarity({ code: '', group: '힛카드' });
    markDirty();
  };

  const removeRarity = (code) => {
    if (rarityCounts.get(code)) { alert('이 레어도를 쓰는 카드가 있어서 지울 수 없습니다.'); return; }
    if (!window.confirm(`'${code}' 레어도를 표에서 지울까요?`)) return;
    setRarities((prev) => prev.filter((r) => r.code !== code));
    markDirty();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanSets = sortSets(sets).map((s) => ({
        code: String(s.code).trim(),
        name: String(s.name || '').trim(),
        label: setLabel(s),
        era: s.era || '기타',
        kind: s.kind || '기타',
        releaseDate: String(s.releaseDate || '').trim(),
        printedTotal: s.printedTotal === '' || s.printedTotal === null || s.printedTotal === undefined ? null : Number(s.printedTotal),
      }));
      // 표에서 보이는 순서(위가 낮은 레어도)대로 order 를 1부터 다시 매긴다.
      const cleanRarities = rarities.map((r, i) => ({ code: String(r.code).trim(), group: r.group || '기타', order: i + 1 }));
      await saveCatalog({ sets: cleanSets, rarities: cleanRarities });
      setDirty(false);
      setMessage('✅ 저장했습니다.');
      onSaved?.('✅ 저장했습니다.');
    } catch (err) {
      console.error(err);
      setMessage('❌ 저장 실패: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-section full-width catalog-settings">
      <div className="catalog-head">
        <h3>세트·레어도 관리</h3>
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? '저장 중...' : dirty ? '변경 내용 저장' : '저장됨'}
        </button>
      </div>
      {message && <p className="catalog-message">{message}</p>}

      <h4>세트 ({sets.length}개, 발매일 순)</h4>
      <p className="help-text">
        코드는 카드와 연결되는 이름표라 바꿀 수 없습니다. 발매일은 한국 발매일, 총 장수는 카드에 인쇄된 "/165" 숫자입니다.
      </p>
      <div className="catalog-table-wrap">
        <table className="admin-table catalog-table">
          <thead>
            <tr>
              <th>코드</th><th>이름</th><th>시대</th><th>종류</th><th>발매일</th><th>총 장수</th><th>등록 카드</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.code}>
                <td className="mono">{s.code}</td>
                <td><input className="table-input" value={s.name || ''} onChange={(e) => updateSet(s.code, 'name', e.target.value)} /></td>
                <td>
                  <select className="table-input" value={s.era || '기타'} onChange={(e) => updateSet(s.code, 'era', e.target.value)}>
                    {ERA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td>
                  <select className="table-input" value={s.kind || '기타'} onChange={(e) => updateSet(s.code, 'kind', e.target.value)}>
                    {KIND_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td><input className="table-input" type="date" value={s.releaseDate || ''} onChange={(e) => updateSet(s.code, 'releaseDate', e.target.value)} /></td>
                <td><input className="table-input num" type="number" min="0" value={s.printedTotal ?? ''} onChange={(e) => updateSet(s.code, 'printedTotal', e.target.value)} /></td>
                <td className="num">{setCounts.get(s.code) || 0}</td>
                <td><button type="button" className="btn btn-compact" onClick={() => removeSet(s.code)} title="표에서 지우기">✕</button></td>
              </tr>
            ))}
            <tr className="catalog-new-row">
              <td><input className="table-input" placeholder="예: m4" value={newSet.code} onChange={(e) => setNewSet({ ...newSet, code: e.target.value })} /></td>
              <td><input className="table-input" placeholder="세트 이름" value={newSet.name} onChange={(e) => setNewSet({ ...newSet, name: e.target.value })} /></td>
              <td>
                <select className="table-input" value={newSet.era} onChange={(e) => setNewSet({ ...newSet, era: e.target.value })}>
                  {ERA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select className="table-input" value={newSet.kind} onChange={(e) => setNewSet({ ...newSet, kind: e.target.value })}>
                  {KIND_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td><input className="table-input" type="date" value={newSet.releaseDate} onChange={(e) => setNewSet({ ...newSet, releaseDate: e.target.value })} /></td>
              <td><input className="table-input num" type="number" min="0" value={newSet.printedTotal} onChange={(e) => setNewSet({ ...newSet, printedTotal: e.target.value })} /></td>
              <td colSpan={2}><button type="button" className="btn btn-secondary btn-compact" onClick={addSet}>세트 추가</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4>레어도 ({rarities.length}개, 위가 낮은 레어도)</h4>
      <p className="help-text">▲▼ 로 순서를 바꾸면 정렬·통계에 그대로 반영됩니다.</p>
      <div className="catalog-table-wrap">
        <table className="admin-table catalog-table">
          <thead>
            <tr><th>순서</th><th>레어도</th><th>그룹</th><th>등록 카드</th><th></th></tr>
          </thead>
          <tbody>
            {rarities.map((r, i) => (
              <tr key={r.code}>
                <td className="nowrap">
                  <button type="button" className="btn btn-compact" disabled={i === 0} onClick={() => moveRarity(i, -1)} aria-label="위로">▲</button>
                  <button type="button" className="btn btn-compact" disabled={i === rarities.length - 1} onClick={() => moveRarity(i, 1)} aria-label="아래로">▼</button>
                </td>
                <td className="mono">{r.code}</td>
                <td>
                  <select className="table-input" value={r.group || '기타'} onChange={(e) => updateRarity(r.code, 'group', e.target.value)}>
                    {RARITY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td className="num">{rarityCounts.get(r.code) || 0}</td>
                <td><button type="button" className="btn btn-compact" onClick={() => removeRarity(r.code)} title="표에서 지우기">✕</button></td>
              </tr>
            ))}
            <tr className="catalog-new-row">
              <td></td>
              <td><input className="table-input" placeholder="예: SSR" value={newRarity.code} onChange={(e) => setNewRarity({ ...newRarity, code: e.target.value })} /></td>
              <td>
                <select className="table-input" value={newRarity.group} onChange={(e) => setNewRarity({ ...newRarity, group: e.target.value })}>
                  {RARITY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </td>
              <td colSpan={2}><button type="button" className="btn btn-secondary btn-compact" onClick={addRarity}>레어도 추가</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
