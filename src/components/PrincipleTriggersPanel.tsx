import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChaosTrigger, Habit } from '../types';
import {
  addChaosTrigger,
  toggleChaosTrigger,
  getRoutinesForTrigger,
  addRoutine,
  deleteRoutine,
  toggleRoutineStep,
  resetRoutineProgress,
  updateRoutineStep,
  deleteRoutineStep,
  routineProgress,
} from '../store';

interface PrincipleTriggersPanelProps {
  dimensionId: string;
  triggers: ChaosTrigger[];
  habits: Habit[];
  accent: string;
  /** compact = nested inside a Chaos card; full = dedicated Principes tab */
  variant?: 'compact' | 'full';
  addPlaceholder?: string;
  addButtonLabel?: string;
}

export default function PrincipleTriggersPanel({
  dimensionId,
  triggers,
  habits,
  accent,
  variant = 'full',
  addPlaceholder = 'Nouveau principe',
  addButtonLabel = '+ Principe',
}: PrincipleTriggersPanelProps) {
  const [newLabel, setNewLabel] = useState('');
  const [newWeight, setNewWeight] = useState(25);
  const [newRoutineTrigger, setNewRoutineTrigger] = useState<string | null>(null);
  const [newRoutineName, setNewRoutineName] = useState('');
  const [draftSteps, setDraftSteps] = useState<{ label: string; habitId?: string }[]>([]);
  const [newStepLabel, setNewStepLabel] = useState('');
  const [newStepHabit, setNewStepHabit] = useState('');

  const rootClass = variant === 'compact' ? 'principles-panel principles-panel--compact' : 'principles-panel';

  return (
    <div className={rootClass} style={{ '--dim-accent': accent } as CSSProperties}>
      {triggers.length === 0 && (
        <p className="principles-panel-empty">
          Aucun principe — ajoute celui qui, non respecté, fait chuter cette dimension.
        </p>
      )}

      <ul className="principles-panel-list">
        {triggers.map((trigger) => {
          const routines = getRoutinesForTrigger(trigger.id);
          const isFormOpen = newRoutineTrigger === trigger.id;
          return (
            <li
              key={trigger.id}
              className={`principles-panel-item ${trigger.active ? 'is-active' : ''}`}
            >
              <label className="principles-panel-row">
                <input
                  type="checkbox"
                  className="principles-panel-check"
                  checked={trigger.active}
                  onChange={() => toggleChaosTrigger(dimensionId, trigger.id)}
                  aria-label={`Marquer ${trigger.label} comme ${trigger.active ? 'inactif' : 'actif'}`}
                />
                <span className="principles-panel-text">{trigger.label}</span>
                <span className="principles-panel-weight">+{trigger.weight}%</span>
                <span className={`principles-panel-pill ${trigger.active ? 'is-on' : ''}`}>
                  {trigger.active ? 'actif' : 'repos'}
                </span>
              </label>

              {routines.length > 0 && (
                <div className="principles-panel-routines">
                  <span className="principles-panel-routines-label">
                    Routines ({routines.length})
                  </span>
                  {routines.map((routine) => {
                    const prog = routineProgress(routine);
                    return (
                    <div key={routine.id} className="principles-panel-routine">
                      <div className="principles-panel-routine-head">
                        <strong>{routine.name}</strong>
                        <span className="principles-panel-routine-progress" title={`${prog.done}/${prog.total} étapes faites`}>
                          {prog.done}/{prog.total}
                        </span>
                        {prog.done > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost principles-panel-routine-delete"
                            onClick={() => resetRoutineProgress(routine.id)}
                            title="Tout décocher et recommencer"
                          >
                            Recommencer
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost principles-panel-routine-delete"
                          onClick={() => deleteRoutine(routine.id)}
                        >
                          Supprimer
                        </button>
                      </div>
                      <ol className="principles-panel-steps principles-panel-steps--checkable">
                        {[...routine.steps].sort((a, b) => a.order - b.order).map((step, idx) => {
                          const done = (routine.progress?.doneStepIds ?? []).includes(step.id);
                          return (
                          <li key={step.id} className={done ? 'is-done' : ''}>
                            <input
                              type="checkbox"
                              className="principles-panel-step-check"
                              checked={done}
                              onChange={() => toggleRoutineStep(routine.id, step.id)}
                              aria-label={`Étape ${idx + 1} : ${step.label}`}
                            />
                            <span className="principles-panel-step-num">{idx + 1}</span>
                            <RoutineStepLabel
                              routineId={routine.id}
                              stepId={step.id}
                              label={step.label}
                              habitName={step.habitId ? (habits.find((h) => h.id === step.habitId)?.name ?? '') : ''}
                            />
                          </li>
                          );
                        })}
                      </ol>
                      {prog.next && (
                        <p className="principles-panel-next" title="Reprendre ici">
                          ▶ Reprendre : étape {routine.steps.findIndex((s) => s.id === prog.next!.id) + 1} — {prog.next.label}
                        </p>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              {isFormOpen ? (
                <div className="principles-panel-form">
                  <input
                    placeholder="Nom de la routine (ex. Protocole matin)"
                    value={newRoutineName}
                    onChange={(e) => setNewRoutineName(e.target.value)}
                  />
                  <div className="principles-panel-step-row">
                    <input
                      placeholder="Étape"
                      value={newStepLabel}
                      onChange={(e) => setNewStepLabel(e.target.value)}
                    />
                    <select value={newStepHabit} onChange={(e) => setNewStepHabit(e.target.value)}>
                      <option value="">Habit lié (optionnel)</option>
                      {habits.map((h) => (
                        <option key={h.id} value={h.id}>{h.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm"
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
                    <ol className="principles-panel-draft">
                      {draftSteps.map((s, i) => (
                        <li key={i}>
                          {s.label}
                          {s.habitId ? ` (${habits.find((h) => h.id === s.habitId)?.name})` : ''}
                          <button type="button" onClick={() => setDraftSteps(draftSteps.filter((_, idx) => idx !== i))}>×</button>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="principles-panel-form-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        if (!newRoutineName.trim() || draftSteps.length === 0) return;
                        addRoutine({
                          triggerId: trigger.id,
                          name: newRoutineName.trim(),
                          steps: draftSteps.map((s, i) => ({
                            id: crypto.randomUUID(),
                            label: s.label,
                            habitId: s.habitId,
                            order: i,
                          })),
                        });
                        setNewRoutineName('');
                        setDraftSteps([]);
                        setNewRoutineTrigger(null);
                      }}
                    >
                      Créer routine
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setNewRoutineTrigger(null);
                        setDraftSteps([]);
                        setNewRoutineName('');
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost principles-panel-add-routine"
                  onClick={() => setNewRoutineTrigger(trigger.id)}
                >
                  + Routine fixe
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="principles-panel-add">
        <input
          type="text"
          placeholder={addPlaceholder}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newLabel.trim()) {
              addChaosTrigger(dimensionId, newLabel.trim(), newWeight);
              setNewLabel('');
            }
          }}
        />
        <div className="principles-panel-weight-field">
          <input
            type="number"
            min={0}
            max={100}
            value={newWeight}
            onChange={(e) => setNewWeight(parseInt(e.target.value, 10) || 0)}
            aria-label="Impact en pourcentage"
          />
          <span>%</span>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            const label = newLabel.trim();
            if (!label) return;
            addChaosTrigger(dimensionId, label, newWeight);
            setNewLabel('');
          }}
        >
          {addButtonLabel}
        </button>
      </div>
    </div>
  );
}

/** One routine step: label (+ linked habit) with inline rename + delete. */
function RoutineStepLabel({ routineId, stepId, label, habitName }: {
  routineId: string;
  stepId: string;
  label: string;
  habitName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  if (editing) {
    return (
      <span className="principles-panel-step-rename">
        <input
          value={draft}
          autoFocus
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              updateRoutineStep(routineId, stepId, draft.trim());
              setEditing(false);
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          aria-label="Renommer l'étape"
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            if (!draft.trim()) return;
            updateRoutineStep(routineId, stepId, draft.trim());
            setEditing(false);
          }}
        >
          OK
        </button>
      </span>
    );
  }
  return (
    <>
      <span className="principles-panel-step-label">{label}</span>
      {habitName && <span className="principles-panel-step-habit">→ {habitName}</span>}
      <button
        type="button"
        className="btn btn-sm btn-ghost principles-panel-step-edit"
        onClick={() => { setDraft(label); setEditing(true); }}
        title="Renommer cette étape"
      >
        ✎
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost principles-panel-step-edit"
        onClick={() => deleteRoutineStep(routineId, stepId)}
        title="Supprimer cette étape"
      >
        ×
      </button>
    </>
  );
}
