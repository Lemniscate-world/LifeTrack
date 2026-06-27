import { useState, useEffect } from 'react';
import { computeChaosReport, subscribe } from './store';

export default function ChaosView() {
  const [, setTick] = useState(0);

  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  // Recompute on every render (tick ensures re-render after store changes)
  const { dimensions, overallPct, linkedHabitCount } = computeChaosReport();

  return (
    <div className="chaos-container">
      <div className="chaos-header">
        <div className="chaos-gauge">
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
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
