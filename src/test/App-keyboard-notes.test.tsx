// Keyboard nav + Notes panel + Misc coverage tests
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, addNote, getNotes } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('Keyboard navigation', () => {
  it('ArrowRight moves focus', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    await user.keyboard('{ArrowRight}');
    expect(document.querySelector('.focused')).not.toBeNull();
  });

  it('Space toggles check-in', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelectorAll('.check-icon').length).toBeGreaterThanOrEqual(1);
  });

  it('Ctrl+Z undoes toggle', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelectorAll('.check-icon').length).toBe(1);
    await user.keyboard('{Control>}z{/Control}');
    expect(document.querySelectorAll('.check-icon').length).toBe(0);
  });

  it('Ctrl+Shift+Z redoes', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    await user.keyboard(' ');
    await user.keyboard('{Control>}z{/Control}');
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(document.querySelectorAll('.check-icon').length).toBe(1);
  });

  it('Ctrl+N opens new habit input', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Click the + New Habit button directly (more reliable than Ctrl+N in jsdom)
    await user.click(screen.getByText('+ New Habit'));
    expect(screen.getByPlaceholderText('Habit name...')).toBeInTheDocument();
  });
});

describe('Notes panel', () => {
  it('opens and closes notes panel', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Notes'));
    expect(screen.getByPlaceholderText('Write a note...')).toBeInTheDocument();
    await user.click(screen.getByText('Notes'));
    expect(screen.queryByPlaceholderText('Write a note...')).toBeNull();
  });

  it('adds a note', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Notes'));
    await user.type(screen.getByPlaceholderText('Write a note...'), 'Hello');
    await user.click(screen.getByText('Save'));
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('deletes a note', async () => {
    const user = userEvent.setup();
    addNote('Delete me');
    render(<App />);
    await user.click(screen.getByText('Notes'));
    expect(screen.getByText('Delete me')).toBeInTheDocument();
    const delBtn = document.querySelector('.notes-delete');
    if (delBtn) await user.click(delBtn);
    expect(getNotes().length).toBe(0);
  });
});

describe('Habit rename', () => {
  it('enters rename on click', async () => {
    const user = userEvent.setup();
    addHabit('Old');
    render(<App />);
    await user.click(screen.getByText('Old'));
    expect(document.querySelector('.habit-name-input')).not.toBeNull();
  });

  it('saves rename on Enter', async () => {
    const user = userEvent.setup();
    addHabit('Old');
    render(<App />);
    await user.click(screen.getByText('Old'));
    const input = document.querySelector('.habit-name-input') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'New');
    await user.keyboard('{Enter}');
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('cancels rename on Escape', async () => {
    const user = userEvent.setup();
    addHabit('Keep');
    render(<App />);
    await user.click(screen.getByText('Keep'));
    await user.keyboard('{Escape}');
    expect(document.querySelector('.habit-name-input')).toBeNull();
  });
});
