// src/test/stacks-ui.test.tsx
// UI smoke tests for StacksView + inline badge in the grid.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  addHabit,
  linkHabitToParent,
  toggleCheckIn,
  resetStore,
  exportAllData,
  archiveHabit,
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
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

  it('renders stack cards with progress bar and step states', () => {
    const a = addHabit('Coffee');
    const b = addHabit('Meditate');
    linkHabitToParent(b.id, a.id);
    const { habits, checkIns } = habitsAndChecks();
    render(<StacksView habits={habits} checkIns={checkIns} />);
    // stack card header uses h3
    expect(screen.getByRole('heading', { name: 'Coffee' })).toBeInTheDocument();
    // progress text
    expect(screen.getByText(/0 \/ 2 done/)).toBeInTheDocument();
    // step names — getAllByText returns multiple
    expect(screen.getAllByText('Coffee').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Meditate')).toBeInTheDocument();
    // blocked glyph
    expect(screen.getByText('⊘')).toBeInTheDocument();    // parent relationship label
    expect(screen.getByText(/after: Coffee/)).toBeInTheDocument();  });

  it('shows complete message when all steps done', () => {
    const a = addHabit('Exercise');
    const b = addHabit('Stretch');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, TODAY_KEY);
    toggleCheckIn(b.id, TODAY_KEY);
    const { habits, checkIns } = habitsAndChecks();
    render(<StacksView habits={habits} checkIns={checkIns} />);
    expect(screen.getByText(/Stack complete/)).toBeInTheDocument();
    // progress should be 2/2, not 1/2
    expect(screen.getByText(/2 \/ 2 done/)).toBeInTheDocument();
  });

  it('renders done and pending glyphs', () => {
    const a = addHabit('Tea');
    const b = addHabit('Walk');
    linkHabitToParent(b.id, a.id);
    toggleCheckIn(a.id, TODAY_KEY);
    const { habits, checkIns } = habitsAndChecks();
    render(<StacksView habits={habits} checkIns={checkIns} />);
    // root Tea is done → glyph ✓
    expect(screen.getByText('✓')).toBeInTheDocument();
    // child Walk is pending (parent done, child not checked in) → glyph •
    expect(screen.getByText('•')).toBeInTheDocument();
  });

  it('renders untracked glyph for archived children in chain', () => {
    const a = addHabit('Root');
    const b = addHabit('Active');
    const c = addHabit('Archived');
    linkHabitToParent(b.id, a.id);
    linkHabitToParent(c.id, b.id);
    // Archive c but keep it in the chain
    archiveHabit(c.id);
    const { habits, checkIns } = habitsAndChecks();
    render(<StacksView habits={habits} checkIns={checkIns} />);
    // The archived habit should show untracked glyph
    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
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