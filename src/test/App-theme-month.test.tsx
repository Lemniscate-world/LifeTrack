// Theme, Month nav, Empty state, Navbar, Day headers coverage tests
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

async function addUI(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByText('+ New Habit'));
  await user.type(screen.getByPlaceholderText('Habit name...'), name);
  await user.click(screen.getByText('Add'));
}

describe('Theme cycling', () => {
  it('cycles theme on click', async () => {
    const user = userEvent.setup();
    render(<App />);
    const btn = document.querySelector('[title*="Theme"]') as HTMLElement;
    const initial = btn.getAttribute('title');
    await user.click(btn);
    expect(btn.getAttribute('title')).not.toBe(initial);
    await user.click(btn);
    expect(btn.getAttribute('title')).not.toBeNull();
  });
});

describe('Dark mode', () => {
  it('toggles dark mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    const btn = document.querySelector('[title="Toggle dark mode"]') as HTMLElement;
    await user.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('Month navigation', () => {
  it('has prev and next arrows', () => {
    render(<App />);
    const arrows = document.querySelectorAll('.month-arrow');
    expect(arrows.length).toBeGreaterThanOrEqual(2);
  });

  it('navigates to previous month', async () => {
    const user = userEvent.setup();
    render(<App />);
    const initial = screen.getByText(/2026/).textContent;
    await user.click(document.querySelectorAll('.month-arrow')[0]);
    expect(screen.getByText(/2026/).textContent).not.toBe(initial);
  });

  it('navigates to next month', async () => {
    const user = userEvent.setup();
    render(<App />);
    const initial = screen.getByText(/2026/).textContent;
    await user.click(document.querySelectorAll('.month-arrow')[1]);
    expect(screen.getByText(/2026/).textContent).not.toBe(initial);
  });
});

describe('Empty state', () => {
  it('shows no habits message', () => {
    render(<App />);
    expect(screen.getByText('No habits yet')).toBeInTheDocument();
  });

  it('shows Ctrl+N hint', () => {
    render(<App />);
    expect(screen.getByText(/Ctrl\+N/)).toBeInTheDocument();
  });

  it('hides empty state after adding habit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addUI(user, 'First');
    expect(screen.queryByText('No habits yet')).toBeNull();
  });
});

describe('Navbar', () => {
  it('renders all tabs', () => {
    render(<App />);
    for (const tab of ['Grid', 'Statistics', 'History', 'Stacks', 'Chaos', '💡 Insights']) {
      expect(screen.getByText(tab)).toBeInTheDocument();
    }
  });

  it('renders logo SVG', () => {
    render(<App />);
    expect(document.querySelector('.logo-icon')).not.toBeNull();
  });

  it('renders skip link', () => {
    render(<App />);
    expect(screen.getByText('Skip to main content')).toBeInTheDocument();
  });
});

describe('Day headers', () => {
  it('shows day numbers after adding habit', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows today highlight', async () => {
    const user = userEvent.setup();
    addHabit('Test');
    render(<App />);
    expect(document.querySelectorAll('.col-day.today').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Multiple habits', () => {
  it('renders 5 habits in order', async () => {
    const user = userEvent.setup();
    render(<App />);
    for (const name of ['A', 'B', 'C', 'D', 'E']) await addUI(user, name);
    const names = Array.from(document.querySelectorAll('.habit-name')).map((n) => n.textContent);
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
