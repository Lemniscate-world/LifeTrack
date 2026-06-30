// src/test/stacks-ui.test.tsx
// UI smoke tests for StacksView + inline badge in the grid.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  addHabit,
  linkHabitToParent,
  toggleCheckIn,
  resetStore,
  exportAllData,
} from '../store';
import { computeStacks } from '../stacks';
import { StacksView } from '../StacksView';
import App from '../App';

const TODAY = new Date(2026, 5, 27); // 2026-06-27
const TODAY_KEY = '2026-06-27';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

function habitsAndChecks() {
  const exported = exportAllData();
  return { habits: exported.habits, checkIns: exported.checkIns };
}

describe('StacksView', () => {
  it('shows empty state when no stacks exist', () => {
    addHabit('Solo');
    const { habits, checkIns } = habitsAndChecks();
    render(<StacksView habits={habits} checkIns={checkIns} />);
    expect(screen.getByText(/No stacks yet/i)).toBeInTheDocument();
  });

  it('renders one stack card per parent', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    const c = addHabit('Journal');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, a.id);
    const { habits, checkIns } = habitsAndChecks();
    const stacks = computeStacks(habits, checkIns, TODAY);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].totalCount).toBe(3);
    expect(stacks[0].doneCount).toBe(0);
  });

  it('shows up-next suggestion when parent done', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, TODAY_KEY);
    const { habits, checkIns } = habitsAndChecks();
    const stacks = computeStacks(habits, checkIns, TODAY);
    // Coffee is done, Meditate is pending and not blocked (parent is done)
    expect(stacks[0].doneCount).toBe(1);
    expect(stacks[0].pendingCount).toBe(1);
  });

  it('marks done steps with a check glyph and shows complete message', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, TODAY_KEY);
    toggleCheckIn(b.id, TODAY_KEY);
    const { habits, checkIns } = habitsAndChecks();
    const stacks = computeStacks(habits, checkIns, TODAY);
    expect(stacks[0].doneCount).toBe(2);
    expect(stacks[0].totalCount).toBe(2);
    expect(stacks[0].completionPct).toBe(100);
  });

  it('renders a blocked state for child when parent not done', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    const { habits, checkIns } = habitsAndChecks();
    const stacks = computeStacks(habits, checkIns, TODAY);
    expect(stacks[0].blockedCount).toBe(1);
  });
});

describe('Stacks UI in App', () => {
  it('adds a Stacks tab to the view switcher', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Stacks'));
    expect(screen.getByText(/No stacks yet/i)).toBeInTheDocument();
  });

  it('shows the stack badge in the grid when habit has a parent', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    render(<App />);
    expect(screen.getByText(/↳ Coffee/)).toBeInTheDocument();
  });
});