// src/test/deepInsights.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildDayTable,
  twoPropP,
  contrastiveWords,
  generateDeepInsights,
} from '../deepInsights';
import type { Habit, CheckIn } from '../types';

const habit = (id: string, name: string): Habit => ({
  id, name, color: '#000', icon: 'x', order: 0, archived: false,
  createdAt: '2026-01-01', goalPerWeek: 7,
} as unknown as Habit);

function ci(date: string, habitId: string, completed: boolean, notes?: string[]): CheckIn {
  return { date, habitId, completed, ...(notes ? { notes } : {}) };
}

describe('twoPropP', () => {
  it('flags a clear difference as significant', () => {
    const p = twoPropP(9, 10, 4, 10);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.05);
  });
  it('returns null on tiny samples', () => {
    expect(twoPropP(1, 3, 0, 3)).toBeNull();
  });
  it('does not flag noise', () => {
    const p = twoPropP(5, 10, 5, 10);
    expect(p!).toBeGreaterThan(0.5);
  });
});

describe('buildDayTable', () => {
  it('tracks done/tracked and mood per day', () => {
    const days = buildDayTable(
      [ci('2026-08-01', 'a', true), ci('2026-08-01', 'b', false)],
      { '2026-08-01': 'great' },
    );
    const r = days.get('2026-08-01')!;
    expect(r.done.has('a')).toBe(true);
    expect(r.tracked.has('b')).toBe(true);
    expect(r.mood).toBe(7); // moodRank('great')
  });
});

describe('contrastiveWords', () => {
  it('finds words overrepresented in failures', () => {
    const fail = Array.from({ length: 8 }, (_, i) => `trop fatigue apres le boulot ${i}`);
    const ok = Array.from({ length: 8 }, (_, i) => `super seance motivante ${i}`);
    const words = contrastiveWords(fail, ok);
    expect(words.length).toBeGreaterThan(0);
    expect(words.some((w) => w.word.toLowerCase().includes('fatigue'))).toBe(true);
  });
  it('returns empty when vocabulary does not contrast', () => {
    const same = ['journee normale tranquille'];
    expect(contrastiveWords(same, same)).toEqual([]);
  });
});

describe('generateDeepInsights — streak risk forecast', () => {
  it('warns about the weekday where the habit historically fails', () => {
    // Build 5 weeks of history: Gym done every day EXCEPT Saturdays.
    const habits = [habit('gym', 'Gym')];
    const checkIns: CheckIn[] = [];
    // Anchor period well in the past relative to "today" we pass (2026-08-20 is a Thursday)
    for (let i = 40; i >= 1; i--) {
      const d = new Date('2026-08-20T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const isSaturday = d.getUTCDay() === 6;
      checkIns.push(ci(date, 'gym', !isSaturday));
    }
    // Current streak: last 3 days done
    for (let i = 2; i >= 0; i--) {
      const d = new Date('2026-08-20T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      // remove auto-added entries duplicates by filtering
      const filtered = checkIns.filter((c) => c.date !== date);
      checkIns.length = 0;
      checkIns.push(...filtered, ci(date, 'gym', true));
    }
    const insights = generateDeepInsights(habits, checkIns, {}, {}, new Date('2026-08-20T12:00:00Z'));
    const risk = insights.find((x) => x.id.startsWith('streakrisk'));
    expect(risk).toBeDefined();
    expect(risk!.title).toContain('samedi');
  });
});

describe('generateDeepInsights — chain detection', () => {
  it('detects A(t) → B(t+1) predictive chain', () => {
    const habits = [habit('run', 'Course'), habit('read', 'Lecture')];
    const checkIns: CheckIn[] = [];
    // 30 days: reading happens ONLY the day after a run — one-directional.
    for (let i = 30; i >= 1; i--) {
      const d = new Date('2026-08-20T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const runToday = i % 3 === 0;
      const readToday = runTomorrow(i);
      if (runToday) checkIns.push(ci(date, 'run', true));
      else checkIns.push(ci(date, 'run', false));
      if (readToday) checkIns.push(ci(date, 'read', true));
      else checkIns.push(ci(date, 'read', false));
    }
    function runTomorrow(idx: number): boolean {
      // idx = days ago. Tomorrow of day-idx is day-(idx-1).
      // read on day idx iff the PREVIOUS calendar day (idx+1 ago) had a run.
      return (idx + 1) % 3 === 0;
    }
    const insights = generateDeepInsights(habits, checkIns, {}, {}, new Date('2026-08-20T12:00:00Z'));
    const chain = insights.find((x) => x.id === 'chain|run|read');
    expect(chain).toBeDefined();
    expect(chain!.body).toContain('Course');
    expect(chain!.stat).toMatch(/p[<=]/);
  });
});
