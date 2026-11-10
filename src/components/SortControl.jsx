import React from 'react';
import { SORT_FIELDS } from '../utils/sortCards';

// 정렬 기준 고르기 + 방향(오름/내림) 바꾸기 버튼
export default function SortControl({ fields, value, onChange }) {
  const info = SORT_FIELDS[value.field] || SORT_FIELDS.release;
  const desc = value.dir === 'desc';
  return (
    <div className="sortctl">
      <span className="sort-label">정렬</span>
      <select
        className="select"
        value={value.field}
        onChange={(e) => onChange({ field: e.target.value, dir: SORT_FIELDS[e.target.value]?.dir || 'desc' })}
        aria-label="정렬 기준"
      >
        {fields.map((k) => <option key={k} value={k}>{SORT_FIELDS[k].label}</option>)}
      </select>
      <button
        type="button"
        className="btn btn-secondary btn-compact sortctl-dir"
        onClick={() => onChange({ ...value, dir: desc ? 'asc' : 'desc' })}
        title="눌러서 방향 바꾸기"
        aria-label={`정렬 방향: ${desc ? '내림차순' : '오름차순'} (눌러서 바꾸기)`}
      >
        <span aria-hidden="true">{desc ? '↓' : '↑'}</span> {desc ? info.desc : info.asc}
      </button>
    </div>
  );
}
