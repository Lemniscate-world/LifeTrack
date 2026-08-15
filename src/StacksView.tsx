// src/StacksView.tsx
// Stacks view: shows today's status for every active stack (a habit with at
// least one direct non-archived child). Uses store.getStacks() to read.
// Now also lets the user relink children to a different parent (or detach them)
// and change the timing directly in the stack, right where they see it.

import { useMemo, useState } from 'react';
import type { Habit, CheckIn } from './types';
import { computeStacks, getNextStackSuggestion } from './stacks';
import type { StackStatus, StackStepState } from './stacks';

interface Props {
  habits: Habit[];
  checkIns: CheckIn[];
  /** Visual relink: set/clear a child's parent anchor + timing. */
   
  onSetParent?: (childId: string, parentId: string | null, when?: 'before' | 'after' | 'with') => void;
}

function stateLabel(state: StackStepState): { glyph: string; label: string; className: string } {
  switch (state) {
    case 'done':      return { glyph: '✓', label: 'Done',     className: 'state-done' };
    case 'pending':   return { glyph: '•', label: 'Pending',  className: 'state-pending' };
    case 'blocked':   return { glyph: '⊘', label: 'Blocked',  className: 'state-blocked' };
    case 'untracked': return { glyph: '?', label: 'Untracked', className: 'state-untracked' };
  }
}

export function StacksView({ habits, checkIns, onSetParent }: Props) {
  const stacks: StackStatus[] = useMemo(
    () => computeStacks(habits, checkIns),
    [habits, checkIns],
  );

  // How many visible (non-archived) habits are anchored into a stack as children.
  // When > 0 but no stack renders, something is hiding the link (archived parent
  // or an archived-only relationship) — we surface that instead of a generic message.
  const linkedChildCount = useMemo(
    () => habits.filter((h) => h.stackParent).length,
    [habits],
  );

  const nextSuggestion = useMemo(
    () => getNextStackSuggestion(habits, checkIns),
    [habits, checkIns],
  );

  // Which step is being relinked (by habitId), if any.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftParent, setDraftParent] = useState('');
  const [draftWhen, setDraftWhen] = useState<'before' | 'after' | 'with'>('after');

  const startEdit = (habitId: string, parentId: string | undefined, when: StackStatus['steps'][number]['stackWhen']) => {
    setEditingId(habitId);
    setDraftParent(parentId ?? '');
    setDraftWhen((when ?? 'after') as 'before' | 'after' | 'with');
  };

  const commitEdit = (childId: string) => {
    if (onSetParent) onSetParent(childId, draftParent === '' ? null : draftParent, draftWhen);
    setEditingId(null);
  };

  if (stacks.length === 0) {
    return (
      <div className="stacks-container" role="region" aria-label="Habit stacks">

        <h2 className="stacks-title">Habit Stacks</h2>
        {linkedChildCount > 0 ? (
          <p className="stacks-empty">
            {linkedChildCount} habit{linkedChildCount > 1 ? 's' : ''} est lié
            {linkedChildCount > 1 ? 'e(s)' : ''} dans une stack, mais aucune n’est
            visible aujourd’hui. Une stack apparaît seulement si <em>le parent et au
            moins un enfant sont actifs</em> (non archivés). Archivage le parent ou
            l’enfant masque la stack. Réactive-la ou relie un enfant actif depuis la
            vue Grid (icône 🔗).
          </p>
        ) : (
          <p className="stacks-empty">
            No stacks yet. In the Grid view, click the link icon on any habit row to anchor it
            after another — for example, <em>after coffee → meditate</em>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="stacks-container" role="region" aria-label="Habit stacks">
      <h2 className="stacks-title">Habit Stacks</h2>
      <p className="stacks-hint">
        Children are <em>blocked</em> until their parent is checked for today. Click a
        step's ✎ to relink or detach it, then Save.
      </p>

      {nextSuggestion && (
        <div className="stack-next-suggestion" role="status">
          <span className="next-suggestion-label">Up next:</span>
          <span
            className="next-suggestion-dot"
            style={{ backgroundColor: nextSuggestion.habitColor }}
            aria-hidden="true"
          />
          <span className="next-suggestion-name">{nextSuggestion.habitName}</span>
          <span className="next-suggestion-context">
            (in stack <em>{nextSuggestion.rootName}</em>)
          </span>
        </div>
      )}

      <div className="stacks-list">
        {stacks.map((stack) => (
          <div key={stack.rootId} className="stack-card">
            <header className="stack-header">
              <h3 className="stack-name">{stack.rootName}</h3>
              <div className="stack-progress">
                <span className="stack-progress-text">
                  {stack.doneCount} / {stack.totalCount} done
                </span>
                <div className="stack-progress-bar">
                  <div
                    className="stack-progress-fill"
                    style={{ width: `${stack.completionPct}%` }}
                  />
                </div>
              </div>
            </header>
            <ol className="stack-steps">
              {stack.steps.map((step) => {
                const sl = stateLabel(step.state);
                const isEditing = editingId === step.habitId;
                return (
                  <li
                    key={step.habitId}
                    className={`stack-step ${sl.className} ${step.archived ? 'archived' : ''}`}
                  >
                    <span
                      className="stack-step-dot"
                      style={{ backgroundColor: step.habitColor }}
                      aria-hidden="true"
                    />
                    <span className="stack-step-name">
                      {step.habitName}
                      {step.archived && <span className="archived-tag"> (archived)</span>}
                    </span>
                    <span
                      className={`stack-step-state ${sl.className}`}
                      title={sl.label}
                    >
                      {sl.glyph}
                    </span>
                    {step.parentId && (() => {
                      const parent = habits.find((h) => h.id === step.parentId);
                      if (!parent) return null;
                      const when = step.stackWhen;
                      const glyph = when === 'before' ? '↑ before' : when === 'with' ? '↔ with' : '↓ after';
                      return (
                        <span className="stack-step-parent">
                          {glyph}: {parent.name}
                        </span>
                      );
                    })()}
                    {onSetParent && (
                      <span className="stack-step-actions">
                        {isEditing ? (
                          <span className="stack-edit-inline">
                            <select
                              className="stack-select-sm"
                              value={draftParent}
                              onChange={(e) => setDraftParent(e.target.value)}
                              aria-label="Parent habit"
                            >
                              <option value="">— none (detach) —</option>
                              {habits
                                .filter((h) => h.id !== step.habitId && !h.archived)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((h) => (
                                  <option key={h.id} value={h.id}>{h.name}</option>
                                ))}
                            </select>
                            <select
                              className="stack-select-sm"
                              value={draftWhen}
                              onChange={(e) => setDraftWhen(e.target.value as 'before' | 'after' | 'with')}
                              aria-label="Timing"
                            >
                              <option value="before">↑ before</option>
                              <option value="after">↓ after</option>
                              <option value="with">↔ with</option>
                            </select>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => commitEdit(step.habitId)}>
                              Save
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-icon stack-step-edit-btn"
                            title="Edit link / timing"
                            aria-label={`Edit link for ${step.habitName}`}
                            onClick={() => startEdit(step.habitId, step.parentId, step.stackWhen)}
                          >
                            ✎
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {stack.completionPct === 100 && stack.totalCount > 0 && (
              <p className="stack-complete-msg">Stack complete for today — nice work!</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}