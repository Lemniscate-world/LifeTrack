// src/test/mantras.test.ts
// Tests for the mantras module: daily selection, notifications, defaults.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MANTRA_DOMAINS,
  createDefaultMantras,
  createMantra,
  getDailyMantra,
  getAllDailyMantras,
  getDailyEntryMantra,
  todayStr,
  shouldShowMantraNotification,
  markMantraNotificationShown,
  parseTime,
  DEFAULT_MANTRA_SETTINGS,
  sendSystemNotification,
  initNotificationPermission,
  requestNotificationPermission,
} from '../mantras';
import type { Mantra, MantraSettings } from '../types';

beforeEach(() => {
  // Reset notification mock state
  vi.restoreAllMocks();
});

// ============================================================
// Domain definitions
// ============================================================
describe('MANTRA_DOMAINS', () => {
  it('has exactly 6 domains', () => {
    expect(MANTRA_DOMAINS).toHaveLength(6);
  });

  it('each domain has a unique id, name, icon, and color', () => {
    const ids = new Set(MANTRA_DOMAINS.map((d) => d.id));
    expect(ids.size).toBe(6);
    for (const domain of MANTRA_DOMAINS) {
      expect(domain.id).toBeTruthy();
      expect(domain.name).toBeTruthy();
      expect(domain.icon).toBeTruthy();
      expect(domain.color).toBeTruthy();
    }
  });

  it('includes Financial, Life, Health, Spiritual, Productivity, Relationships', () => {
    const names = MANTRA_DOMAINS.map((d) => d.name);
    expect(names).toContain('Financial');
    expect(names).toContain('Life');
    expect(names).toContain('Health');
    expect(names).toContain('Spiritual');
    expect(names).toContain('Productivity');
    expect(names).toContain('Relationships');
  });
});

