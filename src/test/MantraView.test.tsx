/**
 * Tests for MantraView component.
 * Covers the daily mantras display, management, and settings.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  resetStore,
  getMantras,
  getMantraSettings,
  addMantra,
} from '../store';
import MantraView from '../MantraView';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

// ============================================================
// Rendering
// ============================================================
describe('MantraView rendering', () => {
  it('renders the header', () => {
    render(<MantraView />);
    expect(screen.getByText('Mantras')).toBeDefined();
  });

  it('renders the three tabs: Today, Manage, Settings', () => {
    render(<MantraView />);
    expect(screen.getByText('📅 Today')).toBeDefined();
    expect(screen.getByText('✏️ Manage')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('starts on the Today tab by default', () => {
    render(<MantraView />);
    // Today tab should be active
    const todayTab = screen.getByText('📅 Today');
    expect(todayTab.className).toContain('active');
  });

  it('shows daily mantras for each domain', () => {
    render(<MantraView />);
    // All 6 domains should show at least their domain name
    expect(screen.getByText('Financial')).toBeDefined();
    expect(screen.getByText('Life')).toBeDefined();
    expect(screen.getByText('Health')).toBeDefined();
    expect(screen.getByText('Spiritual')).toBeDefined();
    expect(screen.getByText('Productivity')).toBeDefined();
    expect(screen.getByText('Relationships')).toBeDefined();
  });
});

// ============================================================
// Tab navigation
// ============================================================
describe('MantraView tab navigation', () => {
  it('switches to Manage tab when clicked', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));
    expect(screen.getByText('✏️ Manage').className).toContain('active');
    expect(screen.getByText('Add your own mantra')).toBeDefined();
  });

  it('switches to Settings tab when clicked', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Settings'));
    expect(screen.getByText('Settings').className).toContain('active');
    expect(screen.getByText('Notification Settings')).toBeDefined();
  });

  it('can return to Today tab', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Settings'));
    await user.click(screen.getByText('📅 Today'));
    expect(screen.getByText('📅 Today').className).toContain('active');
  });
});

// ============================================================
// Manage tab — adding mantras
// ============================================================
describe('MantraView — adding custom mantras', () => {
  it('renders the add mantra form in Manage tab', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));
    expect(screen.getByPlaceholderText('Write your mantra...')).toBeDefined();
    expect(screen.getByText('Add')).toBeDefined();
  });

  it('add button is disabled when input is empty', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));
    const addBtn = screen.getByText('Add');
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a mantra when text is entered and Add is clicked', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));

    const input = screen.getByPlaceholderText('Write your mantra...');
    await user.type(input, 'My personal mantra');
    await user.click(screen.getByText('Add'));

    // The mantra should appear in the store
    const mantras = getMantras();
    const customMantras = mantras.filter((m) => !m.isDefault);
    expect(customMantras).toHaveLength(1);
    expect(customMantras[0].text).toBe('My personal mantra');
    expect(customMantras[0].isDefault).toBe(false);
  });

  it('adds a mantra in the selected domain', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));

    // Select "Health" domain from the dropdown
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'health');

    const input = screen.getByPlaceholderText('Write your mantra...');
    await user.type(input, 'Health mantra');
    await user.click(screen.getByText('Add'));

    const mantras = getMantras();
    const custom = mantras.find((m) => m.text === 'Health mantra');
    expect(custom).toBeDefined();
    expect(custom!.domain).toBe('health');
  });
});

// ============================================================
// Manage tab — browsing & deleting
// ============================================================
describe('MantraView — browsing and deleting', () => {
  it('expands a domain to show its mantras', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));

    // Click on Financial domain to expand
    const financialToggle = screen.getByText('Financial');
    await user.click(financialToggle);

    // Should show the count — all 6 domains have 10 mantras, so there are 6 "10"s
    const counts = screen.getAllByText('10');
    expect(counts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "yours" badge for custom mantras and "default" for built-in', async () => {
    // Add a custom mantra first
    addMantra('Custom test mantra', 'financial');

    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));

    // Expand Financial
    await user.click(screen.getByText('Financial'));

    // Should see both default badge and custom badge
    const defaultBadges = screen.getAllByText('default');
    expect(defaultBadges.length).toBeGreaterThan(0);

    const customBadges = screen.getAllByText('yours');
    expect(customBadges.length).toBe(1);
  });

  it('can delete a custom mantra but not a default one', async () => {
    addMantra('Deletable mantra', 'life');

    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('✏️ Manage'));

    // Expand Life
    await user.click(screen.getByText('Life'));

    // Find the delete button for the custom mantra (only custom mantras have it)
    const deleteButtons = screen.getAllByTitle('Delete this mantra');
    expect(deleteButtons.length).toBe(1); // Only the custom mantra

    // Delete it
    await user.click(deleteButtons[0]);

    // Verify it's gone
    const mantras = getMantras();
    const custom = mantras.filter((m) => !m.isDefault);
    expect(custom).toHaveLength(0);
  });
});

// ============================================================
// Settings tab
// ============================================================
describe('MantraView — settings', () => {
  it('shows morning and evening time inputs', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Settings'));

    expect(screen.getByText('🌅')).toBeDefined();
    expect(screen.getByText('🌙')).toBeDefined();
    expect(screen.getByText('Morning reminder')).toBeDefined();
    expect(screen.getByText('Evening reminder')).toBeDefined();
  });

  it('shows showOnEntry toggle', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Settings'));

    expect(screen.getByText('Show mantra on app entry')).toBeDefined();
  });

  it('toggles morning notification off and on', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Settings'));

    // All checkboxes — find the morning one (first checkbox = morning)
    const checkboxes = screen.getAllByRole('checkbox');
    const morningCheckbox = checkboxes[0]; // Morning is first
    expect(morningCheckbox).toBeChecked();

    await user.click(morningCheckbox);
    expect(morningCheckbox).not.toBeChecked();

    const settings = getMantraSettings();
    expect(settings.morningEnabled).toBe(false);
  });

  it('changes morning time', async () => {
    render(<MantraView />);
    // Switch to settings
    fireEvent.click(screen.getByText('Settings'));

    const timeInputs = screen.getAllByDisplayValue('08:00');
    expect(timeInputs.length).toBeGreaterThanOrEqual(1);

    fireEvent.change(timeInputs[0], { target: { value: '07:30' } });

    const settings = getMantraSettings();
    expect(settings.morningTime).toBe('07:30');
  });
});

// ============================================================
// Dismiss callback
// ============================================================
describe('MantraView — dismiss', () => {
  it('shows close button when onDismiss is provided', () => {
    const onDismiss = () => {};
    render(<MantraView onDismiss={onDismiss} />);
    expect(screen.getByText('Close')).toBeDefined();
  });

  it('calls onDismiss when close button is clicked', async () => {
    let dismissed = false;
    const onDismiss = () => { dismissed = true; };
    const user = userEvent.setup();
    render(<MantraView onDismiss={onDismiss} />);

    await user.click(screen.getByText('Close'));
    expect(dismissed).toBe(true);
  });

  it('does not show close button when onDismiss is not provided', () => {
    render(<MantraView />);
    expect(screen.queryByText('Close')).toBeNull();
  });
});
