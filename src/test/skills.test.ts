import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetStore,
  getSkills,
  addSkill,
  updateSkill,
  deleteSkill,
  addHabit,
  toggleCheckIn,
  incrementCheckInCount,
  computeSkillProgress,
  getLevelFromXp,
  getXpRequiredForLevel,
} from '../store';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('Skills Level Progression Math', () => {
  it('computes correct level from XP', () => {
    expect(getLevelFromXp(0)).toBe(1);
    expect(getLevelFromXp(50)).toBe(1);
    expect(getLevelFromXp(99)).toBe(1);
    expect(getLevelFromXp(100)).toBe(2);
    expect(getLevelFromXp(299)).toBe(2);
    expect(getLevelFromXp(300)).toBe(3);
    expect(getLevelFromXp(599)).toBe(3);
    expect(getLevelFromXp(600)).toBe(4);
    expect(getLevelFromXp(999)).toBe(4);
    expect(getLevelFromXp(1000)).toBe(5);
  });

  it('computes correct XP required for a given level', () => {
    expect(getXpRequiredForLevel(1)).toBe(0);
    expect(getXpRequiredForLevel(2)).toBe(100);
    expect(getXpRequiredForLevel(3)).toBe(300);
    expect(getXpRequiredForLevel(4)).toBe(600);
    expect(getXpRequiredForLevel(5)).toBe(1000);
  });
});

describe('Skills CRUD', () => {
  it('initializes with default skills', () => {
    const skills = getSkills();
    expect(skills.length).toBe(5);
    expect(skills.map(s => s.name)).toContain('Mindfulness');
    expect(skills.map(s => s.name)).toContain('Physical Fitness');
  });

  it('can add a custom skill', () => {
    const initialCount = getSkills().length;
    const added = addSkill('Test Skill', 'Description', '🎓', '#FF0000', []);
    expect(added.id).toBeDefined();
    expect(added.name).toBe('Test Skill');
    expect(getSkills().length).toBe(initialCount + 1);
  });

  it('can update a skill', () => {
    const added = addSkill('Update Me', 'Old Description', '🎓', '#FF0000', []);
    updateSkill(added.id, { name: 'Updated Name', description: 'New Description' });
    const skills = getSkills();
    const found = skills.find(s => s.id === added.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Updated Name');
    expect(found!.description).toBe('New Description');
  });

  it('can delete a skill', () => {
    const added = addSkill('Delete Me', 'Description', '🎓', '#FF0000', []);
    const countBefore = getSkills().length;
    deleteSkill(added.id);
    expect(getSkills().length).toBe(countBefore - 1);
    expect(getSkills().find(s => s.id === added.id)).toBeUndefined();
  });
});

describe('computeSkillProgress', () => {
  it('returns undefined for nonexistent skill', () => {
    expect(computeSkillProgress('nonexistent')).toBeUndefined();
  });

  it('calculates 0 XP and level 1 for a skill with no links or check-ins', () => {
    const skill = addSkill('Test Skill', 'Desc', '🎓', '#FF0000', []);
    const progress = computeSkillProgress(skill.id);
    expect(progress).toBeDefined();
    expect(progress!.totalXp).toBe(0);
    expect(progress!.level).toBe(1);
    expect(progress!.progressPct).toBe(0);
    expect(progress!.contributions.length).toBe(0);
  });

  it('calculates correct XP and level based on linked habit check-ins', () => {
    // 1. Add habit
    const habit = addHabit('Meditate');
    
    // 2. Add skill linked to habit with 15 XP weight
    const skill = addSkill('Mindfulness', 'Desc', '🧠', '#FF0000', [
      { habitId: habit.id, xpPerCompletion: 15 }
    ]);

    // 3. Complete check-in for today
    const dateToday = new Date().toISOString().split('T')[0];
    toggleCheckIn(habit.id, dateToday);

    // 4. Compute progress
    const progress = computeSkillProgress(skill.id);
    expect(progress).toBeDefined();
    expect(progress!.totalXp).toBe(15);
    expect(progress!.level).toBe(1);
    
    // Level 2 needs 100 XP, so progress should be 15%
    expect(progress!.progressPct).toBe(15);
    expect(progress!.contributions[0].completions).toBe(1);
    expect(progress!.contributions[0].xpContributed).toBe(15);
  });

  it('handles multi-count completions correctly', () => {
    const habit = addHabit('Gym');
    const skill = addSkill('Strength', 'Desc', '💪', '#FF0000', [
      { habitId: habit.id, xpPerCompletion: 20 }
    ]);
    const dateToday = new Date().toISOString().split('T')[0];
    
    // Set completion count to 3
    incrementCheckInCount(habit.id, dateToday);
    incrementCheckInCount(habit.id, dateToday);
    incrementCheckInCount(habit.id, dateToday);

    const progress = computeSkillProgress(skill.id);
    expect(progress!.totalXp).toBe(60); // 3 * 20
    expect(progress!.contributions[0].completions).toBe(3);
    expect(progress!.contributions[0].xpContributed).toBe(60);
  });

  it('grows level correctly as check-ins accumulate', () => {
    const habit = addHabit('Running');
    const skill = addSkill('Fitness', 'Desc', '🏃', '#FF0000', [
      { habitId: habit.id, xpPerCompletion: 50 }
    ]);
    
    // Accumulate check-ins over different days
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      toggleCheckIn(habit.id, dateStr);
    }

    const progress = computeSkillProgress(skill.id);
    // 7 check-ins * 50 XP = 350 XP
    // Level 1: 0-99
    // Level 2: 100-299
    // Level 3: 300-599
    // So 350 XP should be level 3
    expect(progress!.totalXp).toBe(350);
    expect(progress!.level).toBe(3);
    // Level 3 min is 300, next level 4 is 600.
    // Progress: (350 - 300) / (600 - 300) = 50 / 300 = 16.67%
    expect(Math.round(progress!.progressPct)).toBe(17);
  });
});
