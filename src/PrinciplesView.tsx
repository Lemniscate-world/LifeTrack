import { useState, useMemo, useEffect } from 'react';
import {
  getChaosDimensions,
  getRoutinesForTrigger,
  addChaosTrigger,
  toggleChaosTrigger,
  addRoutine,
  deleteRoutine,
  getHabits,
  getReflections,
  subscribe,
} from './store';
import { getHabitChaosLinks } from './store';

const DIMENSION_COLORS: Record<string, string> = {
  social: '#3b82f6',
  financial: '#10b981',
  physical: '#ef4444',
  structural: '#f59e0b',
  spiritual: '#8b5cf6',
  emotional: '#ec4899',
  energy: '#06b6d4',
  startup: '#6366f1',
};

export default function PrinciplesView() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  const [newLabel, setNewLabel] = useState<Record<string, string>>({});
  const [newWeight, setNewWeight] = useState<Record<string, number>>({});
  const [newRoutineTrigger, setNewRoutineTrigger] = useState<string | null>(null);
  const [newRoutineName, setNewRoutineName] = useState<Record<string, string>>({});
  const [draftSteps, setDraftSteps] = useState<{ label: string; habitId?: string }[]>([]);
  const [newStepLabel, setNewStepLabel] = useState('');
  const [newStepHabit, setNewStepHabit] = useState('');

  const dimensions = useMemo(() => getChaosDimensions(), [tick]);
  const habits = useMemo(() => getHabits(), [tick]);
  const reflections = useMemo(() => getReflections(), [tick]);

  return (
    <div className="principles-view">
      <div className="principles-header">
        <h2>📜 Principes</h2>
        <p className="principles-subtitle">
          Règles que tu ne veux plus violer. Chaque principe vit dans une dimension Chaos, se coche quotidiennement
          (toggle), et déclenche une routine fixe que tu as composée.
        </p>
      </div>

      {dimensions.map((dim) => {
        const triggers = dim.triggers ?? [];
        // Reflections whose habits are linked to this dimension
        const habitIdsInDim = new Set(
          habits.filter((h) => getHabitChaosLinks(h).some((l) => l.dimension === dim.id)).map((h) => h.id),
        );
        const linkedReflections = reflections.filter((r) => (r.habitIds ?? []).some((id) => habitIdsInDim.has(id))).slice(0, 3);
        const accent = DIMENSION_COLORS[dim.id] ?? 'var(--primary)';
        return (
          <div key={dim.id} className="principles-dim" style={{ borderLeft: `3px solid ${accent}` }}>
            <h3>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: accent, marginRight: '8px', verticalAlign: 'middle' }} />
              {dim.name} <span className="principles-dim-count">{triggers.length} principe{triggers.length !== 1 ? 's' : ''}</span>
            </h3>

            {triggers.length === 0 && <p className="principles-empty">Aucun principe — ajoute celui qui, non respecté, fait chuter cette dimension.</p>}

            {triggers.map((trigger) => (
              <div key={trigger.id} className="principles-principle" style={{ borderLeft: trigger.active ? `3px solid ${accent}` : undefined }}>
                <label className="principles-principle-row">
                  <input type="checkbox" checked={trigger.active} onChange={() => toggleChaosTrigger(dim.id, trigger.id)} style={{ accentColor: accent }} />
                  <span className="principles-principle-label">
                    {trigger.label} <span className="principles-weight" style={{ borderColor: trigger.active ? accent : undefined, color: trigger.active ? accent : undefined }}>+{trigger.weight}%</span>
                  </span>
                  <span className={`principles-status ${trigger.active ? 'active' : ''}`} style={trigger.active ? { background: accent, borderColor: accent, color: 'white' } : undefined}>
                    {trigger.active ? 'actif' : 'inactif'}
                  </span>
                </label>

                <div className="principles-routines">
                  <span className="principles-routines-title">Routines si déclenché ({getRoutinesForTrigger(trigger.id).length})</span>
                  {getRoutinesForTrigger(trigger.id).map((routine) => (
                    <div key={routine.id} className="principles-routine">
                      <strong>{routine.name}</strong>
                      <ol>
                        {[...routine.steps].sort((a, b) => a.order - b.order).map((s) => (
                          <li key={s.id}>
                            {s.label}
                            {s.habitId ? ` → ${habits.find((h) => h.id === s.habitId)?.name ?? ''}` : ''}
                          </li>
                        ))}
                      </ol>
                      <button className="btn btn-sm" onClick={() => deleteRoutine(routine.id)}>
                        Supprimer
                      </button>
                    </div>
                  ))}
                  {newRoutineTrigger === trigger.id ? (
                    <div className="principles-routine-form">
                      <input
                        placeholder="Nom routine (ex: Protocole matin Startup)"
                        value={newRoutineName[trigger.id] || ''}
                        onChange={(e) => setNewRoutineName({ ...newRoutineName, [trigger.id]: e.target.value })}
                      />
                      <div className="principles-step-input">
                        <input placeholder="Étape" value={newStepLabel} onChange={(e) => setNewStepLabel(e.target.value)} />
                        <select value={newStepHabit} onChange={(e) => setNewStepHabit(e.target.value)}>
                          <option value="">-- habit lié --</option>
                          {habits.map((h) => (
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
                        <ol>
                          {draftSteps.map((s, i) => (
                            <li key={i}>
                              {s.label} {s.habitId ? `(${habits.find((h) => h.id === s.habitId)?.name})` : ''}
                              <button onClick={() => setDraftSteps(draftSteps.filter((_, idx) => idx !== i))}>x</button>
                            </li>
                          ))}
                        </ol>
                      )}
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          if (!newRoutineName[trigger.id]?.trim() || draftSteps.length === 0) return;
                          addRoutine({
                            triggerId: trigger.id,
                            name: newRoutineName[trigger.id].trim(),
                            steps: draftSteps.map((s, i) => ({ id: crypto.randomUUID(), label: s.label, habitId: s.habitId, order: i })),
                          });
                          setNewRoutineName({ ...newRoutineName, [trigger.id]: '' });
                          setDraftSteps([]);
                          setNewRoutineTrigger(null);
                        }}
                      >
                        Créer routine
                      </button>
                      <button className="btn btn-sm" onClick={() => { setNewRoutineTrigger(null); setDraftSteps([]); }}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setNewRoutineTrigger(trigger.id)}>
                      + Routine fixe
                    </button>
                  )}
                </div>

                {linkedReflections.length > 0 && (
                  <div className="principles-reflections">
                    <span className="principles-reflections-title">Réflexions structurées liées</span>
                    {linkedReflections.map((r) => (
                      <div key={r.id} className={`principles-reflection ${r.status}`}>
                        <span className="principles-reflection-question">{r.question}</span>
                        {r.answer && <span className="principles-reflection-answer">→ {r.answer.slice(0, 120)}</span>}
                        <span className={`principles-reflection-badge ${r.status}`}>{r.status === 'answered' ? 'répondue' : 'ouverte'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="principles-add">
              <input
                placeholder="Nouveau principe (ex: No LLM 55+ Intelligence)"
                value={newLabel[dim.id] || ''}
                onChange={(e) => setNewLabel({ ...newLabel, [dim.id]: e.target.value })}
              />
              <input type="number" min={0} max={100} value={newWeight[dim.id] ?? 25} onChange={(e) => setNewWeight({ ...newWeight, [dim.id]: parseInt(e.target.value) || 0 })} style={{ width: '60px' }} />
              <span>%</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  const label = newLabel[dim.id]?.trim();
                  if (!label) return;
                  addChaosTrigger(dim.id, label, newWeight[dim.id] ?? 25);
                  setNewLabel({ ...newLabel, [dim.id]: '' });
                }}
              >
                + Principe
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
