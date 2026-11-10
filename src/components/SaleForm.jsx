import React, { useState } from 'react';
import { SOLD_VIA_OPTIONS, todayStr } from '../utils/sales';

// 보유 기록 한 줄을 "판매완료"로 기록하는 작은 입력창
export default function SaleForm({ row, onSubmit, onCancel, busy = false }) {
  const max = Math.max(1, Number(row.count) || 1);
  const [qty, setQty] = useState(max);
  const [price, setPrice] = useState(row.askPrice ? String(row.askPrice) : '');
  const [date, setDate] = useState(todayStr());
  const [via, setVia] = useState(SOLD_VIA_OPTIONS[0]);
  const [note, setNote] = useState('');
  const [toMarket, setToMarket] = useState(true);

  const submit = (e) => {
    e.preventDefault();
    const p = Number(price);
    if (!p || p < 0) return;
    onSubmit({ qty: Math.min(Math.max(1, Number(qty) || 1), max), price: p, date, via, note: note.trim(), toMarket });
  };

  return (
    <form className="sale-form" onSubmit={submit}>
      <div className="sale-grid">
        {max > 1 && (
          <label>판매 수량
            <input type="number" min={1} max={max} value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        )}
        <label>판매 가격 (1장, 원)
          <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="원" required autoFocus />
        </label>
        <label>판매일
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>판매처
          <select value={via} onChange={(e) => setVia(e.target.value)}>
            {SOLD_VIA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="wide">메모
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 택배 거래, 구매자 닉네임" />
        </label>
      </div>
      <label className="sale-check">
        <input type="checkbox" checked={toMarket} onChange={(e) => setToMarket(e.target.checked)} />
        이 거래를 시세 기록에도 추가 (판매완료 매물로 남아요)
      </label>
      <div className="sale-actions">
        <button type="submit" className="btn btn-primary btn-compact" disabled={busy}>{busy ? '저장 중...' : '판매완료로 저장'}</button>
        <button type="button" className="btn btn-secondary btn-compact" onClick={onCancel} disabled={busy}>취소</button>
      </div>
    </form>
  );
}