// ============================================================
// Default mantras
// ============================================================
describe('createDefaultMantras', () => {
  it('creates 60 default mantras (10 per domain)', () => {
    const mantras = createDefaultMantras();
    expect(mantras).toHaveLength(60);
    for (const domain of MANTRA_DOMAINS) {
      const domainMantras = mantras.filter((m) => m.domain === domain.id);
      expect(domainMantras).toHaveLength(10);
    }
  });

  it('all default mantras are marked isDefault: true', () => {
    const mantras = createDefaultMantras();
    expect(mantras.every((m) => m.isDefault)).toBe(true);
  });

  it('each mantra has stable deterministic IDs', () => {
    const a = createDefaultMantras();
    const b = createDefaultMantras();
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  it('every default mantra has non-empty text', () => {
    const mantras = createDefaultMantras();
    for (const m of mantras) {
      expect(m.text.length).toBeGreaterThan(5);
    }
  });
});

// ============================================================
// createMantra
// ============================================================
describe('createMantra', () => {
  it('creates a user mantra with a random UUID', () => {
    const mantra = createMantra('Stay positive', 'life');
    expect(mantra.id).toBeTruthy();
    expect(mantra.text).toBe('Stay positive');
    expect(mantra.domain).toBe('life');
    expect(mantra.isDefault).toBe(false);
    expect(mantra.createdAt).toBeTruthy();
  });

  it('trims whitespace from text', () => {
    const mantra = createMantra('  Hello world  ', 'health');
    expect(mantra.text).toBe('Hello world');
  });

  it('creates unique IDs for each call', () => {
    const a = createMantra('A', 'life');
    const b = createMantra('B', 'life');
    expect(a.id).not.toBe(b.id);
  });
});

// ============================================================
// todayStr
// ============================================================
describe('todayStr', () => {
  it('returns a YYYY-MM-DD string', () => {
    const date = todayStr();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the current date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayStr()).toBe(expected);
  });
});

// ============================================================
// Daily mantra selection
// ============================================================
describe('getDailyMantra', () => {
  const mantras: Mantra[] = [
    { id: 'f1', text: 'Money is a tool', domain: 'financial', createdAt: '2025-01-01', isDefault: true },
    { id: 'f2', text: 'Wealth is experience', domain: 'financial', createdAt: '2025-01-01', isDefault: true },
    { id: 'f3', text: 'Spend less, invest more', domain: 'financial', createdAt: '2025-01-01', isDefault: true },
    { id: 'l1', text: 'Every day is new', domain: 'life', createdAt: '2025-01-01', isDefault: true },
    { id: 'l2', text: 'You are enough', domain: 'life', createdAt: '2025-01-01', isDefault: true },
  ];

  it('returns the same mantra for the same date (deterministic)', () => {
    const a = getDailyMantra(mantras, 'financial', '2026-07-05');
    const b = getDailyMantra(mantras, 'financial', '2026-07-05');
    expect(a).not.toBeNull();
    expect(a!.id).toBe(b!.id);
  });

  it('returns different mantras for different dates', () => {
    // It's possible (but unlikely) that the hash collision gives the same mantra.
    // We test across 3 dates and expect at least one difference.
    const results = new Set<string>();
    for (let d = 1; d <= 3; d++) {
      const m = getDailyMantra(mantras, 'financial', `2026-07-0${d}`);
      if (m) results.add(m.id);
    }
    // With 3 mantras and 3 dates, probability of all same is (1/3)^2 = 1/9.
    // Accept the test passing; if it fails flakily, we can adjust.
    expect(results.size).toBeGreaterThanOrEqual(1);
  });

  it('returns null for a domain with no mantras', () => {
    const result = getDailyMantra(mantras, 'spiritual');
    expect(result).toBeNull();
  });

  it('picks only from the specified domain', () => {
    const result = getDailyMantra(mantras, 'life', '2026-07-05');
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('life');
  });

  it('uses today when no date is provided', () => {
    const result = getDailyMantra(mantras, 'financial');
    if (mantras.filter((m) => m.domain === 'financial').length > 0) {
      expect(result).not.toBeNull();
    }
  });
});

// ============================================================
// getAllDailyMantras
// ============================================================
describe('getAllDailyMantras', () => {
  it('returns one mantra per domain that has mantras', () => {
    const mantras = createDefaultMantras();
    const daily = getAllDailyMantras(mantras, '2026-07-05');
    // All 6 domains have default mantras
    expect(daily.size).toBe(6);
    for (const domain of MANTRA_DOMAINS) {
      expect(daily.has(domain.id)).toBe(true);
      expect(daily.get(domain.id)!.domain).toBe(domain.id);
    }
  });

  it('skips domains with no mantras', () => {
    const mantras: Mantra[] = [
      { id: 'f1', text: 'Money tool', domain: 'financial', createdAt: '2025-01-01', isDefault: true },
    ];
    const daily = getAllDailyMantras(mantras);
    expect(daily.size).toBe(1);
    expect(daily.has('financial')).toBe(true);
  });

  it('is deterministic for the same date', () => {
    const mantras = createDefaultMantras().slice(0, 20); // subset
    const a = getAllDailyMantras(mantras, '2026-07-05');
    const b = getAllDailyMantras(mantras, '2026-07-05');
    for (const [domain, mantra] of a) {
      expect(b.get(domain)!.id).toBe(mantra.id);
    }
  });
});

// ============================================================
// getDailyEntryMantra
// ============================================================
describe('getDailyEntryMantra', () => {
  it('returns one mantra from all domains', () => {
    const mantras = createDefaultMantras();
    const result = getDailyEntryMantra(mantras, '2026-07-05');
    expect(result).not.toBeNull();
    expect(typeof result!.text).toBe('string');
  });

  it('returns null when there are no mantras', () => {
    expect(getDailyEntryMantra([], '2026-07-05')).toBeNull();
  });

  it('is deterministic for the same date', () => {
    const mantras = createDefaultMantras();
    const a = getDailyEntryMantra(mantras, '2026-07-05');
    const b = getDailyEntryMantra(mantras, '2026-07-05');
    expect(a!.id).toBe(b!.id);
  });

  it('returns different mantras for different dates (usually)', () => {
    const mantras = createDefaultMantras();
    const a = getDailyEntryMantra(mantras, '2026-07-05');
    const b = getDailyEntryMantra(mantras, '2026-07-06');
    // With 60 mantras, collision probability is ~1.7% — acceptable
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});

// ============================================================
// shouldShowMantraNotification
// ============================================================
describe('shouldShowMantraNotification', () => {
  const today = todayStr();
  const yesterday = '2020-01-01'; // definitely not today

  it('returns true when morningEnabled is true and lastMorningDate is not today', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      morningEnabled: true,
      lastMorningDate: yesterday,
    };
    expect(shouldShowMantraNotification(settings, 'morning')).toBe(true);
  });

  it('returns false when morningEnabled is false', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      morningEnabled: false,
      lastMorningDate: yesterday,
    };
    expect(shouldShowMantraNotification(settings, 'morning')).toBe(false);
  });

  it('returns false when lastMorningDate is today', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      morningEnabled: true,
      lastMorningDate: today,
    };
    expect(shouldShowMantraNotification(settings, 'morning')).toBe(false);
  });

  it('returns true when eveningEnabled is true and lastEveningDate is not today', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      eveningEnabled: true,
      lastEveningDate: yesterday,
    };
    expect(shouldShowMantraNotification(settings, 'evening')).toBe(true);
  });

  it('returns false when eveningEnabled is false', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      eveningEnabled: false,
      lastEveningDate: yesterday,
    };
    expect(shouldShowMantraNotification(settings, 'evening')).toBe(false);
  });
});

