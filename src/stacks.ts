// src/stacks.ts
// Habit stacking logic. A "stack" is a parent habit that triggers child habits.
// This module owns:
//   - linking/unlinking a habit to a parent
//   - cycle detection (no cycles allowed in the parent graph)
//   - computing today's per-step state (done/pending/blocked/untracked)
//
// Persistence lives on the `Habit.stackParent` field directly (see types.ts).
// `notify()` in store.ts handles re-renders after mutations.

import type { Habit, CheckIn } from './types';
import { toDateKey } from './stats';

// --- Cycle detection (DFS from candidate up the parent chain) ---

function wouldCreateCycle(allHabits: Habit[], habitId: string, newParentId: string): boolean {
  if (habitId === newParentId) return true;
  const map = new Map(allHabits.map((h) => [h.id, h]));
  let cursor: string | undefined = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === habitId) return true;
    if (seen.has(cursor)) return true; // defensive against pre-existing cycles
    seen.add(cursor);
    const parent: Habit | undefined = map.get(cursor);
    cursor = parent?.stackParent;
  }
  return false;
}

// --- Link / unlink (mutators, expect data) ---

export function linkHabitToParentInPlace(
  allHabits: Habit[],
  habitId: string,
  parentId: string,
): { ok: boolean; reason?: 'self' | 'cycle' | 'missing' } {
  const habit = allHabits.find((h) => h.id === habitId);
  const parent = allHabits.find((h) => h.id === parentId);
  if (!habit || !parent) return { ok: false, reason: 'missing' };
  if (habitId === parentId) return { ok: false, reason: 'self' };
  if (wouldCreateCycle(allHabits, habitId, parentId)) {
    return { ok: false, reason: 'cycle' };
  }
  habit.stackParent = parentId;
  return { ok: true };
}

export function unlinkHabitInPlace(allHabits: Habit[], habitId: string): void {
  const habit = allHabits.find((h) => h.id === habitId);
  if (habit) habit.stackParent = undefined;
}

/**
 * Drop stackParent references to a habit that's about to be removed/archive.
 * Returns the list of habit IDs whose parent was cleared (for caller logging).
 */
export function clearDanglingStackParentsInPlace(allHabits: Habit[], removedId: string): string[] {
  const cleared: string[] = [];
  for (const h of allHabits) {
    if (h.stackParent === removedId) {
      h.stackParent = undefined;
      cleared.push(h.id);
    }
  }
  return cleared;
}

// --- Stack status computation ---

export type StackStepState = 'done' | 'pending' | 'blocked' | 'untracked';

export interface StackStep {
  habitId: string;
  habitName: string;
  habitColor: string;
  order: number;
  archived: boolean;
  state: StackStepState;
  parentId?: string;
}

export interface StackStatus {
  rootId: string;
  rootName: string;
  steps: StackStep[];
  doneCount: number;
  pendingCount: number;
  blockedCount: number;
  untrackedCount: number;
  totalCount: number; // excludes archived steps
  completionPct: number;
}

/**
 * Build the completion map for a given day: date-key -> boolean.
 * `undefined` means no entry was recorded (treated as missed for stack purposes).
 */
function completionForDay(checkIns: CheckIn[], habitId: string, dayKey: string): boolean {
  const ci = checkIns.find((c) => c.habitId === habitId && c.date === dayKey);
  if (!ci) return false;
  return ci.completed;
}

/**
 * Walk from a root habit down via stackParent to collect the full chain.
 * Stops at archived steps (kept in the chain but excluded from progress).
 * Cycles are guarded (shouldn't happen given cycle detection in linkHabit).
 */
/**
 * Compute today's status for every stack. A "stack" is a habit that has at
 * least one direct child (habits with `stackParent` pointing to it).
 */
