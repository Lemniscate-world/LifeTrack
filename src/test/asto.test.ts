import { describe, expect, it } from 'vitest';
import { computeMissionProgress, suggestQuota, suggestMissionsFromSky, BODY_DOMAINS } from '../asto';
import type { CheckIn, Mission } from '../types';

const BASE: Mission = {
  id: 'm1',
  name: 'Sport',
  habitIds: ['h1'],
  window: { kind: 'fixed', startDate: '2026-07-01', endDate: '2026-07-31' },
  quota: 10,
  createdAt: '2026-06-01T00:00:00Z',
};

const cin = (habitId: string, date: string, completed = true, count?: number): CheckIn => ({
  habitId, date, completed, count, notes: undefined, projectId: undefined,
});

describe('missions.computeMissionProgress', () => {
  it('status upcoming before the window starts', () => {
    const p = computeMissionProgress(BASE, [], '2026-06-20');
    expect(p.status).toBe('upcoming');
    expect(p.completedCount).toBe(0);
    expect(p.elapsedDays).toBe(0);
    expect(p.elapsedRatio).toBe(0);
    expect(p.daysLeft).toBe(41); // 31/07 - 20/06
  });

  it('counts check-ins inside the window only', () => {
    const checkIns = [
      cin('h1', '2026-06-25'), // before window
      cin('h1', '2026-07-03'),
      cin('h1', '2026-07-03'), // second completion same day (count=1 default)
      cin('h1', '2026-07-15'),
      cin('h1', '2026-08-01'), // after window
      cin('h2', '2026-07-10'), // wrong habit
    ];
    const p = computeMissionProgress(BASE, checkIns, '2026-07-20');
    expect(p.status).toBe('active');
    expect(p.completedDays).toBe(2);
    expect(p.completedCount).toBe(3);
    expect(p.windowDays).toBe(31);
    expect(p.elapsedDays).toBe(20);
    expect(p.quotaRatio).toBeCloseTo(0.3, 5);
    expect(p.quotaReached).toBe(false);
    expect(p.actualPerWeek).toBeCloseTo(3 / (31 / 7), 5);
  });

  it('multi-completions (count) add up toward the quota', () => {
    const checkIns = [cin('h1', '2026-07-02', true, 4), cin('h1', '2026-07-09', true, 3)];
    const p = computeMissionProgress(BASE, checkIns, '2026-07-31');
    expect(p.completedCount).toBe(7);
    expect(p.completedDays).toBe(2);
  });

  it('marks done when quota reached and failed past the end', () => {
    const done = computeMissionProgress(BASE, Array.from({ length: 10 }, (_, i) => cin('h1', `2026-07-${String(i + 1).padStart(2, '0')}`)), '2026-08-01');
    expect(done.status).toBe('done');
    expect(done.quotaReached).toBe(true);
    expect(done.quotaRatio).toBe(1);

    const failed = computeMissionProgress(BASE, [cin('h1', '2026-07-03')], '2026-08-01');
    expect(failed.status).toBe('failed');
    expect(failed.quotaReached).toBe(false);
  });

  it('archived overrides every other status', () => {
    const p = computeMissionProgress({ ...BASE, archived: true }, [], '2026-07-10');
    expect(p.status).toBe('archived');
  });

  it('neededPerWeek tells what is required to reach the quota', () => {
    const p = computeMissionProgress(BASE, [cin('h1', '2026-07-03')], '2026-07-15');
    // 15 days elapsed, 1 done → remaining = 16 days = 2.29 weeks; need 9 more.
    expect(p.neededPerWeek).toBeCloseTo(9 / (16 / 7), 5);
    expect(p.neededPerWeek).toBeGreaterThan(0);
  });

  it('projects the total at current pace', () => {
    const p = computeMissionProgress(BASE, [cin('h1', '2026-07-01'), cin('h1', '2026-07-08'), cin('h1', '2026-07-15')], '2026-07-15');
    // 3 sessions over the whole 31-day window → ~0.68/week → 3 projected.
    expect(p.projectedTotal).toBe(3);
  });

  it('quota reached stops the projection', () => {
    const checkIns = Array.from({ length: 12 }, (_, i) => cin('h1', `2026-07-${String(i + 1).padStart(2, '0')}`));
    const p = computeMissionProgress(BASE, checkIns, '2026-07-20');
    expect(p.quotaReached).toBe(true);
    expect(p.projectedTotal).toBe(10);
  });

  it('no quota → quotaRatio stays 0 but stats still flow', () => {
    const m: Mission = { ...BASE, quota: undefined };
    const p = computeMissionProgress(m, [cin('h1', '2026-07-03')], '2026-07-10');
    expect(p.quotaRatio).toBe(0);
    expect(p.actualPerWeek).toBeGreaterThan(0);
    expect(p.status).toBe('active');
  });

  it('transit windows work like fixed ones', () => {
    const m: Mission = {
      ...BASE,
      window: { kind: 'transit', body: 'mars', signIndex: 0, startDate: '2026-07-01', endDate: '2026-08-15' },
    };
    const p = computeMissionProgress(m, [cin('h1', '2026-08-01')], '2026-08-10');
    expect(p.status).toBe('active');
    expect(p.windowDays).toBe(46);
    expect(p.completedCount).toBe(1);
  });
});

