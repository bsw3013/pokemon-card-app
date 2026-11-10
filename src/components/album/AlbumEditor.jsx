import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import CardThumbnail from '../CardThumbnail';
import { DEFAULT_RARITIES, DEFAULT_SETS, sortRarities, sortSets } from '../../utils/catalog';
import { ownedCount } from '../../utils/cardStats';
import { rarityTone } from '../../utils/rarityTone';
import { DEFAULT_ALBUM_COLOR, binderGeometry, cardToSlot, slotImage, slotOwned } from './albumUtils';

const VIEWS = [['spread', '펼침면', '펼침'], ['all', '전체 페이지', '전체'], ['book', '넘겨보기', '넘기기']];
const DRAWER_PAGE = 90;
const readLS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그대로 */ } };
const norm = (v) => String(v ?? '').trim().toLowerCase();

function useIsMobile() {
  const q = '(max-width: 768px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

function emptyPage(n) { return { slots: Array.from({ length: n }, () => null) }; }

// 페이지 미리보기 (페이지 목록 칸): 보유=진한 칸, 미보유=회색, 빈 칸=점선
function PageMini({ page, perPage, cols, cardsById }) {
  const slots = [...(page?.slots || [])].slice(0, perPage);
  while (slots.length < perPage) slots.push(null);
  return (
    <span className="ae-pmini" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {slots.map((s, i) => <i key={i} className={!s ? 'e' : slotOwned(s, cardsById) ? 'o' : 'm'} />)}
    </span>
  );
}

// 앨범 편집 화면
export default function AlbumEditor({
  album, cards, cardsById, catalog, apply, undo, redo, canUndo, canRedo, saveStatus,
  onClose, onRename, onOpenSlotCard, onOpenImport, onOpenBatch,
}) {
  const isMobile = useIsMobile();
  const cols = Math.max(1, Number(album.cols) || 3);
  const rows = Math.max(1, Number(album.rows) || 3);
  const perPage = cols * rows;
  const pages = useMemo(() => album.pages || [], [album.pages]);
  const color = album.coverColor || DEFAULT_ALBUM_COLOR;

  const [view, setView] = useState(() => readLS('album_editor_view_v1', 'spread'));
  const [pageRaw, setPage] = useState(0); // 지금 보고 있는 (왼쪽) 페이지
  const page = Math.max(0, Math.min(pageRaw, pages.length - 1));
  const [sel, setSel] = useState(null); // { p, s }
  const [moving, setMoving] = useState(null); // 휴대폰: 옮길 칸 { p, s }
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false); // 휴대폰 카드 넣기 판
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(null); // 'p-s' | 'page-N'
  const dragRef = useRef(null);
  const touchRef = useRef(null);

  // 카드 넣기 창 필터
  const [q, setQ] = useState('');
  const [setFilter, setSetFilter] = useState(() => {
    const saved = readLS(`album_drawer_set_${album.id}`, null);
    if (saved !== null) return saved;
    const count = new Map();
    (album.pages || []).forEach((pg) => (pg?.slots || []).forEach((sl) => {
      const code = sl?.cardId ? cardsById.get(sl.cardId)?.setCode : '';
      if (code) count.set(code, (count.get(code) || 0) + 1);
    }));
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  });
  const [rarFilter, setRarFilter] = useState('');
  const [onlyUnplaced, setOnlyUnplaced] = useState(true);
  const [onlyOwned, setOnlyOwned] = useState(false);
  const filterKey = `${q}|${setFilter}|${rarFilter}|${onlyUnplaced}|${onlyOwned}`;
  const [limitState, setLimitState] = useState({ key: '', n: DRAWER_PAGE });
  const drawerLimit = limitState.key === filterKey ? limitState.n : DRAWER_PAGE;

  useEffect(() => { writeLS('album_editor_view_v1', view); }, [view]);
  useEffect(() => { writeLS(`album_drawer_set_${album.id}`, setFilter); }, [setFilter, album.id]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const sheetsPerView = isMobile ? 1 : 2;
  const spreadStart = isMobile ? page : Math.floor(page / 2) * 2;
  const visiblePages = useMemo(() => {
    const out = [];
    for (let i = spreadStart; i < Math.min(pages.length, spreadStart + sheetsPerView); i += 1) out.push(i);
    return out;
  }, [spreadStart, sheetsPerView, pages.length]);

  // ── 통계 (보유는 지금 내 컬렉션 기준)
  const stats = useMemo(() => {
    let placed = 0; let owned = 0;
    pages.forEach((pg) => (pg?.slots || []).forEach((s) => { if (s) { placed += 1; if (slotOwned(s, cardsById)) owned += 1; } }));
    const total = pages.length * perPage;
    return { total, placed, owned, missing: placed - owned, empty: total - placed };
  }, [pages, perPage, cardsById]);
  const placedIds = useMemo(() => {
    const set = new Set();
    pages.forEach((pg) => (pg?.slots || []).forEach((s) => { if (s?.cardId) set.add(s.cardId); }));
    return set;
  }, [pages]);

  // ── 편집 동작
  const slotAt = (p, s) => pages[p]?.slots?.[s] || null;
  const nextEmpty = useCallback((fromP, fromS) => {
    for (let p = fromP; p < pages.length; p += 1) {
      const slots = pages[p]?.slots || [];
      for (let s = p === fromP ? fromS : 0; s < perPage; s += 1) if (!slots[s]) return { p, s };
    }
    return null;
  }, [pages, perPage]);

  // 카드 여러 장을 target 칸부터 순서대로 (빈 칸 우선) 넣는다. 칸이 모자라면 페이지를 늘린다.
  const placeCards = (list, target) => {
    if (!list.length) return null;
    let last = null;
    let added = 0;
    apply((draft) => {
      const ensure = (p) => { while (draft.pages.length <= p) { draft.pages.push(emptyPage(perPage)); added += 1; } };
      let p = target ? target.p : spreadStart;
      let s = target ? target.s : 0;
      list.forEach((card, i) => {
        // 첫 장은 고른 칸에 그대로(교체), 나머지는 다음 빈 칸으로
        if (!(i === 0 && target)) {
          for (;;) {
            ensure(p);
            if (s >= perPage) { p += 1; s = 0; continue; }
            if (!draft.pages[p].slots[s]) break;
            s += 1;
          }
        }
        ensure(p);
        while (draft.pages[p].slots.length < perPage) draft.pages[p].slots.push(null);
        draft.pages[p].slots[s] = cardToSlot(card);
        last = { p, s };
        s += 1;
      });
      return draft;
    });
    if (added) setToast(`칸이 모자라서 페이지 ${added}장을 늘렸어요`);
    return last;
  };

  const placeOne = (card) => {
    const target = sel || nextEmpty(spreadStart, 0);
    const last = placeCards([card], target || null);
    if (!last) return;
    // 다음 빈 칸으로 선택을 옮겨서 계속 채우기 쉽게
    const after = nextEmpty(last.p, last.s + 1);
    setSel(after && after.p <= last.p + 1 ? after : null);
    if (!isMobile && Math.floor(last.p / 2) * 2 !== spreadStart) setPage(last.p);
    if (isMobile && last.p !== page) setPage(last.p);
  };

  const clearSlot = (p, s) => {
    if (!slotAt(p, s)) return;
    apply((draft) => { draft.pages[p].slots[s] = null; return draft; });
    setToast('칸에서 뺐어요 · 되돌리기 Ctrl+Z');
  };

  const moveSlot = (from, to) => {
    if (!from || !to || (from.p === to.p && from.s === to.s)) return;
    apply((draft) => {
      const a = draft.pages[from.p]?.slots; const b = draft.pages[to.p]?.slots;
      if (!a || !b) return draft;
      const card = a[from.s] || null;
      if (!card) return draft;
      a[from.s] = b[to.s] || null;
      b[to.s] = card;
      return draft;
    });
    setSel(to);
  };

  const addPage = () => {
    apply((draft) => { draft.pages.push(emptyPage(perPage)); return draft; });
    setPage(pages.length);
    setSel(null);
  };
  const duplicatePage = () => {
    apply((draft) => { draft.pages.splice(page + 1, 0, JSON.parse(JSON.stringify(draft.pages[page]))); return draft; });
    setPage(page + 1);
  };
  const deletePage = () => {
    if (pages.length <= 1) { setToast('페이지는 한 장 이상 있어야 해요'); return; }
    const filled = (pages[page]?.slots || []).filter(Boolean).length;
    if (filled && !window.confirm(`P${page + 1}에 카드 ${filled}장이 있어요. 페이지를 지울까요?\n(바로 뒤에 Ctrl+Z로 되돌릴 수 있어요)`)) return;
    apply((draft) => { draft.pages.splice(page, 1); return draft; });
    setPage(Math.max(0, page - 1));
    setSel(null);
  };
  const reorderPage = (from, to) => {
    if (from === to) return;
    apply((draft) => {
      const [pg] = draft.pages.splice(from, 1);
      draft.pages.splice(to, 0, pg);
      return draft;
    });
    setPage(to);
  };

  const goPage = (p) => {
    const max = pages.length - 1;
    setPage(Math.max(0, Math.min(max, p)));
    setSel(null);
    setMoving(null);
  };
  const prev = () => goPage(spreadStart - sheetsPerView);
  const next = () => goPage(spreadStart + sheetsPerView);

  // ── 칸 누르기
  const onPocket = (p, s) => {
    if (view === 'book') return;
    if (moving) { moveSlot(moving, { p, s }); setMoving(null); return; }
    const same = sel && sel.p === p && sel.s === s;
    setSel(same ? null : { p, s });
    if (isMobile && !same && !slotAt(p, s)) setDrawerOpen(true);
  };

  // ── 키보드: 방향키 이동, Delete 빼기, Ctrl+Z/Y
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (document.querySelector('.modal-backdrop, .alb-dialog-wrap')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape') { setSel(null); setMoving(null); setMenuOpen(false); return; }
      if (!sel) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSlot(sel.p, sel.s); return; }
      if (e.key === 'Enter' && slotAt(sel.p, sel.s)) { e.preventDefault(); onOpenSlotCard(slotAt(sel.p, sel.s), sel.p, sel.s); return; }
      const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
      if (!d) return;
      e.preventDefault();
      let { p, s } = sel;
      let r = Math.floor(s / cols); let c = s % cols;
      r += d[0]; c += d[1];
      if (c >= cols) { c = 0; p += 1; } else if (c < 0) { c = cols - 1; p -= 1; }
      if (r >= rows) r = rows - 1; else if (r < 0) r = 0;
      if (p < 0 || p >= pages.length) return;
      setSel({ p, s: r * cols + c });
      if (!visiblePages.includes(p)) setPage(p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── 휴대폰 밀어서 넘기기
  const onTouchStart = (e) => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const st = touchRef.current; touchRef.current = null;
    if (!st || view === 'all') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - st.x; const dy = t.clientY - st.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else prev(); }
  };

  // ── 끌어다 놓기 (PC)
  const dragStartSlot = (e, p, s) => { dragRef.current = { kind: 'slot', p, s }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'slot'); };
  const dragStartCard = (e, card) => { dragRef.current = { kind: 'card', card }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'card'); };
  const dropOnPocket = (e, p, s) => {
    e.preventDefault();
    const d = dragRef.current; dragRef.current = null; setDragOver(null);
    if (!d) return;
    if (d.kind === 'slot') moveSlot({ p: d.p, s: d.s }, { p, s });
    if (d.kind === 'card') { placeCards([d.card], { p, s }); setSel({ p, s }); }
  };

  // ── 카드 넣기 창 목록
  const setOptions = useMemo(() => {
    const inCards = new Set(cards.map((c) => c.setCode).filter(Boolean));
    return sortSets(catalog?.sets || DEFAULT_SETS).reverse().filter((x) => inCards.has(x.code));
  }, [cards, catalog]);
  const rarityOptions = useMemo(() => {
    const inCards = new Set(cards.map((c) => c.rarity).filter(Boolean));
    return sortRarities(catalog?.rarities || DEFAULT_RARITIES).map((r) => r.code).filter((r) => inCards.has(r));
  }, [cards, catalog]);
  const drawerCards = useMemo(() => {
    const key = norm(q);
    const list = cards.filter((c) => {
      if (setFilter && c.setCode !== setFilter) return false;
      if (rarFilter && c.rarity !== rarFilter) return false;
      if (onlyUnplaced && placedIds.has(c.id)) return false;
      if (onlyOwned && ownedCount(c) === 0) return false;
      if (key && !norm(c.cardName).includes(key) && !norm(c.cardNumber).includes(key)) return false;
      return true;
    });
    const setOrder = new Map(setOptions.map((x, i) => [x.code, i]));
    return list.sort((a, b) => (setOrder.get(a.setCode) ?? 9999) - (setOrder.get(b.setCode) ?? 9999)
      || (Number(a.cardNo) || 9999) - (Number(b.cardNo) || 9999)
      || String(a.cardName || '').localeCompare(String(b.cardName || ''), 'ko'));
  }, [cards, q, setFilter, rarFilter, onlyUnplaced, onlyOwned, placedIds, setOptions]);

  const fillAll = () => {
    const list = drawerCards;
    if (!list.length) return;
    if (list.length > 30 && !window.confirm(`보이는 카드 ${list.length}장을 빈 칸에 순서대로 넣을까요?\n(칸이 모자라면 페이지를 늘려요)`)) return;
    placeCards(list, null);
    setToast(`${list.length}장을 넣었어요`);
    setSel(null);
  };

  // ── 내보내기 (페이지마다 그림으로 캡처)
  const exportAlbum = async (format) => {
    setMenuOpen(false);
    setExporting(true);
    await new Promise((r) => setTimeout(r, 900));
    try {
      const nodes = [...document.querySelectorAll('.ae-export .ae-export-page')];
      if (!nodes.length) throw new Error('내보낼 페이지가 없어요');
      const shots = [];
      for (const node of nodes) {
        shots.push(await html2canvas(node, { scale: 1.5, useCORS: true, backgroundColor: color }));
      }
      const base = album.name || '앨범';
      if (format === 'pdf') {
        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
        shots.forEach((c, i) => {
          const w = pdf.internal.pageSize.getWidth();
          const h = (c.height * w) / c.width;
          if (i > 0) pdf.addPage();
          pdf.addImage(c.toDataURL('image/jpeg', 0.82), 'JPEG', 0, 0, w, h);
        });
        pdf.save(`${base}.pdf`);
      } else {
        const zip = new JSZip();
        shots.forEach((c, i) => zip.file(`${base}_P${i + 1}.jpg`, c.toDataURL('image/jpeg', 0.85).split(',')[1], { base64: true }));
        saveAs(await zip.generateAsync({ type: 'blob' }), `${base}.zip`);
      }
    } catch (err) {
      console.error('앨범 내보내기 실패', err);
      alert('내보내기에 실패했어요. (카드 사진 서버가 그림 복사를 막았을 수 있어요)');
    } finally {
      setExporting(false);
    }
  };

  const commitName = (input) => {
    const v = input.value.trim();
    if (!v) { input.value = album.name || ''; return; }
    if (v !== album.name) onRename(v);
  };

  // ── 그리기
  const pocket = (p, s, { editable = true } = {}) => {
    const slot = slotAt(p, s);
    const isSel = sel && sel.p === p && sel.s === s;
    const isMoveFrom = moving && moving.p === p && moving.s === s;
    const key = `${p}-${s}`;
    const num = p * perPage + s + 1;
    const common = {
      key,
      className: `ae-pocket ${slot ? '' : 'empty'} ${slot && !slotOwned(slot, cardsById) ? 'miss' : ''} ${isSel ? 'sel' : ''} ${isMoveFrom ? 'moving' : ''} ${dragOver === key ? 'over' : ''}`,
      onClick: editable ? () => onPocket(p, s) : undefined,
      onDoubleClick: editable && slot ? () => onOpenSlotCard(slot, p, s) : undefined,
      onDragOver: editable ? (e) => { e.preventDefault(); if (dragOver !== key) setDragOver(key); } : undefined,
      onDragLeave: editable ? () => setDragOver((v) => (v === key ? null : v)) : undefined,
      onDrop: editable ? (e) => dropOnPocket(e, p, s) : undefined,
      role: editable ? 'button' : undefined,
      tabIndex: editable ? 0 : undefined,
      'aria-label': slot ? `${num}번 칸: ${cardsById.get(slot.cardId)?.cardName || slot.cardName || '카드'}` : `${num}번 빈 칸`,
    };
    if (!slot) {
      return <div {...common}>{editable && <><span className="ae-plus" aria-hidden="true">+</span><small>{num}</small></>}</div>;
    }
    const img = slotImage(slot, cardsById);
    return (
      <div {...common} draggable={editable && !isMobile} onDragStart={(e) => dragStartSlot(e, p, s)}>
        {img ? <CardThumbnail imageUrl={img} alt="" type="grid" /> : <span className="ae-noimg">{slot.cardName || '사진 없음'}</span>}
        {!slotOwned(slot, cardsById) && <em className="ae-tag">미보유</em>}
        {editable && !isMobile && (
          <button type="button" className="ae-x" title="칸에서 빼기" aria-label="칸에서 빼기" onClick={(e) => { e.stopPropagation(); clearSlot(p, s); }}>✕</button>
        )}
      </div>
    );
  };

  const sheet = (p, opts) => (
    <div key={p} className="ae-sheet" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      <span className="ae-sheet-label">P{p + 1}</span>
      {Array.from({ length: perPage }, (_, s) => pocket(p, s, opts))}
    </div>
  );

  const binder = (pageIdxs, opts = {}) => {
    const g = binderGeometry(cols, rows, Math.max(1, pageIdxs.length));
    return (
      <div className={`ae-binder ${pageIdxs.length > 1 ? 'two' : 'one'}`} style={{ '--ratio': g.ratio, '--gw': g.w, '--alb-color': color }}>
        {pageIdxs.map((p, i) => (
          <React.Fragment key={p}>
            {i > 0 && <div className="ae-rings" aria-hidden="true"><i /><i /><i /></div>}
            {sheet(p, opts)}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const selSlot = sel ? slotAt(sel.p, sel.s) : null;
  const selName = selSlot ? (cardsById.get(selSlot.cardId)?.cardName || selSlot.cardName) : '';
  const lastPage = visiblePages[visiblePages.length - 1] ?? page;
  const pageLabel = visiblePages.length > 1 ? `P${visiblePages[0] + 1} – P${lastPage + 1}` : `P${(visiblePages[0] ?? 0) + 1}`;

  const drawer = (
    <aside className={`ae-drawer ${drawerOpen ? 'open' : ''}`} aria-label="카드 넣기">
      <div className="ae-drawer-head">
        <div className="ae-drawer-title">
          <h3>카드 넣기</h3>
          {isMobile && <button type="button" className="alb-x" onClick={() => setDrawerOpen(false)} aria-label="닫기">✕</button>}
        </div>
        <p className="ae-hint">
          {sel ? `P${sel.p + 1} · ${sel.s + 1}번째 칸에 넣어요` : '칸을 고르고 카드를 누르세요. 안 고르면 빈 칸에 차례로 들어가요.'}
          {!isMobile && ' 끌어다 놓아도 돼요.'}
        </p>
        <input className="ae-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 번호로 검색" aria-label="카드 검색" />
        <div className="ae-filters">
          <select className="select" value={setFilter} onChange={(e) => setSetFilter(e.target.value)} aria-label="세트">
            <option value="">모든 세트</option>
            {setOptions.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
          <select className="select" value={rarFilter} onChange={(e) => setRarFilter(e.target.value)} aria-label="레어도">
            <option value="">모든 레어도</option>
            {rarityOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="ae-chips">
          <button type="button" className={`ae-chip ${onlyUnplaced ? 'on' : ''}`} aria-pressed={onlyUnplaced} onClick={() => setOnlyUnplaced((v) => !v)}>안 넣은 카드만</button>
          <button type="button" className={`ae-chip ${onlyOwned ? 'on' : ''}`} aria-pressed={onlyOwned} onClick={() => setOnlyOwned((v) => !v)}>보유만</button>
        </div>
      </div>
      <div className="ae-drawer-list">
        {drawerCards.length === 0 ? <p className="ae-hint ae-empty">{onlyUnplaced && (setFilter || rarFilter) && !q ? '이 조건의 카드는 모두 넣었어요.' : '조건에 맞는 카드가 없어요.'}</p> : (
          <div className="ae-dgrid">
            {drawerCards.slice(0, drawerLimit).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`ae-dcard ${ownedCount(c) > 0 ? 'own' : ''}`}
                onClick={() => placeOne(c)}
                draggable={!isMobile}
                onDragStart={(e) => dragStartCard(e, c)}
                title={`${c.cardName || ''} ${c.cardNumber || ''}`}
              >
                <span className="ae-dimg"><CardThumbnail imageUrl={c.imageUrl} alt="" type="grid" />{placedIds.has(c.id) && <em className="ae-placed">넣음</em>}</span>
                <span className="ae-dname">{c.cardName || '이름 없음'}</span>
                <span className="ae-dmeta"><span>{c.cardNumber || ''}</span>{c.rarity && <span className={`rar-badge ${rarityTone(c.rarity)}`}>{c.rarity}</span>}</span>
              </button>
            ))}
          </div>
        )}
        {drawerCards.length > drawerLimit && (
          <button type="button" className="btn btn-secondary ae-more" onClick={() => setLimitState({ key: filterKey, n: drawerLimit + DRAWER_PAGE })}>더 보기 ({drawerCards.length - drawerLimit}장 남음)</button>
        )}
      </div>
      <div className="ae-drawer-foot">
        <span>{drawerCards.length.toLocaleString()}장</span>
        <button type="button" className="btn btn-secondary btn-compact" disabled={!drawerCards.length || (!setFilter && !rarFilter && !q)} onClick={fillAll} title={!setFilter && !rarFilter && !q ? '세트·레어도·검색으로 먼저 걸러 주세요' : ''}>
          보이는 카드 모두 넣기
        </button>
      </div>
    </aside>
  );

  return (
    <div className={`ae ${view === 'book' ? 'is-book' : ''} ${view === 'all' ? 'is-all' : ''}`} style={{ '--alb-color': color }}>
      {/* 위쪽 막대 */}
      <header className="ae-top">
        <button type="button" className="btn btn-secondary btn-compact ae-back" onClick={onClose} aria-label="앨범 목록으로">←<span className="ae-hide-sm"> 앨범</span></button>
        <input
          key={album.name}
          className="ae-name"
          defaultValue={album.name || ''}
          onBlur={(e) => commitName(e.currentTarget)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = album.name || ''; e.currentTarget.blur(); } }}
          aria-label="앨범 이름"
          maxLength={60}
        />
        <span className={`ae-save ${saveStatus}`} role="status">{saveStatus === 'saving' ? '저장 중…' : saveStatus === 'error' ? '저장 실패' : '저장됨'}</span>
        <div className="ae-top-tools">
          <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
          <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
          <div className="seg ae-views" role="tablist" aria-label="보기 방식">
            {VIEWS.map(([k, l, short]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} aria-label={l} className={view === k ? 'on' : ''} onClick={() => { setView(k); setSel(null); setMoving(null); }}>
                <span className="full">{l}</span><span className="short" aria-hidden="true">{short}</span>
              </button>
            ))}
          </div>
          <div className="ae-menu-wrap">
            <button type="button" className="btn btn-secondary btn-compact ae-icon" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="더 보기" onClick={() => setMenuOpen((v) => !v)}>⋯</button>
            {menuOpen && (
              <>
                <div className="alb-menu-backdrop ae-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div className="alb-menu ae-menu" role="menu">
                  <p className="alb-menu-title">{album.name}</p>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); addPage(); }}>페이지 추가</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); duplicatePage(); }}>P{page + 1} 복제</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenImport(); }}>다른 앨범에서 페이지 가져오기</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenBatch(); }}>카드 화면에서 여러 장 고르기</button>
                  <button type="button" role="menuitem" onClick={() => exportAlbum('pdf')}>PDF로 저장</button>
                  <button type="button" role="menuitem" onClick={() => exportAlbum('zip')}>페이지 사진(ZIP)으로 저장</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); deletePage(); }}>P{page + 1} 삭제</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="ae-body">
        {/* 페이지 목록 */}
        <nav className="ae-rail" aria-label="페이지">
          <span className="ae-rail-title">페이지 {pages.length}</span>
          <div className="ae-rail-list">
            {pages.map((pg, i) => (
              <button
                key={i}
                type="button"
                className={`ae-pt ${visiblePages.includes(i) && view !== 'all' ? 'on' : ''} ${dragOver === `page-${i}` ? 'over' : ''}`}
                onClick={() => { goPage(i); if (view === 'all') document.getElementById(`ae-page-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                draggable={!isMobile}
                onDragStart={(e) => { dragRef.current = { kind: 'page', i }; e.dataTransfer.setData('text/plain', 'page'); }}
                onDragOver={(e) => { if (dragRef.current?.kind === 'page') { e.preventDefault(); setDragOver(`page-${i}`); } }}
                onDrop={(e) => { e.preventDefault(); const d = dragRef.current; dragRef.current = null; setDragOver(null); if (d?.kind === 'page') reorderPage(d.i, i); }}
                onDragEnd={() => setDragOver(null)}
                title={`P${i + 1} · ${(pg?.slots || []).filter(Boolean).length}/${perPage}칸`}
              >
                <PageMini page={pg} perPage={perPage} cols={cols} cardsById={cardsById} />
                <span>P{i + 1}</span>
              </button>
            ))}
            <button type="button" className="ae-pt ae-addp" onClick={addPage} aria-label="페이지 추가"><span className="ae-plus">+</span><span>추가</span></button>
          </div>
        </nav>

        {/* 가운데: 바인더 */}
        <section className="ae-main" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {view !== 'all' && (
            <div className="ae-pager">
              <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={prev} disabled={spreadStart === 0} aria-label="이전 페이지">‹</button>
              <span><b>{pageLabel}</b> <em>/ {pages.length}</em></span>
              <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={next} disabled={lastPage >= pages.length - 1} aria-label="다음 페이지">›</button>
            </div>
          )}
          {view === 'all' ? (
            <div className="ae-all">
              {pages.map((_, i) => (
                <div key={i} id={`ae-page-${i}`} className="ae-all-item">
                  {binder([i])}
                </div>
              ))}
            </div>
          ) : (
            <div className="ae-stage">{binder(visiblePages, { editable: view !== 'book' })}</div>
          )}
        </section>

        {view !== 'book' && drawer}
        {isMobile && drawerOpen && <div className="ae-sheet-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      </div>

      {/* 아래쪽 요약·선택한 칸 */}
      {view !== 'book' && (
        <footer className="ae-status">
          {moving ? (
            <div className="ae-selinfo">
              <span>옮길 곳의 칸을 누르세요</span>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setMoving(null)}>취소</button>
            </div>
          ) : sel ? (
            <div className="ae-selinfo">
              <span className="ae-selname">P{sel.p + 1} · {sel.s + 1}번째{selName ? ` · ${selName}` : ' · 빈 칸'}</span>
              {selSlot && <button type="button" className="btn btn-secondary btn-compact" onClick={() => onOpenSlotCard(selSlot, sel.p, sel.s)}>카드 정보</button>}
              {selSlot && isMobile && <button type="button" className="btn btn-secondary btn-compact" onClick={() => { setMoving(sel); setSel(null); }}>옮기기</button>}
              {selSlot && <button type="button" className="btn btn-secondary btn-compact" onClick={() => clearSlot(sel.p, sel.s)}>빼기</button>}
              {!selSlot && isMobile && <button type="button" className="btn btn-primary btn-compact" onClick={() => setDrawerOpen(true)}>카드 고르기</button>}
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setSel(null)}>선택 해제</button>
            </div>
          ) : (
            <div className="ae-stats">
              <span>전체 <b>{stats.total}</b>칸</span>
              <span><i className="d o" />보유 <b>{stats.owned}</b></span>
              <span><i className="d m" />미보유 <b>{stats.missing}</b></span>
              <span><i className="d e" />빈 칸 <b>{stats.empty}</b></span>
            </div>
          )}
          {isMobile && !sel && !moving && <button type="button" className="btn btn-primary btn-compact ae-open-drawer" onClick={() => setDrawerOpen(true)}>＋ 카드 넣기</button>}
        </footer>
      )}

      {toast && <div className="ae-toast" role="status">{toast}</div>}

      {/* 내보내기용 (화면 밖에 페이지를 한 장씩 그려서 캡처) */}
      {exporting && (
        <div className="ae-export" aria-hidden="true">
          {pages.map((_, i) => (
            <div key={i} className="ae-export-page" style={{ '--alb-color': color }}>
              <p>{album.name} · P{i + 1}</p>
              {binder([i], { editable: false })}
            </div>
          ))}
        </div>
      )}
      {exporting && <div className="ae-toast" role="status">페이지를 그림으로 만드는 중…</div>}
    </div>
  );
}
