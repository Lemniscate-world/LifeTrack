import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  computeChaosReport,
  computeChaosHistory,
  subscribe,
  getHabits,
  getChaosDimensions,
} from './store';
import { getDimensionAccent } from './chaosDimensions';
import PrincipleTriggersPanel from './components/PrincipleTriggersPanel';

export default function ChaosView() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const report = useMemo(() => computeChaosReport(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => computeChaosHistory(30), [tick]);
  const { dimensions, overallPct, linkedHabitCount } = report;

  const rawDimensions = useMemo(() => getChaosDimensions(), [tick]);
  const habits = useMemo(() => getHabits(), [tick]);

  const recent = history.slice(-7);
  const prior = history.slice(-14, -7);
  const recentAvg = recent.length ? recent.reduce((s, p) => s + p.pct, 0) / recent.length : 0;
  const priorAvg = prior.length ? prior.reduce((s, p) => s + p.pct, 0) / prior.length : 0;
  const maxHistory = Math.max(...history.map((p) => p.pct), 1);
  const rising = recentAvg > priorAvg + 1;
  const falling = recentAvg < priorAvg - 1;

  return (
    <div className="chaos-container" aria-label="Chaos pressure dashboard">
      <div className="chaos-header">
        <div className="chaos-gauge" role="meter" aria-valuenow={overallPct} aria-valuemin={0} aria-valuemax={100} aria-label={`Chaos pressure: ${overallPct} percent`}>
          <svg viewBox="0 0 120 120" className="chaos-ring">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="10"
              strokeDasharray={`${overallPct * 3.14} 314`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dasharray 0.5s' }}
            />
          </svg>
          <span className="chaos-gauge-label">{overallPct}%</span>
        </div>
        <div className="chaos-heading">
          <h2>Chaos Pressure</h2>
          <p className="chaos-subtitle">
            {linkedHabitCount === 0
              ? 'Aucune habitude liée'
              : `${linkedHabitCount} habitude${linkedHabitCount > 1 ? 's' : ''} suivie${linkedHabitCount > 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {history.length > 1 && (
        <div className="chaos-history">
          <div className="chaos-history-head">
            <span className="chaos-history-title">30 derniers jours</span>
            <span className={`chaos-trend ${rising ? 'rise' : falling ? 'fall' : 'flat'}`}>
              {rising ? '↗ en hausse' : falling ? '↘ en baisse' : '→ stable'}
            </span>
          </div>
          <div className="chaos-sparkline" role="img" aria-label="Évolution de la pression chaos sur 30 jours">
            {history.map((p) => (
              <div
                key={p.date}
                className="chaos-spark-col"
                style={{ height: `${Math.max(2, (p.pct / maxHistory) * 46)}px` }}
                title={`${p.date} · ${p.pct}%`}
              >
                <span className="chaos-spark-bar" data-hot={p.pct >= 50} />
              </div>
            ))}
          </div>
        </div>
      )}

      {linkedHabitCount === 0 && (
        <p className="chaos-hint">
          Lie une habitude à une dimension avec le bouton ⚡ dans la grille.
          Quand tu la manques plusieurs jours de suite, la dimension chauffe.
        </p>
      )}

      <div className="chaos-grid">
        {dimensions.map((dim) => {
          const badge = dim.pct >= 50 ? 'high' : dim.pct >= 20 ? 'mid' : 'low';
          const triggeredCount = dim.habits.filter((h) => h.triggered).length;
          const rawDim = rawDimensions.find((d) => d.id === dim.id);
          const triggers = rawDim?.triggers ?? [];
          const activePrinciples = triggers.filter((t) => t.active).length;
          const accent = getDimensionAccent(dim.id);

          return (
            <div
              key={dim.id}
              className={`chaos-card ${dim.habits.length === 0 ? 'empty' : ''}`}
              style={{ '--dim-accent': accent } as CSSProperties}
            >
              <div className="chaos-card-header">
                <h3>
                  <span className="chaos-dim-dot" aria-hidden="true" />
                  {dim.name}
                </h3>
                <span className={`chaos-badge ${badge}`}>{dim.pct}%</span>
              </div>
              <div className="chaos-bar">
                <div className="chaos-bar-fill" style={{ width: `${dim.pct}%` }} />
              </div>
              {dim.habits.length === 0 ? (
                <span className="chaos-empty-dim">Aucune habitude liée</span>
              ) : (
                <>
                  <div className="chaos-dim-summary">
                    {triggeredCount === 0
                      ? `${dim.habits.length} sur la bonne voie`
                      : `${triggeredCount} / ${dim.habits.length} en chaos`}
                  </div>
                  <div className="chaos-habits">
                    {dim.habits.map((h) => (
                      <div key={h.habitId} className={`chaos-habit ${h.triggered ? 'triggered' : 'ok'}`}>
                        <span className="chaos-habit-icon">{h.triggered ? '⚡' : '✓'}</span>
                        <span className="chaos-habit-name">{h.habitName}</span>
                        <span className="chaos-habit-status">
                          {h.triggered
                            ? `manqué ${h.missedStreak}j · +${h.impact}%`
                            : h.missedStreak > 0
                              ? `manqué ${h.missedStreak}/${h.thresholdDays}j`
                              : 'ok'}
                        </span>
                        <div className="chaos-habit-progress" title={`${h.missedStreak}/${h.thresholdDays} jours manqués`}>
                          <div
                            className={`chaos-habit-progress-fill ${h.triggered ? 'hot' : ''}`}
                            style={{ width: `${h.progress * 100}%` }}
                          />
                        </div>
                        {h.cause && (
                          <p className="chaos-habit-cause" title="Pourquoi cette habitude déstabilise cette dimension">
                            {h.cause}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <details className="chaos-principles-fold">
                <summary className="chaos-principles-summary">
                  <span className="chaos-principles-summary-title">Principes</span>
                  <span className="chaos-principles-summary-meta">
                    {triggers.length} règle{triggers.length !== 1 ? 's' : ''}
                    {activePrinciples > 0 ? ` · ${activePrinciples} actif${activePrinciples > 1 ? 's' : ''}` : ''}
                  </span>
                </summary>
                <div className="chaos-principles-body">
                  <p className="chaos-principles-hint">Coche chaque jour si le principe est violé — impact manuel sur le chaos.</p>
                  <PrincipleTriggersPanel
                    dimensionId={dim.id}
                    triggers={triggers}
                    habits={habits}
                    accent={accent}
                    variant="compact"
                    addPlaceholder="Nouveau principe pour cette dimension"
                    addButtonLabel="+ Ajouter"
                  />
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
