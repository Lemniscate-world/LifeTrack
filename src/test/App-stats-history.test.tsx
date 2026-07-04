// Stats + History view coverage tests
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, toggleCheckIn } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

async function addUI(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByText('+ New Habit'));
  await user.type(screen.getByPlaceholderText('Habit name...'), name);
  await user.click(screen.getByText('Add'));
}

describe('Stats view', () => {
  it('shows all stats columns', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addUI(user, 'Gym');
    await user.click(screen.getByText('Statistics'));
    for (const col of ['Score', 'Current', 'Best', 'Gap', '7d', '30d', '90d', '365d', 'Total']) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });

  it('shows empty message when no habits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Statistics'));
    expect(screen.getByText(/Add habits to see statistics/)).toBeInTheDocument();
  });

  it('shows heatmap SVG with seeded data', async () => {
    const user = userEvent.setup();
    const h = addHabit('Swim');
    toggleCheckIn(h.id, new Date().toISOString().slice(0, 10));
    render(<App />);
    await user.click(screen.getByText('Statistics'));
    expect(document.querySelector('svg[aria-label]')).not.toBeNull();
  });

  it('shows sparkline path after check-ins', async () => {
    const user = userEvent.setup();
    const h = addHabit('Run');
    for (let d = 0; d < 14; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() - d);
      toggleCheckIn(h.id, dt.toISOString().slice(0, 10));
    }
    render(<App />);
    await user.click(screen.getByText('Statistics'));
    expect(document.querySelector('path')).not.toBeNull();
  });
});

describe('History view', () => {
  it('shows history tab active after click', async () => {
    const user = userEvent.setup();
    const h = addHabit('Yoga');
    toggleCheckIn(h.id, '2026-07-01');
    toggleCheckIn(h.id, '2026-07-02');
    render(<App />);
    await user.click(screen.getByText('History'));
    expect(screen.getByText('History').className).toContain('active');
  });

  it('history tab activates after click', async () => {
    const user = userEvent.setup();
    const h = addHabit('Meditate');
    toggleCheckIn(h.id, '2026-07-01');
    toggleCheckIn(h.id, '2026-07-02');
    render(<App />);
    await user.click(screen.getByText('History'));
    expect(screen.getByText('History').className).toContain('active');
  });
});
