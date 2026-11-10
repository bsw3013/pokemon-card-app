import React from 'react';
import { CONDITION_OPTIONS } from '../utils/cardStats';

const LANGS = ['한국', '일본', '미국', '중국'];

function newRow(defaultLanguage, company = '') {
  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    count: 1,
    condition: company ? '' : '민트',
    language: defaultLanguage || '한국',
    company,
    grade: '',
    serial: '',
    purchasePrice: '',
    purchaseDate: '',
    location: '',
    forTrade: false,
    askPrice: '',
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
  const firstCompany = gradingCompanies[0] || 'PSA';
  const add = (company = '') => onChange([...rows, newRow(defaultLanguage, company)]);
  const setType = (index, graded) => {
    const next = rows.slice();
    next[index] = graded
      ? { ...next[index], company: next[index].company && next[index].company !== 'raw' ? next[index].company : firstCompany }
      : { ...next[index], company: '', grade: '', serial: '', condition: next[index].condition || '민트' };
    onChange(next);
  };
  // 판매완료 줄은 여기서 숨긴다 (카드 상세의 "판매 기록"에서 보고 되돌릴 수 있음). 저장할 때는 그대로 남는다.
  const total = rows.filter((r) => !r.sold).reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  const soldCount = rows.filter((r) => r.sold).reduce((sum, r) => sum + (Number(r.count) || 1), 0);
  const shown = rows.filter((r) => !r.sold).length;

  return (
    <div className="pe">
      <div className="pe-head">
        <span>보유 기록 {shown > 0 && <em>{shown}줄 · 총 {total}장</em>}{soldCount > 0 && <em> · 판매완료 {soldCount}장은 카드 상세의 판매 기록에 있어요</em>}</span>
        <small>같은 조건의 카드는 한 줄에 수량으로, 조건이 다르면 줄을 나눠 적어요.</small>
      </div>
      {rows.map((r, i) => {
        if (r.sold) return null;
        const graded = r.company && r.company !== 'raw';
        return (
          <div key={r.id || i} className={`pe-row ${graded ? 'graded' : 'raw'}`}>
            <div className="pe-type" role="group" aria-label="카드 종류">
              <button type="button" className={!graded ? 'on' : ''} onClick={() => setType(i, false)}>Raw</button>
              <button type="button" className={graded ? 'on' : ''} onClick={() => setType(i, true)}>등급 카드 (슬랩)</button>
            </div>
            <div className="pe-grid">
              <label className="pe-f pe-count">수량
                <input type="number" min={1} value={r.count ?? 1} onChange={(e) => update(i, 'count', Math.max(0, parseInt(e.target.value || '0', 10)))} />
              </label>
              {graded ? (
                <>
                  <label className="pe-f">등급 업체
                    <select value={r.company || ''} onChange={(e) => update(i, 'company', e.target.value)}>
                      {[...new Set([...gradingCompanies, r.company].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
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
                <label className="pe-f">카드 상태
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
              <div className="pe-sale">
                <div className="pe-type small" role="group" aria-label="판매 여부">
                  <button type="button" className={!r.forTrade ? 'on' : ''} onClick={() => update(i, 'forTrade', false)}>보유</button>
                  <button type="button" className={r.forTrade ? 'on sale' : ''} onClick={() => update(i, 'forTrade', true)}>판매중</button>
                </div>
                {r.forTrade && (
                  <label className="pe-ask">희망 가격 (1장)
                    <input type="number" min={0} value={r.askPrice ?? ''} onChange={(e) => update(i, 'askPrice', e.target.value === '' ? '' : Number(e.target.value))} placeholder="원" />
                  </label>
                )}
              </div>
              <button type="button" className="btn btn-compact btn-danger" onClick={() => remove(i)}>이 줄 지우기</button>
            </div>
          </div>
        );
      })}
      <div className="pe-add">
        <button type="button" className="btn btn-secondary" onClick={() => add('')}>+ Raw 카드 추가</button>
        <button type="button" className="btn btn-secondary" onClick={() => add(firstCompany)}>+ 등급 카드 추가</button>
      </div>
    </div>
  );
}
