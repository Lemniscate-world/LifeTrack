// src/CorrelationsView.tsx
// Interactive Correlation Matrix & Pairwise Scatter Explorer
// Rigorous statistical pairwise alignment with FDR q-values, power analysis,
// lag-1 predictive links, weekday/weekend windows, and a full heatmap matrix.
// Also consolidates the time-series Trends here (single "analyse" hub).

import { useState, useMemo } from 'react';
import type { CorrelationResult, CorrelationCell } from './types';
import { computeCorrelations, computeCorrelationAnalysis } from './correlations';
import { exportAllData, getHabits } from './store';
import { computeHabitTrends, moodTrend, WEEKDAY_LABELS } from './timeseries';

type Tab = 'matrix' | 'same' | 'lag' | 'weekend' | 'weekday' | 'trends';

function heatColor(coef: number | null): string {
  if (coef === null) return 'var(--border)';
  const abs = Math.min(1, Math.abs(coef));
  if (coef >= 0) {
    return `rgba(16,185,129,${0.12 + 0.55 * abs})`;
  }
  const r = Math.round(200 + (55 * abs));
  return `rgba(${r},80,20,${0.15 + 0.5 * abs})`;
}

export default function CorrelationsView() {
  const data = useMemo(() => exportAllData(), []);
  const habits = useMemo(() => getHabits().filter(h => !h.archived), []);
  const checkIns = useMemo(() => data.checkIns ?? [], [data]);
  const moods = useMemo(() => data.moods ?? {}, [data]);
  const capacities = useMemo(() => (data.capacities ?? []).map(c => ({ id: c.id, name: c.name })), [data]);
  const ratings = useMemo(() => data.capacityRatings ?? [], [data]);

  const [tab, setTab] = useState<Tab>('matrix');

  const analysis = useMemo(() => {
    try {
      return computeCorrelationAnalysis(habits, checkIns, moods, capacities, ratings);
    } catch {
      return { sameDay: [], lag1: [], weekday: [], weekend: [], matrix: [], metrics: [], caveats: [] };
    }
  }, [habits, checkIns, moods, capacities, ratings]);

  const results = useMemo(() => computeCorrelations(habits, checkIns, moods, capacities, ratings), [habits, checkIns, moods, capacities, ratings]);

  // Time-series trends consolidated here (single analysis hub).
  const habitTrends = useMemo(() => {
    try { return computeHabitTrends(habits, checkIns); } catch { return []; }
  }, [habits, checkIns]);
  const moodTrendResult = useMemo(() => {
    try { return moodTrend(moods); } catch { return null; }
  }, [moods]);

  // Filters
  const [strengthFilter, setStrengthFilter] = useState<'all' | 'strong' | 'moderate' | 'weak'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'positive' | 'negative'>('all');
  const [sigOnly, setSigOnly] = useState(false);
  const [poweredOnly, setPoweredOnly] = useState(false);
  const [selectedPair, setSelectedPair] = useState<CorrelationResult | null>(null);

  const activeList = tab === 'same' ? analysis.sameDay
    : tab === 'lag' ? analysis.lag1
    : tab === 'weekend' ? analysis.weekend
    : tab === 'weekday' ? analysis.weekday
    : results;
  const filteredResults = useMemo(
    () => activeList.filter(r => {
      if (sigOnly && !r.significant) return false;
      if (poweredOnly && r.sampleSize < r.requiredN) return false;
      if (strengthFilter !== 'all' && r.strength !== strengthFilter) return false;
      if (directionFilter !== 'all' && r.direction !== directionFilter) return false;
      return true;
    }),
    [activeList, sigOnly, poweredOnly, strengthFilter, directionFilter],
  );

  const headerLabel = tab === 'matrix' ? 'Matrice de Corrélations'
    : tab === 'same' ? 'Corrélations contemporaines'
    : tab === 'lag' ? 'Corrélations prédictives (lag 1)'
    : tab === 'weekend' ? 'Corrélations — week-ends'
    : tab === 'weekday' ? 'Corrélations — jours ouvrés'
    : 'Tendances (Mann–Kendall)';

  const subLabel = tab === 'lag'
    ? 'X le jour t → Y le jour t+1 : le lien prédit le lendemain (temporalité, pas causalité).'
    : tab === 'weekend' || tab === 'weekday'
      ? 'Même paire mesurée sur un sous-ensemble de jours pour détecter les effets de week-end.'
      : 'Spearman & Pearson · FDR Benjamini-Hochberg · pairwise deletion · caveats de causalité';

  return (
    <div className="correlations-view" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.25rem 0', fontSize: '1.2rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
            {headerLabel}
          </h2>
          <p style={{ color: 'var(--text-muted, #94a3b8)', margin: 0, fontSize: '0.85rem' }}>{subLabel}</p>
        </div>
        {tab !== 'matrix' && tab !== 'trends' && (
          <span style={{ background: 'var(--bg-alt)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
            {filteredResults.length} / {activeList.length} paires
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {([
          ['matrix', '🧮 Matrice'],
          ['same', '🔗 Même jour'],
          ['lag', '⏭ Lag 1 (prédictif)'],
          ['weekend', '🌙 Week-end'],
          ['weekday', '💼 Semaine'],
          ['trends', '📈 Trends'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border)',
              background: tab === t ? 'var(--primary)' : 'var(--bg-alt)',
              color: tab === t ? '#fff' : 'inherit', cursor: 'pointer', fontSize: '0.82rem'
            }}
          >{label}</button>
        ))}
      </div>

      {/* Filter toolbar (not on matrix/trends) */}
      {tab !== 'matrix' && tab !== 'trends' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', background: 'var(--bg-alt)', padding: '0.85rem 1rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Force :</label>
            <select value={strengthFilter} onChange={e => setStrengthFilter(e.target.value as 'all' | 'strong' | 'moderate' | 'weak')} style={{ background: 'var(--bg)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.8rem' }}>
              <option value="all">Toutes</option>
              <option value="strong">Fortes (|r|≥0.6)</option>
              <option value="moderate">Modérées (|r|≥0.3)</option>
              <option value="weak">Faibles (|r|≥0.1)</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Direction :</label>
            <select value={directionFilter} onChange={e => setDirectionFilter(e.target.value as 'all' | 'positive' | 'negative')} style={{ background: 'var(--bg)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.8rem' }}>
              <option value="all">Toutes (+/-)</option>
              <option value="positive">Positive (+)</option>
              <option value="negative">Négative (-)</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={sigOnly} onChange={e => setSigOnly(e.target.checked)} />
            Significatif (q&lt;0.05 FDR)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={poweredOnly} onChange={e => setPoweredOnly(e.target.checked)} />
            Puissance suffisante (N ≥ requiredN)
          </label>
        </div>
      )}

      {/* MATRIX HEATMAP */}
      {tab === 'matrix' && (
        analysis.metrics.length === 0 ? (
          <div style={{ padding: '3rem 1rem', background: 'var(--bg-alt)', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📊</div>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>Pas encore assez de données</h3>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
              Enregistrez vos habitudes et votre humeur pendant 6+ jours pour voir apparaître la matrice de corrélations.
            </p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto', background: 'var(--bg-alt)', borderRadius: '12px', border: '1px solid var(--border)', padding: '1rem' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left', color: 'var(--text-muted)' }}></th>
                    {analysis.metrics.map(m => (
                      <th key={m} style={{ padding: '0.3rem 0.4rem', color: 'var(--text-muted)', fontWeight: 600, maxWidth: '110px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.metrics.map(row => (
                    <tr key={row}>
                      <td style={{ padding: '0.3rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row}</td>
                      {analysis.metrics.map(col => {
                        const cell: CorrelationCell | undefined = row === col
                          ? { row, col, coefficient: 1, sampleSize: 0, significant: false, qValue: 0 }
                          : analysis.matrix.find(c => (c.row === row && c.col === col) || (c.row === col && c.col === row));
                        if (row === col) {
                          return <td key={col} style={{ padding: '0.3rem 0.4rem', background: 'var(--border)', textAlign: 'center', color: 'var(--text-muted)' }}>—</td>;
                        }
                        return (
                          <td
                            key={col}
                            title={cell && cell.coefficient !== null ? `${row} ↔ ${col}: ${cell.coefficient.toFixed(2)} (N=${cell.sampleSize}, q=${cell.qValue.toFixed(3)})` : 'pas assez de données'}
                            onClick={() => {
                              if (!cell || cell.coefficient === null) return;
                              setSelectedPair({
                                metricA: row, metricB: col, coefficient: cell.coefficient,
                                strength: Math.abs(cell.coefficient) >= 0.6 ? 'strong' : Math.abs(cell.coefficient) >= 0.3 ? 'moderate' : Math.abs(cell.coefficient) >= 0.1 ? 'weak' : 'none',
                                direction: cell.coefficient >= 0 ? 'positive' : 'negative',
                                sampleSize: cell.sampleSize, method: 'spearman', pValue: cell.qValue, qValue: cell.qValue,
                                significant: cell.significant, ciLow: cell.coefficient, ciHigh: cell.coefficient,
                                requiredN: Math.abs(cell.coefficient) < 0.05 ? Infinity : Math.ceil(Math.pow(1.96 + 0.842, 2) / Math.pow(Math.atanh(Math.min(0.999999, Math.abs(cell.coefficient))), 2)) + 4,
                                caveat: 'Matrice de corrélations — lien statistique, pas causal. Vérifier N avant de conclure.',
                              });
                            }}
                            style={{
                              padding: '0.3rem 0.4rem', background: heatColor(cell ? cell.coefficient : null), textAlign: 'center',
                              color: cell && cell.coefficient !== null ? '#fff' : 'var(--text-muted)', cursor: cell && cell.coefficient !== null ? 'pointer' : 'default',
                              border: cell && cell.significant ? '1px solid var(--border)' : '1px solid transparent',
                            }}
                          >
                            {cell && cell.coefficient !== null ? (cell.coefficient >= 0 ? '' : '') + cell.coefficient.toFixed(2) : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.75rem 0 0 0' }}>
              Vert = positif · Orange = négatif · bordure claire = significatif (p&lt;0.05) · « · » = pas assez de données. Clique une cellule pour l’inspecter.
            </p>
          </>
        )
      )}

      {/* RESULTS CARDS (same/lag/weekend/weekday) */}
      {tab !== 'matrix' && tab !== 'trends' && (
        results.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Pas encore assez de données pour cette analyse.
          </div>
        ) : filteredResults.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Aucune corrélation ne correspond aux filtres sélectionnés.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {filteredResults.map((r, idx) => {
              const absR = Math.abs(r.coefficient);
              const isPos = r.direction === 'positive';
              const color = isPos ? '#10b981' : '#f59e0b';
              return (
                <div
                  key={r.pairKey ?? idx}
                  onClick={() => setSelectedPair(r)}
                  style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.6rem', transition: 'border-color 0.15s ease, transform 0.1s ease' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.transform = 'none'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.3 }}>
                      <span>{r.metricA}</span>
                      <span style={{ margin: '0 0.3rem', color: 'var(--text-muted)' }}>↔</span>
                      <span>{r.metricB}</span>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '6px', background: `${color}22`, color, flexShrink: 0 }}>
                      {isPos ? '+' : ''}{r.coefficient.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ background: 'var(--border)', borderRadius: '3px', height: '5px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(4, absR * 100))}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', background: 'var(--border)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                      {r.strength === 'strong' ? '🔥 Forte' : r.strength === 'moderate' ? '⚡ Modérée' : '🔹 Faible'}
                    </span>
                    <span style={{ fontSize: '0.72rem', background: 'var(--border)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>N={r.sampleSize}j</span>
                    {r.lag ? <span style={{ fontSize: '0.72rem', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>lag {r.lag}j</span> : null}
                    {r.window ? <span style={{ fontSize: '0.72rem', background: 'var(--border)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{r.window === 'weekend' ? '🌙 week-end' : '💼 semaine'}</span> : null}
                    {r.significant && (
                      <span style={{ fontSize: '0.72rem', background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>q={r.qValue.toFixed(3)} ✓</span>
                    )}
                    <span style={{ fontSize: '0.72rem', background: 'var(--border)', padding: '0.15rem 0.4rem', borderRadius: '4px', color: 'var(--text-muted)' }}>{r.method}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* TRENDS TAB */}
      {tab === 'trends' && (
        <div>
          <div className="trends-section" style={{ background: 'var(--bg-alt)', borderRadius: '12px', border: '1px solid var(--border)', padding: '1rem 1.25rem' }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>Humeur</h3>
            {moodTrendResult ? (
              <div className="trends-row trend-mood" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <span className="trend-name">Tendance globale</span>
                <span className={`trend-arrow ${moodTrendResult.direction}`}>{moodTrendResult.direction === 'up' ? '▲' : moodTrendResult.direction === 'down' ? '▼' : '→'}</span>
                <span className="trend-detail">τ={moodTrendResult.tau.toFixed(2)} <span className="trend-p">p={moodTrendResult.p.toFixed(3)}</span></span>
                {!moodTrendResult.significant && <span className="trend-ns">(n.s.)</span>}
              </div>
            ) : <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.85rem' }}>Moins de 10 jours de mood enregistrés.</p>}
          </div>

          {habitTrends.some((t) => t.trend || t.weekday || t.changepoint) ? (
            <div className="trends-section" style={{ background: 'var(--bg-alt)', borderRadius: '12px', border: '1px solid var(--border)', padding: '1rem 1.25rem', marginTop: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>Habitudes</h3>
              <div className="trends-list">
                {habitTrends.filter((t) => t.trend || t.weekday || t.changepoint).map((t) => (
                  <div key={t.habitId} className="trend-row" style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="trend-name" style={{ flex: '0 0 auto' }}>{t.name}</span>
                    {t.trend ? (
                      <>
                        <span className={`trend-arrow ${t.trend.direction}`}>{t.trend.direction === 'up' ? '▲' : t.trend.direction === 'down' ? '▼' : '→'}</span>
                        <span className="trend-detail">τ={t.trend.tau.toFixed(2)}<span className="trend-p"> p={t.trend.p.toFixed(3)}</span></span>
                        {!t.trend.significant && <span className="trend-ns">(n.s.)</span>}
                      </>
                    ) : <span className="trend-ns">—</span>}
                    {t.changepoint && t.changepoint.significant && (
                      <span className="trend-cp" title={`Changement de régime ~${t.changepointAt}`}>~{t.changepointAt ?? '?'} {t.changepoint.direction === 'up' ? '+' : ''}{Math.round(t.changepoint.delta * 100)}%</span>
                    )}
                    {t.weekday && t.weekday.significant && (
                      <span className="trend-weekday">meilleur jour {WEEKDAY_LABELS[t.weekday.best]} {Math.round(t.weekday.rates[t.weekday.best])}%</span>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.5rem 0 0 0' }}>
                τ = Kendall tau, p du test de Mann-Kendall (n≥10 jours enregistrés requis). Tendance ≠ cause.
              </p>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
              Pas encore de tendance détectable (10+ jours d’habitudes enregistrés requis).
            </p>
          )}
        </div>
      )}

      {/* Causation caveats */}
      {tab !== 'trends' && analysis.caveats.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid #f59e0b', padding: '0.75rem 1rem', borderRadius: '6px', marginTop: '1.25rem', fontSize: '0.82rem' }}>
          <strong>⚠ Corrélation ≠ causation :</strong>
          <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0, color: 'var(--text-muted)' }}>
            {analysis.caveats.slice(0, 4).map((c, i) => <li key={i} style={{ marginBottom: '0.2rem' }}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Detail Inspector Modal */}
      {selectedPair && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200, padding: '1rem' }} onClick={() => setSelectedPair(null)}>
          <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: '16px', maxWidth: '520px', width: '100%', padding: '1.5rem', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedPair(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>📊 Inspecteur de Corrélation</h3>
            <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary)', margin: '0 0 0.25rem 0' }}>
              {selectedPair.metricA} <span style={{ color: 'var(--text-muted)' }}>↔</span> {selectedPair.metricB}
              {selectedPair.lag ? <span style={{ color: '#38bdf8', marginLeft: '0.5rem', fontSize: '0.8rem' }}>lag {selectedPair.lag}j</span> : null}
              {selectedPair.window ? <span style={{ color: '#38bdf8', marginLeft: '0.5rem', fontSize: '0.8rem' }}>{selectedPair.window === 'weekend' ? '🌙 week-end' : '💼 semaine'}</span> : null}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>
              {selectedPair.method === 'pearson' ? 'Pearson (continue × continue)' : 'Spearman (rang ordinal)'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1rem' }}>
              {[
                { label: 'Coefficient', value: `${selectedPair.coefficient >= 0 ? '+' : ''}${selectedPair.coefficient.toFixed(3)}`, color: selectedPair.coefficient >= 0 ? '#10b981' : '#f59e0b' },
                { label: 'IC 95%', value: `[${selectedPair.ciLow.toFixed(2)}, ${selectedPair.ciHigh.toFixed(2)}]`, color: undefined },
                { label: 'p (brut)', value: selectedPair.pValue < 0.001 ? '<0.001' : selectedPair.pValue.toFixed(3), color: undefined },
                { label: 'q (FDR)', value: selectedPair.qValue.toFixed(3), color: selectedPair.significant ? '#10b981' : undefined },
                { label: 'N (jours)', value: selectedPair.sampleSize, color: undefined },
                { label: 'Force', value: selectedPair.strength, color: undefined },
              ].map(item => (
                <div key={item.label} style={{ background: 'var(--border)', padding: '0.6rem', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>{item.label}</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: item.color ?? 'inherit' }}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={{ background: 'rgba(99,102,241,0.1)', borderLeft: '3px solid #6366f1', padding: '0.65rem 0.8rem', borderRadius: '4px', fontSize: '0.82rem' }}>
              <strong>Puissance statistique (80%) :</strong>{' '}
              {selectedPair.requiredN === Infinity
                ? 'Effectif insuffisant pour estimer la puissance.'
                : selectedPair.sampleSize >= selectedPair.requiredN
                  ? <span style={{ color: '#10b981' }}>✓ Suffisant ({selectedPair.sampleSize}/{selectedPair.requiredN} jours).</span>
                  : <span style={{ color: '#f59e0b' }}>⚠ {selectedPair.sampleSize}/{selectedPair.requiredN} jours requis.</span>}
            </div>
            {selectedPair.caveat && (
              <div style={{ background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid #f59e0b', padding: '0.65rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                {selectedPair.caveat}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}