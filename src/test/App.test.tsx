import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore } from '../store';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('App component', () => {
  it('renders the app title and month selector', () => {
    render(<App />);
    expect(screen.getByText('LifeTrack')).toBeInTheDocument();
    // Month label contains current month name
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const currentMonth = monthNames[new Date().getMonth()];
    const currentYear = new Date().getFullYear();
    expect(screen.getByText(`${currentMonth}, ${currentYear}`)).toBeInTheDocument();
  });

  it('renders day headers with letters and numbers', () => {
    render(<App />);
    // First day should be "1" and a letter
    expect(screen.getByText('1')).toBeInTheDocument();
    // Day letters should be present
    const letters = screen.getAllByText(/^[SMTWTF]$/);
    expect(letters.length).toBeGreaterThan(0);
  });

  it('adds a new habit via the input form', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Click "+ New Habit"
    const addButton = screen.getByText('+ New Habit');
    await user.click(addButton);

    // Type habit name
    const input = screen.getByPlaceholderText('Habit name...');
    await user.type(input, 'Exercise');

    // Click Add
    const confirmButton = screen.getByText('Add');
    await user.click(confirmButton);

    // Habit should appear in the grid
    expect(screen.getByText('Exercise')).toBeInTheDocument();
  });

  it('toggles a day cell when clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Add a habit first
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Read');
    await user.click(screen.getByText('Add'));

    // Find day 1 cell and click it
    const dayCells = screen.getAllByRole('cell');
    // The first day cell after the habit name column
    const day1Cell = screen.getByText('1').closest('th');
    // We need the td with day 1, not the th
    const allTds = document.querySelectorAll('td.col-day');
    expect(allTds.length).toBeGreaterThan(0);

    // Click the first day cell
    await user.click(allTds[0]);

    // A checked cell should now have the check icon
    const checkIcons = document.querySelectorAll('.check-icon');
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  it('shows the notes section', () => {
    render(<App />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('+ New Note')).toBeInTheDocument();
  });

  it('adds a note', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Click "+ New Note"
    await user.click(screen.getByText('+ New Note'));

    // Type note content
    const textarea = screen.getByPlaceholderText('Write your note...');
    await user.type(textarea, 'Test note content');

    // Click Save
    await user.click(screen.getByText('Save'));

    // Note should appear
    expect(screen.getByText('Test note content')).toBeInTheDocument();
  });

  it('deletes a note', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Add a note first
    await user.click(screen.getByText('+ New Note'));
    await user.type(screen.getByPlaceholderText('Write your note...'), 'Delete me');
    await user.click(screen.getByText('Save'));

    // Delete it
    const deleteButton = screen.getByTitle('Delete note');
    await user.click(deleteButton);

    // Note should be gone
    expect(screen.queryByText('Delete me')).not.toBeInTheDocument();
  });

  it('navigates to previous month', async () => {
    const user = userEvent.setup();
    render(<App />);

    const prevButton = document.querySelector('.month-arrow:first-child');
    expect(prevButton).not.toBeNull();
    if (prevButton) {
      await user.click(prevButton as HTMLElement);
    }

    // The month label should have changed
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    expect(screen.getByText(`${monthNames[prevMonth]}, ${prevYear}`)).toBeInTheDocument();
  });

  it('shows goal as clickable and allows editing', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Add a habit
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Gym');
    await user.click(screen.getByText('Add'));

    // Find the goal cell - it should show "0/30" or similar
    const goalElement = document.querySelector('.goal-clickable');
    expect(goalElement).not.toBeNull();

    // Click on goal to edit
    if (goalElement) {
      await user.click(goalElement);
    }

    // An input should appear
    const goalInput = document.querySelector('.goal-input');
    expect(goalInput).not.toBeNull();
  });
});
