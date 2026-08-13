// src/CorrelationsView.tsx
// Interactive Correlation Matrix & Pairwise Scatter Explorer
// Rigorous statistical pairwise alignment with FDR q-values and power analysis.

import { useState, useMemo } from 'react';
import type { CorrelationResult } from './types';
import { computeCorrelations } from './correlations';
import { exportAllData, getHabits } from './store';

export default function CorrelationsView() {
  const data = useMemo(() => exportAllData(), []);
  const habits = useMemo(() => getHabits().filter(h => !h.archived), []);
  const checkIns = useMemo(() => data.checkIns ?? [], [data]);
  const moods = useMemo(() => data.moods ?? {}, [data]);
  const capacities = useMemo(() => (data.capacities ?? []).map(c => ({ id: c.id, name: c.name })), [data]);
  const ratings = useMemo(() => data.capacityRatings ?? [], [data]);

  // Compute all correlations
  const results = useMemo(() => {
    try {
      return computeCorrelations(habits, checkIns, moods, capacities, ratings);
    } catch {
      return [];
    }
  }, [habits, checkIns, moods, capacities, ratings]);

  // Filter state
  const [strengthFilter, setStrengthFilter] = useState<'all' | 'strong' | 'moderate' | 'weak'>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'positive' | 'negative'>('all');
  const [sigOnly, setSigOnly] = useState(false);
  const [selectedPair, setSelectedPair] = useState<CorrelationResult | null>(null);

  // Filtered results
  const filteredResults = useMemo(() => {
    return results.filter(r => {
      if (sigOnly && !r.significant) return false;
      if (strengthFilter !== 'all' && r.strength !== strengthFilter) return false;
      if (directionFilter !== 'all' && r.direction !== directionFilter) return false;
      return true;
    });
  }, [results, strengthFilter, directionFilter, sigOnly]);

  return (
    <div className="correlations-view" style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.25rem 0', fontSize: '1.2rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
            Matrice de Corrélations
          </h2>
          <p style={{ color: 'var(--text-muted, #94a3b8)', margin: 0, fontSize: '0.85rem' }}>
            Spearman &amp; Pearson · correction FDR Benjamini-Hochberg · pairwise deletion
          </p>
        </div>
        <span style={{
          background: 'var(--bg-card, #1e293b)',
          padding: '0.35rem 0.75rem',
          borderRadius: '8px',
          fontSize: '0.8rem',
          border: '1px solid var(--border-color, #334155)',
          whiteSpace: 'nowrap'
        }}>
          {filteredResults.length} / {results.length} paires
        </span>
      </div>

      {/* Filter toolbar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        alignItems: 'center',
        background: 'var(--bg-card, #1e293b)',
        padding: '0.85rem 1rem',
        borderRadius: '12px',
        marginBottom: '1.5rem',
        border: '1px solid var(--border-color, #334155)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Force :</label>
          <select
            value={strengthFilter}
            onChange={e => setStrengthFilter(e.target.value as 'all' | 'strong' | 'moderate' | 'weak')}
            style={{ background: 'var(--bg-main, #0f172a)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
          >
            <option value="all">Toutes</option>
            <option value="strong">Fortes (|r|≥0.6)</option>
            <option value="moderate">Modérées (|r|≥0.3)</option>
            <option value="weak">Faibles (|r|≥0.1)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Direction :</label>
          <select
            value={directionFilter}
            onChange={e => setDirectionFilter(e.target.value as 'all' | 'positive' | 'negative')}
            style={{ background: 'var(--bg-main, #0f172a)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
          >
            <option value="all">Toutes (+/-)</option>
            <option value="positive">Positive (+)</option>
            <option value="negative">Négative (-)</option>
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', marginLeft: 'auto' }}>
          <input type="checkbox" checked={sigOnly} onChange={e => setSigOnly(e.target.checked)} />
          Significatif seulement (q&lt;0.05 FDR)
        </label>
      </div>

      {/* Empty states */}
      {results.length === 0 ? (
        <div style={{
          padding: '3rem 1rem',
          background: 'var(--bg-card, #1e293b)',
          borderRadius: '12px',
          textAlign: 'center',
          border: '1px solid var(--border-color, #334155)'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📊</div>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Pas encore assez de données</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            Enregistrez vos habitudes et votre humeur pendant 6+ jours pour voir apparaître les corrélations statistiques.
          </p>
        </div>
      ) : filteredResults.length === 0 ? (
        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Aucune corrélation ne correspond aux filtres sélectionnés.
        </div>
      ) : (
        /* Results grid */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {filteredResults.map((r, idx) => {
            const absR = Math.abs(r.coefficient);
            const isPos = r.direction === 'positive';
            const color = isPos ? '#10b981' : '#f59e0b';

            return (
              <div
                key={idx}
                onClick={() => setSelectedPair(r)}
                style={{
                  background: 'var(--bg-card, #1e293b)',
                  border: '1px solid var(--border-color, #334155)',
                  borderRadius: '12px',
                  padding: '1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  transition: 'border-color 0.15s ease, transform 0.1s ease',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color, #334155)'; (e.currentTarget as HTMLDivElement).style.transform = 'none'; }}
              >
                {/* Top: metric pair + r value */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.3 }}>
                    <span>{r.metricA}</span>
                    <span style={{ margin: '0 0.3rem', color: 'var(--text-muted)' }}>↔</span>
                    <span>{r.metricB}</span>
                  </div>
                  <span style={{
                    fontSize: '0.8rem', fontWeight: 700, padding: '0.15rem 0.45rem',
                    borderRadius: '6px', background: `${color}22`, color, flexShrink: 0
                  }}>
                    {isPos ? '+' : ''}{r.coefficient.toFixed(2)}
                  </span>
                </div>

                {/* Coefficient gauge */}
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '3px', height: '5px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, Math.max(4, absR * 100))}%`,
                    height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s ease'
                  }} />
                </div>

                {/* Footer badges */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                    {r.strength === 'strong' ? '🔥 Forte' : r.strength === 'moderate' ? '⚡ Modérée' : '🔹 Faible'}
                  </span>
                  <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                    N={r.sampleSize}j
                  </span>
                  {r.significant && (
                    <span style={{ fontSize: '0.72rem', background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                      q={r.qValue.toFixed(3)} ✓
                    </span>
                  )}
                  <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.4rem', borderRadius: '4px', color: 'var(--text-muted)' }}>
                    {r.method}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Inspector Modal */}
      {selectedPair && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 200, padding: '1rem'
          }}
          onClick={() => setSelectedPair(null)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1e293b)',
              border: '1px solid var(--border-color, #334155)',
              borderRadius: '16px', maxWidth: '520px', width: '100%',
              padding: '1.5rem', position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedPair(null)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer' }}
            >✕</button>

            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>📊 Inspecteur de Corrélation</h3>

            <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--accent-color, #6366f1)', margin: '0 0 0.25rem 0' }}>
              {selectedPair.metricA} <span style={{ color: 'var(--text-muted)' }}>↔</span> {selectedPair.metricB}
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
                <div key={item.label} style={{ background: 'rgba(255,255,255,0.04)', padding: '0.6rem', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>{item.label}</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: item.color ?? 'inherit' }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Power analysis note */}
            <div style={{ background: 'rgba(99,102,241,0.1)', borderLeft: '3px solid #6366f1', padding: '0.65rem 0.8rem', borderRadius: '4px', fontSize: '0.82rem' }}>
              <strong>Puissance statistique (80%) :</strong>{' '}
              {selectedPair.requiredN === Infinity
                ? 'Effectif insuffisant pour estimer la puissance.'
                : selectedPair.sampleSize >= selectedPair.requiredN
                  ? <span style={{ color: '#10b981' }}>✓ Suffisant ({selectedPair.sampleSize}/{selectedPair.requiredN} jours).</span>
                  : <span style={{ color: '#f59e0b' }}>⚠ {selectedPair.sampleSize}/{selectedPair.requiredN} jours requis.</span>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
