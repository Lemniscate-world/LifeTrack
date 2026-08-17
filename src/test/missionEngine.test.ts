import { describe, it, expect, beforeEach } from 'vitest';
import { resetStore, addHabit, toggleCheckIn, getMissions } from '../store';
import { runAutoMissions } from '../missionEngine';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('missionEngine.runAutoMissions', () => {
  it('creates nothing with no data (no weak domain)', () => {
    const created = runAutoMissions();
    expect(created).toBe(0);
    expect(getMissions()).toHaveLength(0);
  });

  it('auto-creates weak-domain transit missions and converges (no re-creation)', { timeout: 30000 }, () => {
    // A habit tracked once, 20 days ago → weak domains detected.
    const h = addHabit('Gym');
    const d = new Date(Date.now() - 20 * 86400000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    toggleCheckIn(h.id, k);

    const first = runAutoMissions();
    expect(first).toBeGreaterThanOrEqual(1);
    const missions = getMissions();
    expect(missions.length).toBeGreaterThanOrEqual(1);
    expect(missions[0].window.kind).toBe('transit');
    expect(missions[0].habitIds).toContain(h.id);

    // The engine is incremental (max 2 per pass): keep running until converged.
    let created = first;
    let passes = 0;
    while (created > 0 && passes < 6) {
      created = runAutoMissions();
      passes++;
    }
    expect(created).toBe(0);
    expect(getMissions().length).toBeGreaterThanOrEqual(missions.length);
  });

  it('respects the missionAutoEnabled opt-out', () => {
    localStorage.setItem('lifetrack-data', JSON.stringify({
      habits: [{ id: 'h1', name: 'Gym', category: 'health', color: '#fff', goal: 1, createdAt: '', archived: false, order: 0 }],
      checkIns: [],
      notes: [],
      chaosDimensions: [],
      achievementCategories: [],
      mantras: [],
      mantraSettings: { morningEnabled: true, eveningEnabled: true, morningTime: '08:00', eveningTime: '20:00', showOnEntry: true, lastMorningDate: '', lastEveningDate: '', lastEntryDate: '' },
      skills: [],
      capacities: [],
      capacityRatings: [],
      moods: {},
      experiments: [],
      urges: [],
      customUrgeTypes: [],
      journalEntries: [],
      journalThreads: [],
      challenges: [],
      personas: [],
      levers: [],
      patternTracks: [],
      reflections: [],
      preferences: { darkMode: false, theme: '', missionAutoEnabled: false },
    }));
    resetStore();
    expect(runAutoMissions()).toBe(0);
    expect(getMissions()).toHaveLength(0);
  });
});