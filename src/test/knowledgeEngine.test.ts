import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore, addHabit, toggleCheckIn, getHabits, getPreferences, setProtocols,
} from '../store';
import { runAutoKnowledge } from '../knowledgeEngine';
import { SEED_PROTOCOLS } from '../protocols';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('knowledgeEngine.runAutoKnowledge', () => {
  it('adopts nothing with no data (no weak domains → no suggestions)', () => {
    setProtocols(SEED_PROTOCOLS);
    expect(runAutoKnowledge()).toBe(0);
  });

  it('adopts top suggested protocols for weak domains and converges', { timeout: 20000 }, () => {
    // One neglected habit → weak domain(s) → ranked protocol suggestions.
    const h = addHabit('Gym');
    setProtocols(SEED_PROTOCOLS);
    const d = new Date(Date.now() - 20 * 86400000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    toggleCheckIn(h.id, k);

    const before = getHabits().length;
    const first = runAutoKnowledge();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(getHabits().length).toBeGreaterThan(before);

    // Converges: adopted protocols are now "already pursued" (habits exist).
    let created = first;
    let passes = 0;
    while (created > 0 && passes < 6) {
      created = runAutoKnowledge();
      passes++;
    }
    expect(created).toBe(0);
    expect(getHabits().length).toBeGreaterThanOrEqual(before + first);
  });

  it('respects the knowledgeAutoAdopt opt-out', () => {
    const d = new Date(Date.now() - 20 * 86400000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Raw AppData fixture (legacy format, no envelope) — loaded by resetStore.
    localStorage.setItem('lifetrack-data', JSON.stringify({
      habits: [{ id: 'h1', name: 'Gym', category: 'health', color: '#fff', goal: 1, createdAt: '', archived: false, order: 0 }],
      checkIns: [{ habitId: 'h1', date: k, completed: true, count: 1, notes: [], projectId: undefined }],
      notes: [], chaosDimensions: [], achievementCategories: [],
      mantras: [], mantraSettings: { morningEnabled: true, eveningEnabled: true, morningTime: '08:00', eveningTime: '20:00', showOnEntry: true, lastMorningDate: '', lastEveningDate: '', lastEntryDate: '' },
      skills: [], capacities: [], capacityRatings: [], moods: {}, experiments: [], urges: [],
      customUrgeTypes: [], journalEntries: [], journalThreads: [], challenges: [], personas: [],
      levers: [], patternTracks: [], reflections: [],
      preferences: { darkMode: false, theme: '', knowledgeAutoAdopt: false },
    }));
    resetStore();
    setProtocols(SEED_PROTOCOLS);
    expect(getPreferences().knowledgeAutoAdopt).toBe(false);
    expect(runAutoKnowledge()).toBe(0);
  });
});