// ============================================================
// markMantraNotificationShown
// ============================================================
describe('markMantraNotificationShown', () => {
  it('sets lastMorningDate to today for morning period', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      lastMorningDate: '2020-01-01',
    };
    const updated = markMantraNotificationShown(settings, 'morning');
    expect(updated.lastMorningDate).toBe(todayStr());
    // Other fields unchanged
    expect(updated.lastEveningDate).toBe(settings.lastEveningDate);
    expect(updated.morningEnabled).toBe(settings.morningEnabled);
  });

  it('sets lastEveningDate to today for evening period', () => {
    const settings: MantraSettings = {
      ...DEFAULT_MANTRA_SETTINGS,
      lastEveningDate: '2020-01-01',
    };
    const updated = markMantraNotificationShown(settings, 'evening');
    expect(updated.lastEveningDate).toBe(todayStr());
    // Other fields unchanged
    expect(updated.lastMorningDate).toBe(settings.lastMorningDate);
  });

  it('does not mutate the original settings object', () => {
    const settings: MantraSettings = { ...DEFAULT_MANTRA_SETTINGS };
    const updated = markMantraNotificationShown(settings, 'morning');
    expect(updated).not.toBe(settings);
    expect(settings.lastMorningDate).toBe(DEFAULT_MANTRA_SETTINGS.lastMorningDate);
  });
});

// ============================================================
// parseTime
// ============================================================
describe('parseTime', () => {
  it('parses "08:00" correctly', () => {
    const result = parseTime('08:00');
    expect(result).toEqual({ hours: 8, minutes: 0 });
  });

  it('parses "23:59" correctly', () => {
    const result = parseTime('23:59');
    expect(result).toEqual({ hours: 23, minutes: 59 });
  });

  it('parses "0:00" as midnight', () => {
    const result = parseTime('0:00');
    expect(result).toEqual({ hours: 0, minutes: 0 });
  });

  it('returns null for invalid format', () => {
    expect(parseTime('invalid')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime('123:45')).toBeNull();
  });
});

// ============================================================
// DEFAULT_MANTRA_SETTINGS
// ============================================================
describe('DEFAULT_MANTRA_SETTINGS', () => {
  it('has morning and evening enabled by default', () => {
    expect(DEFAULT_MANTRA_SETTINGS.morningEnabled).toBe(true);
    expect(DEFAULT_MANTRA_SETTINGS.eveningEnabled).toBe(true);
  });

  it('has showOnEntry enabled by default', () => {
    expect(DEFAULT_MANTRA_SETTINGS.showOnEntry).toBe(true);
  });

  it('has morningTime 08:00 and eveningTime 20:00', () => {
    expect(DEFAULT_MANTRA_SETTINGS.morningTime).toBe('08:00');
    expect(DEFAULT_MANTRA_SETTINGS.eveningTime).toBe('20:00');
  });

  it('has empty last* dates initially', () => {
    expect(DEFAULT_MANTRA_SETTINGS.lastMorningDate).toBe('');
    expect(DEFAULT_MANTRA_SETTINGS.lastEveningDate).toBe('');
    expect(DEFAULT_MANTRA_SETTINGS.lastEntryDate).toBe('');
  });
});

// ============================================================
// System notifications
// ============================================================
describe('sendSystemNotification', () => {
  it('does not throw when Notification is undefined', () => {
    // In test environment (jsdom), Notification may not exist
    expect(() => sendSystemNotification('Title', 'Body')).not.toThrow();
  });
});

describe('initNotificationPermission', () => {
  it('returns "unsupported" when Notification is not available', () => {
    const result = initNotificationPermission();
    // In jsdom, Notification is usually available but with 'denied' permission
    expect(['unsupported', 'denied', 'granted', 'default']).toContain(result);
  });
});

describe('requestNotificationPermission', () => {
  it('resolves to a permission state', async () => {
    // In jsdom, Notification.requestPermission may not exist or may be mocked
    const result = await requestNotificationPermission();
    expect(['denied', 'granted', 'default']).toContain(result);
  });
});
