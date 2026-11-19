import React, { useMemo } from 'react';
import { GRADE_COLORS } from '../utils/gradeKey';

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

// 같은 날짜에 기록이 여러 건 있으면 평균가로 묶는다
function dailyAveragesOf(points) {
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
}

// seriesOf(기록) → 묶음 이름을 주면(등급카드: "BRG 10") 묶음마다 따로 선을 그린다. 서로 섞어서 평균 내지 않는다.
export default function PriceTrendChart({ history, seriesOf = null, seriesOrder = [] }) {
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
  const dailyAverages = useMemo(() => dailyAveragesOf(points), [points]);

  // 등급카드: 등급마다 { key, color, points, line }
  const series = useMemo(() => {
    if (!seriesOf) return null;
    const map = new Map();
    points.forEach((p) => {
      const k = seriesOf(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    });
    const keys = [...map.keys()].sort((a, b) => {
      const ia = seriesOrder.indexOf(a); const ib = seriesOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    // 색은 고른 순서(등급 칩과 같은 색)를 따른다
    return keys.map((key, i) => {
      const idx = seriesOrder.indexOf(key);
      return { key, color: GRADE_COLORS[(idx === -1 ? i : idx) % GRADE_COLORS.length], points: map.get(key), line: dailyAveragesOf(map.get(key)) };
    });
  }, [points, seriesOf, seriesOrder]);

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
        아직 추이 데이터가 부족합니다. 수집이 쌓일수록 (또는 직접 기록을 추가할수록) 자동으로 그래프가 채워집니다.
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

        {series ? series.map((s) => (
          <g key={s.key}>
            {s.line.length > 1 && (
              <path
                d={s.line.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.date)} ${yFor(p.price)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
              />
            )}
            {s.points.map((p, i) => (
              <circle key={i} cx={xFor(p.recordedAt)} cy={yFor(p.price)} r="3.5" fill={s.color}>
                <title>{`${s.key} · ${p.price.toLocaleString()}원 · ${formatDate(p.recordedAt)} · ${marketplaceLabelFor(p)}${p.saleType === 'auction' ? ' 경매' : ''}`}</title>
              </circle>
            ))}
          </g>
        )) : (
          <>
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
                    <circle key={i} cx={xFor(p.recordedAt)} cy={yFor(p.price)} r="3" fill={color}>
                      <title>{`${p.price.toLocaleString()}원 · ${formatDate(p.recordedAt)} · ${label}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </>
        )}
      </svg>
      <div className="market-chart-legend">
        {series ? series.map((s) => (
          <span key={s.key} className="market-chart-legend-item">
            <i style={{ background: s.color }} />
            {s.key} <small>({s.points.length}건)</small>
          </span>
        )) : (
          <>
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
          </>
        )}
      </div>
      {series && <p className="market-chart-note">등급마다 따로 선을 그려요. 점에 마우스를 올리면 판매처·날짜가 보여요.</p>}
    </div>
  );
}
