import React, { useMemo } from 'react';

const KNOWN_MARKETPLACE_COLORS = {
  번개장터: '#f97316',
  당근마켓: '#22c55e',
  직접입력: '#3b82f6',
};
const FALLBACK_PALETTE = ['#a855f7', '#ec4899', '#eab308', '#14b8a6', '#f43f5e', '#6366f1', '#84cc16', '#0ea5e9'];

function marketplaceLabelFor(point) {
  if (point.marketplace) return point.marketplace;
  if (point.source === 'bunjang') return '번개장터';
  if (point.source === 'danggeun') return '당근마켓';
  if (point.source === 'manual') return '직접입력';
  return point.source || '기타';
}

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
  // 판매처(사용자가 직접 입력한 이름 포함)별로 묶어서 점 색상/범례를 정한다. (선은 판매처 구분 없이 날짜별 평균 하나로만 그림)
  const byMarketplace = useMemo(() => {
    const map = {};
    for (const p of points) {
      const label = marketplaceLabelFor(p);
      if (!map[label]) map[label] = [];
      map[label].push(p);
    }
    return map;
  }, [points]);

  // 같은 날짜에 매물이 여러 건 있으면 평균가로 묶어서 하나의 선으로 이어준다.
  const dailyAverages = useMemo(() => {
    const map = new Map(); // dayKey -> { sum, count, date }
    points.forEach((p) => {
      const dayKey = p.recordedAt.slice(0, 10);
      const entry = map.get(dayKey) || { sum: 0, count: 0, date: p.recordedAt };
      entry.sum += p.price;
      entry.count += 1;
      map.set(dayKey, entry);
    });
    return Array.from(map.values())
      .map(({ sum, count, date }) => ({ date, price: Math.round(sum / count) }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [points]);

  const colorByLabel = useMemo(() => {
    const colors = {};
    let fallbackIdx = 0;
    Object.keys(byMarketplace).forEach((label) => {
      if (KNOWN_MARKETPLACE_COLORS[label]) {
        colors[label] = KNOWN_MARKETPLACE_COLORS[label];
      } else {
        colors[label] = FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length];
        fallbackIdx += 1;
      }
    });
    return colors;
  }, [byMarketplace]);

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

        {dailyAverages.length > 1 && (
          <path
            d={dailyAverages.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.date)} ${yFor(p.price)}`).join(' ')}
            fill="none"
            stroke="var(--accent-color)"
            strokeWidth="2.5"
          />
        )}

        {Object.entries(byMarketplace).map(([label, pts]) => {
          const color = colorByLabel[label] || '#94a3b8';
          return (
            <g key={label}>
              {pts.map((p, i) => (
                <circle key={i} cx={xFor(p.recordedAt)} cy={yFor(p.price)} r="3" fill={color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="market-chart-legend">
        <span className="market-chart-legend-item">
          <i style={{ background: 'var(--accent-color)' }} />
          날짜별 평균
        </span>
        {Object.keys(byMarketplace).map((label) => (
          <span key={label} className="market-chart-legend-item">
            <i style={{ background: colorByLabel[label] || '#94a3b8' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
