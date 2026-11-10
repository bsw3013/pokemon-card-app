import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOwnedCards } from '../../hooks/useOwnedCards';
import { DEFAULT_RARITIES, DEFAULT_SETS } from '../../utils/catalog';
import { loadJpDetail, loadJpIndex, loadKrIndex } from '../../utils/imageSources';
import {
  LANGS, buildJpGroups, buildKrGroups, buildRegistry, enCatalogCode, isRegistered, jpDetailPatches,
  langKeyOf, loadEnSetCards, loadEnSets, missingRarities, targetSet, toCardPayload,
} from '../../utils/officialImport';

// 마스터 설정 → 공식 목록 가져오기
// 공식 카드 목록(한국·일본·영문)에서 카드 탭에 아직 없는 카드를 골라 한 번에 등록한다.
// 목록 파일은 GitHub Actions 가 계속 모으고 있어서, 모일수록 여기서 고를 수 있는 카드가 늘어난다.
const UNDO_MS = 15000;
const text = (v) => String(v ?? '').trim();

const INFO = {
  kr: <>한국 공식 카드를 <b>언어 "한국" · 미보유</b>로 등록해요. 이름·세트·번호·레어도·종류·도감 번호·사진이 공식 정보로 채워져요. 세트 표에 없는 세트는 자동으로 추가돼요.</>,
  ja: <><b>언어 "일본" · 미보유</b>로 따로 등록돼요. 카드 탭 썸네일에 <b>일판</b> 표시가 붙어요. 한국판에 같은 카드가 있어도 따로 등록되고, "등록됨"은 이미 등록된 <b>일판 카드</b>만 뜻해요.<br />이름은 포켓몬이면 한글로 번역하고, 번역이 안 되는 이름은 <span className="oi-raw">주황색</span>으로 일본어 그대로 들어가요. 번호·레어도는 일본 카드 상세 목록이 모인 카드만 채워져요.</>,
  en: <><b>언어 "미국" · 미보유</b>로 따로 등록돼요. 썸네일에 <b>영문판</b> 표시가 붙어요. 영문판은 세트 구성·번호가 달라서 <b>영문 세트</b>(예: en-sv09 Journey Together)로 들어가고, 처음 등록할 때 세트·레어도 표에 자동으로 추가돼요.<br />이름은 포켓몬이면 한글로 번역하고, 번역이 안 되는 이름은 <span className="oi-raw">주황색</span>으로 영어 그대로 들어가요.</>,
};

