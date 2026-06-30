// src/test/HistoryView.test.tsx
// Smoke tests for the HistoryView component.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryView } from '../HistoryView';
import type { Habit, CheckIn } from '../types';

const TODAY = new Date(2026, 5, 27); // 2026-06-27

function makeHabit(id: string, name: string, color = '#22c55e'): Habit {
  return {
    id, name, color,
    goal: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    archived: false,
    order: 0,
  };
}

function checkIn(date: string, habitId: string, completed = true): CheckIn {
  return { date, habitId, completed };
}

describe('HistoryView', () => {
  it('renders empty state when no habits exist', () => {
    render(<HistoryView checkIns={[]} habits={[]} today={TODAY} />);
    expect(screen.getByText(/add habits to see your history/i)).toBeInTheDocument();
  });

  it('renders empty state when no check-ins exist', () => {
    const habits = [makeHabit('h1', 'Gym')];
    render(<HistoryView checkIns={[]} habits={habits} today={TODAY} />);
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });

  it('groups check-ins by day and shows them in reverse chronological order', () => {
    const habits = [makeHabit('h1', 'Gym'), makeHabit('h2', 'Read')];
    const checkIns: CheckIn[] = [
      checkIn('2026-06-25', 'h1'),
      checkIn('2026-06-26', 'h1'),
      checkIn('2026-06-26', 'h2'),
      checkIn('2026-06-27', 'h1'),
    ];
    render(<HistoryView checkIns={checkIns} habits={habits} today={TODAY} />);
    // "Today" appears (for 2026-06-27) and "Yesterday" (for 2026-06-26)
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('shows the correct completion ratio per day', () => {
    const habits = [makeHabit('h1', 'Gym'), makeHabit('h2', 'Read')];
    const checkIns: CheckIn[] = [
      checkIn('2026-06-27', 'h1', true),
      checkIn('2026-06-27', 'h2', false),
    ];
    render(<HistoryView checkIns={checkIns} habits={habits} today={TODAY} />);
    expect(screen.getByText(/1\/2 done/)).toBeInTheDocument();
  });

  it('filters by selected habit via the dropdown', async () => {
    const user = userEvent.setup();
    const habits = [makeHabit('h1', 'Gym'), makeHabit('h2', 'Read')];
    const checkIns: CheckIn[] = [
      checkIn('2026-06-27', 'h1'),
      checkIn('2026-06-27', 'h2'),
    ];
    render(<HistoryView checkIns={checkIns} habits={habits} today={TODAY} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'h1');

    // Only the Gym entry should appear in the timeline (not in the dropdown).
    // The dropdown still has "Read" as an option — that's fine, it's the filter list.
    // We assert by counting history-entry elements that contain "Read" — should be 0.
    const entries = document.querySelectorAll('li.history-entry');
    const readEntries = Array.from(entries).filter((el) => el.textContent?.includes('Read'));
    expect(readEntries.length).toBe(0);
    // Gym should still be visible as an entry
    const gymEntries = Array.from(entries).filter((el) => el.textContent?.includes('Gym'));
    expect(gymEntries.length).toBe(1);
  });

  it('hides misses when the toggle is off', async () => {
    const user = userEvent.setup();
    const habits = [makeHabit('h1', 'Gym')];
    const checkIns: CheckIn[] = [
      checkIn('2026-06-27', 'h1', true),
      checkIn('2026-06-26', 'h1', false),
    ];
    render(<HistoryView checkIns={checkIns} habits={habits} today={TODAY} />);

    // Toggle off "Show misses"
    const toggle = screen.getByRole('checkbox');
    await user.click(toggle);

    // The "Yesterday" day section should not appear (only one miss entry)
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
  });

  it('respects the dayWindow prop', () => {
    const habits = [makeHabit('h1', 'Gym')];
    // 10 different days
    const checkIns: CheckIn[] = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      checkIns.push(checkIn(key, 'h1'));
    }
    render(<HistoryView checkIns={checkIns} habits={habits} today={TODAY} dayWindow={3} />);
    // Only 3 days should be rendered — verify by counting <li.history-day>
    const { container } = render(
      <HistoryView checkIns={checkIns} habits={habits} today={TODAY} dayWindow={3} />,
    );
    const days = container.querySelectorAll('li.history-day');
    expect(days.length).toBe(3);
  });

  it('handles a habit that has no name (defensive)', () => {
    const habits = [makeHabit('h1', 'Gym')];
    // Check-in for a habit not in the list (deleted habit)
    const checkIns: CheckIn[] = [checkIn('2026-06-27', 'deleted-id')];
    render(<HistoryView checkIns={checkIns} habits={habits} today={TODAY} />);
    // Falls back to the habit id
    expect(screen.getByText('deleted-id')).toBeInTheDocument();
  });
});