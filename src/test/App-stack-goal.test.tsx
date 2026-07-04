// Stack editor + Goal editing coverage tests
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, linkHabitToParent, getHabits } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

async function addUI(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByText('+ New Habit'));
  await user.type(screen.getByPlaceholderText('Habit name...'), name);
  await user.click(screen.getByText('Add'));
}

describe('Stack editor', () => {
  it('opens stack editor', async () => {
    const user = userEvent.setup();
    addHabit('Parent');
    addHabit('Child');
    render(<App />);
    const btn = document.querySelector('.habit-stack-btn');
    expect(btn).not.toBeNull();
    await user.click(btn!);
    expect(screen.getByText(/Triggered by/)).toBeInTheDocument();
  });

  it('links child to parent', async () => {
    const user = userEvent.setup();
    const parent = addHabit('Coffee');
    addHabit('Read');
    render(<App />);
    const btns = document.querySelectorAll('.habit-stack-btn');
    await user.click(btns[1]);
    const select = document.querySelector('.stack-select-sm') as HTMLSelectElement;
    if (select) {
      await user.selectOptions(select, parent.id);
      await user.click(screen.getByText('Done'));
      expect(getHabits().some((h) => h.stackParent === parent.id)).toBe(true);
    }
  });

  it('shows stack badge on child', () => {
    const parent = addHabit('A');
    const child = addHabit('B');
    linkHabitToParent(child.id, parent.id);
    render(<App />);
    expect(screen.getByText(/↳ A/)).toBeInTheDocument();
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

  it('shows achieved count', async () => {
    const user = userEvent.setup();
    const h = addHabit('Run');
    render(<App />);
    // Toggle via keyboard (day 1 by default)
    await user.keyboard(' ');
    const achieved = document.querySelector('.achieved-number');
    expect(achieved).not.toBeNull();
    expect(achieved?.textContent).toBe('1');
  });
});
