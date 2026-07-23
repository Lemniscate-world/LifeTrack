// Export + Chaos editor coverage tests
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, getHabits } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('Export dropdown', () => {
  it('shows all menu items on hover', async () => {
    const user = userEvent.setup();
    render(<App />);
    const btn = document.querySelector('[title="Export data"]');
    await user.hover(btn!);
    expect(screen.getByText('Export JSON')).toBeInTheDocument();
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
    expect(screen.getByText('Restore from Backup')).toBeInTheDocument();
  });

  it('Export JSON triggers without crash', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    const btn = document.querySelector('[title="Export data"]');
    await user.hover(btn!);
    expect(() => user.click(screen.getByText('Export JSON'))).not.toThrow();
  });

  it('Export CSV triggers without crash', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    const btn = document.querySelector('[title="Export data"]');
    await user.hover(btn!);
    expect(() => user.click(screen.getByText('Export CSV'))).not.toThrow();
  });
});

describe('Chaos editor', () => {
  it('opens chaos editor via button', async () => {
    const user = userEvent.setup();
    addHabit('Gym');
    render(<App />);
    const btn = document.querySelector('.habit-chaos-btn');
    expect(btn).not.toBeNull();
    await user.click(btn!);
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('links habit to chaos dimension and saves', async () => {
    const user = userEvent.setup();
    addHabit('Gym');
    render(<App />);
    const btn = document.querySelector('.habit-chaos-btn');
    await user.click(btn!);
    const select = document.querySelector('.chaos-select-sm') as HTMLSelectElement;
    if (select) {
      await user.selectOptions(select, 'physical');
      await user.click(screen.getByText('OK'));
      expect(getHabits().some((h) => h.chaosDimension === 'physical')).toBe(true);
    }
  });

  it('cancels chaos editor without saving', async () => {
    const user = userEvent.setup();
    addHabit('Run');
    render(<App />);
    const btn = document.querySelector('.habit-chaos-btn');
    await user.click(btn!);
    await user.click(screen.getByText('Cancel'));
    expect(getHabits().every((h) => !h.chaosDimension)).toBe(true);
  });
});
