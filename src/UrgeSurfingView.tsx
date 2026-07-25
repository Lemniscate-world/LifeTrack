// Urge Surfing View — log urges, ride them out, track success rate.
// Based on the mindfulness technique of observing urges like waves.
// v0.3.2: Custom urge types with per-type default counter-habits.
import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import {
  addUrgeEntry,
  getUrgeEntries,
  getActiveUrge,
  surfUrge,
  giveInUrge,
  deleteUrgeEntry,
  computeUrgeStats,
  formatUrgeElapsed,
  getAllUrgeTypes,
  getDefaultCounterHabits,
  addCustomUrgeType,
  updateCustomUrgeType,
  deleteCustomUrgeType,
  type UrgeStats,
} from './urgeSurfing';
import { subscribe, getHabits } from './store';

const DEFAULT_COLORS = ['#F59E0B', '#8B5CF6', '#EF4444', '#6366F1', '#6B7280', '#10B981', '#EC4899', '#14B8A6'];

function UrgeSurfingView() {
  const [, setTick] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showManageTypes, setShowManageTypes] = useState(false);
  const [selectedType, setSelectedType] = useState('craving');
  const [intensity, setIntensity] = useState(5);
  const [trigger, setTrigger] = useState('');
  const [note, setNote] = useState('');
  const [counterHabits, setCounterHabits] = useState<Set<string>>(new Set());

  // Custom type form
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeEmoji, setNewTypeEmoji] = useState('🎯');
  const [newTypeColor, setNewTypeColor] = useState(DEFAULT_COLORS[0]);
  const [newTypeHabits, setNewTypeHabits] = useState<Set<string>>(new Set());
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);

  // Re-render every 10s to update elapsed time displays
  useEffect(() => {
    const unsub = subscribe(() => setTick(t => t + 1));
    const timer = setInterval(() => setTick(t => t + 1), 10000);
    return () => { unsub(); clearInterval(timer); };
  }, []);

  const activeUrge = getActiveUrge();
  const entries = getUrgeEntries();
  const stats: UrgeStats = computeUrgeStats(30);
  const recentEntries = entries.slice(0, 20);
  const habits = getHabits();
  const allTypes = getAllUrgeTypes();

  // When urge type changes, auto pre-select default counter-habits
  const selectType = useCallback((typeId: string) => {
    setSelectedType(typeId);
    const defaults = getDefaultCounterHabits(typeId);
    setCounterHabits(new Set(defaults));
  }, []);

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

  const urgeTypeInfo = (typeId: string) => allTypes.find(t => t.id === typeId);

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
              {urgeTypeInfo(activeUrge.type)?.emoji} {urgeTypeInfo(activeUrge.type)?.name}
            </span>
            <span className="urge-active-timer">
              ⏱ {formatUrgeElapsed(activeUrge.startTime)}
            </span>
          </div>
          <div className="urge-active-intensity">
            Intensity: <strong>{activeUrge.intensity}/10</strong>
            <div className="urge-intensity-bar" style={{ '--pct': `${activeUrge.intensity * 10}%` } as CSSProperties}>
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
            {allTypes.map(t => (
              <button
                key={t.id}
                className={`urge-type-btn ${selectedType === t.id ? 'active' : ''}`}
                style={selectedType === t.id ? { borderColor: t.color, background: t.color + '20' } : {}}
                onClick={() => selectType(t.id)}
                title={t.isCustom ? `${t.name} (custom)` : t.name}
              >
                {t.emoji} {t.name}
                {t.isCustom && <span className="urge-type-custom-dot" title="Custom type">✎</span>}
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-ghost urge-manage-types-btn" onClick={() => setShowManageTypes(!showManageTypes)}>
            {showManageTypes ? '− Hide type manager' : '⚙ Manage custom types'}
          </button>
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

      {/* Custom Type Manager */}
      {showManageTypes && (
        <div className="urge-manage-types">
          <h3>Custom Urge Types</h3>
          <p className="urge-manage-hint">Create your own urge categories with default counter-habits.</p>

          {/* List existing custom types */}
          {allTypes.filter(t => t.isCustom).map(t => (
            <div key={t.id} className="urge-custom-type-row" style={{ borderLeftColor: t.color }}>
              {editingTypeId === t.id ? (
                <div className="urge-edit-type-form">
                  <input className="form-input" value={newTypeName} onChange={e => setNewTypeName(e.target.value)} placeholder="Name" />
                  <input className="form-input" value={newTypeEmoji} onChange={e => setNewTypeEmoji(e.target.value)} placeholder="Emoji" style={{ width: 60 }} />
                  <div className="urge-color-picker">
                    {DEFAULT_COLORS.map(c => (
                      <button key={c} className={`urge-color-dot ${newTypeColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setNewTypeColor(c)} />
                    ))}
                  </div>
                  <div className="urge-type-habits-select">
                    {habits.map(h => (
                      <label key={h.id} className={`chip ${newTypeHabits.has(h.id) ? 'active' : ''}`}>
                        <input type="checkbox" checked={newTypeHabits.has(h.id)} onChange={() => setNewTypeHabits(prev => { const n = new Set(prev); n.has(h.id) ? n.delete(h.id) : n.add(h.id); return n; })} />
                        {h.name}
                      </label>
                    ))}
                  </div>
                  <div className="urge-edit-type-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => { updateCustomUrgeType(t.id, { name: newTypeName, emoji: newTypeEmoji, color: newTypeColor, defaultCounterHabits: [...newTypeHabits] }); setEditingTypeId(null); }}>Save</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingTypeId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="urge-custom-type-info">
                  <span className="urge-custom-type-name">{t.emoji} {t.name}</span>
                  {t.defaultCounterHabits && t.defaultCounterHabits.length > 0 && (
                    <span className="urge-custom-type-habits">🛡️ {t.defaultCounterHabits.map(hid => habits.find(h => h.id === hid)?.name ?? hid).join(', ')}</span>
                  )}
                  <div className="urge-custom-type-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => { setEditingTypeId(t.id); setNewTypeName(t.name); setNewTypeEmoji(t.emoji); setNewTypeColor(t.color); setNewTypeHabits(new Set(t.defaultCounterHabits ?? [])); }}>Edit</button>
                    <button className="btn btn-sm btn-ghost urge-delete-btn" onClick={() => { if (confirm(`Delete "${t.name}"?`)) deleteCustomUrgeType(t.id); }}>×</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add new custom type */}
          {editingTypeId === null && (
            <div className="urge-add-type-form">
              <input className="form-input" value={newTypeName} onChange={e => setNewTypeName(e.target.value)} placeholder="Type name (e.g. Gaming, Shopping...)" />
              <div className="urge-add-type-row">
                <input className="form-input" value={newTypeEmoji} onChange={e => setNewTypeEmoji(e.target.value)} placeholder="🎯" style={{ width: 50 }} />
                <div className="urge-color-picker">
                  {DEFAULT_COLORS.map(c => (
                    <button key={c} className={`urge-color-dot ${newTypeColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setNewTypeColor(c)} />
                  ))}
                </div>
              </div>
              {habits.length > 0 && (
                <div className="urge-type-habits-select">
                  <span className="urge-manage-hint">Default counter-habits:</span>
                  {habits.map(h => (
                    <label key={h.id} className={`chip ${newTypeHabits.has(h.id) ? 'active' : ''}`}>
                      <input type="checkbox" checked={newTypeHabits.has(h.id)} onChange={() => setNewTypeHabits(prev => { const n = new Set(prev); n.has(h.id) ? n.delete(h.id) : n.add(h.id); return n; })} />
                      {h.name}
                    </label>
                  ))}
                </div>
              )}
              <button className="btn btn-primary" onClick={() => { if (newTypeName.trim()) { addCustomUrgeType(newTypeName.trim(), newTypeEmoji || '🎯', newTypeColor, [...newTypeHabits]); setNewTypeName(''); setNewTypeEmoji('🎯'); setNewTypeColor(DEFAULT_COLORS[0]); setNewTypeHabits(new Set()); } }} disabled={!newTypeName.trim()}>
                + Create Type
              </button>
            </div>
          )}
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
                      <span className="urge-history-type">{info?.name}</span>
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
