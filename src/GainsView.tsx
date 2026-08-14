// src/GainsView.tsx
// "Gains" dashboard: completion percentage per habit, grouped by domain
// (category), over a selectable period, with the delta between periods
// (improvement / regression in points) and a weekday/weekend window filter.
// Self-contained: subscribes to the store, owns its own filter state.

import { useState, useEffect, useMemo } from 'react';
import { exportAllData, getHabits, subscribe } from './store';
import { computeGains, PERIOD_DAYS, GAIN_CATEGORIES } from './gainsAnalysis';
import type { PeriodKey, DayWindow } from './gainsAnalysis';

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  all: 'Tout',
};

export default function GainsView() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [dayWindow, setDayWindow] = useState<DayWindow>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const report = useMemo(() => {
    try {
      const d = exportAllData();
      return computeGains(d.habits ?? [], d.checkIns ?? [], period, dayWindow, new Date());
    } catch {
      return { domains: [], totalHabits: 0, overallAvg: 0, generatedAt: '' };
    }
  }, [period, dayWindow]);

  const habitCount = getHabits().filter((h) => !h.archived).length;

  const domains = categoryFilter === 'all'
    ? report.domains
    : report.domains.filter((d) => d.categoryId === categoryFilter || (categoryFilter !== '__none__' && d.categoryId === categoryFilter));

  const periodDays = period === 'all' ? 'total' : `${PERIOD_DAYS[period]} j`;

  // Color for a delta: green improvement, red regression.
  const deltaColor = (v: number) => (v > 3 ? '#10b981' : v < -3 ? '#ef4444' : '#94a3b8');
  const deltaArrow = (v: number) => (v > 3 ? '▲' : v < -3 ? '▼' : '·');

  return (
    <div className="gains-view" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.25rem 0', fontSize: '1.2rem' }}>
            📈 Gains par domaine
          </h2>
          <p style={{ color: 'var(--text-muted, #94a3b8)', margin: 0, fontSize: '0.85rem' }}>
            % de complétion par habitude, regroupé par domaine, avec la progression entre périodes (en points).
          </p>
        </div>
        {report.totalHabits > 0 && (
          <span style={{ background: 'var(--bg-card, #1e293b)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', border: '1px solid var(--border-color, #334155)', whiteSpace: 'nowrap' }}>
            Moyenne globale : <strong>{report.overallAvg}%</strong> · {report.totalHabits} habitudes
          </span>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', background: 'var(--bg-card, #1e293b)', padding: '0.85rem 1rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid var(--border-color, #334155)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Période :</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} style={{ background: 'var(--bg-main, #0f172a)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            {Object.entries(PERIOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Jours :</label>
          <select value={dayWindow} onChange={(e) => setDayWindow(e.target.value as DayWindow)} style={{ background: 'var(--bg-main, #0f172a)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            <option value="all">Tous</option>
            <option value="weekday">Ouvrés (Lun–Ven)</option>
            <option value="weekend">Week-end</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Domaine :</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ background: 'var(--bg-main, #0f172a)', color: 'inherit', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            <option value="all">Tous</option>
            {GAIN_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            <option value="__none__">🏷️ Non classé</option>
          </select>
        </div>
        {habitCount === 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 'auto' }}>
            Aucune habitude — ajoute d'abord des habitudes pour voir tes gains.
          </span>
        )}
      </div>

      {/* Empty state */}
      {report.totalHabits === 0 ? (
        <div style={{ padding: '3rem 1rem', background: 'var(--bg-card, #1e293b)', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border-color, #334155)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🌱</div>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Pas encore de données de gains</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            Crée des habitudes, coche-les quotidiennement et renseigne leur domaine pour voir les pourcentages de complétion et ta progression.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {domains.map((domain) => (
            <div key={domain.categoryId} style={{ background: 'var(--bg-card, #1e293b)', borderRadius: '12px', border: '1px solid var(--border-color, #334155)', overflow: 'hidden' }}>
              {/* Domain header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-color, #334155)' }}>
                <span style={{ fontSize: '1.3rem' }}>{domain.emoji}</span>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{domain.categoryName}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>· {domain.count} habitude{domain.count > 1 ? 's' : ''}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Moyenne <strong style={{ color: domain.avgRate >= 60 ? '#10b981' : domain.avgRate >= 30 ? '#f59e0b' : '#ef4444' }}>{domain.avgRate}%</strong>
                </span>
                <div style={{ width: '120px', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, domain.avgRate)}%`, height: '100%', background: domain.color, borderRadius: '3px' }} />
                </div>
              </div>

              {/* Habit rows */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {domain.habits.map((g) => {
                  const rate = g.rates[period];
                  const d1 = g.deltas.d7to30;
                  const d2 = g.deltas.d30to90;
                  return (
                    <div key={g.habitId} style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '0.7rem 1.25rem', borderBottom: '1px solid var(--border-color, #334155)' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', minWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.name}>{g.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {g.streak > 0 ? `🔥 ${g.streak}j · ` : ''}{g.trackingDays}j suivis
                      </span>
                      <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, rate)}%`, height: '100%', background: rate >= 60 ? '#10b981' : rate >= 30 ? '#f59e0b' : '#ef4444', borderRadius: '3px' }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', minWidth: '44px', textAlign: 'right' }}>{rate}%</span>
                      {/* Delta chips */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: '130px', fontSize: '0.72rem' }}>
                        <span title="7j → 30j" style={{ color: deltaColor(d1) }}>
                          {deltaArrow(d1)} {period === '7d' ? 'vs 30j' : '7→30j'}: {d1 >= 0 ? '+' : ''}{d1} pts
                        </span>
                        <span title="30j → 90j" style={{ color: deltaColor(d2) }}>
                          {deltaArrow(d2)} {period === '30d' ? 'vs 90j' : '30→90j'}: {d2 >= 0 ? '+' : ''}{d2} pts
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Legend */}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>
            Taux = % de jours complétés sur la période ({periodDays}). Les jours avant le début du suivi de l'habitude ne comptent pas.
            Deltas : ▲ gain &gt; +3 pts · ▼ régression &lt; −3 pts. Filtre « Jours » pour comparer ouvrés vs week-end (détecte les habitudes qui ne survivent qu'au week-end).
          </p>
        </div>
      )}
    </div>
  );
}