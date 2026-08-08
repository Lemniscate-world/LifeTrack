import { describe, it, expect } from 'vitest';
import {
  detectReflections,
  filterNewReflections,
  reflectionEmoji,
  type DataSlice,
} from '../reflection';
import type { Habit, CheckIn, ReflectionEntry } from '../types';

function d(daysBack: number, base = new Date('2026-08-08T12:00:00')): string {
  const d = new Date(base);
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function habit(id: string, name = id, extra: Partial<Habit> = {}): Habit {
  return { id, name, color: '#ccc', goal: 1, createdAt: d(-300), archived: false, order: 0, ...extra };
}

function check(habitId: string, daysBack: number, completed: boolean): CheckIn {
  return { date: d(daysBack), habitId, completed };
}

function slice(overrides: Partial<DataSlice> = {}): DataSlice {
  return {
    habits: [],
    checkIns: [],
    notes: [],
    urges: [],
    challenges: [],
    journalEntries: [],
    ...overrides,
  };
}

describe('detectReflections', () => {
  it('returns empty on empty data', () => {
    expect(detectReflections(slice())).toEqual([]);
  });

  it('detects stale-win: strong in past window, silent this week', () => {
    const h = habit('gym', 'Gym');
    const checkIns = [
      check('gym', 10, true), check('gym', 12, true), check('gym', 14, true), check('gym', 16, true),
    ];
    const out = detectReflections(slice({ habits: [h], checkIns }));
    expect(out.some((r) => r.kind === 'stale-win' && r.habitIds.includes('gym'))).toBe(true);
  });

  it('does not flag stale-win when the habit completed this week', () => {
    const checkIns = [check('gym', 3, true), check('gym', 10, true), check('gym', 12, true)];
    const out = detectReflections(slice({ habits: [habit('gym')], checkIns }));
    expect(out.some((r) => r.kind === 'stale-win')).toBe(false);
  });

  it('detects recurring-leak: often opened but often missed', () => {
    const checkIns = [check('med', 1, true), check('med', 2, false), check('med', 3, false), check('med', 4, false)];
    const out = detectReflections(slice({ habits: [habit('med')], checkIns }));
    expect(out.some((r) => r.kind === 'recurring-leak' && r.habitIds.includes('med'))).toBe(true);
  });

  it('detects quiet neglect: had history, silent 14 days', () => {
    const checkIns = [check('read', 60, true), check('read', 40, false), check('read', 20, true)];
    const out = detectReflections(slice({ habits: [habit('read')], checkIns }));
    expect(out.some((r) => r.kind === 'neglect' && r.habitIds.includes('read'))).toBe(true);
  });

  it('excludes habits with no history from neglect', () => {
    const out = detectReflections(slice({ habits: [habit('newbie')] }));
    expect(out.some((r) => r.kind === 'neglect')).toBe(false);
  });

  it('detects momentum when >= 3 habits completed this week', () => {
    const habits = [habit('a'), habit('b'), habit('c')];
    const checkIns = [
      check('a', 1, true), check('b', 2, true), check('c', 3, true),
    ];
    const out = detectReflections(slice({ habits, checkIns }));
    expect(out.some((r) => r.kind === 'momentum')).toBe(true);
  });

  it('detects confidence at >=5/7 days completed', () => {
    const checkIns = Array.from({ length: 6 }, (_, i) => check('streak', i, true));
    const out = detectReflections(slice({ habits: [habit('streak')], checkIns }));
    expect(out.some((r) => r.kind === 'confidence' && r.habitIds.includes('streak'))).toBe(true);
  });

  it('detects repetition when the same urge type gave in 3+ times', () => {
    const urges = Array.from({ length: 3 }, (_, i) => ({
      id: `u${i}`,
      type: 'procrastination',
      intensity: 5,
      startTime: d(i + 1),
      outcome: 'gave_in' as const,
    }));
    const out = detectReflections(slice({ urges }));
    expect(out.some((r) => r.kind === 'repetition' && r.context.includes('procrastination'))).toBe(true);
  });

  it('detects pattern-progress from a recent working track', () => {
    const tracks = [{ patternId: 'catastrophizing', step: 2, seenCount: 5, lastSeen: d(1), createdAt: d(-30) }];
    const out = detectReflections(slice({ tracks }));
    expect(out.some((r) => r.kind === 'pattern-progress' && r.dedupeKey.includes('catastrophizing'))).toBe(true);
  });

  it('does not ask pattern-progress when the track is old', () => {
    const tracks = [{ patternId: 'catastrophizing', step: 2, seenCount: 5, lastSeen: d(20), createdAt: d(-30) }];
    const out = detectReflections(slice({ tracks }));
    expect(out.some((r) => r.kind === 'pattern-progress')).toBe(false);
  });

  it('every reflection carries a stable dedupeKey', () => {
    const checkIns = [check('gym', 10, true), check('gym', 12, true), check('gym', 14, true)];
    const out = detectReflections(slice({ habits: [habit('gym')], checkIns }));
    for (const r of out) expect(r.dedupeKey.length).toBeGreaterThan(0);
  });
});

describe('filterNewReflections', () => {
  const detected = [{
    kind: 'stale-win' as const,
    title: 't',
    question: 'q',
    context: 'c',
    habitIds: ['x'],
    dedupeKey: 'stale-win:x',
  }];

  it('filters out recently asked dedupeKeys', () => {
    const persisted: ReflectionEntry[] = [{
      id: '1', kind: 'stale-win', title: 't', question: 'q', context: 'c', habitIds: ['x'],
      dedupeKey: 'stale-win:x', createdAt: new Date().toISOString(), status: 'open',
    }];
    expect(filterNewReflections(detected, persisted, 7)).toEqual([]);
  });

  it('keeps reflections still available for the window', () => {
    const old: ReflectionEntry = {
      id: '1', kind: 'stale-win', title: 't', question: 'q', context: 'c', habitIds: ['x'],
      dedupeKey: 'stale-win:x', createdAt: '2026-01-01T00:00:00Z', status: 'open',
    };
    expect(filterNewReflections(detected, [old], 7)).toEqual(detected);
  });
});

describe('reflectionEmoji', () => {
  it('maps every kind to an emoji', () => {
    expect(reflectionEmoji('stale-win')).toBe('🏆');
    expect(reflectionEmoji('momentum')).toBe('🚀');
    expect(reflectionEmoji('unknown' as never)).toBe('💡');
  });
});