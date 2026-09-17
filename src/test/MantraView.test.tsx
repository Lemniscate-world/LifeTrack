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

  it('renders the three tabs (FR)', () => {
    render(<MantraView />);
    expect(screen.getByText("Aujourd'hui")).toBeDefined();
    expect(screen.getByText('Gérer')).toBeDefined();
    expect(screen.getByText('Réglages')).toBeDefined();
  });

  it('starts on the today tab by default', () => {
    render(<MantraView />);
    // Today tab should be active
    const todayTab = screen.getByText("Aujourd'hui");
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
    await user.click(screen.getByText('Gérer'));
    expect(screen.getByText('Gérer').className).toContain('active');
    expect(screen.getByText('Ajoute ton mantra')).toBeDefined();
  });

  it('switches to Settings tab when clicked', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Réglages'));
    expect(screen.getByText('Réglages').className).toContain('active');
    expect(screen.getByText('Rappels')).toBeDefined();
  });

  it('can return to Today tab', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Réglages'));
    await user.click(screen.getByText("Aujourd'hui"));
    expect(screen.getByText("Aujourd'hui").className).toContain('active');
  });
});

// ============================================================
// Manage tab — adding mantras
// ============================================================
describe('MantraView — adding custom mantras', () => {
  it('renders the add mantra form in Manage tab', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Gérer'));
    expect(screen.getByPlaceholderText('Écris ton mantra…')).toBeDefined();
    expect(screen.getByText('Ajouter')).toBeDefined();
  });

  it('add button is disabled when input is empty', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Gérer'));
    const addBtn = screen.getByText('Ajouter');
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a mantra when text is entered and Add is clicked', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Gérer'));

    const input = screen.getByPlaceholderText('Écris ton mantra…');
    await user.type(input, 'My personal mantra');
    await user.click(screen.getByText('Ajouter'));

    // The mantra should appear in the store
    const mantras = getMantras();
    const customMantras = mantras.filter((m) => !m.isDefault);
    expect(customMantras).toHaveLength(1);
    expect(customMantras[0].text).toBe('My personal mantra');
    expect(customMantras[0].isDefault).toBe(false);
  });

  it('proves the save: confirmation + domain opened + row highlighted', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Gérer'));

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'health');

    const input = screen.getByPlaceholderText('Écris ton mantra…');
    await user.type(input, 'Respire, ça passe');
    await user.click(screen.getByText('Ajouter'));

    // Confirmation message names the save explicitly.
    expect(screen.getByText(/Enregistré dans/)).toBeDefined();
    // The new row is visible right away (domain auto-expanded + highlight).
    expect(screen.getByText(/Respire, ça passe/)).toBeDefined();
    expect(document.querySelector('.mantra-item.just-added')).not.toBeNull();
  });

  it('adds a mantra in the selected domain', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Gérer'));

    // Select "Health" domain from the dropdown
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'health');

    const input = screen.getByPlaceholderText('Écris ton mantra…');
    await user.type(input, 'Health mantra');
    await user.click(screen.getByText('Ajouter'));

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
    await user.click(screen.getByText('Gérer'));

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
    await user.click(screen.getByText('Gérer'));

    // Expand Financial
    await user.click(screen.getByText('Financial'));

    // Should see both default badge and custom badge
    const defaultBadges = screen.getAllByText('défaut');
    expect(defaultBadges.length).toBeGreaterThan(0);

    const customBadges = screen.getAllByText('à toi');
    expect(customBadges.length).toBe(1);
  });

  it('can delete a custom mantra but not a default one', async () => {
    addMantra('Deletable mantra', 'life');

    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Gérer'));

    // Expand Life
    await user.click(screen.getByText('Life'));

    // Find the delete button for the custom mantra (only custom mantras have it)
    const deleteButtons = screen.getAllByTitle('Supprimer ce mantra');
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
    await user.click(screen.getByText('Réglages'));

    expect(screen.getByText('🌅')).toBeDefined();
    expect(screen.getByText('🌙')).toBeDefined();
    expect(screen.getByText('Rappel du matin')).toBeDefined();
    expect(screen.getByText('Rappel du soir')).toBeDefined();
  });

  it('shows showOnEntry toggle', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Réglages'));

    expect(screen.getByText("Afficher un mantra à l'ouverture")).toBeDefined();
  });

  it('toggles morning notification off and on', async () => {
    const user = userEvent.setup();
    render(<MantraView />);
    await user.click(screen.getByText('Réglages'));

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
    fireEvent.click(screen.getByText('Réglages'));

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
    expect(screen.getByText('Fermer')).toBeDefined();
  });

  it('calls onDismiss when close button is clicked', async () => {
    let dismissed = false;
    const onDismiss = () => { dismissed = true; };
    const user = userEvent.setup();
    render(<MantraView onDismiss={onDismiss} />);

    await user.click(screen.getByText('Fermer'));
    expect(dismissed).toBe(true);
  });

  it('does not show close button when onDismiss is not provided', () => {
    render(<MantraView />);
    expect(screen.queryByText('Fermer')).toBeNull();
  });
});
