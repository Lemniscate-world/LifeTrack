import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('Life')).toBeInTheDocument();
    expect(screen.getByText('Track')).toBeInTheDocument();
    // Month label contains current month name
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const currentMonth = monthNames[new Date().getMonth()];
    const currentYear = new Date().getFullYear();
    expect(screen.getByText(`${currentMonth}, ${currentYear}`)).toBeInTheDocument();
  });

  it('renders day headers with letters and numbers', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Need a habit for the grid to render instead of empty state
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Test');
    await user.click(screen.getByText('Add'));

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

    // Find the first day cell td and click it
    const allTds = document.querySelectorAll('td.col-day');
    expect(allTds.length).toBeGreaterThan(0);

    // Click the first day cell
    await user.click(allTds[0]);

    // A checked cell should now have the check icon
    const checkIcons = document.querySelectorAll('.check-icon');
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  it('shows the notes toggle button', () => {
    render(<App />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('adds a note via the notes panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Click "Notes" toggle to open panel
    await user.click(screen.getByText('Notes'));

    // Type note content
    const textarea = screen.getByPlaceholderText('Write a note...');
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
    await user.click(screen.getByText('Notes'));
    await user.type(screen.getByPlaceholderText('Write a note...'), 'Delete me');
    await user.click(screen.getByText('Save'));

    // Delete it - find the X button in the notes list
    const deleteBtn = document.querySelector('.notes-delete') as HTMLElement;
    expect(deleteBtn).not.toBeNull();
    await user.click(deleteBtn);

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

    // Find the goal cell - it should show the goal number
    const goalElement = document.querySelector('.goal-number');
    expect(goalElement).not.toBeNull();

    // Click on goal to edit
    if (goalElement) {
      await user.click(goalElement);
    }

    // An input should appear
    const goalInput = document.querySelector('.goal-input');
    expect(goalInput).not.toBeNull();
  });

  it('switches to Statistics view and shows empty state', async () => {
    const user = userEvent.setup();
    render(<App />);

    const statsTab = screen.getByText('Statistics');
    await user.click(statsTab);

    // Should show empty state since no habits exist
    expect(screen.getByText('Add habits to see statistics.')).toBeInTheDocument();
  });

  it('shows statistics with data after adding a habit and check-in', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Add a habit
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Gym');
    await user.click(screen.getByText('Add'));

    // Toggle today's cell
    const allTds = document.querySelectorAll('td.col-day');
    if (allTds.length > 0) {
      await user.click(allTds[0]);
    }

    // Switch to stats
    await user.click(screen.getByText('Statistics'));

    // Should show the habit name in the stats table
    expect(screen.getAllByText('Gym').length).toBeGreaterThan(0);
    // Should show the new column headers: Current / Best / Gap
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Best')).toBeInTheDocument();
    expect(screen.getByText('Gap')).toBeInTheDocument();
  });

  it('can switch back to Grid view from Statistics', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Add a habit so grid has content
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Test');
    await user.click(screen.getByText('Add'));

    await user.click(screen.getByText('Statistics'));
    await user.click(screen.getByText('Grid'));

    // Grid should be visible again (day numbers present)
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows empty state when no habits exist', () => {
    render(<App />);
    expect(screen.getByText('No habits yet')).toBeInTheDocument();
  });

  it('hides empty state after adding a habit', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('No habits yet')).toBeInTheDocument();

    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Gym');
    await user.click(screen.getByText('Add'));

    expect(screen.queryByText('No habits yet')).not.toBeInTheDocument();
  });

  it('renames a habit by clicking the name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Old');
    await user.click(screen.getByText('Add'));

    // Click the habit name to edit
    await user.click(screen.getByText('Old'));
    const input = document.querySelector('.habit-name-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    await user.clear(input);
    await user.type(input, 'New');
    await user.keyboard('{Enter}');

    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  it('archives a habit on hover and click', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Remove');
    await user.click(screen.getByText('Add'));

    // Archive button appears on hover; click it
    const archiveBtn = document.querySelector('.habit-archive') as HTMLElement;
    expect(archiveBtn).not.toBeNull();
    await user.click(archiveBtn);

    // Habit should be gone (archived)
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });

  it('edits goal by clicking the goal number', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Gym');
    await user.click(screen.getByText('Add'));

    const goalEl = document.querySelector('.goal-number') as HTMLElement;
    expect(goalEl).not.toBeNull();
    await user.click(goalEl);

    const goalInput = document.querySelector('.goal-input') as HTMLInputElement;
    expect(goalInput).not.toBeNull();
    await user.clear(goalInput);
    await user.type(goalInput, '15');
    await user.keyboard('{Enter}');

    // Goal should now show 15 in the goal column
    const goalNumbers = document.querySelectorAll('.goal-number');
    expect(goalNumbers.length).toBeGreaterThan(0);
    expect(goalNumbers[0].textContent).toBe('15');
  });

  it('exports JSON via dropdown', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'ExportTest');
    await user.click(screen.getByText('Add'));

    // Open export dropdown
    const exportBtns = document.querySelectorAll('.btn-icon');
    const exportBtn = exportBtns[1]; // Second icon button = export
    await user.click(exportBtn);

    // Click Export JSON
    const jsonBtn = screen.getByText('Export JSON');
    expect(jsonBtn).toBeInTheDocument();
  });

  it('cycles through themes', async () => {
    const user = userEvent.setup();
    render(<App />);
    const themeBtn = document.querySelectorAll('.btn-icon')[0];
    await user.click(themeBtn);
    // Theme should have changed (class added to html)
    const html = document.documentElement;
    const hasTheme = html.classList.contains('theme-ocean');
    expect(hasTheme).toBe(true);
  });

  it('toggles dark mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    const darkBtn = document.querySelectorAll('.btn-icon')[2];
    await user.click(darkBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(darkBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('keyboard focus highlights a cell in the correct habit row', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Two habits so row index and day-column index cannot coincidentally match
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'First');
    await user.click(screen.getByText('Add'));
    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Second');
    await user.click(screen.getByText('Add'));

    // ArrowDown moves focus to the second habit row (day stays on day 1)
    await user.keyboard('{ArrowDown}');

    const focused = document.querySelectorAll('td.focused');
    expect(focused).toHaveLength(1);
    const row = focused[0].closest('tr');
    expect(row?.querySelector('.habit-name')?.textContent).toBe('Second');
  });

  it('keyboard shortcuts support undo and redo with Ctrl+Z / Ctrl+Shift+Z', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText('+ New Habit'));
    await user.type(screen.getByPlaceholderText('Habit name...'), 'Read');
    await user.click(screen.getByText('Add'));

    await user.keyboard(' ');
    expect(document.querySelectorAll('.check-icon')).toHaveLength(1);

    await user.keyboard('{Control>}z{/Control}');
    expect(document.querySelectorAll('.check-icon')).toHaveLength(0);

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(document.querySelectorAll('.check-icon')).toHaveLength(1);
  });
});
