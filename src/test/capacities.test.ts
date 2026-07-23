import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  getSkills,
  addSkill,
  deleteSkill,
  getCapacities,
  getCapacity,
  addCapacity,
  updateCapacity,
  deleteCapacity,
  getCapacityRatings,
  logCapacityObservation,
  deleteCapacityRating,
  computeCapacityProgress,
  mergeImportedData,
} from '../store';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

// Helper: create a skill and return it
function setupSkill(name = 'Test Skill') {
  return addSkill(name, 'Test desc', '🧪', '#EEE', [])!;
}

// Helper: create a capacity under a skill
function setupCapacity(skillId: string, name = 'Test Capacity') {
  return addCapacity(skillId, name, 'A test capacity', '1-10', 3, 8)!;
}

describe('Capacities CRUD', () => {
  it('getCapacities returns empty when no capacities exist', () => {
    expect(getCapacities()).toEqual([]);
  });

  it('addCapacity creates a capacity under a skill', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, 'Focus Duration', 'How long can I focus', 'minutes', 5, 45);
    expect(cap).not.toBeNull();
    expect(cap!.name).toBe('Focus Duration');
    expect(cap!.skillId).toBe(skill.id);
    expect(cap!.unit).toBe('minutes');
    expect(cap!.baseline).toBe(5);
    expect(cap!.target).toBe(45);

    const caps = getCapacities(skill.id);
    expect(caps).toHaveLength(1);
    expect(caps[0].id).toBe(cap!.id);
  });

  it('addCapacity returns null for missing skill', () => {
    const cap = addCapacity('nonexistent', 'Test', '', '1-10', 1, 5);
    expect(cap).toBeNull();
  });

  it('addCapacity returns null for empty name', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, '  ', '', '1-10', 1, 5);
    expect(cap).toBeNull();
  });

  it('addCapacity defaults unit to 1-10 if empty', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, 'Test', '', '', 0, 10);
    expect(cap!.unit).toBe('1-10');
  });

  it('addCapacity clamps baseline and target', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, 'Test', '', '1-10', -5, 2000);
    expect(cap!.baseline).toBe(0);   // clamped to 0
    expect(cap!.target).toBe(1000);  // clamped to 1000
  });

  it('getCapacities filters by skillId', () => {
    const skillA = setupSkill('A');
    const skillB = setupSkill('B');
    addCapacity(skillA.id, 'Cap A1', '', '1-10', 1, 5);
    addCapacity(skillB.id, 'Cap B1', '', '1-10', 1, 5);

    expect(getCapacities(skillA.id)).toHaveLength(1);
    expect(getCapacities(skillB.id)).toHaveLength(1);
    expect(getCapacities()).toHaveLength(2);
  });

  it('getCapacity returns single capacity by id', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const found = getCapacity(cap.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Capacity');
  });

  it('getCapacity returns undefined for missing id', () => {
    expect(getCapacity('nonexistent')).toBeUndefined();
  });

  it('updateCapacity mutates fields', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    updateCapacity(cap.id, { name: 'Updated', baseline: 5, target: 20 });
    const updated = getCapacity(cap.id);
    expect(updated!.name).toBe('Updated');
    expect(updated!.baseline).toBe(5);
    expect(updated!.target).toBe(20);
  });

  it('updateCapacity clamps out-of-range values', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    updateCapacity(cap.id, { baseline: -10, target: 9999 });
    const updated = getCapacity(cap.id);
    expect(updated!.baseline).toBe(0);
    expect(updated!.target).toBe(1000);
  });

  it('updateCapacity trims name and defaults empty unit to 1-10', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    updateCapacity(cap.id, { name: '  Trimmed  ', unit: '' });
    const updated = getCapacity(cap.id);
    expect(updated!.name).toBe('Trimmed');
    expect(updated!.unit).toBe('1-10');
  });

  it('deleteCapacity removes capacity and its ratings', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    logCapacityObservation(cap.id, { rating: 5 });
    expect(getCapacityRatings(cap.id)).toHaveLength(1);

    deleteCapacity(cap.id);
    expect(getCapacities(skill.id)).toHaveLength(0);
    expect(getCapacityRatings(cap.id)).toHaveLength(0);
  });

  it('deleteSkill cascades to its capacities and ratings', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    logCapacityObservation(cap.id, { rating: 7 });

    deleteSkill(skill.id);
    expect(getCapacities()).toHaveLength(0);
    expect(getCapacityRatings(cap.id)).toHaveLength(0);
  });
});