export default function OfficialImport() {
  const { cards, catalog, saveCatalog, createCardsMany, deleteCardsMany, saveMasterMany } = useOwnedCards();
  const sets = useMemo(() => catalog?.sets || DEFAULT_SETS, [catalog]);
  const rarities = useMemo(() => catalog?.rarities || DEFAULT_RARITIES, [catalog]);
  const registry = useMemo(() => buildRegistry(cards, sets), [cards, sets]);

  const [lang, setLang] = useState('kr');
  const [data, setData] = useState({}); // { kr: { groups, meta, error, loading }, ja: …, en: … }
  const [enCards, setEnCards] = useState({}); // 영문 세트별 카드 { [setId]: cards | 'loading' | Error }
  const [jpDetail, setJpDetail] = useState(null);
  const [setKey, setSetKey] = useState('');
  const [setQuery, setSetQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [rarityFilter, setRarityFilter] = useState('');
  const [nameFilter, setNameFilter] = useState(''); // '' | 'ok' | 'pokemon'
  const [showRegistered, setShowRegistered] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, undoIds?, until? }
  const undoTimer = useRef(null);

  // 언어를 처음 열 때 목록 불러오기
  useEffect(() => {
    if (data[lang]) return;
    setData((prev) => ({ ...prev, [lang]: { loading: true } }));
    (async () => {
      try {
        if (lang === 'kr') {
          const index = await loadKrIndex();
          setData((prev) => ({ ...prev, kr: { groups: buildKrGroups(index), count: index.count, complete: index.complete, updatedAt: index.updatedAt } }));
        } else if (lang === 'ja') {
          const [index, detail] = await Promise.all([loadJpIndex(), loadJpDetail()]);
          setJpDetail(detail);
          setData((prev) => ({ ...prev, ja: { groups: buildJpGroups(index, detail), count: index.count, complete: true, detailCount: detail?.count || 0, detailComplete: !!detail?.complete, updatedAt: index.updatedAt } }));
        } else {
          const groups = await loadEnSets();
          setData((prev) => ({ ...prev, en: { groups, count: groups.reduce((n, g) => n + g.total, 0), complete: true } }));
        }
      } catch (err) {
        setData((prev) => ({ ...prev, [lang]: { error: err.message || String(err) } }));
      }
    })();
  }, [lang, data]);

  const state = data[lang] || { loading: true };
  const groups = useMemo(() => state.groups || [], [state.groups]);

  // 세트별 등록 현황 (공식 · 등록 · 미등록)
  const enRegCount = useMemo(() => {
    const m = new Map();
    cards.forEach((c) => {
      if (langKeyOf(c) !== 'en') return;
      const code = text(c.setCode).toLowerCase();
      if (code) m.set(code, (m.get(code) || 0) + 1);
    });
    return m;
  }, [cards]);
  const summaries = useMemo(() => groups.map((g) => {
    const target = targetSet(g, sets);
    const list = g.lang === 'en' ? (Array.isArray(enCards[g.key]) ? enCards[g.key] : null) : g.cards;
    const registered = list ? list.filter((c) => isRegistered(c, target, registry)).length : (enRegCount.get(enCatalogCode(g.key)) || 0);
    const total = list ? list.length : g.total;
    return { group: g, target, total, registered: Math.min(registered, total), missing: Math.max(0, total - registered) };
  }), [groups, sets, registry, enCards, enRegCount]);

  const visibleSets = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    return summaries.filter((s) => (!onlyMissing || s.missing > 0)
      && (!q || `${s.group.key} ${s.group.name} ${s.target.name}`.toLowerCase().includes(q)));
  }, [summaries, setQuery, onlyMissing]);

  const current = summaries.find((s) => s.group.key === setKey) || null;

  // 세트를 고르면: 영문은 카드를 불러오고, 선택·필터는 처음으로
  const pickSet = (key) => {
    setSetKey(key);
    setSelected(new Set());
    setRarityFilter('');
    setNameFilter('');
    if (lang === 'en' && !Array.isArray(enCards[key]) && enCards[key] !== 'loading') {
      setEnCards((prev) => ({ ...prev, [key]: 'loading' }));
      loadEnSetCards(key)
        .then((list) => setEnCards((prev) => ({ ...prev, [key]: list })))
        .catch((err) => setEnCards((prev) => ({ ...prev, [key]: new Error(err.message || String(err)) })));
    }
  };

  // 언어를 바꾸면 그 언어의 첫 세트를 고른다
  useEffect(() => {
    if (!groups.length) return;
    if (!groups.some((g) => g.key === setKey)) pickSet(groups[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const switchLang = (k) => {
    if (k === lang) return;
    setLang(k);
    setSetKey('');
    setSelected(new Set());
    setSetQuery('');
  };

  const cardList = useMemo(() => {
    if (!current) return [];
    if (current.group.lang !== 'en') return current.group.cards;
    return Array.isArray(enCards[current.group.key]) ? enCards[current.group.key] : [];
  }, [current, enCards]);
  const enState = current?.group.lang === 'en' ? enCards[current.group.key] : null;
  const rows = useMemo(() => cardList.map((c) => ({ card: c, reg: current ? isRegistered(c, current.target, registry) : false })), [cardList, current, registry]);
  const missingRows = useMemo(() => rows.filter((r) => !r.reg), [rows]);
  const rarityChips = useMemo(() => {
    const m = new Map();
    missingRows.forEach(({ card }) => { const k = card.rarity || '없음'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()];
  }, [missingRows]);
  const shown = rows.filter(({ card, reg }) => {
    if (reg && !showRegistered) return false;
    if (rarityFilter && (card.rarity || '없음') !== rarityFilter) return false;
    if (nameFilter === 'ok' && !card.nameOk) return false;
    if (nameFilter === 'pokemon' && card.type !== '포켓몬') return false;
    return true;
  });
  const pickable = shown.filter((r) => !r.reg);
  const selectedRows = rows.filter((r) => !r.reg && selected.has(r.card.oid));

  const toggle = (oid) => setSelected((prev) => { const n = new Set(prev); if (n.has(oid)) n.delete(oid); else n.add(oid); return n; });
  const selectAllShown = () => setSelected((prev) => new Set([...prev, ...pickable.map((r) => r.card.oid)]));

  const showMessage = (msg) => {
    clearTimeout(undoTimer.current);
    setMessage(msg);
    if (msg?.undoIds) undoTimer.current = setTimeout(() => setMessage((m) => (m === msg ? { text: m.text } : m)), UNDO_MS);
  };
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const register = async () => {
    if (!current || selectedRows.length === 0) return;
    const picked = selectedRows.map((r) => r.card);
    const { isNew, ...target } = current.target;
    const newRar = missingRarities(picked, rarities);
    const writes = picked.length * (lang === 'kr' ? 1 : 2);
    const lines = [
      `선택한 ${picked.length}장을 "미보유 · ${LANGS[lang].cardLang}"(으)로 등록할까요?`,
      isNew ? `· 세트 표에 새 세트 "${target.label}"가 추가돼요.` : `· 세트: ${target.label}`,
      newRar.length ? `· 새 레어도 ${newRar.map((r) => r.code).join(', ')} 가 레어도 표에 추가돼요.` : '',
      writes > 2000 ? `· 저장이 ${writes.toLocaleString()}번 필요해요. 하루 무료 저장 한도(약 2만 번)를 생각해서 나눠서 넣는 걸 권해요.` : '',
    ].filter(Boolean);
    if (!window.confirm(lines.join('\n'))) return;
    setBusy(true);
    try {
      let nextSets = sets;
      if (isNew || newRar.length) {
        nextSets = isNew ? [...sets, target] : sets;
        await saveCatalog({ sets: nextSets, rarities: [...rarities, ...newRar] });
      }
      const ids = await createCardsMany(picked.map((c) => toCardPayload(c, target)), { sets: nextSets });
      setSelected(new Set());
      showMessage({ text: `${ids.length}장을 등록했어요. 카드 탭에서 볼 수 있어요.`, undoIds: ids });
    } catch (err) {
      console.error(err);
      showMessage({ text: `등록하지 못했어요: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const ids = message?.undoIds;
    if (!ids?.length) return;
    setBusy(true);
    try {
      await deleteCardsMany(ids);
      showMessage({ text: `방금 등록한 ${ids.length}장을 되돌렸어요. (새로 추가된 세트는 세트·레어도 탭에 남아 있어요)` });
    } catch (err) {
      showMessage({ text: `되돌리지 못했어요: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  // 일본 상세 목록이 늦게 모였을 때: 이미 등록한 일판 카드의 빈 번호·레어도 채우기
  const jpPatches = useMemo(() => (lang === 'ja' ? jpDetailPatches(cards, jpDetail, sets) : []), [lang, cards, jpDetail, sets]);
  const fillJp = async () => {
    if (!jpPatches.length || !window.confirm(`등록한 일판 카드 ${jpPatches.length}장의 빈 번호·레어도·도감 번호를 일본 상세 목록으로 채울까요?`)) return;
    setBusy(true);
    try {
      await saveMasterMany(jpPatches);
      showMessage({ text: `일판 카드 ${jpPatches.length}장의 번호·레어도를 채웠어요.` });
    } catch (err) {
      showMessage({ text: `채우지 못했어요: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const statusTag = (() => {
    if (lang === 'kr' && state.groups && !state.complete) return <span className="oi-tag wip">목록 모으는 중</span>;
    if (lang === 'ja' && state.groups && !state.detailComplete) return <span className="oi-tag wip">번호 모으는 중</span>;
    return null;
  })();

  return (
    <div className="oi">
      <div className="oi-top">
        <div className="oi-langs" role="tablist">
          {Object.entries(LANGS).map(([k, v]) => (
            <button key={k} type="button" role="tab" aria-selected={lang === k} className={lang === k ? 'on' : ''} onClick={() => switchLang(k)}>
              {v.label}{data[k]?.count ? <i>{Number(data[k].count).toLocaleString()}</i> : null}
            </button>
          ))}
        </div>
        {jpPatches.length > 0 && (
          <button type="button" className="btn btn-secondary btn-compact" onClick={fillJp} disabled={busy}>일판 카드 {jpPatches.length}장 번호·레어도 채우기</button>
        )}
      </div>

      {message && (
        <div className="oi-msg" role="status">
          <span>{message.text}</span>
          {message.undoIds && <button type="button" className="link-btn" onClick={undo} disabled={busy}>되돌리기</button>}
          <button type="button" className="oi-x" onClick={() => setMessage(null)} aria-label="닫기">✕</button>
        </div>
      )}

      {state.loading && <div className="oi-empty">공식 카드 목록을 불러오는 중...</div>}
      {state.error && (
        <div className="oi-empty">
          {lang === 'kr'
            ? '한국 공식 카드 목록이 아직 없어요. GitHub Actions가 천천히 모으는 중이라, 다 모이면 여기에 자동으로 보여요.'
            : lang === 'ja' ? '일본 공식 카드 목록을 불러오지 못했어요.' : '영문 카드 목록(TCGdex)을 불러오지 못했어요.'}
          <small>{state.error}</small>
        </div>
      )}

      {state.groups && (
        <div className="oi-wrap">
          <aside className="oi-sets">
            <div className="oi-sets-hd">
              <b>{lang === 'en' ? '영문 세트 (TCGdex)' : `${LANGS[lang].label.replace('판', '')} 공식 세트`}</b>
              {statusTag}
            </div>
            <div className="oi-sets-tools">
              <input type="search" placeholder="세트 찾기 (코드·이름)" value={setQuery} onChange={(e) => setSetQuery(e.target.value)} />
              <label><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> 미등록 있는 세트만</label>
            </div>
            <div className="oi-set-list">
              {visibleSets.map((s) => {
                const pct = s.total ? (s.registered / s.total) * 100 : 0;
                return (
                  <button key={s.group.key} type="button" className={`oi-set ${s.group.key === setKey ? 'on' : ''}`} onClick={() => pickSet(s.group.key)}>
                    <span className="l1">
                      <b>{s.group.key}{(s.target.name || s.group.name) && (s.target.name || s.group.name) !== s.group.key ? ` · ${s.target.isNew ? s.group.name : s.target.name}` : ''}</b>
                      {s.total > 0 && s.missing === 0 && <span className="oi-tag done">다 등록</span>}
                      {s.target.isNew && <span className="oi-tag">새 세트</span>}
                    </span>
                    <span className="oi-bar"><span className="r" style={{ width: `${pct}%` }} /><span className="m" style={{ width: `${100 - pct}%` }} /></span>
                    <span className="l2">공식 {s.total}장 · 등록 {s.registered}장{s.missing > 0 && <> · <em>미등록 {s.missing}장</em></>}</span>
                  </button>
                );
              })}
              {visibleSets.length === 0 && <div className="oi-none">맞는 세트가 없어요.</div>}
            </div>
          </aside>

          <section className="oi-main">
            {current ? (
              <>
                <div className="oi-head">
                  <div>
                    <h3>{current.group.key}{current.group.name ? ` · ${current.target.isNew ? current.group.name : current.target.name}` : ''}</h3>
                    <small>공식 {current.total}장 · 등록 {current.registered}장 · 미등록 {current.missing}장 · 넣을 세트: {current.target.label}{current.target.isNew ? ' (새로 추가)' : ''}</small>
                  </div>
                  <button type="button" className="btn btn-secondary btn-compact" onClick={selectAllShown} disabled={pickable.length === 0}>보이는 미등록 {pickable.length}장 전체 선택</button>
                </div>
                <div className="oi-info">{INFO[lang]}</div>
                <div className="oi-filters">
                  <button type="button" className={`oi-chip ${rarityFilter ? '' : 'on'}`} onClick={() => setRarityFilter('')}>전체<i>{missingRows.length}</i></button>
                  {rarityChips.map(([r, n]) => (
                    <button key={r} type="button" className={`oi-chip ${rarityFilter === r ? 'on' : ''}`} onClick={() => setRarityFilter(rarityFilter === r ? '' : r)}>{r}<i>{n}</i></button>
                  ))}
                  {lang !== 'kr' && <>
                    <span className="oi-sep" />
                    <button type="button" className={`oi-chip ${nameFilter === 'ok' ? 'on' : ''}`} onClick={() => setNameFilter(nameFilter === 'ok' ? '' : 'ok')}>번역된 이름만</button>
                    <button type="button" className={`oi-chip ${nameFilter === 'pokemon' ? 'on' : ''}`} onClick={() => setNameFilter(nameFilter === 'pokemon' ? '' : 'pokemon')}>포켓몬만</button>
                  </>}
                  <label className="oi-check"><input type="checkbox" checked={showRegistered} onChange={(e) => setShowRegistered(e.target.checked)} /> 등록된 카드도 흐리게 보기</label>
                </div>

                {enState === 'loading' ? <div className="oi-empty">영문 카드를 불러오는 중...</div>
                  : enState instanceof Error ? <div className="oi-empty">영문 카드를 불러오지 못했어요.<small>{enState.message}</small></div>
                    : shown.length === 0 ? <div className="oi-empty">{rows.length ? '조건에 맞는 카드가 없어요.' : '이 세트에는 카드가 없어요.'}</div>
                      : (
                        <div className="oi-grid">
                          {shown.map(({ card, reg }) => {
                            const sel = !reg && selected.has(card.oid);
                            return (
                              <button
                                key={card.oid}
                                type="button"
                                className={`oi-card ${reg ? 'reg' : ''} ${sel ? 'sel' : ''}`}
                                onClick={() => !reg && toggle(card.oid)}
                                disabled={reg}
                                aria-pressed={sel}
                                title={card.original && card.original !== card.name ? `${card.name} (${card.original})` : card.name}
                              >
                                <span className="oi-im"><img src={card.thumb || card.img} alt={card.name} loading="lazy" /></span>
                                {reg ? <span className="oi-badge">등록됨</span> : <span className="oi-ck">{sel ? '✓' : ''}</span>}
                                {LANGS[lang].badge && <span className="oi-lb">{LANGS[lang].badge}</span>}
                                <span className={`oi-t ${card.nameOk ? '' : 'raw'}`}>{card.name}</span>
                                <span className="oi-s">
                                  {!card.nameOk ? '번역 안 됨 · 원래 이름으로'
                                    : [card.original && card.original !== card.name ? card.original : '', card.noText || (card.num != null ? String(card.num) : ''), card.rarity].filter(Boolean).join(' · ')}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                <div className={`oi-bar-sticky ${selectedRows.length ? 'show' : ''}`}>
                  <b>{selectedRows.length}장 선택</b>
                  <small>미등록 {missingRows.length}장 중 · "미보유 · {LANGS[lang].cardLang}"(으)로 등록돼요</small>
                  <span className="oi-grow" />
                  <button type="button" className="btn oi-clear" onClick={() => setSelected(new Set())} disabled={busy || !selectedRows.length}>선택 해제</button>
                  <button type="button" className="btn oi-go" onClick={register} disabled={busy || !selectedRows.length}>{busy ? '등록 중...' : `선택한 ${selectedRows.length}장 등록`}</button>
                </div>
              </>
            ) : <div className="oi-empty">왼쪽에서 세트를 골라 주세요.</div>}
          </section>
        </div>
      )}
    </div>
  );
}
