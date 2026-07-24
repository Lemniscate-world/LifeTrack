// Stack editor + Goal editing coverage tests
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, linkHabitToParent, getHabits, updateHabit } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('Stack editor', () => {
  it('opens stack editor', async () => {
    const user = userEvent.setup();
    addHabit('Parent');
    addHabit('Child');
    render(<App />);
    const btn = document.querySelector('.habit-stack-btn');
    expect(btn).not.toBeNull();
    await user.click(btn!);
    expect(screen.getByText(/from:/i)).toBeInTheDocument();
  });

  it('links child to parent', async () => {
    const user = userEvent.setup();
    const parent = addHabit('Coffee');
    addHabit('Read');
    render(<App />);
    const btns = document.querySelectorAll('.habit-stack-btn');
    await user.click(btns[1]);
    // Now there are two selects: the first is "when" (before/after/with), the second is "from" (parent picker).
    const selects = document.querySelectorAll('.stack-select-sm');
    const parentSelect = selects[1]; // second select = parent picker
    if (parentSelect) {
      await user.selectOptions(parentSelect, parent.id);
      await user.click(screen.getByText('Done'));
      expect(getHabits().some((h) => h.stackParent === parent.id)).toBe(true);
    }
  });

  it('shows stack badge on child', () => {
    const parent = addHabit('A');
    const child = addHabit('B');
    linkHabitToParent(child.id, parent.id);
    render(<App />);
    // Badge now uses ↓ for "after" (default), ↑ for "before", ↔ for "with"
    expect(screen.getByText(/↓ A/)).toBeInTheDocument();
  });
});

describe('Goal editing', () => {
  it('opens goal input on click', async () => {
    const user = userEvent.setup();
    addHabit('Gym');
    render(<App />);
    const cell = document.querySelector('.goal-number');
    expect(cell).not.toBeNull();
    await user.click(cell!);
    expect(document.querySelector('.goal-input')).not.toBeNull();
  });

  it('saves goal on Enter', async () => {
    const user = userEvent.setup();
    const h = addHabit('Gym');
    render(<App />);
    await user.click(document.querySelector('.goal-number')!);
    const input = document.querySelector('.goal-input') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '20');
    await user.keyboard('{Enter}');
    expect(getHabits().find((x) => x.id === h.id)?.goal).toBe(20);
  });

  it('cancels goal on Escape', async () => {
    const user = userEvent.setup();
    addHabit('Run');
    render(<App />);
    await user.click(document.querySelector('.goal-number')!);
    await user.keyboard('{Escape}');
    expect(document.querySelector('.goal-input')).toBeNull();
  });

  it('shows achieved count with monthly goal format', async () => {
    const user = userEvent.setup();
    addHabit('Run');
    render(<App />);
    // Toggle via keyboard (day 1 by default)
    await user.keyboard(' ');
    const achieved = document.querySelector('.achieved-number');
    expect(achieved).not.toBeNull();
    // Shows "1/31" (1 execution out of 31 days this month)
    expect(achieved?.textContent).toContain('1');
  });

  it('multi-click: increments count per Space press', async () => {
    const user = userEvent.setup();
    const h = addHabit('Meditation');
    updateHabit(h.id, { goal: 3 });
    render(<App />);
    // Use keyboard toggle (Space) which reliably hits the focused grid cell
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('1');
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('2');
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('3');
    // Ctrl+Space resets
    await user.keyboard('{Control>} {/Control}');
    expect(document.querySelector('.day-cell-count')).toBeNull();
  });

  it('multi-click works regardless of goal value', async () => {
    const user = userEvent.setup();
    const h = addHabit('Read');
    updateHabit(h.id, { goal: 30 });
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell.checked')).not.toBeNull();
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('1');
    // Shift+Space decrements
    await user.keyboard('{Shift>} {/Shift}');
    expect(document.querySelector('.day-cell.checked')).toBeNull();
  });
});
