/**
 * Bulk split: the ~1.5MB knowledge library (protocols + ingestedSources) used
 * to ride inside EVERY envelope/snapshot write, choking the ~5MB localStorage
 * quota until ALL writes failed silently and recent user data stopped
 * persisting. Now envelopes carry only the ~100KB core; bulk lives in its own
 * best-effort key (+ full-fidelity files). Guards: envelope stays small,
 * bulk round-trips through reload, rollback preserves the library.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  addHabit,
  mergeImportedData,
  exportAllData,
  forceSaveNow,
  getProtocols,
  createUpgradeBackup,
  restoreUpgradeBackup,
} from '../store';

const BULK_KEY = 'lifetrack-bulk';

function seedBulk() {
  mergeImportedData({
    habits: [],
    checkIns: [],
    notes: [],
    protocols: [
      { id: 'pr1', title: 'T1', source: 'S', claim: 'C', domain: 'sleep', protocol: 'P', keywords: [] },
      { id: 'pr2', title: 'T2', source: 'S', claim: 'C', domain: 'sleep', protocol: 'P', keywords: [] },
    ],
    ingestedSources: [
      { id: 's1', title: 'T', rawText: 'R'.repeat(1000), createdAt: '2026-09-01T00:00:00Z', ingested: true },
    ],
  });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('bulk split persistence', () => {
  it('keeps envelopes core-only while bulk persists separately', () => {
    addHabit('Gym');
    seedBulk();
    forceSaveNow();
    const env = JSON.parse(localStorage.getItem('lifetrack-data')!);
    expect('protocols' in env.d).toBe(false);
    expect('ingestedSources' in env.d).toBe(false);
    expect(env.d.habits.map((h: { name: string }) => h.name)).toContain('Gym');
    const bulk = JSON.parse(localStorage.getItem(BULK_KEY)!);
    expect(bulk.d.protocols.map((p: { id: string }) => p.id).sort()).toEqual(['pr1', 'pr2']);
    expect(bulk.d.ingestedSources.map((s: { id: string }) => s.id)).toEqual(['s1']);
    // Envelope stays small even with a 1MB+ library in play.
    expect(JSON.stringify(env).length).toBeLessThan(256 * 1024);
  });

  it('reattaches bulk on reload (resetStore → loadData)', () => {
    addHabit('Gym');
    seedBulk();
    forceSaveNow();
    expect(getProtocols()).toHaveLength(2);
    resetStore(); // reloads from localStorage: core envelope + bulk key
    expect(getProtocols().map((p) => p.id).sort()).toEqual(['pr1', 'pr2']);
    expect(exportAllData().ingestedSources?.map((s) => s.id)).toEqual(['s1']);
  });

  it('rollback to a core-only snapshot preserves the library', () => {
    addHabit('Gym');
    seedBulk();
    forceSaveNow();
    const key = createUpgradeBackup();
    expect(key).not.toBeNull();
    // Snapshot itself carries no library bulk (small forever — sanitize
    // leaves empty arrays, which must stay tiny).
    const snap = JSON.parse(localStorage.getItem(key!)!);
    expect(JSON.stringify(snap.d.protocols ?? []).length).toBeLessThan(1024);
    expect(JSON.stringify(snap.d.ingestedSources ?? []).length).toBeLessThan(1024);
    // Roll back: core restored, library reattached from bulk key.
    expect(restoreUpgradeBackup(key!)).toBe(true);
    expect(getProtocols().map((p) => p.id).sort()).toEqual(['pr1', 'pr2']);
  });

  it('merge imports the knowledge library into memory', () => {
    expect(getProtocols()).toHaveLength(0);
    const r = mergeImportedData({
      habits: [],
      checkIns: [],
      notes: [],
      protocols: [{ id: 'px', title: 'T', source: 'S', claim: 'C', domain: 'sleep', protocol: 'P', keywords: [] }],
      ingestedSources: [{ id: 'sx', title: 'T', rawText: 'R', createdAt: '2026-09-01T00:00:00Z', ingested: false }],
      feeds: [{ id: 'f1', url: 'https://x', title: 'X', enabled: true, createdAt: '2026-09-01T00:00:00Z', lastGuids: [] }],
    });
    expect(r.miscRestored).toBeGreaterThanOrEqual(3);
    expect(getProtocols().map((p) => p.id)).toEqual(['px']);
    expect(exportAllData().ingestedSources?.map((s) => s.id)).toEqual(['sx']);
    expect(exportAllData().feeds?.map((f) => f.id)).toEqual(['f1']);
  });
});
