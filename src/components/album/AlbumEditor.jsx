import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import CardThumbnail from '../CardThumbnail';
import { DEFAULT_RARITIES, DEFAULT_SETS, sortRarities, sortSets } from '../../utils/catalog';
import { ownedCount } from '../../utils/cardStats';
import { rarityTone } from '../../utils/rarityTone';
import { DEFAULT_ALBUM_COLOR, cardToSlot, slotImage, slotOwned } from './albumUtils';

const DRAWER_PAGE = 90;
const PER_ROW = { pc: { key: 'album_per_row_pc_v1', def: 2, max: 4, minW: 200 }, m: { key: 'album_per_row_m_v1', def: 1, max: 2, minW: 150 } };
const readLS = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그대로 */ } };
const norm = (v) => String(v ?? '').trim().toLowerCase();
const keyOf = (p, s) => `${p}-${s}`;
const parseKey = (k) => { const [p, s] = k.split('-').map(Number); return { p, s }; };
const clone = (v) => JSON.parse(JSON.stringify(v));

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

// 페이지 목록의 작은 미리보기: 보유=남색, 미보유=노랑, 빈 칸=연한 점선
function PageMini({ page, perPage, cols, cardsById }) {
  const slots = [...(page?.slots || [])].slice(0, perPage);
  while (slots.length < perPage) slots.push(null);
  return (
    <span className="ae-pmini" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {slots.map((s, i) => <i key={i} className={!s ? 'e' : slotOwned(s, cardsById) ? 'o' : 'm'} />)}
    </span>
  );
}

