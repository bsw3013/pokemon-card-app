import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

function classifyStatus(status) {
  const normalized = String(status || '').trim();

  if (normalized.includes('등급')) return 'graded';
  if (normalized.includes('미보유') || normalized.includes('위시')) return 'unowned';
  if (normalized.includes('보유') || normalized.includes('수집') || normalized.includes('소장') || normalized.includes('배송')) return 'owned';

  return 'unowned';
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

export default function StatsDashboard() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, 'pokemon_cards'));
        const aggregate = new Map();

        snap.forEach((docItem) => {
          const data = docItem.data() || {};
          const rarity = String(data.rarity || '').trim() || '미분류';
          const statusType = classifyStatus(data.status);

          if (!aggregate.has(rarity)) {
            aggregate.set(rarity, {
              rarity,
              owned: 0,
              unowned: 0,
              graded: 0,
              total: 0,
            });
          }

          const entry = aggregate.get(rarity);
          entry[statusType] += 1;
          entry.total += 1;
        });

        const sorted = Array.from(aggregate.values()).sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          return a.rarity.localeCompare(b.rarity);
        });

        setRows(sorted);
      } catch (err) {
        console.error('stats load failed', err);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => row.rarity.toLowerCase().includes(keyword));
  }, [rows, search]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.total += row.total;
        acc.owned += row.owned;
        acc.unowned += row.unowned;
        acc.graded += row.graded;
        return acc;
      },
      { total: 0, owned: 0, unowned: 0, graded: 0 }
    );
  }, [filteredRows]);

  if (loading) {
    return (
      <div className="stats-loading fade-in">
        <div className="spinner"></div>
        <h2>레어도 통계를 분석 중입니다...</h2>
        <p>보유/미보유/등급카드 분포를 계산하고 있어요.</p>
      </div>
    );
  }

  return (
    <main className="stats-page slide-up">
      <div className="stats-header">
        <div>
          <h2>📊 레어도 통계</h2>
          <p>각 레어도별 보유/미보유/등급카드 수를 확인할 수 있습니다.</p>
        </div>
        <input
          type="text"
          className="stats-search"
          placeholder="레어도 검색 (예: SR, SAR, AR...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <section className="stats-kpi-grid">
        <article className="stats-kpi-card">
          <span>총 카드 수</span>
          <strong>{formatNumber(totals.total)}</strong>
        </article>
        <article className="stats-kpi-card owned">
          <span>보유 카드</span>
          <strong>{formatNumber(totals.owned)}</strong>
        </article>
        <article className="stats-kpi-card unowned">
          <span>미보유 카드</span>
          <strong>{formatNumber(totals.unowned)}</strong>
        </article>
        <article className="stats-kpi-card graded">
          <span>등급 카드</span>
          <strong>{formatNumber(totals.graded)}</strong>
        </article>
      </section>

      <section className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th>레어도</th>
              <th>보유</th>
              <th>미보유</th>
              <th>등급카드</th>
              <th>총합</th>
              <th>분포</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const safeTotal = row.total || 1;
              const ownedPct = Math.round((row.owned / safeTotal) * 100);
              const unownedPct = Math.round((row.unowned / safeTotal) * 100);
              const gradedPct = 100 - ownedPct - unownedPct;

              return (
                <tr key={row.rarity}>
                  <td className="rarity-cell">{row.rarity}</td>
                  <td className="num owned">{formatNumber(row.owned)}</td>
                  <td className="num unowned">{formatNumber(row.unowned)}</td>
                  <td className="num graded">{formatNumber(row.graded)}</td>
                  <td className="num total">{formatNumber(row.total)}</td>
                  <td>
                    <div className="stats-stackbar" aria-label={`${row.rarity} 분포`}>
                      <span className="seg owned" style={{ width: `${ownedPct}%` }} title={`보유 ${ownedPct}%`}></span>
                      <span className="seg unowned" style={{ width: `${unownedPct}%` }} title={`미보유 ${unownedPct}%`}></span>
                      <span className="seg graded" style={{ width: `${Math.max(0, gradedPct)}%` }} title={`등급 ${Math.max(0, gradedPct)}%`}></span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="stats-mobile-list">
        {filteredRows.map((row) => (
          <article className="stats-mobile-card" key={`m-${row.rarity}`}>
            <header>
              <h4>{row.rarity}</h4>
              <strong>{formatNumber(row.total)}장</strong>
            </header>
            <div className="mobile-row">
              <span>보유</span>
              <b className="owned">{formatNumber(row.owned)}</b>
            </div>
            <div className="mobile-row">
              <span>미보유</span>
              <b className="unowned">{formatNumber(row.unowned)}</b>
            </div>
            <div className="mobile-row">
              <span>등급카드</span>
              <b className="graded">{formatNumber(row.graded)}</b>
            </div>
          </article>
        ))}
      </section>

      {filteredRows.length === 0 && (
        <div className="stats-empty">검색 결과가 없습니다.</div>
      )}
    </main>
  );
}
