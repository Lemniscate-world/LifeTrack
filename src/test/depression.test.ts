// src/test/depression.test.ts
// Store tests for the depression tracker (% per day) + alert threshold pref.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  setDepression,
  getDepression,
  getMonthDepressions,
  getAverageDepression,
  updatePreferences,
  getPreferences,
} from '../store';

describe('depression tracker', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('stocke et lit une valeur 0-100 (bornée)', () => {
    setDepression('2026-08-01', 75);
    expect(getDepression('2026-08-01')).toBe(75);
    setDepression('2026-08-01', 150);
    expect(getDepression('2026-08-01')).toBe(100);
    setDepression('2026-08-01', null);
    expect(getDepression('2026-08-01')).toBeUndefined();
  });

  it('agrège par mois et calcule la moyenne', () => {
    setDepression('2026-08-01', 60);
    setDepression('2026-08-02', 80);
    setDepression('2026-07-30', 20);
    const month = getMonthDepressions(2026, 7); // août = index 7
    expect(month.get(1)).toBe(60);
    expect(month.get(2)).toBe(80);
    expect(month.size).toBe(2);
    expect(getAverageDepression(['2026-08-01', '2026-08-02'])).toBe(70);
  });

  it('préserve le seuil d alerte dans les préférences', () => {
    updatePreferences({ depressionAlertThreshold: 55 });
    expect(getPreferences().depressionAlertThreshold).toBe(55);
  });
});
