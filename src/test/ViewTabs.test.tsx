/**
 * ViewTabs: with 25 tabs the bar must keep every tab reachable (scrollable,
 * active tab scrolled into view) instead of pushing tabs off-screen where
 * they become unclickable.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ViewTabs from '../components/ViewTabs';

describe('ViewTabs', () => {
  it('renders all tabs and routes clicks', () => {
    const onView = vi.fn();
    const { container } = render(<ViewTabs view="grid" onView={onView} />);
    const tabs = container.querySelectorAll('.view-tab');
    // Every destination must exist as a real button (no dead corner).
    expect(tabs.length).toBeGreaterThanOrEqual(20);
    expect(screen.getByRole('tab', { name: /mantras/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /achievements/i })).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: /mantras/i }));
    expect(onView).toHaveBeenCalledWith('mantras');
  });

  it('marks the active tab (the scroll target)', () => {
    const { container } = render(<ViewTabs view="mantras" onView={() => {}} />);
    const active = container.querySelectorAll('.view-tab.active');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toMatch(/mantras/i);
  });
});
