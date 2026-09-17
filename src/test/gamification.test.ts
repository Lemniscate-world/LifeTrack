import { describe, it, expect } from 'vitest';
import type { Habit, CheckIn, Note, Challenge, Persona } from '../types';
import {
  XP_RULES,
  computeXp,
  streakMilestonesForHabit,
  bestStreakAllTime,
  levelForXp,
  xpForLevel,
  levelProgress,
  rankForLevel,
  hasPerfectDay,
  habitMastersCount,
  computeMedals,
  xpInRange,
  compareLastWeeks,
  comboDays,
  comboMultiplier,
  xpTodayWithCombo,
  resilienceShields,
  personaProgress,
  suggestPersonas,
} from '../gamification';

const LARGE_YEAR = 2026;
function key(m: number, d: number): string {
  return `${LARGE_YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function ci(habitId: string, date: string, completed = true, count = 1): CheckIn {
  return { habitId, date, completed, count };
}
function habit(id: string, goal = 1, archived = false): Habit {
  return {
    id, name: id, color: '#fff', goal,
    createdAt: new Date().toISOString(), archived, order: 0,
  };
}

describe('computeXp', () => {
  it('awards XP for completed check-ins', () => {
    const h = habit('med', 3); // goal 3 → a 1-completion day does not meet the goal
    const checks = [ci('med', key(1, 1)), ci('med', key(1, 2)), ci('off', key(1, 3), false)];
    const xp = computeXp([h], checks, [], []);
    expect(xp.checkIns).toBe(2 * XP_RULES.checkIn);
    expect(xp.goalDays).toBe(0);
    expect(xp.total).toBe(2 * XP_RULES.checkIn);
  });

  it('awards goal-day XP only when the daily goal is met', () => {
    const h = habit('med', 2);
    const checks = [ci('med', key(1, 1), true, 2), ci('med', key(1, 2), true, 1)];
    const xp = computeXp([h], checks, [], []);
    expect(xp.goalDays).toBe(XP_RULES.goalDay);
  });

  it('awards streak XP for every full 7-day run', () => {
    const h = habit('med');
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 14; d++) checks.push(ci('med', key(1, d)));
    const xp = computeXp([h], checks, [], []);
    expect(xp.streakMilestones).toBe(2 * XP_RULES.streakMilestone);
  });

  it('awards challenge + achievement XP', () => {
    const h = habit('med');
    const challenges: Challenge[] = [
      { id: 'c1', habitId: 'med', name: 'x', days: 30, dailyGoal: 1, startDate: key(1, 1), status: 'completed', createdAt: new Date().toISOString() },
    ];
    const notes: Note[] = [{ id: 'n1', habitId: '', content: 'win', createdAt: new Date().toISOString(), achievementCategory: 'physical' }];
    const xp = computeXp([h], [], notes, challenges);
    expect(xp.challenges).toBe(XP_RULES.challenge);
    expect(xp.achievements).toBe(XP_RULES.achievement);
    expect(xp.total).toBe(XP_RULES.challenge + XP_RULES.achievement);
  });
});

describe('streakMilestonesForHabit', () => {
  it('counts one milestone at 7 days and two at 14 (consecutive)', () => {
    const checks: CheckIn[] = [];
    for (let d = 1; d <= 14; d++) checks.push(ci('med', key(1, d)));
    expect(streakMilestonesForHabit('med', checks)).toBe(2);
  });
  it('resets milestones when the run breaks', () => {
    const checks = [
      ci('med', key(1, 1)), ci('med', key(1, 2)),
      ci('med', key(1, 10)),
      ci('med', key(2, 1)), ci('med', key(2, 2)), ci('med', key(2, 3)), ci('med', key(2, 4)),
    ];
    expect(streakMilestonesForHabit('med', checks)).toBe(0);
  });
});

describe('bestStreakAllTime', () => {
  it('returns the longest consecutive run across habits', () => {
    const checks = [
      ci('a', key(1, 1)), ci('a', key(1, 2)), ci('a', key(1, 3)),
      ci('b', key(1, 1)), ci('b', key(1, 2)),
    ];
    expect(bestStreakAllTime([habit('a'), habit('b')], checks)).toBe(3);
  });
});

describe('levels & ranks', () => {
  it('xpForLevel is 0 at level 1 and 100 at level 2', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
  });
  it('levelForXp maps XP to level monotonically', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(999999)).toBeGreaterThan(1);
  });
  it('levelProgress reports progress into the next level', () => {
    const p = levelProgress(50);
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(50);
    expect(p.xpForNext).toBe(100);
    expect(p.progressPct).toBe(50);
  });
  it('rankForLevel picks the right title at the boundaries', () => {
    expect(rankForLevel(1).rankName).toBe('Explorer');
    expect(rankForLevel(5).rankName).toBe('Observer');
    expect(rankForLevel(10).rankName).toBe('Builder');
    expect(rankForLevel(15).rankName).toBe('Architect');
    expect(rankForLevel(25).rankName).toBe('Strategist');
    expect(rankForLevel(40).rankName).toBe('Master of Self');
    expect(rankForLevel(61).rankName).toBe('Legend');
  });
});

describe('perfect day & habit masters', () => {
  it('hasPerfectDay is true when all active habits are done the same day', () => {
    const checks = [ci('a', key(1, 1)), ci('b', key(1, 1))];
    expect(hasPerfectDay([habit('a'), habit('b')], checks)).toBe(true);
  });
  it('hasPerfectDay ignores archived habits', () => {
    const checks = [ci('a', key(1, 1))];
    expect(hasPerfectDay([habit('a'), habit('b', 1, true)], checks)).toBe(true);
  });
  it('habitMastersCount counts habits at >=70% over the window', () => {
    // Habit 'a': 21 done days in the 30-day window ending 6/15 → 70%
    const checks: CheckIn[] = [];
    for (let i = 0; i < 30; i++) {
      const dt = new Date(LARGE_YEAR, 5, 15 - (29 - i)); // 5/17 … 6/15
      if (i < 21) checks.push(ci('a', `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`));
    }
    expect(habitMastersCount([habit('a'), habit('b')], checks, 30, new Date(LARGE_YEAR, 5, 15))).toBe(1);
  });
});

describe('computeMedals', () => {
  it('earns first-steps with one completion and first-win with one achievement', () => {
    const checks = [ci('a', key(1, 1))];
    const notes: Note[] = [{ id: 'n', habitId: '', content: 'x', createdAt: `${key(1, 1)}T10:00:00Z`, achievementCategory: 'work' }];
    const medals = computeMedals([habit('a')], checks, notes, [], 200, 1);
    const firstSteps = medals.find((m) => m.id === 'first-steps');
    const firstWin = medals.find((m) => m.id === 'first-win');
    const perfectDay = medals.find((m) => m.id === 'perfect-first');
    expect(firstSteps?.earned).toBe(true);
    expect(firstSteps?.earnedAt).toBe(key(1, 1));
    expect(firstWin?.earned).toBe(true);
    // one completion on the only active habit also earns the perfect-day medal
    expect(perfectDay?.earned).toBe(true);
    // ...plus the 1-day streak and 100 XP medals
    expect(medals.find((m) => m.id === 'streak-1')?.earned).toBe(true);
    expect(medals.find((m) => m.id === 'xp-100')?.earned).toBe(true);
    expect(medals.find((m) => m.id === 'challenge-5')?.earned).toBe(false);
  });
  it('earns a low-level rank medal only at the right level', () => {
    const medalsLow = computeMedals([], [], [], [], 0, 1);
    expect(medalsLow.find((m) => m.id === 'level-5')?.earned).toBe(false);
    const medalsHigh = computeMedals([], [], [], [], 0, 5);
    expect(medalsHigh.find((m) => m.id === 'level-5')?.earned).toBe(true);
  });
  it('uses mood, urge and lever context to award reflection/self medals', () => {
    const moods: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) moods[`2026-01-${String(i).padStart(2, '0')}`] = 'calm';
    const urges = Array.from({ length: 12 }, () => ({ id: 'u', type: 'craving', intensity: 5, startTime: '2026-01-01T08:00:00Z', outcome: 'surfed' as const }));
    const levers = [{ id: 'l', content: 'Mornings', effect: 'X', createdAt: '2026-01-01' }];
    const medals = computeMedals([], [], [], [], 0, 1, { moods, urges, levers });
    expect(medals.find((m) => m.id === 'mood-7')?.earned).toBe(true);
    expect(medals.find((m) => m.id === 'mood-30')?.earned).toBe(false);
    expect(medals.find((m) => m.id === 'urge-10')?.earned).toBe(true);
    expect(medals.find((m) => m.id === 'lever-1')?.earned).toBe(true);
  });
  it('awards the new deep-analysis medals', () => {
    // 1 negative pattern detected in a note → detective medal.
    const notes: Note[] = [{ id: 'n', habitId: '', content: 'Tout est foutu, je suis totalement ruine', createdAt: '2026-01-02T10:00:00Z' }];
    const moods: Record<string, string> = { '2026-02-10': 'calm' };
    const levers = [{ id: 'l', content: 'Marche', effect: '+ énergie', createdAt: '2026-01-01' }];
    const medals = computeMedals([], [], notes, [], 0, 1, { moods, levers });
    expect(medals.find((m) => m.id === 'pattern-1')?.earned).toBe(true);
    expect(medals.find((m) => m.id === 'lever-effect')?.earned).toBe(true);
    // Not earned yet: surf nowriteable needs 10 urges at ≥50%.
    expect(medals.find((m) => m.id === 'surf-balance')?.earned).toBe(false);
    // Emotions need 8+ mood days; one mood day cannot rise the trajectory.
    expect(medals.find((m) => m.id === 'mood-rising')?.earned).toBe(false);
  });
});

describe('week-over-week comparison', () => {
  it('compares this week against the previous week', () => {
    const h = habit('med');
    // Last 7 days: key(12, 9)..key(12,15) → 7 completions
    // Previous 7 days: key(12, 2)..key(12,8) → 3 completions
    const checks: CheckIn[] = [];
    for (let d = 9; d <= 15; d++) checks.push(ci('med', key(12, d)));
    for (let d = 2; d <= 4; d++) checks.push(ci('med', key(12, d)));
    const comp = compareLastWeeks([h], checks, new Date(LARGE_YEAR, 11, 15));
    // each completed day also meets the goal (goal 1) → checkIn XP + goal-day XP
    const perDay = XP_RULES.checkIn + XP_RULES.goalDay;
    expect(comp.currentXp).toBe(7 * perDay);
    expect(comp.previousXp).toBe(3 * perDay);
    expect(comp.currentCompleted).toBe(7);
    expect(comp.previousCompleted).toBe(3);
    expect(comp.improved).toBe(true);
    expect(comp.deltaPct).toBeGreaterThan(0);
  });
  it('xpInRange only counts day-completions inside the inclusive range', () => {
    const h = habit('med', 1);
    const checks = [ci('med', key(1, 1)), ci('med', key(1, 5)), ci('med', key(1, 9))];
    const perDay = XP_RULES.checkIn + XP_RULES.goalDay;
    expect(xpInRange([h], checks, key(1, 1), key(1, 5))).toBe(2 * perDay);
  });
});

describe('personaProgress', () => {
  it('computes average completion of linked habits over the window', () => {
    const p: Persona = { id: 'p1', name: 'Calm', emoji: '🧘', habitIds: ['a'], createdAt: new Date().toISOString() };
    const checks: CheckIn[] = [];
    for (let i = 0; i < 14; i++) {
      const dt = new Date(LARGE_YEAR, 5, 15 - (13 - i));
      checks.push(ci('a', `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`));
    }
    for (let i = 0; i < 7; i++) { // first 7 days only → 50%
      const dt = new Date(LARGE_YEAR, 5, 15 - i);
      checks.push(ci('b', `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`));
    }
    const pp = personaProgress({ ...p, habitIds: ['a', 'b'] }, [habit('a'), habit('b')], checks, 14, new Date(LARGE_YEAR, 5, 15));
    expect(pp).not.toBeNull();
    expect(pp!.pct).toBe(75); // (100% + 50%) / 2
    expect(pp!.habits).toHaveLength(2);
  });
  it('returns null when the persona has no linked / active habit', () => {
    const p: Persona = { id: 'p1', name: 'Empty', emoji: '⭐', habitIds: [] as string[], createdAt: new Date().toISOString() };
    expect(personaProgress(p, [], [], 14, new Date())).toBeNull();
  });
});

describe('suggestPersonas', () => {
  it('suggests an emerging category persona when 2+ habits in a category are strong', () => {
    const habits = [habit('gym'), habit('run'), habit('read')];
    const checks: CheckIn[] = [];
    for (const h of ['gym', 'run']) {
      for (let i = 0; i < 14; i++) {
        const dt = new Date(LARGE_YEAR, 5, 14 - i);
        checks.push(ci(h, `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`));
      }
    }
    const suggestions = suggestPersonas(habits, checks, new Date(LARGE_YEAR, 5, 15));
    expect(suggestions.length).toBeGreaterThan(0);
    // A health-flavoured suggestion built from the two strong habits.
    const catSuggestion = suggestions.find((s) => s.habitIds.length >= 2);
    expect(catSuggestion).toBeDefined();
    expect(catSuggestion!.avgPct).toBeGreaterThanOrEqual(70);
  });

  it('suggests the single strongest habit not already covered', () => {
    const habits = [habit('meditate'), habit('read')];
    const checks: CheckIn[] = [];
    for (let i = 0; i < 14; i++) {
      const dt = new Date(LARGE_YEAR, 5, 14 - i);
      const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      checks.push(ci('meditate', k));
    }
    const suggestions = suggestPersonas(habits, checks, new Date(LARGE_YEAR, 5, 15));
    expect(suggestions.length).toBeGreaterThan(0);
    const best = suggestions.filter((s) => s.habitIds.length === 1).sort((a, b) => b.avgPct - a.avgPct)[0];
    expect(best).toBeDefined();
    expect(best!.habitIds).toContain('meditate');
  });

  it('returns no suggestions without data', () => {
    expect(suggestPersonas([], [])).toEqual([]);
  });

  it('suggests reflective personas from moods and urges context', () => {
    const moods: Record<string, string> = { '2026-01-01': 'calm', '2026-01-02': 'calm' };
    const urges = [
      { id: 'u1', type: 'craving', intensity: 6, startTime: '2026-01-01T08:00:00Z', outcome: 'surfed' as const },
      { id: 'u2', type: 'craving', intensity: 4, startTime: '2026-01-02T08:00:00Z', outcome: 'surfed' as const },
    ];
    const suggestions = suggestPersonas([], [], undefined, { moods, urges, levers: [{ id: 'l', content: 'M', createdAt: '2026-01-01' }] });
    expect(suggestions.some((s) => s.name.includes('Observateur'))).toBe(true);
    expect(suggestions.some((s) => s.name.includes('Surfeur'))).toBe(true);
    expect(suggestions.some((s) => s.name.includes('Ingénieur'))).toBe(true);
  });
});

describe('combo & resilience (fun layer)', () => {
  const NOW = new Date(LARGE_YEAR, 5, 15); // 2026-06-15
  const dkey = (day: number) => key(6, day);

  it('comboDays counts consecutive active days, tolerating unchecked today', () => {
    const hs = [habit('a')];
    const checks = [13, 14].map((d) => ci('a', dkey(d)));
    expect(comboDays(hs, checks, NOW)).toBe(2); // today (15th) unchecked → alive
    expect(comboDays(hs, [...checks, ci('a', dkey(15))], NOW)).toBe(3);
    expect(comboDays(hs, [ci('a', dkey(10))], NOW)).toBe(0); // broken long ago
    expect(comboDays([], checks, NOW)).toBe(0);
  });

  it('comboMultiplier pays streaks more (goal-gradient fuel)', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(2)).toBe(1);
    expect(comboMultiplier(3)).toBe(2);
    expect(comboMultiplier(6)).toBe(2);
    expect(comboMultiplier(7)).toBe(3);
    expect(comboMultiplier(100)).toBe(3);
  });

  it('xpTodayWithCombo multiplies today XP by the combo', () => {
    const hs = [habit('a', 1)];
    const checks = [13, 14, 15].map((d) => ci('a', dkey(d)));
    const r = xpTodayWithCombo(hs, checks, NOW);
    expect(r.combo).toBe(3);
    expect(r.mult).toBe(2);
    expect(r.base).toBeGreaterThan(0);
    expect(r.total).toBe(r.base * 2);
  });

  it('resilienceShields counts distinct doux days in the window', () => {
    const checks: CheckIn[] = [
      { habitId: 'a', date: dkey(10), completed: true, partial: true, subIds: ['s'] },
      { habitId: 'a', date: dkey(12), completed: true, partial: true, subIds: ['s'] },
      { habitId: 'a', date: dkey(13), completed: true },
      { habitId: 'a', date: '2026-01-01', completed: true, partial: true, subIds: ['s'] },
    ];
    expect(resilienceShields(checks, 30, NOW)).toBe(2);
  });

  it('new resilience medals: phoenix, doux, boss, si-alors, closure', () => {
    const hs = [
      { ...habit('pho'), longestGap: 9 },
      { ...habit('plan'), ifThen: [{ cue: 'tard', action: 'doux' }, { cue: 'x', action: 'y' }, { cue: 'z', action: 'w' }] },
    ];
    const checks: CheckIn[] = [
      ci('pho', dkey(14)), ci('pho', dkey(15)),
      { habitId: 'a', date: dkey(10), completed: true, partial: true, subIds: ['s'] },
      { habitId: 'a', date: dkey(11), completed: true, partial: true, subIds: ['s'] },
      { habitId: 'a', date: dkey(12), completed: true, partial: true, subIds: ['s'] },
    ];
    const medals = computeMedals(hs, checks, [], [], 0, 1, { emotionalClosures: 1, now: NOW });
    const byId = new Map(medals.map((m) => [m.id, m]));
    expect(byId.get('phoenix')!.earned).toBe(true);
    expect(byId.get('doux-3')!.earned).toBe(true);
    expect(byId.get('doux-10')!.earned).toBe(false);
    expect(byId.get('doux-10')!.progress).toBe(30);
    expect(byId.get('ifthen-3')!.earned).toBe(true);
    expect(byId.get('closure-1')!.earned).toBe(true);
    expect(byId.get('boss-slay')!.earned).toBe(false); // no history → boss alive
  });
});
// --- v0.6.3: life-intelligence medals (projects / experiments / knowledge) ---

import { computeMedals as cm } from '../gamification';
import { countAdoptedProtocols } from '../preferences';
import type { Experiment, Project, Protocol } from '../types';

const proj = (id: string, status: Project['status'], tasks: { done: boolean }[] = [], deadline?: string): Project =>
  ({
    id,
    name: `P-${id}`,
    status,
    habitIds: [],
    tasks: tasks.map((t, i) => ({ id: `${id}-t${i}`, title: `t${i}`, done: t.done, createdAt: '2026-01-01' })),
    createdAt: '2026-01-01',
    deadline,
  }) as Project;

const exp = (id: string, status: Experiment['status'], conclusion = ''): Experiment =>
  ({ id, title: id, hypothesis: '', startDate: '2026-01-01', endDate: '', linkedHabits: [], linkedMetrics: [], status, conclusion, createdAt: '2026-01-01' }) as Experiment;

const proto = (id: string, suggestions: string[]): Protocol =>
  ({ id, title: id, source: 'test', claim: '', evidenceLevel: 'B', domain: 'sleep', protocol: '', keywords: [], habitSuggestions: suggestions }) as Protocol;

describe('life-intelligence medals (projects / N=1 / savoir)', () => {
  const base = { urges: [], moods: {}, now: new Date(2026, 0, 15) };

  it('earns project medals only for done projects and counts tasks', () => {
    const medals = cm([], [], [], [], 0, 1, {
      ...base,
      projects: [proj('a', 'done', [{ done: true }, { done: true }]), proj('b', 'active', [{ done: false }])],
    });
    const byId = new Map(medals.map((m) => [m.id, m]));
    expect(byId.get('project-1')?.earned).toBe(true);
    expect(byId.get('project-3')?.earned).toBe(false);
    expect(byId.get('project-3')?.progress).toBeCloseTo(33.33, 1);
    // 2 tasks done total → 25 needed, progress 8
    expect(byId.get('project-tasks-25')?.earned).toBe(false);
    // active project without deadline → ship not earned
    expect(byId.get('project-ship')?.earned).toBe(false);
  });

  it('earns ship medal for an active project with a deadline', () => {
    const medals = cm([], [], [], [], 0, 1, {
      ...base,
      projects: [proj('a', 'active', [], '2026-12-01')],
    });
    expect(medals.find((m) => m.id === 'project-ship')?.earned).toBe(true);
  });

  it('counts only concluded experiments (completed with written conclusion)', () => {
    const medals = cm([], [], [], [], 0, 1, {
      ...base,
      experiments: [exp('a', 'completed', 'Ça marchait.'), exp('b', 'completed', ''), exp('c', 'active'), exp('d', 'cancelled')],
    });
    const byId = new Map(medals.map((m) => [m.id, m]));
    expect(byId.get('exp-1')?.earned).toBe(true);
    expect(byId.get('exp-3')?.earned).toBe(false);
    expect(byId.get('exp-3')?.progress).toBeCloseTo(33.33, 1);
    expect(byId.get('exp-running')?.earned).toBe(true);
  });

  it('earns knowledge medals from adopted protocols', () => {
    const habits = [{ id: 'h1', name: 'Cold Shower', archived: false }];
    const protocols = [proto('p1', ['cold shower']), proto('p2', ['meditation'])];
    const medals = cm([], [], [], [], 0, 1, { ...base, protocolsAdopted: countAdoptedProtocols(protocols, habits as Habit[]) });
    const byId = new Map(medals.map((m) => [m.id, m]));
    expect(byId.get('knowledge-1')?.earned).toBe(true);
    expect(byId.get('knowledge-5')?.earned).toBe(false);
  });

  it('is a no-op when the context has no projects/experiments/protocols', () => {
    const medals = cm([], [], [], [], 0, 1, base);
    expect(medals.find((m) => m.id === 'project-1')?.earned).toBe(false);
    expect(medals.find((m) => m.id === 'exp-1')?.earned).toBe(false);
    expect(medals.find((m) => m.id === 'knowledge-1')?.earned).toBe(false);
  });
});
