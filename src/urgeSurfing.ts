// Urge Surfing — mindfulness technique: observe urges like waves,
// watch them peak, and let them pass without acting on them.
// This module defines types, presets, and store functions.

import type { AppData, UrgeEntry } from './types';

// --- Computed stats (not stored) ---

export interface UrgeStats {
  total: number;
  surfed: number;
  gaveIn: number;
  successRate: number; // 0-100
  avgIntensity: number;
  byType: Record<string, { total: number; surfed: number; avgIntensity: number }>;
}

// --- Predefined urge types ---

export const URGE_TYPES = [
  { id: 'craving', label: 'Craving', emoji: '🍫', color: '#F59E0B' },
  { id: 'procrastination', label: 'Procrastination', emoji: '📱', color: '#8B5CF6' },
  { id: 'anger', label: 'Anger', emoji: '😤', color: '#EF4444' },
  { id: 'anxiety', label: 'Anxiety', emoji: '😰', color: '#6366F1' },
  { id: 'boredom', label: 'Boredom', emoji: '🥱', color: '#6B7280' },
  { id: 'other', label: 'Other', emoji: '❓', color: '#10B981' },
];

// --- Store accessors (data lives in AppData.urges) ---
// We use a helper to read/write the urges array from the global data object.

let _getData: () => AppData;
let _notify: () => void;

export function bindUrgeStore(getData: () => AppData, notify: () => void): void {
  _getData = getData;
  _notify = notify;
}

function urges(): UrgeEntry[] {
  const d = _getData();
  if (!d.urges) (d as Record<string, unknown>).urges = [];
  return d.urges as unknown as UrgeEntry[];
}

export function addUrgeEntry(entry: Omit<UrgeEntry, 'id'>): UrgeEntry {
  const e: UrgeEntry = {
    ...entry,
    id: crypto.randomUUID(),
  };
  urges().push(e);
  _notify();
  return e;
}

export function updateUrgeEntry(id: string, updates: Partial<UrgeEntry>): void {
  const idx = urges().findIndex(e => e.id === id);
  if (idx !== -1) {
    Object.assign(urges()[idx], updates);
    _notify();
  }
}

export function deleteUrgeEntry(id: string): void {
  const arr = urges();
  const idx = arr.findIndex(e => e.id === id);
  if (idx !== -1) {
    arr.splice(idx, 1);
    _notify();
  }
}

export function getUrgeEntries(): UrgeEntry[] {
  return [...urges()].sort((a, b) => b.startTime.localeCompare(a.startTime));
}

export function getActiveUrge(): UrgeEntry | null {
  return urges().find(e => e.outcome === 'active') ?? null;
}

/** Surf the urge: mark as successfully ridden out. */
export function surfUrge(id: string, note?: string): void {
  updateUrgeEntry(id, {
    outcome: 'surfed',
    endTime: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
}

/** Give in: mark as given in to the urge. */
export function giveInUrge(id: string, note?: string): void {
  updateUrgeEntry(id, {
    outcome: 'gave_in',
    endTime: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
}

/** Compute urge statistics for the last N days (default 30). */
export function computeUrgeStats(days: number = 30): UrgeStats {
  const all = getUrgeEntries();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  const recent = all.filter(e => e.startTime >= cutoffStr && e.outcome !== 'active');
  const total = recent.length;
  const surfed = recent.filter(e => e.outcome === 'surfed').length;
  const gaveIn = recent.filter(e => e.outcome === 'gave_in').length;
  const successRate = total > 0 ? Math.round((surfed / total) * 100) : 0;
  const avgIntensity = total > 0
    ? Math.round(recent.reduce((s, e) => s + e.intensity, 0) / total)
    : 0;

  const byType: UrgeStats['byType'] = {};
  for (const e of recent) {
    if (!byType[e.type]) {
      byType[e.type] = { total: 0, surfed: 0, avgIntensity: 0 };
    }
    byType[e.type].total++;
    if (e.outcome === 'surfed') byType[e.type].surfed++;
    byType[e.type].avgIntensity =
      Math.round((byType[e.type].avgIntensity * (byType[e.type].total - 1) + e.intensity) / byType[e.type].total);
  }

  return { total, surfed, gaveIn, successRate, avgIntensity, byType };
}

/** Format elapsed time since urge started (human-readable). */
export function formatUrgeElapsed(startTime: string): string {
  const elapsed = Date.now() - new Date(startTime).getTime();
  const mins = Math.floor(elapsed / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}
