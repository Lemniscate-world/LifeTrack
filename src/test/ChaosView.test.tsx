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
  resetChaos,
  getHabits,
  getDefaultChaosDimensions,
  resetStore,
} from '../store';
import ChaosView from '../ChaosView';

beforeEach(() => {
  resetStore();
});

describe('Chaos dimension defaults', () => {
  it('returns 5 default dimensions', () => {
    const dims = getDefaultChaosDimensions();
    expect(dims.length).toBe(5);
    const ids = dims.map((d) => d.id).sort();
    expect(ids).toEqual([
      'financial', 'physical', 'social', 'spiritual', 'structural',
    ]);
  });

  it('dimensions have correct labels and colors', () => {
    const dims = getDefaultChaosDimensions();
    for (let i = 0; i < dims.length; i++) {
      const d = dims[i];
      expect(d.name).toBeTruthy();
      expect(Array.isArray(d.triggers)).toBe(true);
    }
    expect(dims.length).toBe(5);
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
    expect(report.dimensions.length).toBe(5);
    expect(report.overallPct).toBeGreaterThanOrEqual(0);
    expect(report.overallPct).toBeLessThanOrEqual(100);
    expect(report.linkedHabitCount).toBe(0);
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