// 앨범 편집 화면 (페이지를 위아래로 이어서 보여주고, 한 줄에 몇 장 놓을지 고른다)
export default function AlbumEditor({
  album, cards, cardsById, catalog, apply, undo, redo, canUndo, canRedo, saveStatus,
  onClose, onRename, onOpenSlotCard, onOpenImport, onOpenBatch,
}) {
  const isMobile = useIsMobile();
  const cols = Math.max(1, Number(album.cols) || 3);
  const rows = Math.max(1, Number(album.rows) || 3);
  const perPage = cols * rows;
  const pages = useMemo(() => album.pages || [], [album.pages]);
  const tray = useMemo(() => (Array.isArray(album.tray) ? album.tray.filter(Boolean) : []), [album.tray]);
  const color = album.coverColor || DEFAULT_ALBUM_COLOR;
  const pr = isMobile ? PER_ROW.m : PER_ROW.pc;

  const [view, setView] = useState(() => (readLS('album_editor_view_v2', 'edit') === 'book' ? 'book' : 'edit'));
  const [perRowPc, setPerRowPc] = useState(() => Number(readLS(PER_ROW.pc.key, PER_ROW.pc.def)) || PER_ROW.pc.def);
  const [perRowM, setPerRowM] = useState(() => Number(readLS(PER_ROW.m.key, PER_ROW.m.def)) || PER_ROW.m.def);
  const perRow = Math.max(1, Math.min(pr.max, isMobile ? perRowM : perRowPc));
  const setPerRow = (n) => (isMobile ? setPerRowM(n) : setPerRowPc(n));
  const [fit, setFit] = useState(4); // 화면 폭에 들어가는 최대 장수
  const gridCols = Math.max(1, Math.min(perRow, fit));

  const [cur, setCur] = useState(0); // 지금 보고 있는 페이지
  const curPage = Math.max(0, Math.min(cur, pages.length - 1));
  const [selKeys, setSelKeys] = useState([]); // 고른 칸들 ('p-s'), 마지막이 기준 칸
  const [moving, setMoving] = useState(null); // 휴대폰: 옮길 칸 { p, s }
  const [trayPick, setTrayPick] = useState(null); // 보관함에서 고른 카드 번호
  const [menu, setMenu] = useState(null); // 'main' | 페이지 번호
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [sendTo, setSendTo] = useState('');
  const dragRef = useRef(null);
  const touchRef = useRef(null);
  const scrollRef = useRef(null);
  const anchorRef = useRef(null);

  const sel = selKeys.length ? parseKey(selKeys[selKeys.length - 1]) : null;
  const selSet = useMemo(() => new Set(selKeys), [selKeys]);

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

  useEffect(() => { writeLS('album_editor_view_v2', view); }, [view]);
  useEffect(() => { writeLS(PER_ROW.pc.key, String(perRowPc)); }, [perRowPc]);
  useEffect(() => { writeLS(PER_ROW.m.key, String(perRowM)); }, [perRowM]);
  useEffect(() => { writeLS(`album_drawer_set_${album.id}`, setFilter); }, [setFilter, album.id]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // 화면 폭에 들어가는 만큼만 한 줄에 놓는다
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const gap = isMobile ? 10 : 18;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setFit(Math.max(1, Math.floor((w + gap) / (pr.minW + gap))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, pr.minW, view]);

  // 스크롤하면 지금 보고 있는 페이지를 페이지 목록에 표시
  useEffect(() => {
    if (view !== 'edit' || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => seen.set(Number(en.target.dataset.page), en.isIntersecting));
      const visible = [...seen.entries()].filter(([, v]) => v).map(([k]) => k).sort((a, b) => a - b);
      if (visible.length) setCur(visible[0]);
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.ae-scroll [data-page]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [view, pages.length, gridCols]);

  const scrollToPage = (p) => {
    setCur(p);
    if (view === 'edit') document.getElementById(`ae-p-${p}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── 통계 (보유는 지금 내 컬렉션 기준)
  const pageStat = (pg) => {
    const slots = pg?.slots || [];
    let placed = 0; let owned = 0;
    slots.forEach((s) => { if (s) { placed += 1; if (slotOwned(s, cardsById)) owned += 1; } });
    return { placed, owned };
  };
  const stats = useMemo(() => {
    let placed = 0; let owned = 0;
    pages.forEach((pg) => (pg?.slots || []).forEach((s) => { if (s) { placed += 1; if (slotOwned(s, cardsById)) owned += 1; } }));
    const total = pages.length * perPage;
    return { total, placed, owned, missing: placed - owned, empty: total - placed };
  }, [pages, perPage, cardsById]);
  const placedIds = useMemo(() => {
    const set = new Set();
    pages.forEach((pg) => (pg?.slots || []).forEach((s) => { if (s?.cardId) set.add(s.cardId); }));
    tray.forEach((s) => { if (s?.cardId) set.add(s.cardId); });
    return set;
  }, [pages, tray]);

  // ── 편집 동작
  const slotAt = (p, s) => pages[p]?.slots?.[s] || null;
  const nextEmpty = useCallback((fromP, fromS) => {
    for (let p = fromP; p < pages.length; p += 1) {
      const slots = pages[p]?.slots || [];
      for (let s = p === fromP ? fromS : 0; s < perPage; s += 1) if (!slots[s]) return { p, s };
    }
    return null;
  }, [pages, perPage]);
  const clearSelection = () => { setSelKeys([]); anchorRef.current = null; };

  // draft 안에서: start 칸부터 빈 칸을 찾아 slot들을 차례로 넣는다 (모자라면 페이지 추가)
  const fillInto = (draft, list, start, replaceFirst = false) => {
    let p = start?.p ?? 0;
    let s = start?.s ?? 0;
    let added = 0;
    let last = null;
    const ensure = (pi) => { while (draft.pages.length <= pi) { draft.pages.push(emptyPage(perPage)); added += 1; } };
    list.forEach((slot, i) => {
      if (!(i === 0 && replaceFirst)) {
        for (;;) {
          ensure(p);
          if (s >= perPage) { p += 1; s = 0; continue; }
          if (!draft.pages[p].slots[s]) break;
          s += 1;
        }
      }
      ensure(p);
      while (draft.pages[p].slots.length < perPage) draft.pages[p].slots.push(null);
      draft.pages[p].slots[s] = slot;
      last = { p, s };
      s += 1;
    });
    return { added, last };
  };

  const placeCards = (list, target) => {
    if (!list.length) return null;
    let res = null;
    apply((draft) => { res = fillInto(draft, list.map(cardToSlot), target || { p: curPage, s: 0 }, !!target); return draft; });
    if (res?.added) setToast(`칸이 모자라서 페이지 ${res.added}장을 늘렸어요`);
    return res?.last || null;
  };

  const placeOne = (card) => {
    const target = sel || nextEmpty(curPage, 0);
    const last = placeCards([card], target || null);
    if (!last) return;
    const after = nextEmpty(last.p, last.s + 1);
    setSelKeys(after && after.p <= last.p + 1 ? [keyOf(after.p, after.s)] : []);
  };

  const removeKeys = (keys) => {
    const list = keys.filter((k) => { const { p, s } = parseKey(k); return slotAt(p, s); });
    if (!list.length) return;
    apply((draft) => { list.forEach((k) => { const { p, s } = parseKey(k); draft.pages[p].slots[s] = null; }); return draft; });
    clearSelection();
    setToast(`${list.length}장을 칸에서 뺐어요 · 되돌리기 Ctrl+Z`);
  };

  // 한 칸을 다른 칸으로 (다른 카드가 있으면 서로 바꾼다)
  const swapSlot = (from, to) => {
    if (!from || !to || (from.p === to.p && from.s === to.s)) return;
    apply((draft) => {
      const a = draft.pages[from.p]?.slots; const b = draft.pages[to.p]?.slots;
      if (!a || !b || !a[from.s]) return draft;
      const card = a[from.s];
      a[from.s] = b[to.s] || null;
      b[to.s] = card;
      return draft;
    });
    setSelKeys([keyOf(to.p, to.s)]);
  };

  // 여러 칸을 target 칸부터 빈 칸에 차례로 옮긴다
  const moveKeys = (keys, target, label) => {
    const list = keys.map(parseKey).filter(({ p, s }) => slotAt(p, s)).sort((a, b) => a.p - b.p || a.s - b.s);
    if (!list.length) return;
    if (list.length === 1 && target.s !== undefined && !label) { swapSlot(list[0], target); return; }
    let res = null;
    apply((draft) => {
      const moved = list.map(({ p, s }) => { const c = draft.pages[p].slots[s]; draft.pages[p].slots[s] = null; return c; });
      res = fillInto(draft, moved, { p: target.p, s: target.s ?? 0 });
      return draft;
    });
    clearSelection();
    setToast(`${list.length}장을 ${label || `P${target.p + 1}`}(으)로 옮겼어요${res?.added ? ` · 페이지 ${res.added}장 추가` : ''}`);
  };

  // 보관함: 칸에서 빼서 잠깐 담아 두고, 다른 페이지 빈 칸에 넣는다
  const toTray = (keys) => {
    const list = keys.map(parseKey).filter(({ p, s }) => slotAt(p, s)).sort((a, b) => a.p - b.p || a.s - b.s);
    if (!list.length) return;
    apply((draft) => {
      draft.tray = Array.isArray(draft.tray) ? draft.tray.filter(Boolean) : [];
      list.forEach(({ p, s }) => { draft.tray.push(draft.pages[p].slots[s]); draft.pages[p].slots[s] = null; });
      return draft;
    });
    clearSelection();
    setTrayPick(0);
    setToast(`보관함에 ${list.length}장 담았어요. 넣을 빈 칸을 누르세요`);
  };
  const placeFromTray = (i, target) => {
    if (!tray[i]) return;
    apply((draft) => {
      const t = draft.tray.filter(Boolean);
      const [card] = t.splice(i, 1);
      const old = draft.pages[target.p].slots[target.s];
      if (old) t.splice(i, 0, old); // 카드가 있던 칸이면 그 카드는 보관함으로
      draft.pages[target.p].slots[target.s] = card;
      draft.tray = t;
      return draft;
    });
    const left = tray.length - (slotAt(target.p, target.s) ? 0 : 1);
    setTrayPick(left > 0 ? Math.min(i, left - 1) : null);
  };
  const trayAll = () => {
    if (!tray.length) return;
    let res = null;
    apply((draft) => { res = fillInto(draft, draft.tray.filter(Boolean), { p: curPage, s: 0 }); draft.tray = []; return draft; });
    setTrayPick(null);
    setToast(`보관함 카드를 P${curPage + 1}부터 빈 칸에 넣었어요${res?.added ? ` · 페이지 ${res.added}장 추가` : ''}`);
  };
  const trayRemove = (i) => {
    apply((draft) => { draft.tray = draft.tray.filter(Boolean).filter((_, j) => j !== i); return draft; });
    setTrayPick(null);
    setToast('보관함에서 뺐어요 (앨범에서 빠져요) · 되돌리기 Ctrl+Z');
  };

  // ── 페이지
  const insertPage = (at) => {
    apply((draft) => { draft.pages.splice(at, 0, emptyPage(perPage)); return draft; });
    setTimeout(() => scrollToPage(at), 60);
  };
  const duplicatePage = (p) => { apply((draft) => { draft.pages.splice(p + 1, 0, clone(draft.pages[p])); return draft; }); };
  const clearPage = (p) => {
    const n = pageStat(pages[p]).placed;
    if (!n) return;
    apply((draft) => { draft.pages[p].slots = draft.pages[p].slots.map(() => null); return draft; });
    setToast(`P${p + 1}을(를) 비웠어요 · 되돌리기 Ctrl+Z`);
  };
  const deletePage = (p) => {
    if (pages.length <= 1) { setToast('페이지는 한 장 이상 있어야 해요'); return; }
    const filled = pageStat(pages[p]).placed;
    if (filled && !window.confirm(`P${p + 1}에 카드 ${filled}장이 있어요. 페이지를 지울까요?\n(바로 뒤에 Ctrl+Z로 되돌릴 수 있어요)`)) return;
    apply((draft) => { draft.pages.splice(p, 1); return draft; });
    clearSelection();
  };
  const reorderPage = (from, to) => {
    if (from === to || to < 0 || to >= pages.length) return;
    apply((draft) => { const [pg] = draft.pages.splice(from, 1); draft.pages.splice(to, 0, pg); return draft; });
    clearSelection();
    setTimeout(() => scrollToPage(to), 60);
  };

  // ── 정리: 빈 칸 당기기 / 번호순 정렬
  const compact = () => {
    apply((draft) => {
      const all = draft.pages.flatMap((pg) => pg.slots).filter(Boolean);
      draft.pages = draft.pages.map(() => emptyPage(perPage));
      fillInto(draft, all, { p: 0, s: 0 });
      return draft;
    });
    clearSelection();
    setToast('빈 칸을 당겨서 앞으로 모았어요 · 되돌리기 Ctrl+Z');
  };
  const sortByNumber = () => {
    const order = new Map(sortSets(catalog?.sets || DEFAULT_SETS).map((x, i) => [x.code, i]));
    const keyFor = (s) => {
      const c = s?.cardId ? cardsById.get(s.cardId) : null;
      return [order.get(c?.setCode) ?? 9999, Number(c?.cardNo) || 9999, String(c?.cardName || s?.cardName || '')];
    };
    apply((draft) => {
      const all = draft.pages.flatMap((pg) => pg.slots).filter(Boolean)
        .map((s) => ({ s, k: keyFor(s) }))
        .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2].localeCompare(b.k[2], 'ko'))
        .map((x) => x.s);
      draft.pages = draft.pages.map(() => emptyPage(perPage));
      fillInto(draft, all, { p: 0, s: 0 });
      return draft;
    });
    clearSelection();
    setToast('세트·카드 번호 순서로 정렬했어요 · 되돌리기 Ctrl+Z');
  };

  // ── 칸 누르기
  const linear = (k) => { const { p, s } = parseKey(k); return p * perPage + s; };
  const onPocket = (p, s, e) => {
    if (view === 'book') return;
    const k = keyOf(p, s);
    if (moving) { swapSlot(moving, { p, s }); setMoving(null); return; }
    if (trayPick !== null && tray[trayPick] && !e?.ctrlKey && !e?.metaKey && !e?.shiftKey) { placeFromTray(trayPick, { p, s }); return; }
    if ((e?.ctrlKey || e?.metaKey) && slotAt(p, s)) {
      setSelKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
      anchorRef.current = k;
      return;
    }
    if (e?.shiftKey && anchorRef.current) {
      const a = linear(anchorRef.current); const b = p * perPage + s;
      const out = [];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) {
        const pp = Math.floor(i / perPage); const ss = i % perPage;
        if (slotAt(pp, ss)) out.push(keyOf(pp, ss));
      }
      setSelKeys(out);
      return;
    }
    const same = selKeys.length === 1 && selKeys[0] === k;
    setSelKeys(same ? [] : [k]);
    anchorRef.current = same ? null : k;
    if (isMobile && !same && !slotAt(p, s)) setDrawerOpen(true);
  };

  // ── 키보드
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (document.querySelector('.modal-backdrop, .alb-dialog-wrap')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape') { clearSelection(); setMoving(null); setMenu(null); setTrayPick(null); return; }
      if (view === 'book') {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); bookGo(1); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); bookGo(-1); }
        return;
      }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeKeys(selKeys); return; }
      if (e.key === 'Enter' && slotAt(sel.p, sel.s)) { e.preventDefault(); onOpenSlotCard(slotAt(sel.p, sel.s), sel.p, sel.s); return; }
      let { p, s } = sel;
      if (e.key === 'ArrowRight') { s += 1; if (s >= perPage) { s = 0; p += 1; } } else if (e.key === 'ArrowLeft') { s -= 1; if (s < 0) { s = perPage - 1; p -= 1; } } else if (e.key === 'ArrowDown') { s += cols; if (s >= perPage) { s %= cols; p += 1; } } else if (e.key === 'ArrowUp') { s -= cols; if (s < 0) { s += perPage; p -= 1; } } else return;
      e.preventDefault();
      if (p < 0 || p >= pages.length) return;
      setSelKeys([keyOf(p, s)]);
      anchorRef.current = keyOf(p, s);
      document.querySelector(`[data-key="${keyOf(p, s)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── 넘겨보기
  const bookN = isMobile ? 1 : 2;
  const bookStart = isMobile ? curPage : Math.floor(curPage / 2) * 2;
  const bookPages = [];
  for (let i = bookStart; i < Math.min(pages.length, bookStart + bookN); i += 1) bookPages.push(i);
  const bookGo = (d) => setCur(Math.max(0, Math.min(pages.length - 1, bookStart + d * bookN)));
  const onTouchStart = (e) => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const st = touchRef.current; touchRef.current = null;
    if (!st || view !== 'book') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - st.x; const dy = t.clientY - st.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) bookGo(dx < 0 ? 1 : -1);
  };

  // ── 끌어다 놓기 (PC)
  const dragStartSlot = (e, p, s) => {
    const k = keyOf(p, s);
    const keys = selSet.has(k) && selKeys.length > 1 ? selKeys : [k];
    dragRef.current = { kind: 'slots', keys };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'slot');
  };
  const dragStartCard = (e, card) => { dragRef.current = { kind: 'card', card }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'card'); };
  const dragStartTray = (e, i) => { dragRef.current = { kind: 'tray', i }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'tray'); };
  const endDrag = () => { dragRef.current = null; setDragOver(null); };
  const dropOnPocket = (e, p, s) => {
    e.preventDefault();
    const d = dragRef.current; endDrag();
    if (!d) return;
    if (d.kind === 'slots') moveKeys(d.keys, { p, s });
    if (d.kind === 'card') { placeCards([d.card], { p, s }); setSelKeys([keyOf(p, s)]); }
    if (d.kind === 'tray') placeFromTray(d.i, { p, s });
  };
  const dropOnRail = (e, i) => {
    e.preventDefault();
    const d = dragRef.current; endDrag();
    if (!d) return;
    if (d.kind === 'page') { reorderPage(d.i, i); return; }
    if (d.kind === 'slots') moveKeys(d.keys, { p: i }, `P${i + 1}`);
    if (d.kind === 'card') { const last = placeCards([d.card], nextEmpty(i, 0) && nextEmpty(i, 0).p === i ? nextEmpty(i, 0) : null); if (last) setToast(`P${last.p + 1}에 넣었어요`); }
    if (d.kind === 'tray') {
      const t = nextEmpty(i, 0);
      if (t && t.p === i) placeFromTray(d.i, t); else setToast(`P${i + 1}에 빈 칸이 없어요`);
    }
  };
  // 끌고 있는 동안 화면 위·아래 끝에 가면 자동으로 스크롤
  const onMainDragOver = (e) => {
    if (!dragRef.current) return;
    const el = isMobile ? null : scrollRef.current;
    const rect = el ? el.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const edge = 70;
    let dy = 0;
    if (e.clientY < rect.top + edge) dy = -18;
    else if (e.clientY > rect.bottom - edge) dy = 18;
    if (dy) { if (el) el.scrollBy(0, dy); else window.scrollBy(0, dy); }
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
    clearSelection();
  };

  // ── 내보내기 (페이지마다 그림으로 캡처)
  const exportAlbum = async (format) => {
    setMenu(null);
    setExporting(true);
    await new Promise((r) => setTimeout(r, 900));
    try {
      const nodes = [...document.querySelectorAll('.ae-export .ae-export-page')];
      if (!nodes.length) throw new Error('내보낼 페이지가 없어요');
      const shots = [];
      for (const node of nodes) {
        shots.push(await html2canvas(node, { scale: 1.5, useCORS: true, backgroundColor: '#f7f7f5' }));
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
  const pocket = (p, s, editable) => {
    const slot = slotAt(p, s);
    const k = keyOf(p, s);
    const isSel = selSet.has(k);
    const num = p * perPage + s + 1;
    const owned = slot && slotOwned(slot, cardsById);
    const common = {
      key: k,
      'data-key': k,
      className: `ae-pocket ${slot ? '' : 'empty'} ${slot && !owned ? 'miss' : ''} ${isSel ? 'sel' : ''} ${moving && moving.p === p && moving.s === s ? 'moving' : ''} ${dragOver === k ? 'over' : ''} ${trayPick !== null && editable ? 'target' : ''}`,
      onClick: editable ? (e) => onPocket(p, s, e) : undefined,
      onDoubleClick: editable && slot ? () => onOpenSlotCard(slot, p, s) : undefined,
      onDragOver: editable ? (e) => { e.preventDefault(); if (dragOver !== k) setDragOver(k); } : undefined,
      onDragLeave: editable ? () => setDragOver((v) => (v === k ? null : v)) : undefined,
      onDrop: editable ? (e) => dropOnPocket(e, p, s) : undefined,
      role: editable ? 'button' : undefined,
      tabIndex: editable ? 0 : undefined,
      'aria-pressed': editable ? isSel : undefined,
      'aria-label': slot ? `${num}번 칸: ${cardsById.get(slot.cardId)?.cardName || slot.cardName || '카드'}${owned ? '' : ' (미보유)'}` : `${num}번 빈 칸`,
    };
    if (!slot) return <div {...common}>{editable && <span className="ae-plus" aria-hidden="true">+</span>}</div>;
    const img = slotImage(slot, cardsById);
    return (
      <div {...common} draggable={editable && !isMobile} onDragStart={(e) => dragStartSlot(e, p, s)} onDragEnd={endDrag}>
        {img ? <CardThumbnail imageUrl={img} alt="" type="grid" /> : <span className="ae-noimg">{slot.cardName || '사진 없음'}</span>}
        {!owned && <em className="ae-tag">미보유</em>}
        {isSel && selKeys.length > 1 && <span className="ae-check" aria-hidden="true">✓</span>}
      </div>
    );
  };

  const pageMenu = (p) => (
    <div className="ae-pmenu-wrap">
      <button type="button" className="ae-pmore" aria-label={`P${p + 1} 메뉴`} aria-haspopup="menu" aria-expanded={menu === p} onClick={() => setMenu(menu === p ? null : p)}>⋯</button>
      {menu === p && (
        <>
          <div className="alb-menu-backdrop ae-menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
          <div className="alb-menu ae-menu ae-pmenu" role="menu">
            <p className="alb-menu-title">P{p + 1}</p>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); insertPage(p + 1); }}>뒤에 새 페이지 넣기</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); duplicatePage(p); }}>페이지 복제</button>
            <button type="button" role="menuitem" disabled={p === 0} onClick={() => { setMenu(null); reorderPage(p, p - 1); }}>앞으로 옮기기</button>
            <button type="button" role="menuitem" disabled={p === pages.length - 1} onClick={() => { setMenu(null); reorderPage(p, p + 1); }}>뒤로 옮기기</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(null); clearPage(p); }}>페이지 비우기</button>
            <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); deletePage(p); }}>페이지 삭제</button>
          </div>
        </>
      )}
    </div>
  );

  const sheet = (p, editable = true) => {
    const st = pageStat(pages[p]);
    return (
      <section key={p} id={editable ? `ae-p-${p}` : undefined} data-page={editable ? p : undefined} className={`ae-sheet ${curPage === p && view === 'edit' ? 'cur' : ''}`} style={{ '--alb-color': color }}>
        <header className="ae-sh">
          <b>P{p + 1}</b>
          <span>{st.placed}/{perPage}칸 · 보유 {st.owned}</span>
          {editable && pageMenu(p)}
        </header>
        <div className="ae-g" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: perPage }, (_, s) => pocket(p, s, editable))}
        </div>
      </section>
    );
  };

  const selSlot = sel ? slotAt(sel.p, sel.s) : null;
  const selName = selSlot ? (cardsById.get(selSlot.cardId)?.cardName || selSlot.cardName) : '';
  const selFilled = selKeys.filter((k) => { const { p, s } = parseKey(k); return slotAt(p, s); });
  const dense = gridCols >= (isMobile ? 2 : 3);

  const drawer = (
    <aside className={`ae-drawer ${drawerOpen ? 'open' : ''}`} aria-label="카드 넣기">
      <div className="ae-drawer-head">
        <div className="ae-drawer-title">
          <h3>카드 넣기</h3>
          {isMobile && <button type="button" className="alb-x" onClick={() => setDrawerOpen(false)} aria-label="닫기">✕</button>}
        </div>
        <p className="ae-hint">
          {sel ? `P${sel.p + 1} · ${sel.s + 1}번째 칸에 넣어요` : `칸을 고르고 카드를 누르세요. 안 고르면 P${curPage + 1}부터 빈 칸에 차례로 들어가요.`}
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
                onDragEnd={endDrag}
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
    <div className={`ae ${view === 'book' ? 'is-book' : ''}`} style={{ '--alb-color': color }}>
      {/* 위쪽 막대 */}
      <header className="ae-top">
        <div className="ae-top-row">
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
        </div>
        <div className="ae-top-tools">
          <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">↶</button>
          <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">↷</button>
          {view === 'edit' && (
            <div className="seg ae-perrow" role="group" aria-label="한 줄에 놓을 페이지 수">
              <span className="ae-seg-label">한 줄에</span>
              {Array.from({ length: pr.max }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" className={perRow === n ? 'on' : ''} aria-pressed={perRow === n} onClick={() => setPerRow(n)} title={n > fit ? '화면이 좁아서 들어가는 만큼만 놓여요' : `한 줄에 ${n}장`}>{n}</button>
              ))}
            </div>
          )}
          <span className="ae-sp" />
          <div className="seg ae-views" role="tablist" aria-label="보기 방식">
            {[['edit', '편집'], ['book', '넘겨보기']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => { setView(k); clearSelection(); setMoving(null); }}>{l}</button>
            ))}
          </div>
          <div className="ae-menu-wrap">
            <button type="button" className="btn btn-secondary btn-compact ae-icon" aria-haspopup="menu" aria-expanded={menu === 'main'} aria-label="더 보기" onClick={() => setMenu(menu === 'main' ? null : 'main')}>⋯</button>
            {menu === 'main' && (
              <>
                <div className="alb-menu-backdrop ae-menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
                <div className="alb-menu ae-menu" role="menu">
                  <p className="alb-menu-title">{album.name}</p>
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); insertPage(pages.length); }}>맨 뒤에 페이지 추가</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); compact(); }}>빈 칸 당기기</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); sortByNumber(); }}>번호순 정렬</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); onOpenImport(); }}>다른 앨범에서 페이지 가져오기</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); onOpenBatch(); }}>카드 화면에서 여러 장 고르기</button>
                  <button type="button" role="menuitem" onClick={() => exportAlbum('pdf')}>PDF로 저장</button>
                  <button type="button" role="menuitem" onClick={() => exportAlbum('zip')}>페이지 사진(ZIP)으로 저장</button>
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
            {pages.map((pg, i) => {
              const st = pageStat(pg);
              const on = view === 'book' ? bookPages.includes(i) : curPage === i;
              return (
                <button
                  key={i}
                  type="button"
                  className={`ae-pt ${on ? 'on' : ''} ${dragOver === `page-${i}` ? 'over' : ''}`}
                  onClick={() => scrollToPage(i)}
                  draggable={!isMobile}
                  onDragStart={(e) => { dragRef.current = { kind: 'page', i }; e.dataTransfer.setData('text/plain', 'page'); }}
                  onDragOver={(e) => { if (dragRef.current) { e.preventDefault(); setDragOver(`page-${i}`); } }}
                  onDragLeave={() => setDragOver((v) => (v === `page-${i}` ? null : v))}
                  onDrop={(e) => dropOnRail(e, i)}
                  onDragEnd={endDrag}
                  title={`P${i + 1} · ${st.placed}/${perPage}칸 · 보유 ${st.owned}`}
                >
                  <PageMini page={pg} perPage={perPage} cols={cols} cardsById={cardsById} />
                  <span className="ae-pt-label">P{i + 1} <em>{st.owned}/{st.placed || 0}</em></span>
                </button>
              );
            })}
            <button type="button" className="ae-pt ae-addp" onClick={() => insertPage(pages.length)} aria-label="페이지 추가"><span className="ae-plus">+</span><span>추가</span></button>
          </div>
          <div className="ae-legend" aria-hidden="true"><span><i className="o" />보유</span><span><i className="m" />미보유</span><span><i className="e" />빈 칸</span></div>
        </nav>

        {/* 가운데: 페이지들 */}
        <section className="ae-main" onDragOver={onMainDragOver} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {view === 'edit' ? (
            <div className={`ae-scroll ${dense ? 'dense' : ''}`} ref={scrollRef} style={{ '--gcols': gridCols }}>
              <div className="ae-grid">
                {pages.map((_, i) => sheet(i))}
                <button type="button" className="ae-addrow" onClick={() => insertPage(pages.length)}>+ 페이지 추가</button>
              </div>
            </div>
          ) : (
            <div className="ae-book" ref={scrollRef}>
              <div className="ae-pager">
                <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={() => bookGo(-1)} disabled={bookStart === 0} aria-label="이전 페이지">‹</button>
                <span><b>{bookPages.length > 1 ? `P${bookPages[0] + 1} – P${bookPages[bookPages.length - 1] + 1}` : `P${(bookPages[0] ?? 0) + 1}`}</b> <em>/ {pages.length}</em></span>
                <button type="button" className="btn btn-secondary btn-compact ae-icon" onClick={() => bookGo(1)} disabled={(bookPages[bookPages.length - 1] ?? 0) >= pages.length - 1} aria-label="다음 페이지">›</button>
              </div>
              <div className="ae-book-spread" style={{ '--gcols': bookN }}>{bookPages.map((i) => sheet(i, false))}</div>
            </div>
          )}

          {/* 아래: 보관함 + 요약/선택 */}
          {view === 'edit' && (
            <div className="ae-bottom">
              {tray.length > 0 && (
                <div className="ae-tray" aria-label="보관함">
                  <div className="ae-tray-head">
                    <b>보관함 {tray.length}장</b>
                    <span className="ae-hint">{trayPick !== null ? '넣을 칸을 누르세요 (카드가 있으면 서로 바꿔요)' : '카드를 고르고 칸을 누르세요'}</span>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={trayAll}>모두 P{curPage + 1}부터 빈 칸에</button>
                  </div>
                  <div className="ae-tray-row">
                    {tray.map((t, i) => (
                      <div key={`${t.cardId || t.cardName}-${i}`} className={`ae-tray-item ${trayPick === i ? 'on' : ''}`}>
                        <button type="button" className="ae-tray-card" onClick={() => setTrayPick(trayPick === i ? null : i)} draggable={!isMobile} onDragStart={(e) => dragStartTray(e, i)} onDragEnd={endDrag} aria-pressed={trayPick === i} title={cardsById.get(t.cardId)?.cardName || t.cardName}>
                          <CardThumbnail imageUrl={slotImage(t, cardsById)} alt="" type="grid" />
                        </button>
                        <button type="button" className="ae-tray-x" onClick={() => trayRemove(i)} aria-label="보관함에서 빼기">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <footer className="ae-status">
                {moving ? (
                  <div className="ae-selinfo">
                    <span>옮길 곳의 칸을 누르세요</span>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => setMoving(null)}>취소</button>
                  </div>
                ) : selKeys.length ? (
                  <div className="ae-selinfo">
                    <span className="ae-selname">{selKeys.length > 1 ? `${selKeys.length}장 선택` : `P${sel.p + 1} · ${sel.s + 1}번째${selName ? ` · ${selName}` : ' · 빈 칸'}`}</span>
                    {selKeys.length === 1 && selSlot && <button type="button" className="btn btn-secondary btn-compact" onClick={() => onOpenSlotCard(selSlot, sel.p, sel.s)}>카드 정보</button>}
                    {selKeys.length === 1 && selSlot && isMobile && <button type="button" className="btn btn-secondary btn-compact" onClick={() => { setMoving(sel); clearSelection(); }}>옮기기</button>}
                    {selFilled.length > 0 && <button type="button" className="btn btn-secondary btn-compact" onClick={() => toTray(selFilled)}>보관함에 담기</button>}
                    {selFilled.length > 0 && (
                      <select
                        className="select ae-sendto"
                        value={sendTo}
                        aria-label="다른 페이지로 보내기"
                        onChange={(e) => { const v = e.target.value; setSendTo(''); if (v !== '') moveKeys(selFilled, { p: Number(v) }, `P${Number(v) + 1}`); }}
                      >
                        <option value="">페이지로 보내기…</option>
                        {pages.map((_, i) => <option key={i} value={i}>P{i + 1} (빈 칸 {perPage - pageStat(pages[i]).placed})</option>)}
                      </select>
                    )}
                    {selFilled.length > 0 && <button type="button" className="btn btn-secondary btn-compact" onClick={() => removeKeys(selFilled)}>빼기</button>}
                    {selKeys.length === 1 && !selSlot && isMobile && <button type="button" className="btn btn-primary btn-compact" onClick={() => setDrawerOpen(true)}>카드 고르기</button>}
                    <button type="button" className="btn btn-secondary btn-compact" onClick={clearSelection}>선택 해제</button>
                  </div>
                ) : (
                  <div className="ae-stats">
                    <span>전체 <b>{stats.total}</b>칸</span>
                    <span><i className="d o" />보유 <b>{stats.owned}</b></span>
                    <span><i className="d m" />미보유 <b>{stats.missing}</b></span>
                    <span><i className="d e" />빈 칸 <b>{stats.empty}</b></span>
                    {!isMobile && <span className="ae-tip">Ctrl·Shift로 여러 장 고르기</span>}
                  </div>
                )}
                {isMobile && !selKeys.length && !moving && <button type="button" className="btn btn-primary btn-compact ae-open-drawer" onClick={() => setDrawerOpen(true)}>＋ 카드 넣기</button>}
              </footer>
            </div>
          )}
        </section>

        {view === 'edit' && drawer}
        {isMobile && drawerOpen && view === 'edit' && <div className="ae-sheet-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      </div>

      {toast && <div className="ae-toast" role="status">{toast}</div>}

      {/* 내보내기용 (화면 밖에 페이지를 한 장씩 그려서 캡처) */}
      {exporting && (
        <div className="ae-export" aria-hidden="true">
          {pages.map((_, i) => (
            <div key={i} className="ae-export-page">
              <p>{album.name} · P{i + 1}</p>
              {sheet(i, false)}
            </div>
          ))}
        </div>
      )}
      {exporting && <div className="ae-toast" role="status">페이지를 그림으로 만드는 중…</div>}
    </div>
  );
}
