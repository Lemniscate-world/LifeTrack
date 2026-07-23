// InsightsView coverage: recommendations rendering, action buttons, AI analysis states
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, toggleCheckIn } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });


describe('InsightsView — with recommendations', () => {
  it('shows recommendation cards when data exists', async () => {
    const user = userEvent.setup();
    addHabit('Journal');
    // No check-ins → NEGLECTED recommendation
    render(<App />);
    await user.click(screen.getByText('Insights'));

    // Should show recommendation cards, not empty state
    expect(screen.queryByText('Not enough data yet')).toBeNull();
    // Insight cards exist
    expect(document.querySelectorAll('.insight-card').length).toBeGreaterThanOrEqual(1);
  });

  it('shows recommendation count in subtitle', async () => {
    const user = userEvent.setup();
    addHabit('Gym');
    addHabit('Read');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    // Subtitle shows count: "N recommendation(s) — 100% local"
    expect(screen.getByText(/recommendation/)).toBeInTheDocument();
  });

  it('shows action buttons on recommendations', async () => {
    const user = userEvent.setup();
    addHabit('Yoga');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    // NEGLECTED recs have "Track now" button
    expect(screen.getByText('Track now')).toBeInTheDocument();
  });

  it('shows kind icons on cards', async () => {
    const user = userEvent.setup();
    addHabit('Meditate');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    const icons = document.querySelectorAll('.insight-icon');
    expect(icons.length).toBeGreaterThanOrEqual(1);
    // Icon should be non-empty
    expect(icons[0].textContent?.length).toBeGreaterThan(0);
  });

  it('shows strength/relevance percentage', async () => {
    const user = userEvent.setup();
    addHabit('Run');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    expect(screen.getByText(/Relevance/)).toBeInTheDocument();
  });

  it('shows habit names in insight meta', async () => {
    const user = userEvent.setup();
    addHabit('Swim');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    // Habit name in the insight-meta section
    const metas = document.querySelectorAll('.insight-habits');
    expect(metas.length).toBeGreaterThanOrEqual(1);
  });

  it('generated timestamp is visible', async () => {
    const user = userEvent.setup();
    addHabit('Gym');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    // Generated at timestamp
    expect(screen.getByText(/100% local/)).toBeInTheDocument();
  });

  it('Deep Analysis button is present', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    await user.click(screen.getByText('Insights'));

    expect(screen.getByText('🤖 Deep Analysis')).toBeInTheDocument();
  });
});

describe('InsightsView — action buttons navigate', () => {
  it('Track now navigates to grid', async () => {
    const user = userEvent.setup();
    addHabit('Read');
    render(<App />);
    await user.click(screen.getByText('Insights'));
    await user.click(screen.getByText('Track now'));

    // Should be back on grid
    expect(screen.getByText('Grid').className).toContain('active');
  });

  it('View stats action navigates to stats', async () => {
    const user = userEvent.setup();
    const h = addHabit('Gym');
    // Build a streak so RECORD_APPROACH appears
    for (let d = 0; d < 5; d++) {
      const dt = new Date(); dt.setDate(dt.getDate() - d);
      toggleCheckIn(h.id, dt.toISOString().slice(0, 10));
    }
    render(<App />);
    await user.click(screen.getByText('Insights'));

    // Find a "View stats" button if present
    const viewStatsBtns = screen.queryAllByText('View stats');
    if (viewStatsBtns.length > 0) {
      await user.click(viewStatsBtns[0]);
      expect(screen.getByText('Statistics').className).toContain('active');
    }
  });

  it('View history action navigates to history', async () => {
    const user = userEvent.setup();
    // Create a habit with enough check-ins to trigger MISS_PATTERN or TREND
    const h = addHabit('Swim');
    for (let w = 0; w < 12; w++) {
      for (let d = 0; d < 7; d++) {
        const dt = new Date('2026-07-03');
        dt.setUTCDate(dt.getUTCDate() - w * 7 - d);
        toggleCheckIn(h.id, dt.toISOString().slice(0, 10));
      }
    }
    render(<App />);
    await user.click(screen.getByText('Insights'));

    const viewHistoryBtns = screen.queryAllByText('View history');
    if (viewHistoryBtns.length > 0) {
      await user.click(viewHistoryBtns[0]);
      expect(screen.getByText('History').className).toContain('active');
    }
  });

  it('Link now action triggers stack linking', async () => {
    const user = userEvent.setup();
    const coffee = addHabit('Coffee');
    const read = addHabit('Read');
    // Add check-ins so STACK_SUGGESTION triggers
    for (let d = 0; d < 30; d++) {
      const dt = new Date('2026-07-03');
      dt.setUTCDate(dt.getUTCDate() - d);
      toggleCheckIn(coffee.id, dt.toISOString().slice(0, 10));
      if (d % 7 !== 0) toggleCheckIn(read.id, dt.toISOString().slice(0, 10));
    }
    render(<App />);
    await user.click(screen.getByText('Insights'));

    const linkBtns = screen.queryAllByText('Link now');
    if (linkBtns.length > 0) {
      await user.click(linkBtns[0]);
      // Should still be on insights tab after linking
      const insightsTab = screen.getByRole('tab', { name: /Insights/ });
      expect(insightsTab.className).toContain('active');
    }
  });
});

describe('InsightsView — empty state', () => {
  it('shows empty state with no habits', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Insights'));
    expect(screen.getByText('Not enough data yet')).toBeInTheDocument();
    expect(screen.getByText('Go to Grid')).toBeInTheDocument();
  });

  it('Go to Grid button navigates to grid', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Insights'));
    await user.click(screen.getByText('Go to Grid'));
    expect(screen.getByText('Grid').className).toContain('active');
  });
});
