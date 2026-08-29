import { useState, useEffect, useMemo } from 'react';
import {
  computeChaosReport,
  computeChaosHistory,
  subscribe,
  addChaosTrigger,
  toggleChaosTrigger,
  getRoutinesForTrigger,
  addRoutine,
  deleteRoutine,
  getHabits,
  getChaosDimensions,
} from './store';

export default function ChaosView() {
  // Bumped by the store subscription to force a re-render after mutations.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  // Memoize the chaos report: recompute only when something forces a re-render
  // (the `tick` bump above). Without memoization, every render scans every
  // habit's check-ins, which gets expensive past a few hundred checks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const report = useMemo(() => computeChaosReport(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => computeChaosHistory(30), [tick]);
  const { dimensions, overallPct, linkedHabitCount } = report;

  const [newTriggerLabel, setNewTriggerLabel] = useState<Record<string, string>>({});
  const [newTriggerWeight, setNewTriggerWeight] = useState<Record<string, number>>({});
  const [newRoutineName, setNewRoutineName] = useState<Record<string, string>>({});
  const [newRoutineTrigger, setNewRoutineTrigger] = useState<string | null>(null);
  const [newStepLabel, setNewStepLabel] = useState('');
  const [newStepHabit, setNewStepHabit] = useState('');
  const [draftSteps, setDraftSteps] = useState<{ label: string; habitId?: string }[]>([]);
  const rawDimensions = useMemo(() => getChaosDimensions(), [tick]);

  // Trend of the last week vs the previous week.
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
              ? 'No habits linked yet'
              : `${linkedHabitCount} habit${linkedHabitCount > 1 ? 's' : ''} tracked across dimensions`}
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
          Link a habit to a chaos dimension with the ⚡ button next to it in the Grid view.
          When you miss it for too many days in a row, its dimension heats up.
        </p>
      )}

      <div className="chaos-grid">
        {dimensions.map((dim) => {
          const badge = dim.pct >= 50 ? 'high' : dim.pct >= 20 ? 'mid' : 'low';
          const triggeredCount = dim.habits.filter((h) => h.triggered).length;
          return (
            <div key={dim.id} className={`chaos-card ${dim.habits.length === 0 ? 'empty' : ''}`}>
              <div className="chaos-card-header">
                <h3>{dim.name}</h3>
                <span className={`chaos-badge ${badge}`}>{dim.pct}%</span>
              </div>
              <div className="chaos-bar">
                <div className="chaos-bar-fill" style={{ width: `${dim.pct}%` }} />
              </div>
              {dim.habits.length === 0 ? (
                <span className="chaos-empty-dim">No habits linked</span>
              ) : (
                <>
                  <div className="chaos-dim-summary">
                    {triggeredCount === 0
                      ? `All ${dim.habits.length} on track`
                      : `${triggeredCount} of ${dim.habits.length} in chaos`}
                  </div>
                  <div className="chaos-habits">
                    {dim.habits.map((h) => (
                      <div key={h.habitId} className={`chaos-habit ${h.triggered ? 'triggered' : 'ok'}`}>
                        <span className="chaos-habit-icon">{h.triggered ? '⚡' : '✓'}</span>
                        <span className="chaos-habit-name">{h.habitName}</span>
                        <span className="chaos-habit-status">
                          {h.triggered
                            ? `missed ${h.missedStreak}d · +${h.impact}%`
                            : h.missedStreak > 0
                              ? `missed ${h.missedStreak}/${h.thresholdDays}d`
                              : 'on track'}
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
              <div className="chaos-triggers">
                <h4>
                  Triggers & Principes ({(rawDimensions.find((d) => d.id === dim.id)?.triggers.length ?? 0)}) — check quotidien
                  manuel
                </h4>
                {(rawDimensions.find((d) => d.id === dim.id)?.triggers ?? []).map((trigger) => (
                  <div key={trigger.id} className="chaos-trigger">
                    <label className="chaos-trigger-label">
                      <input
                        type="checkbox"
                        checked={trigger.active}
                        onChange={() => toggleChaosTrigger(dim.id, trigger.id)}
                      />
                      <span>
                        {trigger.label} +{trigger.weight}% {trigger.active ? '(actif)' : ''}
                      </span>
                    </label>
                    <div className="chaos-routines">
                      {getRoutinesForTrigger(trigger.id).map((routine) => (
                        <div key={routine.id} className="chaos-routine">
                          <strong>{routine.name}</strong>
                          <ol>
                            {[...routine.steps].sort((a, b) => a.order - b.order).map((step) => (
                              <li key={step.id}>
                                {step.label}
                                {step.habitId ? ` → ${getHabits().find((h) => h.id === step.habitId)?.name ?? ''}` : ''}
                              </li>
                            ))}
                          </ol>
                          <button className="btn btn-sm" onClick={() => deleteRoutine(routine.id)}>
                            Supprimer routine
                          </button>
                        </div>
                      ))}
                      {newRoutineTrigger === trigger.id ? (
                        <div className="chaos-routine-form">
                          <input
                            placeholder="Nom routine"
                            value={newRoutineName[trigger.id] || ''}
                            onChange={(e) => setNewRoutineName({ ...newRoutineName, [trigger.id]: e.target.value })}
                          />
                          <div className="chaos-step-input">
                            <input
                              placeholder="Étape"
                              value={newStepLabel}
                              onChange={(e) => setNewStepLabel(e.target.value)}
                            />
                            <select value={newStepHabit} onChange={(e) => setNewStepHabit(e.target.value)}>
                              <option value="">-- habit lié --</option>
                              {getHabits().map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                if (!newStepLabel.trim()) return;
                                setDraftSteps([...draftSteps, { label: newStepLabel.trim(), habitId: newStepHabit || undefined }]);
                                setNewStepLabel('');
                                setNewStepHabit('');
                              }}
                            >
                              + Étape
                            </button>
                          </div>
                          {draftSteps.length > 0 && (
                            <ol className="chaos-draft-steps">
                              {draftSteps.map((s, i) => (
                                <li key={i}>
                                  {s.label} {s.habitId ? `(${getHabits().find((h) => h.id === s.habitId)?.name})` : ''}
                                  <button onClick={() => setDraftSteps(draftSteps.filter((_, idx) => idx !== i))}>x</button>
                                </li>
                              ))}
                            </ol>
                          )}
                          <div className="chaos-routine-actions">
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                if (!newRoutineName[trigger.id]?.trim() || draftSteps.length === 0) return;
                                addRoutine({
                                  triggerId: trigger.id,
                                  name: newRoutineName[trigger.id].trim(),
                                  steps: draftSteps.map((s, i) => ({
                                    id: crypto.randomUUID(),
                                    label: s.label,
                                    habitId: s.habitId,
                                    order: i,
                                  })),
                                });
                                setNewRoutineName({ ...newRoutineName, [trigger.id]: '' });
                                setDraftSteps([]);
                                setNewRoutineTrigger(null);
                              }}
                            >
                              Créer routine
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => {
                                setNewRoutineTrigger(null);
                                setDraftSteps([]);
                              }}
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-sm" onClick={() => setNewRoutineTrigger(trigger.id)}>
                          + Routine fixe
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="chaos-add-trigger">
                  <input
                    placeholder="Nouveau trigger/principe"
                    value={newTriggerLabel[dim.id] || ''}
                    onChange={(e) => setNewTriggerLabel({ ...newTriggerLabel, [dim.id]: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newTriggerWeight[dim.id] ?? 25}
                    onChange={(e) => setNewTriggerWeight({ ...newTriggerWeight, [dim.id]: parseInt(e.target.value) || 0 })}
                    style={{ width: '60px' }}
                  />
                  <span>%</span>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      const label = newTriggerLabel[dim.id]?.trim();
                      if (!label) return;
                      addChaosTrigger(dim.id, label, newTriggerWeight[dim.id] ?? 25);
                      setNewTriggerLabel({ ...newTriggerLabel, [dim.id]: '' });
                    }}
                  >
                    + Trigger
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
