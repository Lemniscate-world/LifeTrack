/**
 * Per-emotion focus: name every emotion in a shock, dissect each one
 * (evolution, notes, estimation, coping, action items), tag daily notes
 * and plans per emotion — without losing anything on the way.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  resetStore,
  addEmotionalEvent,
  upsertEmotionalCheck,
  getEmotionalChecks,
  updateEmotionalEvent,
} from '../store';
import { todayKey } from '../dates';
import EmotionalProcessingView from '../EmotionalProcessingView';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

function seedShock() {
  const ev = addEmotionalEvent({
    title: 'Choc test',
    situation: 'rejet brutal',
    emotions: ['Honte', 'Colère'],
  });
  upsertEmotionalCheck(ev.id, '2026-09-04', 9, 'je me sens nul', { Honte: 9, Colère: 7 }, ['Honte']);
  upsertEmotionalCheck(ev.id, '2026-09-05', 8, undefined, { Honte: 8, Colère: 7 });
  upsertEmotionalCheck(ev.id, '2026-09-06', 6, 'marche', { Honte: 6, Colère: 5 }, ['Honte']);
  return ev;
}

function focusPanel() {
  const panel = document.querySelector('.emotional-focus-panel');
  expect(panel).not.toBeNull();
  return panel!;
}

describe('Emotion focus tabs', () => {
  it('shows focus tabs and opens one emotion at a time', () => {
    seedShock();
    const { container } = render(<EmotionalProcessingView />);
    expect(screen.getByRole('tab', { name: 'Toutes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Honte/ }));
    expect(screen.getByText('🔍 Honte — analyse')).toBeInTheDocument();
    // Estimation from the per-emotion fit (3 Honte points) inside the panel.
    expect(container.querySelector('.emotional-focus-est')).not.toBeNull();
    expect(container.querySelector('.emotional-focus-est')!.textContent).toContain('Demi-vie');
    // Switching focus swaps the panel.
    fireEvent.click(screen.getByRole('tab', { name: /Colère/ }));
    expect(screen.getByText('🔍 Colère — analyse')).toBeInTheDocument();
    expect(screen.queryByText('🔍 Honte — analyse')).toBeNull();
  });

  it('lists notes tagged with the focused emotion', () => {
    seedShock();
    render(<EmotionalProcessingView />);
    fireEvent.click(screen.getByRole('tab', { name: /Honte/ }));
    const panel = focusPanel();
    expect(panel.textContent).toContain('Notes liées (2)');
    expect(panel.textContent).toContain('je me sens nul');
    fireEvent.click(screen.getByRole('tab', { name: /Colère/ }));
    expect(focusPanel().textContent).toContain('Notes liées (0)');
  });

  it('shows coping tracks for the focused emotion', () => {
    seedShock();
    render(<EmotionalProcessingView />);
    fireEvent.click(screen.getByRole('tab', { name: /Honte/ }));
    expect(focusPanel().textContent).toContain('Auto-compassion');
  });

  it('plots per-emotion bars, empty where no per-emotion value exists', () => {
    seedShock();
    const { container } = render(<EmotionalProcessingView />);
    fireEvent.click(screen.getByRole('tab', { name: /Colère/ }));
    const bars = container.querySelectorAll('.emotional-bars.per-emotion .emotional-bar-wrap');
    expect(bars.length).toBeGreaterThan(0);
    // 2026-09-05 has no Colère-tagged note but HAS a Colère intensity → filled.
    const withFill = container.querySelectorAll('.emotional-bars.per-emotion .per-emotion-fill');
    expect(withFill.length).toBeGreaterThan(0);
  });
});

describe('Per-emotion tagging', () => {
  it('tags the daily note from the check form', () => {
    const ev = seedShock();
    render(<EmotionalProcessingView />);
    // Tag chips live in the daily form; tag Colère then check today.
    fireEvent.click(screen.getByTitle('Tagguer la note « Colère »'));
    const input = screen.getByPlaceholderText('Note du jour (optionnel)');
    fireEvent.change(input, { target: { value: 'note taggée' } });
    fireEvent.click(screen.getByText("Cocher aujourd'hui"));
    const today = todayKey(new Date());
    const check = getEmotionalChecks(ev.id).find((c) => c.date === today);
    expect(check?.note).toBe('note taggée');
    expect(check?.noteEmotions).toEqual(['Colère']);
  });

  it('tags a plan with emotions from its card', () => {
    const ev = seedShock();
    updateEmotionalEvent(ev.id, {
      plans: [{ id: 'p-1', title: 'Plan', steps: [{ id: 's-1', label: 'step', done: false }], createdAt: '2026-09-04T00:00:00.000Z' }],
    });
    render(<EmotionalProcessingView />);
    fireEvent.click(screen.getByTitle('Cibler ce plan sur « Honte »'));
    // Focus shows it under targeted plans.
    fireEvent.click(screen.getByRole('tab', { name: /Honte/ }));
    expect(focusPanel().textContent).toContain('Choses à faire (1)');
  });
});
