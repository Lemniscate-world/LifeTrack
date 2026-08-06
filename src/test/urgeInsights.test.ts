import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, UrgeEntry } from '../types';
import {
  proportionWithCI,
  dailyUrgeSeries,
  lagCorrelate,
  surfedVsGiveInNextMood,
  emotionalVolatility,
  urgeSuccessTrend,
  computeUrgeInsights,
} from '../urgeInsights';

function habit(id: string, name = id): Habit {
  return { id, name, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string, completed = true): CheckIn {
  return { habitId, date, completed, count: 1 };
}
function urge(date: string, intensity: number, outcome: UrgeEntry['outcome'], type = 'craving'): UrgeEntry {
  return { id: `${date}-${type}-${intensity}`, type, intensity, startTime: `${date}T08:00:00.000Z`, endTime: `${date}T09:00:00.000Z`, outcome };
}
function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

describe('proportionWithCI', () => {
  it('computes the rate and a Wilson interval', () => {
    const p = proportionWithCI(5, 10)!;
    expect(p.rate).toBe(50);
    expect(p.k).toBe(5);
    expect(p.n).toBe(10);
    expect(p.low).toBeGreaterThan(0);
    expect(p.low).toBeLessThan(50);
    expect(p.high).toBeGreaterThan(50);
    expect(p.high).toBeLessThan(100);
  });
  it('collapses at the extremes', () => {
    expect(proportionWithCI(0, 5)!.rate).toBe(0);
    expect(proportionWithCI(0, 5)!.low).toBe(0);
    expect(proportionWithCI(5, 5)!.rate).toBe(100);
    expect(proportionWithCI(5, 5)!.high).toBe(100);
  });
  it('returns null for invalid input', () => {
    expect(proportionWithCI(6, 5)).toBeNull();
    expect(proportionWithCI(0, 0)).toBeNull();
  });
});

describe('dailyUrgeSeries', () => {
  it('groups urges per day with intensity/outcome aggregates', () => {
    const series = dailyUrgeSeries([
      urge('2026-01-01', 8, 'surfed'),
      urge('2026-01-01', 3, 'gave_in'),
      urge('2026-01-02', 6, 'active'),
    ]);
    expect(series).toHaveLength(2);
    expect(series[0].date).toBe('2026-01-01');
    expect(series[0].count).toBe(2);
    expect(series[0].maxIntensity).toBe(8);
    expect(series[0].surfedFrac).toBe(0.5);
    expect(series[1].maxIntensity).toBe(6);
    expect(series[1].surfedFrac).toBe(0); // still active, nothing ended
  });
});

describe('lagCorrelate', () => {
  it('detects that today’s urge intensity predicts a lower mood tomorrow', () => {
    // High intensity days 1-6, low intensity days 7-12 → mood follows one day later.
    const x = [8, 8, 8, 8, 8, 8, 2, 2, 2, 2, 2, 2].map((value, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, '0')}`,
      value,
    }));
    const y = [7, 7, 1, 1, 1, 1, 1, 1, 7, 7, 7, 7].map((value, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, '0')}`,
      value,
    }));
    const lc = lagCorrelate(x, y, 1)!;
    expect(lc.lagDays).toBe(1);
    expect(lc.n).toBe(11); // days 2..12 (y[t] paired with x[t-1])
    expect(lc.direction).toBe('negative');
    expect(lc.rho).toBeLessThan(0);
    expect(lc.p).toBeLessThan(0.05);
    expect(lc.significant).toBe(true);
  });
  it('returns null with too few overlapping pairs', () => {
    const x = [{ date: '2026-02-01', value: 1 }];
    const y = [{ date: '2026-02-02', value: 2 }];
    expect(lagCorrelate(x, y, 1)).toBeNull();
  });
});