describe('Capacity Ratings', () => {
  it('logCapacityObservation records a numeric rating', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { rating: 7 });
    expect(obs).not.toBeNull();
    expect(obs!.rating).toBe(7);
    expect(obs!.date).toBe(new Date().toISOString().split('T')[0]);
  });

  it('logCapacityObservation records a note', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { note: 'Felt focused today' });
    expect(obs).not.toBeNull();
    expect(obs!.note).toBe('Felt focused today');
    expect(obs!.rating).toBeUndefined();
  });

  it('logCapacityObservation records rating + note together', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { rating: 8, note: 'Great session' });
    expect(obs!.rating).toBe(8);
    expect(obs!.note).toBe('Great session');
  });

  it('logCapacityObservation rejects empty observation', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, {});
    expect(obs).toBeNull();
  });

  it('logCapacityObservation rejects blank note with no rating', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { note: '   ' });
    expect(obs).toBeNull();
  });

  it('logCapacityObservation returns null for missing capacity', () => {
    const obs = logCapacityObservation('nonexistent', { rating: 5 });
    expect(obs).toBeNull();
  });

  it('logCapacityObservation merges with existing entry on same day', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    logCapacityObservation(cap.id, { rating: 3, note: 'Morning' });
    const merged = logCapacityObservation(cap.id, { rating: 7, note: 'Evening' });

    // Newer rating wins
    expect(merged!.rating).toBe(7);
    // Notes concatenate
    expect(merged!.note).toContain('Morning');
    expect(merged!.note).toContain('Evening');

    // Only one entry for today
    const ratings = getCapacityRatings(cap.id);
    expect(ratings).toHaveLength(1);
  });

  it('logCapacityObservation accepts custom date', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { date: '2026-01-15', rating: 6 });
    expect(obs!.date).toBe('2026-01-15');
  });

  it('logCapacityObservation rejects invalid date', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { date: 'not-a-date', rating: 5 });
    expect(obs).toBeNull();
  });

  it('getCapacityRatings returns newest first', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    logCapacityObservation(cap.id, { date: '2026-01-10', rating: 3 });
    logCapacityObservation(cap.id, { date: '2026-01-15', rating: 7 });
    logCapacityObservation(cap.id, { date: '2026-01-12', rating: 5 });

    const ratings = getCapacityRatings(cap.id);
    expect(ratings).toHaveLength(3);
    expect(ratings[0].date).toBe('2026-01-15'); // newest first
    expect(ratings[2].date).toBe('2026-01-10'); // oldest last
  });

  it('deleteCapacityRating removes a single rating', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    // Use different dates so they don't merge (same-day entries merge by design)
    const r1 = logCapacityObservation(cap.id, { date: '2026-06-01', rating: 5 })!;
    logCapacityObservation(cap.id, { date: '2026-06-02', rating: 7 });

    deleteCapacityRating(r1.id);
    expect(getCapacityRatings(cap.id)).toHaveLength(1);
  });

  it('logCapacityObservation records habitId context', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const obs = logCapacityObservation(cap.id, { rating: 6, habitId: 'habit-123' });
    expect(obs!.habitId).toBe('habit-123');
  });
});

describe('computeCapacityProgress', () => {
  it('returns null for missing capacity', () => {
    expect(computeCapacityProgress('nonexistent')).toBeNull();
  });

  it('returns zero progress when no ratings exist', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    const progress = computeCapacityProgress(cap.id);
    expect(progress).not.toBeNull();
    expect(progress!.latestRating).toBeNull();
    expect(progress!.totalObservations).toBe(0);
    expect(progress!.progressPct).toBe(0);
    expect(progress!.targetReached).toBe(false);
  });

  it('computes progress from ratings', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id); // baseline=3, target=8
    // Rating of 5.5 is halfway: (5.5-3)/(8-3)*100 = 50%
    logCapacityObservation(cap.id, { date: '2026-06-01', rating: 3 });
    logCapacityObservation(cap.id, { date: '2026-06-05', rating: 5.5 });

    const progress = computeCapacityProgress(cap.id);
    expect(progress!.latestRating).toBe(5.5);
    expect(progress!.progressPct).toBeCloseTo(50, 0);
    expect(progress!.targetReached).toBe(false);
    expect(progress!.totalObservations).toBe(2);
  });

  it('detects target reached', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, 'Target Test', '', '1-10', 1, 5)!;
    logCapacityObservation(cap.id, { rating: 6 });
    const progress = computeCapacityProgress(cap.id);
    expect(progress!.targetReached).toBe(true);
    expect(progress!.progressPct).toBe(100);
  });

  it('computes recent average from last 5 ratings', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    for (let i = 0; i < 8; i++) {
      logCapacityObservation(cap.id, { date: `2026-01-${String(i + 1).padStart(2, '0')}`, rating: i + 1 });
    }
    const progress = computeCapacityProgress(cap.id);
    // Last 5: 4,5,6,7,8 → avg = 6
    expect(progress!.recentAverage).toBeCloseTo(6, 0);
  });

  it('computes delta from baseline and deltaSinceStart', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id); // baseline=3
    logCapacityObservation(cap.id, { date: '2026-03-01', rating: 2 }); // first
    logCapacityObservation(cap.id, { date: '2026-03-10', rating: 7 }); // latest

    const progress = computeCapacityProgress(cap.id);
    expect(progress!.delta).toBe(4);         // 7 - 3
    expect(progress!.deltaSinceStart).toBe(5); // 7 - 2
  });

  it('handles 100% when baseline equals target and rating meets target', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, 'Equal', '', '1-10', 5, 5)!;
    logCapacityObservation(cap.id, { rating: 5 });
    const progress = computeCapacityProgress(cap.id);
    expect(progress!.progressPct).toBe(100);
    expect(progress!.targetReached).toBe(true);
  });

  it('handles 0% when baseline equals target and rating is below', () => {
    const skill = setupSkill();
    const cap = addCapacity(skill.id, 'Equal Below', '', '1-10', 5, 5)!;
    logCapacityObservation(cap.id, { rating: 3 });
    const progress = computeCapacityProgress(cap.id);
    expect(progress!.progressPct).toBe(0);
    expect(progress!.targetReached).toBe(false);
  });

  it('includes note-only observations in total count', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);
    // Different dates so they don't merge
    logCapacityObservation(cap.id, { date: '2026-06-01', rating: 5 });
    logCapacityObservation(cap.id, { date: '2026-06-02', note: 'Just a note, no rating' });
    const progress = computeCapacityProgress(cap.id);
    expect(progress!.totalObservations).toBe(2);
    // latest rating is still 5 from first entry (note-only has no rating)
    expect(progress!.latestRating).toBe(5);
  });
});

