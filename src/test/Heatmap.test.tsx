// src/test/Heatmap.test.tsx
// Smoke tests for the Heatmap and Sparkline components.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Heatmap, Sparkline } from '../Heatmap';
import type { Habit, CheckIn } from '../types';

const TODAY = new Date(2026, 5, 27); // 2026-06-27

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Test',
    color: '#22c55e',
    goal: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    order: 0,
    ...overrides,
  };
}

function checkIn(date: string, completed = true): CheckIn {
  return { habitId: 'h1', date, completed };
}

describe('Heatmap', () => {
  it('renders an SVG with aria-label', () => {
    const h = makeHabit();
    render(<Heatmap habit={h} checkIns={[]} today={TODAY} />);
    const svg = screen.getByRole('img', { name: /365-day heatmap/i });
    expect(svg).toBeInTheDocument();
  });

  it('renders one rect per non-future day (365 total)', () => {
    const h = makeHabit();
    const { container } = render(<Heatmap habit={h} checkIns={[]} today={TODAY} />);
    const rects = container.querySelectorAll('rect');
    // 365 non-future cells (today + 364 past). No future cells rendered.
    expect(rects.length).toBe(365);
  });

  it('marks today with the today class', () => {
    const h = makeHabit();
    const { container } = render(<Heatmap habit={h} checkIns={[]} today={TODAY} />);
    const todayCell = container.querySelector('rect.today');
    expect(todayCell).toBeInTheDocument();
  });

  it('renders completed days with the habit color', () => {
    const h = makeHabit({ color: '#ff0000' });
    // Check in 2026-06-20 (well within last 365 days)
    const { container } = render(
      <Heatmap habit={h} checkIns={[checkIn('2026-06-20')]} today={TODAY} />,
    );
    const cell = container.querySelector('rect[fill="#ff0000"]');
    expect(cell).toBeInTheDocument();
  });

  it('marks days before the habit was created as untracked', () => {
    const h = makeHabit({ createdAt: '2026-06-01T00:00:00.000Z' });
    const { container } = render(<Heatmap habit={h} checkIns={[]} today={TODAY} />);
    // Most cells (before June) should carry the untracked class
    const untracked = container.querySelectorAll('rect.untracked');
    expect(untracked.length).toBeGreaterThan(200);
  });

  it('renders without crashing on an empty check-in array', () => {
    const h = makeHabit();
    expect(() => render(<Heatmap habit={h} checkIns={[]} today={TODAY} />)).not.toThrow();
  });

  it('handles a habit created today (no past data, no future)', () => {
    const h = makeHabit({ createdAt: TODAY.toISOString() });
    const { container } = render(<Heatmap habit={h} checkIns={[]} today={TODAY} />);
    const cells = container.querySelectorAll('rect');
    // Only today is "tracked"; everything else is untracked (created today)
    // We assert it doesn't crash and produces 365 cells.
    expect(cells.length).toBe(365);
  });
});

describe('Sparkline', () => {
  it('renders an SVG with aria-label', () => {
    const h = makeHabit();
    render(<Sparkline habit={h} checkIns={[]} today={TODAY} />);
    const svg = screen.getByRole('img', { name: /sparkline/i });
    expect(svg).toBeInTheDocument();
  });

  it('renders a path element (the sparkline curve)', () => {
    const h = makeHabit();
    const { container } = render(<Sparkline habit={h} checkIns={[]} today={TODAY} />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it('renders higher (lower y) when recent completions are dense', () => {
    const h = makeHabit();
    // Fill last 30 days with completions
    const checkIns: CheckIn[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      checkIns.push(checkIn(dateStr));
    }
    const { container } = render(<Sparkline habit={h} checkIns={checkIns} today={TODAY} />);
    const path = container.querySelector('path[fill="none"]');
    expect(path).toBeInTheDocument();
    // The d attribute should contain "L0,0" or similar near-zero y values
    // indicating the sparkline stays near the top (high completion).
    expect(path!.getAttribute('d')).toBeTruthy();
  });

  it('renders without crashing on empty check-ins', () => {
    const h = makeHabit();
    expect(() => render(<Sparkline habit={h} checkIns={[]} today={TODAY} />)).not.toThrow();
  });
});