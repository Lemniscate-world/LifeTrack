// Tests for the multi-click toggle mode — when multiClick is OFF, the small
// count badge next to the checkmark should NOT show. This is a UI cleanup
// request from the user: in simple toggle mode the count is always 0 or 1,
// so showing a "1" next to the check is just visual noise.
// Uses keyboard (Space) toggling, which reliably targets the focused grid cell.
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore, addHabit, updateHabit } from '../store';
import App from '../App';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('Multi-click OFF hides count badge', () => {
  it('toggle mode: checkmark appears but no count badge', async () => {
    const user = userEvent.setup();
    addHabit('Yoga'); // multiClick defaults to OFF (v0.3.2)
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell.checked')).not.toBeNull();
    expect(document.querySelector('.day-cell-count')).toBeNull();
  });

  it('toggle mode: uncheck removes checkmark, count stays absent', async () => {
    const user = userEvent.setup();
    addHabit('Meditate');
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell.checked')).not.toBeNull();
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell.checked')).toBeNull();
    expect(document.querySelector('.day-cell-count')).toBeNull();
  });

  it('multi-click OFF is the default for new habits', async () => {
    // v0.3.2: new habits start with simple toggle (multiClick = false by default)
    const user = userEvent.setup();
    addHabit('Run');
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell.checked')).not.toBeNull();
    expect(document.querySelector('.day-cell-count')).toBeNull();
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell.checked')).toBeNull();
    expect(document.querySelector('.day-cell-count')).toBeNull();
  });
});

describe('Multi-click ON shows count badge', () => {
  it('shows count that increments on each Space press', async () => {
    const user = userEvent.setup();
    const h = addHabit('Pushups');
    updateHabit(h.id, { multiClick: true }); // explicitly enable
    render(<App />);
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('1');
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('2');
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('3');
  });

  it('Ctrl+Space resets count, badge disappears', async () => {
    const user = userEvent.setup();
    const h = addHabit('Sit-ups');
    updateHabit(h.id, { multiClick: true }); // explicitly enable
    render(<App />);
    await user.keyboard(' ');
    await user.keyboard(' ');
    expect(document.querySelector('.day-cell-count')?.textContent).toBe('2');
    await user.keyboard('{Control>} {/Control}');
    expect(document.querySelector('.day-cell-count')).toBeNull();
  });
});