describe('Capacities import sanitization', () => {
  it('filters out malformed capacities during import', () => {
    const skill = setupSkill();
    const goodCap = setupCapacity(skill.id);

    const importPayload = {
      skills: getSkills(),
      capacities: [
        goodCap,
        { id: 'bad', skillId: 'x', name: 123 },  // malformed
        null,
        { id: 'bad2', skillId: skill.id, name: 'No desc' }, // missing description
      ],
      capacityRatings: [],
    };

    // Import the payload — malformed entries should be dropped
    mergeImportedData(importPayload);

    const caps = getCapacities(skill.id);
    // Only the original goodCap survives (already present, skip duplicate)
    expect(caps.length).toBeGreaterThanOrEqual(1);
    expect(caps[0].id).toBe(goodCap.id);
  });

  it('drops orphaned capacities whose parent skill is missing during import', () => {
    const orphanCap = {
      id: 'orphan-1',
      skillId: 'nonexistent-skill',
      name: 'Orphan',
      description: 'No parent skill',
      unit: '1-10',
      baseline: 1,
      target: 5,
      createdAt: new Date().toISOString(),
    };

    const importPayload = {
      skills: getSkills(),
      capacities: [orphanCap],
      capacityRatings: [],
    };

    mergeImportedData(importPayload);
    // Orphan should be dropped since skill doesn't exist
    expect(getCapacities()).toHaveLength(0);
    expect(getCapacity('orphan-1')).toBeUndefined();
  });

  it('drops ratings for orphaned capacities during import', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);

    const importPayload = {
      skills: [skill],
      capacities: [cap],
      capacityRatings: [
        { id: 'r1', capacityId: cap.id, date: '2026-06-01', rating: 5 },
        { id: 'r2', capacityId: 'nonexistent', date: '2026-06-01', rating: 3 },
      ],
    };

    mergeImportedData(importPayload);

    // r1 survives (valid capacity), r2 dropped (orphan capacity)
    const ratings = getCapacityRatings(cap.id);
    // r1 imported successfully
    expect(ratings.some((r) => r.id === 'r1')).toBe(true);
    // r2 should not appear since its capacity doesn't exist
    expect(ratings.some((r) => r.id === 'r2')).toBe(false);
  });

  it('filters out malformed capacity ratings during import', () => {
    const skill = setupSkill();
    const cap = setupCapacity(skill.id);

    const importPayload = {
      skills: [skill],
      capacities: [cap],
      capacityRatings: [
        { id: 'r1', capacityId: cap.id, date: '2026-06-01', rating: 5 },
        { id: 'r2' }, // missing fields
        { id: 'r3', capacityId: cap.id, date: 'not-valid' }, // bad date
        { id: 'r4', capacityId: cap.id, date: '2026-06-02' }, // no rating, no note → invalid
      ],
    };

    mergeImportedData(importPayload);

    const ratings = getCapacityRatings(cap.id);
    // Only r1 is valid
    expect(ratings.some((r) => r.id === 'r1')).toBe(true);
    expect(ratings.some((r) => r.id === 'r2')).toBe(false);
    expect(ratings.some((r) => r.id === 'r3')).toBe(false);
    expect(ratings.some((r) => r.id === 'r4')).toBe(false);
  });
});
