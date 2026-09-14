import React, { useMemo } from 'react';

const SOURCE_COLORS = {
  bunjang: '#f97316',
  danggeun: '#22c55e',
  manual: '#3b82f6',
};
const SOURCE_LABELS = {
  bunjang: '번개장터',
  danggeun: '당근마켓',
  manual: '직접입력',
};

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function PriceTrendChart({ history }) {
  const points = useMemo(
    () => (history || []).filter((h) => typeof h.price === 'number').slice().sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt)),
    [history]
  );
  const bySource = useMemo(() => {
    const map = {};
    for (const p of points) {
      if (!map[p.source]) map[p.source] = [];
      map[p.source].push(p);
    }
    return map;
  }, [points]);

  if (points.length < 2) {
    return (
      <div className="market-chart-empty">
        📈 아직 추이 데이터가 부족합니다. 수집이 쌓일수록 (또는 직접 기록을 추가할수록) 자동으로 그래프가 채워집니다.
      </div>
    );
  }

  const prices = points.map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices) || 1;
  const minTime = new Date(points[0].recordedAt).getTime();
  const maxTime = new Date(points[points.length - 1].recordedAt).getTime() || minTime + 1;

  const xFor = (iso) => {
    const t = new Date(iso).getTime();
    const ratio = maxTime === minTime ? 0.5 : (t - minTime) / (maxTime - minTime);
    return PAD.left + ratio * (WIDTH - PAD.left - PAD.right);
  };
  const yFor = (price) => {
    const ratio = maxPrice === minPrice ? 0.5 : (price - minPrice) / (maxPrice - minPrice);
    return HEIGHT - PAD.bottom - ratio * (HEIGHT - PAD.top - PAD.bottom);
  };

  return (
    <div className="market-chart-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="market-chart-svg" role="img" aria-label="가격 추이 그래프">
        <line x1={PAD.left} y1={HEIGHT - PAD.bottom} x2={WIDTH - PAD.right} y2={HEIGHT - PAD.bottom} stroke="var(--border-color)" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={HEIGHT - PAD.bottom} stroke="var(--border-color)" />

        <text x={4} y={PAD.top + 4} className="market-chart-axis-label">{maxPrice.toLocaleString()}원</text>
        <text x={4} y={HEIGHT - PAD.bottom} className="market-chart-axis-label">{minPrice.toLocaleString()}원</text>
        <text x={PAD.left} y={HEIGHT - 6} className="market-chart-axis-label">{formatDate(points[0].recordedAt)}</text>
        <text x={WIDTH - PAD.right - 28} y={HEIGHT - 6} className="market-chart-axis-label">{formatDate(points[points.length - 1].recordedAt)}</text>

        {Object.entries(bySource).map(([source, pts]) => {
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.recordedAt)} ${yFor(p.price)}`).join(' ');
          const color = SOURCE_COLORS[source] || '#94a3b8';
          return (
            <g key={source}>
              <path d={path} fill="none" stroke={color} strokeWidth="2" />
              {pts.map((p, i) => (
                <circle key={i} cx={xFor(p.recordedAt)} cy={yFor(p.price)} r="3" fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="market-chart-legend">
        {Object.keys(bySource).map((source) => (
          <span key={source} className="market-chart-legend-item">
            <i style={{ background: SOURCE_COLORS[source] || '#94a3b8' }} />
            {SOURCE_LABELS[source] || source}
          </span>
        ))}
      </div>
    </div>
  );
}
