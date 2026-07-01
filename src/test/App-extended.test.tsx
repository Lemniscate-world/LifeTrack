/**
 * Extended App tests for coverage gaps.
 * View navigation, insights, dark mode, export, notes, intentions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore } from '../store';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

async function addOneHabit(user: ReturnType<typeof userEvent.setup>, name = 'TestHabit') {
  await user.click(screen.getByText('+ New Habit'));
  await user.type(screen.getByPlaceholderText('Habit name...'), name);
  await user.click(screen.getByText('Add'));
}

describe('App view tabs', () => {
  it('navigates to all views', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText('Statistics'));
    expect(screen.getByText('Statistics').className).toContain('active');

    await user.click(screen.getByText('History'));
    expect(screen.getByText('History').className).toContain('active');

    await user.click(screen.getByText('Stacks'));
    expect(screen.getByText('Stacks').className).toContain('active');

    await user.click(screen.getByText('Chaos'));
    expect(screen.getByText('Chaos').className).toContain('active');

    await user.click(screen.getByText('💡 Insights'));
    expect(screen.getByText('Not enough data yet')).toBeInTheDocument();

    await user.click(screen.getByText('Grid'));
    expect(screen.getByText('Grid').className).toContain('active');
  });

  it('Insights shows empty state with button to grid', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('💡 Insights'));
    expect(screen.getByText('Go to Grid')).toBeInTheDocument();
  });
});

describe('App notes panel', () => {
  it('opens and closes notes panel', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addOneHabit(user, 'Gym');
    await user.click(screen.getByText('Notes'));
    expect(screen.getByPlaceholderText('Write a note...')).toBeInTheDocument();
    await user.click(screen.getByText('Notes'));
    // Panel closes
    expect(screen.queryByPlaceholderText('Write a note...')).not.toBeInTheDocument();
  });

  it('can add a note', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addOneHabit(user, 'Gym');
    await user.click(screen.getByText('Notes'));
    const textarea = screen.getByPlaceholderText('Write a note...');
    await user.type(textarea, 'Great workout');
    await user.click(screen.getByText('Save'));
    // Note appears in the list
    expect(screen.getByText('Great workout')).toBeInTheDocument();
  });
});

describe('App dark mode', () => {
  it('toggles dark mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    const darkBtn = document.querySelector('[title="Toggle dark mode"]');
    expect(darkBtn).toBeInTheDocument();
    await user.click(darkBtn!);
    // Dark class should be on html
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(darkBtn!);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('App month navigation', () => {
  it('navigates months', async () => {
    const user = userEvent.setup();
    render(<App />);
    const arrows = document.querySelectorAll('.month-arrow');
    const initial = screen.getByText(/, 2026/).textContent;
    // Navigate forward
    await user.click(arrows[1]);
    const afterNext = screen.getByText(/, 2026/).textContent;
    expect(afterNext).not.toBe(initial);
  });
});

describe('App empty state', () => {
  it('shows + New Habit in empty state', () => {
    render(<App />);
    expect(screen.getByText('+ New Habit')).toBeInTheDocument();
  });

  it('shows Grid tab active by default', () => {
    render(<App />);
    expect(screen.getByText('Grid').className).toContain('active');
  });
});

describe('App save indicator', () => {
  it('shows storage indicator dot', () => {
    render(<App />);
    const indicator = document.querySelector('.storage-indicator');
    expect(indicator).toBeInTheDocument();
  });
});
