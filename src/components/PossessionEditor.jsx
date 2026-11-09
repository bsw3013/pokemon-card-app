import React from 'react';
import { CONDITION_OPTIONS } from '../utils/cardStats';

const LANGS = ['한국', '일본', '미국', '중국'];

function newRow(defaultLanguage) {
  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    count: 1,
    condition: '민트',
    language: defaultLanguage || '한국',
    company: '',
    grade: '',
    serial: '',
    purchasePrice: '',
    purchaseDate: '',
    location: '',
    forTrade: false,
    notes: '',
  };
}

// 보유 기록 편집: "한 장(또는 같은 조건 묶음) = 한 줄"
export default function PossessionEditor({ rows, onChange, gradingCompanies = [], gradingScale = [], defaultLanguage }) {
  const update = (index, field, value) => {
    const next = rows.slice();
    next[index] = { ...next[index], [field]: value };
    if (field === 'company' && (value === '' || value === 'raw')) { next[index].grade = ''; next[index].serial = ''; }
    onChange(next);
  };
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));
  const add = () => onChange([...rows, newRow(defaultLanguage)]);
  const total = rows.reduce((sum, r) => sum + (Number(r.count) || 0), 0);

  return (
    <div className="pe">
      <div className="pe-head">
        <span>보유 기록 {rows.length > 0 && <em>{rows.length}줄 · 총 {total}장</em>}</span>
        <small>같은 조건의 카드는 한 줄에 수량으로, 조건이 다르면 줄을 나눠 적어요.</small>
      </div>
      {rows.map((r, i) => {
        const graded = r.company && r.company !== 'raw';
        return (
          <div key={r.id || i} className="pe-row">
            <div className="pe-grid">
              <label className="pe-f pe-count">수량
                <input type="number" min={1} value={r.count ?? 1} onChange={(e) => update(i, 'count', Math.max(0, parseInt(e.target.value || '0', 10)))} />
              </label>
              <label className="pe-f">등급
                <select value={r.company || ''} onChange={(e) => update(i, 'company', e.target.value)}>
                  <option value="">무등급</option>
                  {gradingCompanies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              {graded ? (
                <>
                  <label className="pe-f pe-small">점수
                    <select value={r.grade || ''} onChange={(e) => update(i, 'grade', e.target.value)}>
                      <option value="">선택</option>
                      {gradingScale.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                  <label className="pe-f">인증 번호
                    <input type="text" value={r.serial || ''} onChange={(e) => update(i, 'serial', e.target.value)} placeholder="슬랩 번호" />
                  </label>
                </>
              ) : (
                <label className="pe-f">상태
                  <select value={r.condition || ''} onChange={(e) => update(i, 'condition', e.target.value)}>
                    <option value="">선택</option>
                    {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              <label className="pe-f pe-small">언어
                <select value={r.language || defaultLanguage || '한국'} onChange={(e) => update(i, 'language', e.target.value)}>
                  {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="pe-f">구매가 (1장)
                <input type="number" min={0} value={r.purchasePrice ?? ''} onChange={(e) => update(i, 'purchasePrice', e.target.value === '' ? '' : Number(e.target.value))} placeholder="원" />
              </label>
              <label className="pe-f">구매일
                <input type="date" value={r.purchaseDate || ''} onChange={(e) => update(i, 'purchaseDate', e.target.value)} />
              </label>
              <label className="pe-f">보관 위치
                <input type="text" value={r.location || ''} onChange={(e) => update(i, 'location', e.target.value)} placeholder="예: 바인더 A 3쪽" />
              </label>
              <label className="pe-f pe-wide">메모
                <input type="text" value={r.notes || ''} onChange={(e) => update(i, 'notes', e.target.value)} />
              </label>
            </div>
            <div className="pe-row-foot">
              <label className="pe-check">
                <input type="checkbox" checked={!!r.forTrade} onChange={(e) => update(i, 'forTrade', e.target.checked)} />
                판매·교환 가능
              </label>
              <button type="button" className="btn btn-compact btn-danger" onClick={() => remove(i)}>이 줄 지우기</button>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-secondary" onClick={add}>보유 기록 추가</button>
    </div>
  );
}
