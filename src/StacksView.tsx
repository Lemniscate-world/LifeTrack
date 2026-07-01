// src/StacksView.tsx
// Stacks view: shows today's status for every active stack (a habit with at
// least one direct non-archived child). Uses store.getStacks() to read.

import { useMemo } from 'react';
import type { Habit, CheckIn } from './types';
import { computeStacks, getNextStackSuggestion } from './stacks';
import type { StackStatus, StackStepState } from './stacks';

interface Props {
  habits: Habit[];
  checkIns: CheckIn[];
}

function stateLabel(state: StackStepState): { glyph: string; label: string; className: string } {
  switch (state) {
    case 'done':      return { glyph: '✓', label: 'Done',     className: 'state-done' };
    case 'pending':   return { glyph: '•', label: 'Pending',  className: 'state-pending' };
    case 'blocked':   return { glyph: '⊘', label: 'Blocked',  className: 'state-blocked' };
    case 'untracked': return { glyph: '?', label: 'Untracked', className: 'state-untracked' };
  }
}

export function StacksView({ habits, checkIns }: Props) {
  const stacks: StackStatus[] = useMemo(
    () => computeStacks(habits, checkIns),
    [habits, checkIns],
  );

  const nextSuggestion = useMemo(
    () => getNextStackSuggestion(habits, checkIns),
    [habits, checkIns],
  );

  if (stacks.length === 0) {
    return (
      <div className="stacks-container" role="region" aria-label="Habit stacks">

        <h2 className="stacks-title">Habit Stacks</h2>
        <p className="stacks-empty">
          No stacks yet. Click the link icon on any habit row to anchor it to another
          habit — for example, <em>after coffee → meditate</em>.
        </p>
      </div>
    );
  }

  return (
    <div className="stacks-container" role="region" aria-label="Habit stacks">
      <h2 className="stacks-title">Habit Stacks</h2>
      <p className="stacks-hint">
        Children are <em>blocked</em> until their parent is checked for today. Use the
        link icon on each row to manage anchors.
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
                    {step.parentId && (
                      <span className="stack-step-parent">
                        after: {habits.find((h) => h.id === step.parentId)?.name ?? '?'}
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