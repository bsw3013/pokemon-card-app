import React, { useMemo, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import { DEFAULT_SETS, buildSetIndex, findSetForCard, setLabel, sortSets, withCardMeta } from '../../utils/catalog';
import { normalizePokedexNumber } from '../../utils/numberUtils';
import { setHashParams } from '../../utils/hashRoute';
import CardThumbnail from '../CardThumbnail';

const PAGE_SIZE = 50;
const BATCH_LIMIT = 400;
const NON_POKEMON = ['서포트', '도구', '스타디움', '에너지'];
const text = (v) => String(v ?? '').trim();

const BLANKS = [
  ['', '전체'],
  ['name', '이름 없음'],
  ['type', '종류 없음'],
  ['rarity', '레어도 없음'],
  ['dex', '도감번호 없음 (포켓몬)'],
  ['image', '이미지 없음'],
  ['set', '세트 없음'],
];

// 마스터 설정 → 카드 관리: 검색·페이지 나눔·바로 수정·여러 장 한꺼번에 수정
export default function CardManager({ appConfig }) {
  const { cards, setCards, catalog, saveCard } = useOwnedCards();
  const sets = useMemo(() => sortSets(catalog?.sets || DEFAULT_SETS).reverse(), [catalog]);
  const setIndex = useMemo(() => buildSetIndex(catalog?.sets || DEFAULT_SETS), [catalog]);
  const [q, setQ] = useState('');
  const [setFilter, setSetFilter] = useState('');
  const [blank, setBlank] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [drafts, setDrafts] = useState({});
  const [savedFlash, setSavedFlash] = useState({});
  const [bulk, setBulk] = useState({ field: 'type', value: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const rarityOptions = appConfig?.rarityOptions || [];
  const typeOptions = appConfig?.typeOptions || [];

  const rows = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return cards
      .map((card) => ({ card, set: findSetForCard(card, setIndex) }))
      .filter(({ card, set }) => {
        if (setFilter && (set?.code || '') !== setFilter) return false;
        if (blank === 'name' && text(card.cardName)) return false;
        if (blank === 'type' && text(card.type)) return false;
        if (blank === 'rarity' && text(card.rarity)) return false;
        if (blank === 'dex' && (text(card.pokedexNumber) || NON_POKEMON.includes(text(card.type)))) return false;
        if (blank === 'image' && text(card.imageUrl)) return false;
        if (blank === 'set' && set) return false;
        if (!keyword) return true;
        return [card.cardName, card.cardNumber, card.pokedexNumber, card.series, card.rarity, card.type, card.id]
          .map(text).join(' ').toLowerCase().includes(keyword);
      })
      .sort((a, b) => text(b.set?.releaseDate).localeCompare(text(a.set?.releaseDate)) || ((a.card.cardNo ?? 0) - (b.card.cardNo ?? 0)));
  }, [cards, setIndex, q, setFilter, blank]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const resetPage = () => { setPage(1); setSelected(new Set()); };

  const valueOf = (card, field) => (drafts[card.id]?.[field] ?? card[field] ?? '');
  const setDraft = (id, field, value) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const commit = async (card, field) => {
    const draft = drafts[card.id]?.[field];
    if (draft === undefined) return;
    let value = draft;
    if (field === 'pokedexNumber') value = normalizePokedexNumber(value);
    if (text(value) === text(card[field])) {
      setDrafts((prev) => { const n = { ...prev }; if (n[card.id]) { delete n[card.id][field]; } return n; });
      return;
    }
    try {
      await saveCard(card.id, { [field]: value });
      setDrafts((prev) => { const n = { ...prev }; if (n[card.id]) { delete n[card.id][field]; } return n; });
      setSavedFlash((prev) => ({ ...prev, [card.id]: Date.now() }));
      setTimeout(() => setSavedFlash((prev) => { const n = { ...prev }; delete n[card.id]; return n; }), 1500);
    } catch (err) {
      console.error(err);
      alert('저장 실패: ' + err.message);
    }
  };

  const toggleRow = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = pageRows.length > 0 && pageRows.every(({ card }) => selected.has(card.id));
  const togglePage = () => setSelected((prev) => {
    const n = new Set(prev);
    pageRows.forEach(({ card }) => { if (allOnPage) n.delete(card.id); else n.add(card.id); });
    return n;
  });

  // 여러 장을 한 번에 저장 (Firestore 한 번에 400개씩)
  const writeMany = async (patches) => {
    const now = new Date().toISOString();
    const byId = new Map(cards.map((c) => [c.id, c]));
    const finals = patches.map(({ id, patch }) => ({ id, patch: withCardMeta(patch, { setIndex, existing: byId.get(id) || {}, now }) }));
    for (let i = 0; i < finals.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      finals.slice(i, i + BATCH_LIMIT).forEach(({ id, patch }) => batch.update(doc(db, 'pokemon_cards', id), patch));
      await batch.commit();
    }
    const map = new Map(finals.map((f) => [f.id, f.patch]));
    setCards((prev) => prev.map((c) => (map.has(c.id) ? { ...c, ...map.get(c.id) } : c)));
  };

  const applyBulk = async () => {
    const ids = [...selected];
    if (!ids.length || !bulk.value) return;
    const label = { type: '종류', rarity: '레어도', series: '세트' }[bulk.field];
    if (!window.confirm(`선택한 ${ids.length}장의 ${label}를 "${bulk.value}"(으)로 바꿉니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      await writeMany(ids.map((id) => ({ id, patch: { [bulk.field]: bulk.value } })));
      setMessage(`✅ ${ids.length}장의 ${label}를 바꿨습니다.`);
      setSelected(new Set());
    } catch (err) {
      console.error(err);
      setMessage('❌ 저장 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  // 종류가 빈 카드 중 도감번호가 있는 카드는 "포켓몬"으로 채운다.
  const autoFillType = async () => {
    const targets = cards.filter((c) => !text(c.type) && text(c.pokedexNumber));
    if (!targets.length) { setMessage('✅ 채울 카드가 없습니다.'); return; }
    if (!window.confirm(`종류가 비어 있고 도감번호가 있는 카드 ${targets.length}장을 "포켓몬"으로 채웁니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      await writeMany(targets.map((c) => ({ id: c.id, patch: { type: '포켓몬' } })));
      setMessage(`✅ ${targets.length}장의 종류를 "포켓몬"으로 채웠습니다.`);
    } catch (err) {
      console.error(err);
      setMessage('❌ 저장 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const autoTypeCount = useMemo(() => cards.filter((c) => !text(c.type) && text(c.pokedexNumber)).length, [cards]);
  const bulkOptions = bulk.field === 'type' ? typeOptions : bulk.field === 'rarity' ? rarityOptions : sets.map(setLabel);

  return (
    <div className="admin-section full-width cm">
      <div className="catalog-head">
        <h3>카드 관리 <span className="cm-count">{rows.length.toLocaleString()}장</span></h3>
        <button type="button" className="btn btn-primary btn-compact" onClick={() => setHashParams({ cardId: 'new' })}>카드 추가</button>
      </div>
      <p className="help-text">칸을 고치고 다른 곳을 누르면 바로 저장됩니다. 왼쪽 칸을 체크하면 여러 장을 한꺼번에 바꿀 수 있어요.</p>

      <div className="cm-tools">
        <input className="cm-search" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} placeholder="이름, 번호, 도감번호, 카드 ID 검색" />
        <select className="select" value={setFilter} onChange={(e) => { setSetFilter(e.target.value); resetPage(); }}>
          <option value="">모든 세트</option>
          {sets.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
        </select>
        <select className="select" value={blank} onChange={(e) => { setBlank(e.target.value); resetPage(); }}>
          {BLANKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {autoTypeCount > 0 && (
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={autoFillType}>빈 종류 자동 채우기 ({autoTypeCount}장)</button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="cm-bulk">
          <b>{selected.size}장 선택</b>
          <select className="select" value={bulk.field} onChange={(e) => setBulk({ field: e.target.value, value: '' })}>
            <option value="type">종류</option>
            <option value="rarity">레어도</option>
            <option value="series">세트</option>
          </select>
          <select className="select" value={bulk.value} onChange={(e) => setBulk((b) => ({ ...b, value: e.target.value }))}>
            <option value="">바꿀 값 선택</option>
            {bulkOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-compact" disabled={busy || !bulk.value} onClick={applyBulk}>{busy ? '저장 중...' : '한꺼번에 바꾸기'}</button>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => setSelected(new Set())}>선택 해제</button>
        </div>
      )}
      {message && <p className="catalog-message">{message}</p>}

      <div className="catalog-table-wrap">
        <table className="admin-table catalog-table cm-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="이 페이지 모두 선택" /></th>
              <th></th><th>이름</th><th>세트</th><th>카드 번호</th><th>레어도</th><th>종류</th><th>도감</th><th>이미지 주소</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ card }) => (
              <tr key={card.id} className={selected.has(card.id) ? 'sel' : ''}>
                <td><input type="checkbox" checked={selected.has(card.id)} onChange={() => toggleRow(card.id)} aria-label="선택" /></td>
                <td className="cm-thumb"><CardThumbnail imageUrl={card.imageUrl} alt="" type="table" /></td>
                <td><input className="table-input" value={valueOf(card, 'cardName')} onChange={(e) => setDraft(card.id, 'cardName', e.target.value)} onBlur={() => commit(card, 'cardName')} /></td>
                <td>
                  <select className="table-input" value={valueOf(card, 'series')} onChange={(e) => { setDraft(card.id, 'series', e.target.value); }} onBlur={() => commit(card, 'series')}>
                    <option value="">-</option>
                    {sets.map((s) => <option key={s.code} value={setLabel(s)}>{s.code} · {s.name}</option>)}
                    {card.series && !sets.some((s) => setLabel(s) === card.series) && <option value={card.series}>{card.series}</option>}
                  </select>
                </td>
                <td><input className="table-input mono" value={valueOf(card, 'cardNumber')} onChange={(e) => setDraft(card.id, 'cardNumber', e.target.value)} onBlur={() => commit(card, 'cardNumber')} /></td>
                <td>
                  <select className="table-input" value={valueOf(card, 'rarity')} onChange={(e) => setDraft(card.id, 'rarity', e.target.value)} onBlur={() => commit(card, 'rarity')}>
                    <option value="">-</option>
                    {rarityOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                    {card.rarity && !rarityOptions.includes(card.rarity) && <option value={card.rarity}>{card.rarity}</option>}
                  </select>
                </td>
                <td>
                  <select className="table-input" value={valueOf(card, 'type')} onChange={(e) => setDraft(card.id, 'type', e.target.value)} onBlur={() => commit(card, 'type')}>
                    <option value="">-</option>
                    {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td><input className="table-input mono cm-dex" value={valueOf(card, 'pokedexNumber')} onChange={(e) => setDraft(card.id, 'pokedexNumber', e.target.value)} onBlur={() => commit(card, 'pokedexNumber')} /></td>
                <td><input className="table-input cm-url" value={valueOf(card, 'imageUrl')} onChange={(e) => setDraft(card.id, 'imageUrl', e.target.value)} onBlur={() => commit(card, 'imageUrl')} /></td>
                <td className="nowrap">
                  {savedFlash[card.id] ? <span className="cm-saved">저장됨</span> : (
                    <button type="button" className="btn btn-compact" onClick={() => setHashParams({ cardId: card.id })}>열기</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cm-pages">
        <button type="button" className="btn btn-secondary btn-compact" disabled={current <= 1} onClick={() => setPage(current - 1)}>이전</button>
        <span>{current} / {pages} 쪽</span>
        <button type="button" className="btn btn-secondary btn-compact" disabled={current >= pages} onClick={() => setPage(current + 1)}>다음</button>
      </div>
    </div>
  );
}