export function computeStacks(allHabits: Habit[], checkIns: CheckIn[], today: Date = new Date()): StackStatus[] {
  const dayKey = toDateKey(today);
  const childrenOf = new Map<string, Habit[]>();
  for (const h of allHabits) {
    if (!h.stackParent) continue;
    if (h.archived) continue; // archived children don't form visible stacks
    const arr = childrenOf.get(h.stackParent) ?? [];
    arr.push(h);
    childrenOf.set(h.stackParent, arr);
  }

  // Roots = habits that are parents of at least one non-archived child.
  const rootHabits = allHabits.filter((h) => !h.archived && (childrenOf.get(h.id)?.length ?? 0) > 0);
  const out: StackStatus[] = [];
  const habitMap = new Map(allHabits.map((h) => [h.id, h]));

  for (const root of rootHabits) {
    const steps = collectChainWithCheckIns(allHabits, checkIns, root.id, dayKey, habitMap);
    const active = steps.filter((s) => !s.archived);
    const doneCount = active.filter((s) => s.state === 'done').length;
    const pendingCount = active.filter((s) => s.state === 'pending').length;
    const blockedCount = active.filter((s) => s.state === 'blocked').length;
    const untrackedCount = active.filter((s) => s.state === 'untracked').length;
    const totalCount = active.length;
    const completionPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    out.push({
      rootId: root.id,
      rootName: root.name,
      steps,
      doneCount,
      pendingCount,
      blockedCount,
      untrackedCount,
      totalCount,
      completionPct,
    });
  }

  // Stable sort: by root name asc.
  out.sort((a, b) => a.rootName.localeCompare(b.rootName));
  return out;
}

/**
 * Same as collectChain, but plugs the actual `checkIns` (so completion state
 * reflects today's checks, not the default-pending from collectChain).
 */
function collectChainWithCheckIns(
  allHabits: Habit[],
  checkIns: CheckIn[],
  rootId: string,
  dayKey: string,
  habitMap: Map<string, Habit>,
): StackStep[] {
  const childrenOf = new Map<string, Habit[]>();
  for (const h of allHabits) {
    if (!h.stackParent) continue;
    const arr = childrenOf.get(h.stackParent) ?? [];
    arr.push(h);
    childrenOf.set(h.stackParent, arr);
  }

  const chain: StackStep[] = [];
  const visited = new Set<string>();
  const queue: Habit[] = [];
  const root = habitMap.get(rootId);
  if (!root) return chain;
  queue.push(root);

  while (queue.length > 0) {
    const h = queue.shift()!;
    if (visited.has(h.id)) continue;
    visited.add(h.id);

    let state: StackStepState;
    if (h.archived) {
      state = 'untracked';
    } else if (h.stackParent) {
      // Find the parent's already-computed state in the chain.
      const parentStep = chain.find((s) => s.habitId === h.stackParent);
      if (!parentStep) {
        // Dangling parent reference (shouldn't happen — store clears them).
        state = 'untracked';
      } else if (parentStep.state === 'done') {
        state = completionForDay(checkIns, h.id, dayKey) ? 'done' : 'pending';
      } else {
        // Parent is pending, blocked, or untracked → child is blocked.
        state = 'blocked';
      }
    } else {
      // Root habit: state comes from completion only.
      state = completionForDay(checkIns, h.id, dayKey) ? 'done' : 'pending';
    }

    chain.push({
      habitId: h.id,
      habitName: h.name,
      habitColor: h.color,
      order: h.order,
      archived: h.archived,
      state,
      parentId: h.stackParent,
    });

    const kids = childrenOf.get(h.id) ?? [];
    kids.sort((a, b) => a.name.localeCompare(b.name) || a.order - b.order);
    for (const kid of kids) queue.push(kid);
  }
  return chain;
}

/**
 * Return the very next pending habit across all stacks for today.
 * Algorithm: walk each stack in order; the first habit in state 'pending'
 * whose ancestors are all 'done' or 'root' wins.
 *
 * Excludes steps that are archived or in 'blocked' state.
 */
export function getNextStackSuggestion(
  allHabits: Habit[],
  checkIns: CheckIn[],
  today: Date = new Date(),
): { habitId: string; habitName: string; habitColor: string; rootName: string } | null {
  const stacks = computeStacks(allHabits, checkIns, today);
  for (const stack of stacks) {
    for (const step of stack.steps) {
      if (step.archived || step.state !== 'pending') continue;
      return {
        habitId: step.habitId,
        habitName: step.habitName,
        habitColor: step.habitColor,
        rootName: stack.rootName,
      };
    }
  }
  return null;
}

// Note: getNextStackSuggestion only returns steps that are pending AND
// have a parent state of 'done' (because blocked steps never enter the
// 'pending' state — see collectChainWithCheckIns).
