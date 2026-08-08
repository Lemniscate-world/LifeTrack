import { describe, it, expect } from 'vitest';
import { currentWeekCells, countWeekDone } from '../gridWeek';

describe('currentWeekCells', () => {
  it('starts Monday and ends Sunday for a given date', () => {
    const cells = currentWeekCells(new Date('2026-08-08T12:00:00')); // Saturday
    expect(cells).toHaveLength(7);
    expect(cells[0].dateKey).toBe('2026-08-03'); // Monday
    expect(cells[6].dateKey).toBe('2026-08-09'); // Sunday
    expect(cells[0].label).toBe('L');
    expect(cells[6].label).toBe('D');
  });

  it('marks the containing day as today', () => {
    const cells = currentWeekCells(new Date('2026-08-08T12:00:00'));
    const today = cells.find(c => c.isToday);
    expect(today?.dateKey).toBe('2026-08-08');
    expect(cells.filter(c => c.isToday)).toHaveLength(1);
  });

  it('handles a Monday start without shifting back to the previous week', () => {
    const cells = currentWeekCells(new Date('2026-08-03T09:00:00')); // Monday
    expect(cells[0].dateKey).toBe('2026-08-03');
    expect(cells[6].dateKey).toBe('2026-08-09');
    expect(cells[0].isToday).toBe(true);
  });

  it('handles a Sunday within its ISO week', () => {
    const cells = currentWeekCells(new Date('2026-08-09T09:00:00')); // Sunday
    expect(cells[0].dateKey).toBe('2026-08-03');
    expect(cells[6].dateKey).toBe('2026-08-09');
    expect(cells[6].isToday).toBe(true);
  });

  it('handles a week crossing a month boundary', () => {
    const cells = currentWeekCells(new Date('2026-09-01T09:00:00')); // Tuesday
    expect(cells[0].dateKey).toBe('2026-08-31'); // Monday in August
    expect(cells[6].dateKey).toBe('2026-09-06');
  });
});

describe('countWeekDone', () => {
  it('counts only matching keys', () => {
    const cells = currentWeekCells(new Date('2026-08-08T12:00:00'));
    const done = countWeekDone(cells, new Set(['2026-08-03', '2026-08-08']));
    expect(done).toBe(2);
  });

  it('returns 0 when nothing matches', () => {
    const cells = currentWeekCells(new Date('2026-08-08T12:00:00'));
    expect(countWeekDone(cells, new Set())).toBe(0);
  });

  it('returns 7 when everything matches', () => {
    const cells = currentWeekCells(new Date('2026-08-08T12:00:00'));
    expect(countWeekDone(cells, new Set(cells.map((c) => c.dateKey)))).toBe(7);
  });
});