describe('surfedVsGiveInNextMood', () => {
  it('surfing is followed by a better mood than giving in', () => {
    const urges: UrgeEntry[] = [];
    const moods: Record<string, string> = {};
    // Days 1-3: surfed urge → next day 'great'; days 4-6: gave in → next day 'bad'.
    for (let d = 1; d <= 6; d++) {
      const k = `2026-03-${String(d).padStart(2, '0')}`;
      const next = shiftKey(k, 1);
      const outcome = d <= 3 ? 'surfed' : 'gave_in';
      urges.push(urge(k, 6, outcome));
      moods[next] = d <= 3 ? 'great' : 'bad';
    }
    const r = surfedVsGiveInNextMood(urges, moods)!;
    expect(r.nSurfed).toBe(3);
    expect(r.nGaveIn).toBe(3);
    expect(r.surfedNextMood).toBeGreaterThan(r.gaveInNextMood);
  });
  it('returns null when a group is too small', () => {
    const urges = [urge('2026-03-01', 6, 'surfed'), urge('2026-03-02', 6, 'surfed')];
    expect(surfedVsGiveInNextMood(urges, { '2026-03-02': 'okay' })).toBeNull();
  });
});

describe('emotionalVolatility', () => {
  it('is zero for a stable mood and high for swings', () => {
    const stable: Record<string, string> = {};
    const swinging: Record<string, string> = {};
    for (let d = 1; d <= 14; d++) {
      const k = `2026-04-${String(d).padStart(2, '0')}`;
      stable[k] = 'okay';
      swinging[k] = d % 2 === 0 ? 'great' : 'bad';
    }
    const s = emotionalVolatility(stable)!;
    const w = emotionalVolatility(swinging)!;
    expect(s.stdDev).toBe(0);
    expect(s.meanAbsChange).toBe(0);
    expect(w.stdDev).toBeGreaterThan(0);
    expect(w.meanAbsChange).toBeGreaterThan(s.meanAbsChange);
  });
});

describe('urgeSuccessTrend', () => {
  it('improving surfed fraction → upward trend', () => {
    const urges: UrgeEntry[] = [];
    for (let d = 1; d <= 14; d++) {
      const k = `2026-05-${String(d).padStart(2, '0')}`;
      const success = d > 7;
      urges.push(urge(k, 5, success ? 'surfed' : 'gave_in'));
    }
    const t = urgeSuccessTrend(urges)!;
    expect(t.direction).toBe('up');
    expect(t.significant).toBe(true);
  });
  it('returns null with too few days of resolved urges', () => {
    expect(urgeSuccessTrend([urge('2026-05-01', 5, 'surfed')])).toBeNull();
  });
});

describe('computeUrgeInsights', () => {
  it('assembles a full summary with honest fields', () => {
    const urges: UrgeEntry[] = [];
    const moods: Record<string, string> = {};
    const checks: CheckIn[] = [];
    const habits = [habit('a', 'Run')];
    for (let d = 1; d <= 14; d++) {
      const k = `2026-06-${String(d).padStart(2, '0')}`;
      const high = d % 3 === 0;
      urges.push(urge(k, high ? 9 : 3, d % 5 === 0 ? 'gave_in' : 'surfed', high ? 'anxiety' : 'boredom'));
      moods[k] = high ? 'bad' : 'great';
      checks.push(ci('a', k, !high));
    }
    const s = computeUrgeInsights(urges, moods, habits, checks);
    expect(s.survival!.n).toBe(14);
    expect(s.survival!.rate).toBeGreaterThan(0);
    expect(s.survival!.rate).toBeLessThan(100);
    expect(s.perType.length).toBeGreaterThanOrEqual(2);
    expect(s.emotionalVolatility!.n).toBe(14);
    expect(s.emotionalVolatility!.stdDev).toBeGreaterThan(0);
    expect(s.nextDayMood).toBeDefined();
    expect(s.nextDayCompletion).toBeDefined();
    expect(s.surfVsGiveIn).toBeDefined();
    expect(s.successTrend).toBeDefined();
  });
});