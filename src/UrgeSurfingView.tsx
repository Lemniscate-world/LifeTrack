// Urge Surfing View — log urges, ride them out, track success rate.
// Based on the mindfulness technique of observing urges like waves.
import { useState, useEffect, useMemo } from 'react';
import {
  addUrgeEntry,
  getUrgeEntries,
  getActiveUrge,
  surfUrge,
  giveInUrge,
  deleteUrgeEntry,
  computeUrgeStats,
  formatUrgeElapsed,
  URGE_TYPES,
  type UrgeStats,
} from './urgeSurfing';
import type { Habit, UrgeEntry } from './types';
import { subscribe, getHabits } from './store';

function UrgeSurfingView() {
  const [, setTick] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [selectedType, setSelectedType] = useState('craving');
  const [intensity, setIntensity] = useState(5);
  const [trigger, setTrigger] = useState('');
  const [note, setNote] = useState('');
  const [counterHabits, setCounterHabits] = useState<Set<string>>(new Set());

  // Re-render every 10s to update elapsed time displays
  useEffect(() => {
    const unsub = subscribe(() => setTick(t => t + 1));
    const timer = setInterval(() => setTick(t => t + 1), 10000);
    return () => { unsub(); clearInterval(timer); };
  }, []);

  const activeUrge = getActiveUrge();
  const entries = useMemo(() => getUrgeEntries(), []);
  const stats: UrgeStats = useMemo(() => computeUrgeStats(30), []);
  const recentEntries = entries.slice(0, 20);
  const habits = useMemo(() => getHabits(), []);

  const toggleCounterHabit = (habitId: string) => {
    setCounterHabits(prev => {
      const next = new Set(prev);
      if (next.has(habitId)) next.delete(habitId);
      else next.add(habitId);
      return next;
    });
  };

  const handleStartUrge = () => {
    addUrgeEntry({
      type: selectedType,
      intensity,
      startTime: new Date().toISOString(),
      outcome: 'active',
      trigger: trigger.trim() || undefined,
      counterHabits: counterHabits.size > 0 ? [...counterHabits] : undefined,
    });
    resetForm();
  };

  const resetForm = () => {
    setShowForm(false);
    setSelectedType('craving');
    setIntensity(5);
    setTrigger('');
    setNote('');
    setCounterHabits(new Set());
  };

  const handleSurf = (id: string) => {
    const n = note.trim();
    surfUrge(id, n || undefined);
    setNote('');
  };

  const handleGiveIn = (id: string) => {
    const n = note.trim();
    giveInUrge(id, n || undefined);
    setNote('');
  };

  const urgeTypeInfo = (typeId: string) => URGE_TYPES.find(t => t.id === typeId);

  return (
    <div className="urge-surfing-view">
      <div className="urge-header">
        <h2>🌊 Urge Surfing</h2>
        <p className="urge-subtitle">
          Urges are like waves — they rise, peak, and fall. You don't have to act on them.
        </p>
      </div>

      {/* Active Urge Timer */}
      {activeUrge ? (
        <div className="urge-active-card">
          <div className="urge-active-header">
            <span className="urge-active-type">
              {urgeTypeInfo(activeUrge.type)?.emoji} {urgeTypeInfo(activeUrge.type)?.label}
            </span>
            <span className="urge-active-timer">
              ⏱ {formatUrgeElapsed(activeUrge.startTime)}
            </span>
          </div>
          <div className="urge-active-intensity">
            Intensity: <strong>{activeUrge.intensity}/10</strong>
            <div className="urge-intensity-bar" style={{ '--pct': `${activeUrge.intensity * 10}%` } as React.CSSProperties}>
              <div className="urge-intensity-fill" />
            </div>
          </div>
          {activeUrge.trigger && (
            <p className="urge-active-trigger">Trigger: {activeUrge.trigger}</p>
          )}
          {activeUrge.counterHabits && activeUrge.counterHabits.length > 0 && (
            <p className="urge-active-trigger">
              🛡️ Try instead: {activeUrge.counterHabits.map(hid => habits.find(h => h.id === hid)?.name ?? hid).join(', ')}
            </p>
          )}
          <div className="urge-active-actions">
            <textarea
              className="urge-note-input"
              placeholder="Any reflection? (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
            />
            <div className="urge-active-btns">
              <button className="btn btn-sm btn-success" onClick={() => handleSurf(activeUrge.id)}>
                🌊 Surfed it!
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => handleGiveIn(activeUrge.id)}>
                😔 Gave in
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="urge-no-active">
          <p>No active urge right now. Feel one coming? Log it below.</p>
          {!showForm && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Log an Urge
            </button>
          )}
        </div>
      )}

      {/* New Urge Form */}
      {!activeUrge && showForm && (
        <div className="urge-form">
          <h3>New Urge</h3>
          <div className="urge-type-grid">
            {URGE_TYPES.map(t => (
              <button
                key={t.id}
                className={`urge-type-btn ${selectedType === t.id ? 'active' : ''}`}
                style={selectedType === t.id ? { borderColor: t.color, background: t.color + '20' } : {}}
                onClick={() => setSelectedType(t.id)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <div className="form-row">
            <label>Intensity (1-10):</label>
            <input
              type="range"
              min="1"
              max="10"
              value={intensity}
              onChange={e => setIntensity(Number(e.target.value))}
            />
            <span className="intensity-value">{intensity}</span>
          </div>
          <div className="form-row">
            <input
              className="form-input"
              placeholder="What triggered it? (optional)"
              value={trigger}
              onChange={e => setTrigger(e.target.value)}
            />
          </div>
          {habits.length > 0 && (
            <div className="form-row urge-counter-habits">
              <label>Counter-habits (try these instead):</label>
              <div className="habit-chips">
                {habits.map(h => (
                  <label key={h.id} className={`chip ${counterHabits.has(h.id) ? 'active' : ''}`} style={counterHabits.has(h.id) ? { background: h.color + '40', borderColor: h.color } : {}}>
                    <input type="checkbox" checked={counterHabits.has(h.id)} onChange={() => toggleCounterHabit(h.id)} />
                    {h.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="urge-form-actions">
            <button className="btn btn-primary" onClick={handleStartUrge}>
              Start Surfing 🌊
            </button>
            <button className="btn btn-ghost" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats.total > 0 && (
        <div className="urge-stats">
          <div className="urge-stat">
            <span className="urge-stat-value">{stats.successRate}%</span>
            <span className="urge-stat-label">Success rate</span>
          </div>
          <div className="urge-stat">
            <span className="urge-stat-value">{stats.surfed}/{stats.total}</span>
            <span className="urge-stat-label">Surfed</span>
          </div>
          <div className="urge-stat">
            <span className="urge-stat-value">{stats.avgIntensity}/10</span>
            <span className="urge-stat-label">Avg intensity</span>
          </div>
        </div>
      )}

      {/* History */}
      {recentEntries.length > 0 && (
        <div className="urge-history">
          <h3>Recent Urges</h3>
          <div className="urge-history-list">
            {recentEntries.map(e => {
              const info = urgeTypeInfo(e.type);
              return (
                <div key={e.id} className={`urge-history-item ${e.outcome}`}>
                  <div className="urge-history-left">
                    <span className="urge-history-emoji">{info?.emoji}</span>
                    <div>
                      <span className="urge-history-type">{info?.label}</span>
                      <span className="urge-history-time">
                        {new Date(e.startTime).toLocaleDateString()} {new Date(e.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <div className="urge-history-right">
                    <span className="urge-history-intensity">{e.intensity}/10</span>
                    <span className={`urge-history-outcome ${e.outcome}`}>
                      {e.outcome === 'surfed' ? '🌊' : e.outcome === 'gave_in' ? '😔' : '⏳'}
                    </span>
                    <button
                      className="urge-delete-btn"
                      onClick={() => deleteUrgeEntry(e.id)}
                      title="Delete"
                    >×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && !activeUrge && (
        <div className="urge-empty">
          <p>No urges logged yet. Urge surfing helps you break bad habits by observing cravings without acting on them.</p>
          <p className="urge-empty-hint">Next time you feel an urge — to procrastinate, eat junk food, check social media — log it here and ride the wave. 🌊</p>
        </div>
      )}
    </div>
  );
}

export default UrgeSurfingView;
