/**
 * charts.tsx: pure series math (window bounds, distinct-habit counting,
 * archived exclusion) + SVG render smoke tests.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { daySeries, weekSeries, monthSeries, WeekBars, MonthCurve } from '../charts';
import type { Habit, CheckIn } from '../types';

const NOW = new Date(2026, 8, 9, 12, 0, 0); // Wed 2026-09-09

function habit(id: string, archived = false): Habit {
  return {
    id, name: id, color: '', goal: 0,
    createdAt: '2026-01-01T00:00:00.000Z', archived, order: 0,
  };
}

function ci(habitId: string, date: string): CheckIn {
  return { habitId, date, completed: true };
}

describe('daySeries', () => {
  it('covers the trailing window ending today with local dates', () => {
    const out = daySeries([habit('a')], [], NOW, 7);
    expect(out).toHaveLength(7);
    expect(out[0]!.date).toBe('2026-09-03');
    expect(out[6]!.date).toBe('2026-09-09');
    expect(out[6]!.dayLabel).toBe('mer.');
    expect(out.map((d) => d.rate)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts distinct completed habits over active ones', () => {
    const checks = [ci('a', '2026-09-09'), ci('a', '2026-09-09'), ci('b', '2026-09-09')];
    const out = daySeries([habit('a'), habit('b'), habit('c')], checks, NOW, 1);
    expect(out[0]).toMatchObject({ done: 2, total: 3 });
    expect(out[0]!.rate).toBeCloseTo(2 / 3, 10);
  });

  it('excludes archived habits and empty days stay honest', () => {
    const checks = [ci('old', '2026-09-09')];
    const out = daySeries([habit('a'), habit('old', true)], checks, NOW, 1);
    expect(out[0]).toMatchObject({ done: 0, total: 1, rate: 0 });
  });

  it('returns zeros (not NaN) with no habits', () => {
    const out = daySeries([], [], NOW, 3);
    expect(out.every((d) => d.rate === 0 && d.hasData === false)).toBe(true);
  });

  it('monthSeries spans 30 days', () => {
    const out = monthSeries([habit('a')], [], NOW);
    expect(out).toHaveLength(30);
    expect(out[0]!.date).toBe('2026-08-11');
    expect(out[29]!.date).toBe('2026-09-09');
  });
});

describe('WeekBars', () => {
  it('renders one bar per day with today ringed', () => {
    const days = weekSeries([habit('a')], [ci('a', '2026-09-09')], NOW);
    const { container } = render(<WeekBars days={days} />);
    expect(container.querySelectorAll('rect.chart-bar')).toHaveLength(7);
    expect(container.querySelectorAll('rect.chart-bar.is-today')).toHaveLength(1);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('7 derniers jours');
  });
});

describe('MonthCurve', () => {
  it('renders area + line + gridlines', () => {
    const days = monthSeries([habit('a')], [ci('a', '2026-09-09')], NOW);
    const { container } = render(<MonthCurve days={days} />);
    expect(container.querySelector('path.chart-area')).not.toBeNull();
    expect(container.querySelector('path.chart-line')).not.toBeNull();
    expect(container.querySelectorAll('line.chart-grid')).toHaveLength(3);
    expect(container.querySelector('circle.chart-dot')).not.toBeNull();
  });

  it('renders empty without crashing', () => {
    const { container } = render(<MonthCurve days={[]} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
