import { useCallback, useEffect, useRef, useState } from 'react';

// 카드 여러 장 고르기 (카드 탭·세트 상세의 "여러 장 선택")
// - toggle(id, shiftKey, orderIds): Shift를 누르고 누르면 앞서 누른 카드와의 사이를 한꺼번에 고른다
// - Esc 를 누르면 선택 모드를 끈다
export function useBulkSelect() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const lastRef = useRef(null);

  const stop = useCallback(() => { setActive(false); setSelected(new Set()); lastRef.current = null; }, []);
  const start = useCallback(() => setActive(true), []);
  const clear = useCallback(() => { setSelected(new Set()); lastRef.current = null; }, []);

  const toggle = useCallback((id, shiftKey = false, orderIds = []) => {
    const last = lastRef.current; // 상태 갱신 함수가 나중에 실행되므로 미리 읽어 둔다
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && last && last !== id) {
        const a = orderIds.indexOf(last);
        const b = orderIds.indexOf(id);
        if (a >= 0 && b >= 0) {
          const on = prev.has(last);
          orderIds.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (on ? next.add(x) : next.delete(x)));
          return next;
        }
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastRef.current = id;
  }, []);

  const selectAll = useCallback((ids) => setSelected(new Set(ids)), []);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // 열려 있는 창(카드 상세 등)이 있으면 그 창이 먼저 닫히게 둔다
      if (document.querySelector('.modal-backdrop, .bulk-dialog')) return;
      stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);

  return { active, start, stop, selected, toggle, selectAll, clear };
}
