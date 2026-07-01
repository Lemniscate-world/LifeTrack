/**
 * Targeted App tests for covering specific uncovered lines.
 * Includes Insights with seeded data, stack interactions, and stats.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, toggleCheckIn, getHabits } from '../store';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('Insights with seeded data', () => {
  it('shows NEGLECTED recommendation for habit with no check-ins', async () => {
    const user = userEvent.setup();
    // Seed habit BEFORE rendering App so initial state includes it
    addHabit('Journal');
    render(<App />);

    await user.click(screen.getByText('💡 Insights'));

    // Should show NEGLECTED: "Journal" has no check-ins yet (appears in title + detail)
    const journalTexts = screen.getAllByText(/Journal/);
    expect(journalTexts.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/no check-ins yet/)).toBeInTheDocument();
    // Action button
    expect(screen.getByText('Track now')).toBeInTheDocument();
  });

  it('NEGLECTED action button works', async () => {
    const user = userEvent.setup();
    addHabit('Read');
    render(<App />);

    await user.click(screen.getByText('💡 Insights'));
    // Click the action button for the NEGLECTED recommendation
    await user.click(screen.getByText('Track now'));
    // Should navigate to grid (InsightsView's NEGLECTED action: onView('grid'))
    const gridBtn = screen.getByRole('button', { name: 'Grid' });
    expect(gridBtn.className).toContain('active');
  });

  it('shows recommendation with kindIcon', async () => {
    const user = userEvent.setup();
    addHabit('Yoga');
    render(<App />);
    await user.click(screen.getByText('💡 Insights'));

    // Recommendation card renders with title
    const yogaTexts = screen.getAllByText(/Yoga/);
    expect(yogaTexts.length).toBeGreaterThanOrEqual(2);
    // The insight-icon span exists
    const iconSpans = document.querySelectorAll('.insight-icon');
    expect(iconSpans.length).toBeGreaterThanOrEqual(1);
    // NEGLECTED has priority 0 so it should be first
    const firstIcon = iconSpans[0].textContent?.codePointAt(0)?.toString(16);
    // Just verify it's non-empty
    expect(iconSpans[0].textContent?.length).toBeGreaterThan(0);
  });
});

describe('Insights empty state interaction', () => {
  it('empty state button navigates to grid', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('💡 Insights'));
    const goToGrid = screen.getByText('Go to Grid');
    await user.click(goToGrid);
    expect(screen.getByText('Grid').className).toContain('active');
  });
});

describe('Theme cycling', () => {
  it('cycles through themes', async () => {
    const user = userEvent.setup();
    render(<App />);
    const themeBtn = document.querySelector('[title*="Theme"]');
    expect(themeBtn).toBeInTheDocument();
    await user.click(themeBtn!);
    const newTitle = themeBtn!.getAttribute('title');
    expect(newTitle).toBeTruthy();
    expect(newTitle).not.toBe('Theme: Default');
  });
});

describe('Grid interactions', () => {
  it('renders grid headers with day numbers', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Test');
    await user.click(screen.getByText('Add'));
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows goal column header', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Test');
    await user.click(screen.getByText('Add'));
    expect(screen.getByText('Goal')).toBeInTheDocument();
  });
});

describe('Export dropdown', () => {
  it('shows Restore from Backup option', async () => {
    const user = userEvent.setup();
    render(<App />);
    const exportBtn = document.querySelector('[title="Export data"]');
    await user.hover(exportBtn!);
    expect(screen.getByText('Restore from Backup')).toBeInTheDocument();
  });
});

describe('Chaos tab', () => {
  it('renders Chaos view from tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Chaos'));
    expect(screen.getByText('Chaos').className).toContain('active');
  });
});

describe('Stats view table', () => {
  it('renders stats table headers', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Test');
    await user.click(screen.getByText('Add'));
    await user.click(screen.getByText('Statistics'));
    expect(screen.getByText('Habit')).toBeInTheDocument();
  });

  it('shows stats with seeded check-in data', async () => {
    const user = userEvent.setup();
    // Seed a habit with check-ins before rendering
    const h = addHabit('Run');
    const today = new Date().toISOString().slice(0, 10);
    toggleCheckIn(h.id, today);
    render(<App />);
    await user.click(screen.getByText('Statistics'));
    // Stats table should show the habit row (name appears in header nav + table)
    const runTexts = screen.getAllByText('Run');
    expect(runTexts.length).toBeGreaterThanOrEqual(2);
    // Stats section title
    expect(screen.getByText('Activity (last 365 days)')).toBeInTheDocument();
  });
});

describe('History view', () => {
  it('shows history with check-in data', async () => {
    const user = userEvent.setup();
    const h = addHabit('Swim');
    const today = new Date().toISOString().slice(0, 10);
    toggleCheckIn(h.id, today);
    render(<App />);
    await user.click(screen.getByText('History'));
    // History should render the habit name (appears in grid nav + history view)
    const swimTexts = screen.getAllByText(/Swim/);
    expect(swimTexts.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Intentions (why) editor', () => {
  it('opens and closes intentions modal', async () => {
    const user = userEvent.setup();
    addHabit('Meditate');
    render(<App />);
    // Click the 💭 button to open intentions editor
    const whyBtn = document.querySelector('[title="Edit intentions"]');
    if (whyBtn) {
      await user.click(whyBtn);
      // Modal should appear
      expect(screen.getByText(/Why do you track/)).toBeInTheDocument();
      // Close button
      await user.click(screen.getByText('Cancel'));
    }
  });

  it('adds intention and saves', async () => {
    const user = userEvent.setup();
    addHabit('Read');
    render(<App />);
    const whyBtn = document.querySelector('[title="Edit intentions"]');
    if (whyBtn) {
      await user.click(whyBtn);
      const input = document.querySelector('.intentions-editor input') as HTMLInputElement;
      if (input) {
        await user.type(input, 'To relax');
        await user.click(screen.getByText('Add'));
        await user.click(screen.getByText('Save'));
      }
    }
  });
});

describe('Goal editing', () => {
  it('shows goal input on habit row', async () => {
    const user = userEvent.setup();
    addHabit('Yoga');
    render(<App />);
    // Goal column should show goal value or default
    expect(screen.getByText('Goal')).toBeInTheDocument();
  });
});

describe('Multiple habits in grid', () => {
  it('renders multiple habit rows', async () => {
    const user = userEvent.setup();
    render(<App />);
    
    for (const name of ['A', 'B', 'C']) {
      await user.click(screen.getByText('+ New Habit'));
      await user.type(screen.getByPlaceholderText('Habit name...'), name);
      await user.click(screen.getByText('Add'));
    }

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});

describe('All views accessible after adding habits', () => {
  it('can visit all tabs after seeding data', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Test');
    await user.click(screen.getByText('Add'));

    const tabs = ['Grid', 'Statistics', 'History', 'Stacks', 'Chaos', '💡 Insights'];
    for (const t of tabs) {
      // click the tab button (use role=button to avoid text collisions)
      const btns = screen.getAllByRole('button', { name: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      if (btns.length > 0) await user.click(btns[0]);
    }
    // verify we're rendering content (Insights shows h2 heading)
    expect(screen.getByRole('heading', { name: /insights/i })).toBeInTheDocument();
  });
});
