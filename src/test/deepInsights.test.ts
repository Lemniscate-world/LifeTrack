// src/test/deepInsights.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildDayTable,
  twoPropP,
  twoMeanP,
  contrastiveWords,
  firstCheckHours,
  buildIcsForPlan,
  generateDeepInsights,
} from '../deepInsights';
import { isJunkyHabitName, adoptProtocol } from '../protocols';
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

describe('firstCheckHours', () => {
  it('keeps the earliest completed check per day', () => {
    const map = firstCheckHours([
      { date: '2026-08-01', habitId: 'a', completed: true, checkedAt: '2026-08-01T09:00:00' },
      { date: '2026-08-01', habitId: 'b', completed: true, checkedAt: '2026-08-01T07:30:00' },
      { date: '2026-08-01', habitId: 'c', completed: false, checkedAt: '2026-08-01T06:00:00' },
      { date: '2026-08-02', habitId: 'a', completed: false },
    ]);
    expect(map.get('2026-08-01')).toBe(7); // 07:30 local, failed 06:00 ignored
    expect(map.has('2026-08-02')).toBe(false);
  });
});

describe('isJunkyHabitName / adoptProtocol guard', () => {
  it('flags arXiv announce blocks, DOIs and overlong titles', () => {
    expect(isJunkyHabitName('arXiv:2510.15911v4 Announce Type: replace-cross Abstract: The Sleeping')).toBe(true);
    expect(isJunkyHabitName('Dense-caption retrieval for egocentric video understanding tasks')).toBe(true);
    expect(isJunkyHabitName('DOI 10.1038/s41586-026-08888-x')).toBe(true);
    expect(isJunkyHabitName('Gym')).toBe(false);
    expect(isJunkyHabitName('No Sodas After Noon')).toBe(false);
  });

  it('adoptProtocol never creates habits from junk suggestions', () => {
    const proto = {
      id: 'p1', title: 'Some dense paper title that is way too long to be a habit name here',
      source: 'arXiv', claim: 'x', evidenceLevel: 'B', domain: 'sleep', protocol: 'y',
      keywords: [], habitSuggestions: ['arXiv:2608.18521v2 Announce Type: new Abstract: Dense-caption'],
    } as unknown as import('../types').Protocol;
    const res = adoptProtocol('p1', [proto], []);
    expect(res.created.length).toBe(0);
  });
});

describe('buildIcsForPlan', () => {
  it('produces a valid VCALENDAR with one all-day event per date', () => {
    const ics = buildIcsForPlan('LifeTrack — Gym', 'Plan Gym — mois prochain', ['2026-09-01', '2026-09-03']);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260901');
    expect(ics).toContain('SUMMARY:LifeTrack \\— Gym'.replace('\\—', '—')); // em-dash preserved unescaped
  });
});

describe('twoMeanP', () => {
  it('separates clearly shifted samples', () => {
    const a = [0.9, 0.85, 0.8, 0.95, 0.88, 0.92];
    const b = [0.4, 0.5, 0.45, 0.55, 0.42, 0.48];
    expect(twoMeanP(a, b)!).toBeLessThan(0.001);
  });
});

describe('generateDeepInsights — weekend drift', () => {
  it('detects a habit collapsing on weekends', () => {
    const habits = [habit('medit', 'Méditation')];
    const checkIns: CheckIn[] = [];
    // 40 days ending 2026-08-20 (Thu): done on weekdays, missed on weekends.
    for (let i = 40; i >= 1; i--) {
      const d = new Date('2026-08-20T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      checkIns.push(ci(date, 'medit', !isWeekend));
    }
    const insights = generateDeepInsights(habits, checkIns, {}, {}, new Date('2026-08-20T12:00:00Z'));
    const drift = insights.find((x) => x.id === 'drift|medit');
    expect(drift).toBeDefined();
    expect(drift!.title).toContain("s'effondre");
  });
});

describe('generateDeepInsights — goal calibration', () => {
  it('flags a chronically missed monthly goal', () => {
    const habits: Habit[] = [{
      id: 'gym', name: 'Gym', color: '#000', icon: 'x', order: 0, archived: false,
      createdAt: '2026-01-01', goal: 26,
    } as unknown as Habit];
    const checkIns: CheckIn[] = [];
    // May-Aug 2026: ~12 completions/month vs goal 26.
    for (const [month, days] of [['2026-05', 31], ['2026-06', 30], ['2026-07', 31], ['2026-08', 19]] as [string, number][]) {
      for (let d = 1; d <= days; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        checkIns.push(ci(date, 'gym', d % 3 === 1)); // ~1/3 of days → ~10/mo
      }
    }
    const insights = generateDeepInsights(habits, checkIns, {}, {}, new Date('2026-08-19T12:00:00Z'));
    const calib = insights.find((x) => x.id === 'goalcal|gym');
    expect(calib).toBeDefined();
    expect(calib!.title).toContain('Plan progressif');
    expect(calib!.body).toContain('médiane');
    expect(calib!.plan).toBeDefined();
    expect(calib!.plan!.dates.length).toBeGreaterThan(0);
  });
});
