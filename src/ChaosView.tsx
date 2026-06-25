import { useState, useEffect } from 'react';
import {
  getChaosDimensions,
  toggleChaosTrigger,
  resetChaos,
  getChaosTriggersForDimension,
  subscribe,
} from './store';

export default function ChaosView() {
  const [dimensions, setDimensions] = useState(() => getChaosDimensions());

  useEffect(() => {
    return subscribe(() => setDimensions(getChaosDimensions()));
  }, []);

  function computeDimPct(dimId: string): number {
    const triggers = getChaosTriggersForDimension(dimId);
    return Math.min(100, triggers.reduce((s, t) => s + (t.active ? t.weight : 0), 0));
  }

  const overallPct = dimensions.length > 0
    ? Math.round(dimensions.reduce((sum, d) => sum + computeDimPct(d.id), 0) / dimensions.length)
    : 0;

  function handleReset() {
    resetChaos();
    setDimensions(getChaosDimensions());
  }

  return (
    <div className="chaos-container">
      <div className="chaos-header">
        <h2>Chaos Pressure</h2>
        <div className="chaos-overall">
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
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleReset}>
          Reset All
        </button>
      </div>
      <div className="chaos-grid">
        {dimensions.map((dim) => {
          const triggers = getChaosTriggersForDimension(dim.id);
          const dimPct = computeDimPct(dim.id);
          return (
            <div key={dim.id} className="chaos-card">
              <div className="chaos-card-header">
                <h3>{dim.name}</h3>
                <span
                  className={`chaos-badge ${dimPct >= 50 ? 'high' : dimPct >= 20 ? 'mid' : 'low'}`}
                >
                  {dimPct}%
                </span>
              </div>
              <div className="chaos-bar">
                <div className="chaos-bar-fill" style={{ width: `${dimPct}%` }} />
              </div>
              <div className="chaos-triggers">
                {triggers.map((t) => {
                  const isAuto = t.id.startsWith('auto_');
                  return (
                    <label
                      key={t.id}
                      className={`chaos-trigger ${isAuto ? 'auto' : 'manual'}`}
                    >
                      <input
                        type="checkbox"
                        checked={t.active}
                        disabled={isAuto}
                        onChange={() => {
                          if (!isAuto) {
                            toggleChaosTrigger(dim.id, t.id);
                            setDimensions(getChaosDimensions());
                          }
                        }}
                        title={
                          isAuto
                            ? 'Auto-generated from missed habit'
                            : 'Manual trigger'
                        }
                      />
                      <span>
                        {isAuto ? '⚡ ' : ''}
                        {t.label}
                      </span>
                      <span className="chaos-weight">+{t.weight}%</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