describe('missions.suggestQuota', () => {
  it('scales a weekly pace to the window length', () => {
    expect(suggestQuota(3, 31)).toBe(13); // 3 × 31/7 ≈ 13.3
    expect(suggestQuota(3, 7)).toBe(3);
    expect(suggestQuota(0, 30)).toBe(1);
  });
});

describe('missions.suggestMissionsFromSky', () => {
  const habit = (id: string, category = 'health') => ({ id, category, archived: false });
  const now = new Date();

  it('always proposes the current Sun transit (window in progress or ahead)', () => {
    const suggestions = suggestMissionsFromSky({
      habits: [habit('h1')],
      checkIns: [],
      weakDomains: [],
      existingMissions: [],
      now,
      transitHorizonDays: 120,
    });
    expect(suggestions.length).toBeGreaterThan(0);
    const sun = suggestions.find((s) => s.source === 'transit' && s.key.startsWith('transit:sun:'));
    expect(sun).toBeDefined();
    expect(sun!.window.kind).toBe('transit');
    expect(sun!.autoCreate).toBe(false); // no weak domain → 1-click only
    expect(sun!.habitIds).toContain('h1');
    expect(sun!.quota).toBeGreaterThanOrEqual(1);
  });

  it('flags transits on weak domains as autoCreate', () => {
    const suggestions = suggestMissionsFromSky({
      habits: [habit('h1')],
      checkIns: [],
      weakDomains: ['training'], // Mars is classically linked to training
      existingMissions: [],
      now,
    });
    const mars = suggestions.find((s) => s.key.startsWith('transit:mars:'));
    expect(mars).toBeDefined();
    expect(mars!.autoCreate).toBe(true);
    expect(mars!.objective).toContain('faible');
  });

  it('dedupes against existing transit missions on the same (body, sign)', () => {
    const base = suggestMissionsFromSky({
      habits: [habit('h1')],
      checkIns: [],
      weakDomains: ['training'],
      existingMissions: [],
      now,
    });
    const mars = base.find((s) => s.key.startsWith('transit:mars:'));
    expect(mars).toBeDefined();
    const existing: Mission = {
      id: 'x',
      name: mars!.name,
      habitIds: ['h1'],
      window: {
        kind: 'transit',
        body: 'mars',
        signIndex: Number(mars!.key.split(':')[2]),
        startDate: mars!.window.startDate,
        endDate: mars!.window.endDate,
      },
      createdAt: '2026-01-01T00:00:00Z',
    };
    const after = suggestMissionsFromSky({
      habits: [habit('h1')],
      checkIns: [],
      weakDomains: ['training'],
      existingMissions: [existing],
      now,
    });
    expect(after.find((s) => s.key === mars!.key)).toBeUndefined();
  });

  it('resolves aspects to fixed windows with a quota from real pace', () => {
    const checkIns: CheckIn[] = [];
    const base = new Date();
    for (let d = 27; d >= 0; d--) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() - d); // rollover-safe (the old inline math produced day 0 / negatives)
      const k = dt.toISOString().slice(0, 10);
      if (d % 2 === 0) checkIns.push(cin('h1', k)); // ~14 completions / 28 days ≈ 3.5/week
    }
    const suggestions = suggestMissionsFromSky({
      habits: [habit('h1')],
      checkIns,
      weakDomains: [],
      existingMissions: [],
      now,
      aspectHorizonDays: 150,
    });
    const aspect = suggestions.find((s) => s.source === 'aspect');
    expect(aspect).toBeDefined();
    expect(aspect!.window.kind).toBe('fixed');
    expect(aspect!.quota).toBeGreaterThan(1);
    expect(aspect!.rationale).toContain('exact');
  });

  it('never suggests the Moon transit (windows too short for missions)', () => {
    const suggestions = suggestMissionsFromSky({
      habits: [habit('h1')],
      checkIns: [],
      weakDomains: ['mood'],
      existingMissions: [],
      now,
    });
    expect(suggestions.some((s) => s.key.startsWith('transit:moon:'))).toBe(false);
    // Moon's mood domain still maps through BODY_DOMAINS for aspects.
    expect(BODY_DOMAINS.moon).toContain('mood');
  });
});
