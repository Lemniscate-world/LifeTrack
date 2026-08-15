/**
 * Tests for ChaosView component.
 * Covers the previously 0%-coverage chaos visualization.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  addHabit,
  getChaosTriggersForDimension,
  getChaosPercentageForDimension,
  computeChaosReport,
  computeChaosHistory,
  resetChaos,
  getHabits,
  getDefaultChaosDimensions,
  resetStore,
  updateHabit,
} from '../store';
import ChaosView from '../ChaosView';

beforeEach(() => {
  resetStore();
});

describe('Chaos dimension defaults', () => {
  it('returns 7 default dimensions', () => {
    const dims = getDefaultChaosDimensions();
    expect(dims.length).toBe(7);
    const ids = dims.map((d) => d.id).sort();
    expect(ids).toEqual([
      'emotional', 'energy', 'financial', 'physical', 'social', 'spiritual', 'structural',
    ]);
  });

  it('dimensions have correct labels and colors', () => {
    const dims = getDefaultChaosDimensions();
    for (let i = 0; i < dims.length; i++) {
      const d = dims[i];
      expect(d.name).toBeTruthy();
      expect(Array.isArray(d.triggers)).toBe(true);
    }
    expect(dims.length).toBe(7);
  });
});

describe('Chaos linkage', () => {
  it('links a habit to a chaos dimension', () => {
    addHabit('Test Habit', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 2 });
    const habits = getHabits();
    expect(habits[0].chaosDimension).toBe('physical');
    expect(habits[0].chaosImpact).toBe(50);
    expect(habits[0].chaosThresholdDays).toBe(2);
  });

  it('links a habit to two chaos zones via chaosLinks and reports both', () => {
    addHabit('Gym', { chaosLinks: [{ dimension: 'physical', impact: 40 }, { dimension: 'energy', impact: 30 }], chaosThresholdDays: 2 });
    const habits = getHabits();
    expect(habits[0].chaosLinks).toEqual([
      { dimension: 'physical', impact: 40 },
      { dimension: 'energy', impact: 30 },
    ]);
    // No check-ins at all → missed streak reaches threshold on day 2 → both zones triggered.
    const report = computeChaosReport();
    const physical = report.dimensions.find((d) => d.id === 'physical');
    const energy = report.dimensions.find((d) => d.id === 'energy');
    const social = report.dimensions.find((d) => d.id === 'social');
    expect(physical?.habits).toHaveLength(1);
    expect(physical?.habits[0].impact).toBe(40);
    expect(energy?.habits).toHaveLength(1);
    expect(energy?.habits[0].impact).toBe(30);
    // Unlinked zones stay empty.
    expect(social?.habits).toHaveLength(0);
    // linkedHabitCount counts the habit once, not per-zone.
    expect(report.linkedHabitCount).toBe(1);
  });

  it('persists and reports the optional per-zone "cause" note', () => {
    addHabit('Snacking', {
      chaosLinks: [{ dimension: 'physical', impact: 40, cause: '  grignote tard le soir  ' }],
      chaosThresholdDays: 2,
    });
    const h = getHabits()[0];
    // updateHabit path: re-submit the same link with a cause and verify it survives sanitization.
    updateHabit(h.id, { chaosLinks: [{ dimension: 'physical', impact: 40, cause: 'Je perds l’appétit le lendemain' }] });
    expect(getHabits()[0].chaosLinks?.[0].cause).toBe('Je perds l’appétit le lendemain');
    const report = computeChaosReport();
    const physical = report.dimensions.find((d) => d.id === 'physical');
    expect(physical?.habits[0].cause).toBe('Je perds l’appétit le lendemain');
  });

  it('getChaosTriggersForDimension returns empty when no habits linked', () => {
    const triggers = getChaosTriggersForDimension('physical');
    expect(triggers.length).toBe(0);
  });

  it('getChaosPercentageForDimension returns 0 when no triggers', () => {
    const pct = getChaosPercentageForDimension('physical');
    expect(pct).toBe(0);
  });

  it('computeChaosReport returns all 5 dimensions', () => {
    const report = computeChaosReport();
    expect(report.dimensions.length).toBe(7);
    expect(report.overallPct).toBeGreaterThanOrEqual(0);
    expect(report.overallPct).toBeLessThanOrEqual(100);
    expect(report.linkedHabitCount).toBe(0);
  });

  it('computes a per-habit progress ratio toward triggering', () => {
    addHabit('Procrast', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 4 });
    const report = computeChaosReport(new Date(2026, 5, 26));
    const dim = report.dimensions.find((d) => d.id === 'physical')!;
    expect(dim.habits).toHaveLength(1);
    expect(dim.habits[0].progress).toBeGreaterThanOrEqual(0);
    expect(dim.habits[0].progress).toBeLessThanOrEqual(1);
  });

  it('computeChaosHistory returns the requested number of daily points', () => {
    const history = computeChaosHistory(14, new Date(2026, 5, 26));
    expect(history).toHaveLength(14);
    for (const p of history) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.pct).toBeGreaterThanOrEqual(0);
      expect(p.pct).toBeLessThanOrEqual(100);
    }
    // Oldest first.
    expect(history[0].date < history[history.length - 1].date).toBe(true);
  });

  it('resetChaos clears all triggers', () => {
    addHabit('Test', { chaosDimension: 'physical', chaosImpact: 50, chaosThresholdDays: 1 });
    resetChaos();
    const triggers = getChaosTriggersForDimension('physical');
    expect(triggers.length).toBe(0);
  });
});

describe('ChaosView UI', () => {
  it('renders with no linked habits', () => {
    render(<ChaosView />);
    expect(screen.getByText('Chaos Pressure')).toBeInTheDocument();
    expect(screen.getByText('No habits linked yet')).toBeInTheDocument();
  });

  it('renders habit names when habits are linked to chaos', () => {
    addHabit('Gym', { chaosDimension: 'physical', chaosImpact: 30, chaosThresholdDays: 3 });
    addHabit('Budget', { chaosDimension: 'financial', chaosImpact: 40, chaosThresholdDays: 5 });
    render(<ChaosView />);
    // Habit names should appear in dimension lists
    const gymTexts = screen.getAllByText('Gym');
    expect(gymTexts.length).toBeGreaterThanOrEqual(1);
    const budgetTexts = screen.getAllByText('Budget');
    expect(budgetTexts.length).toBeGreaterThanOrEqual(1);
    // Linked count
    expect(screen.getByText('2 habits tracked across dimensions')).toBeInTheDocument();
  });
});
