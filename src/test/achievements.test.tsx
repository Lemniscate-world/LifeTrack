// Achievements: notes tagged with a category, grouped in a timeline.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  resetStore, addNote, getNotes, getAchievements,
  getDefaultAchievementCategories, getAchievementCategories,
  getAchievementCategoryById, mergeAchievementCategories,
  tagNoteAchievement, exportAllData, mergeImportedData,
} from '../store';
import AchievementsView from '../AchievementsView';

beforeEach(() => { localStorage.clear(); resetStore(); });

describe('Achievement categories', () => {
  it('defaults to 8 categories (7 chaos dims + Psychological)', () => {
    const cats = getDefaultAchievementCategories();
    expect(cats).toHaveLength(8);
    const ids = cats.map((c) => c.id);
    expect(ids).toContain('energy');
    expect(ids).toContain('psychological');
    expect(ids).toContain('emotional');
  });

  it('getAchievementCategories self-heals missing defaults', () => {
    const stored = getDefaultAchievementCategories().filter((c) => c.id !== 'psychological');
    // Simulate persisted data missing a newer category by injecting it directly.
    // Use mergeAchievementCategories as the unit under test.
    const merged = mergeAchievementCategories(stored);
    expect(merged).toHaveLength(8);
    expect(merged.map((c) => c.id)).toContain('psychological');
  });

  it('getAchievementCategoryById finds a category', () => {
    const cat = getAchievementCategoryById('energy');
    expect(cat?.name).toBe('Energy');
    expect(getAchievementCategoryById('nonexistent')).toBeUndefined();
  });
});

describe('Tagging notes as achievements', () => {
  it('addNote with a category tags the note as an achievement', () => {
    const note = addNote('Ran 10km!', 'energy');
    expect(note.achievementCategory).toBe('energy');
    expect(getAchievements().map((n) => n.id)).toContain(note.id);
  });

  it('addNote without a category is not an achievement', () => {
    addNote('Just a thought');
    expect(getAchievements()).toHaveLength(0);
  });

  it('tagNoteAchievement tags and untags an existing note', () => {
    const note = addNote('Big win at work');
    const tagged = tagNoteAchievement(note.id, 'psychological');
    expect(tagged?.achievementCategory).toBe('psychological');
    expect(getAchievements()).toHaveLength(1);

    tagNoteAchievement(note.id, null);
    expect(getAchievements()).toHaveLength(0);
    const cleared = getNotes().find((n) => n.id === note.id);
    expect(cleared?.achievementCategory).toBeUndefined();
  });

  it('tagNoteAchievement returns null for a missing note', () => {
    expect(tagNoteAchievement('nope', 'energy')).toBeNull();
  });

  it('getAchievements returns only tagged notes, newest first', async () => {
    addNote('Older achievement', 'physical');
    await new Promise((r) => setTimeout(r, 5));
    const newer = addNote('Newer achievement', 'energy');
    const ach = getAchievements();
    expect(ach).toHaveLength(2);
    expect(ach[0].id).toBe(newer.id);
  });
});

describe('AchievementsView UI', () => {
  it('renders the empty state', () => {
    render(<AchievementsView />);
    expect(screen.getByText('🏆 Achievements')).toBeInTheDocument();
    expect(screen.getByText(/No achievements yet — tag a note/)).toBeInTheDocument();
  });

  it('shows achievement categories with their counts', () => {
    addNote('Ran 10km!', 'energy');
    render(<AchievementsView />);
    expect(screen.getByText('1 achievement across 1 category')).toBeInTheDocument();
    expect(screen.getByText('Energy')).toBeInTheDocument();
    expect(screen.getByText('Ran 10km!')).toBeInTheDocument();
  });
});

describe('Achievement persistence', () => {
  it('exportAllData includes achievementCategories and note tags', () => {
    getAchievementCategories(); // materialize defaults (UI does this on render)
    addNote('Won the day', 'emotional');
    const data = exportAllData();
    expect(data.achievementCategories).toHaveLength(8);
    expect(data.notes[0].achievementCategory).toBe('emotional');
  });

  it('mergeImportedData preserves note tags and merges categories', () => {
    addNote('Local note', 'energy');
    const payload = {
      habits: [],
      checkIns: [],
      notes: [{ id: 'n1', habitId: '', content: 'Imported achievement', createdAt: '2026-01-05T00:00:00.000Z', achievementCategory: 'psychological' }],
      chaosDimensions: [],
      achievementCategories: [{ id: 'psychological', name: 'Psychological', emoji: '🧠', color: '#EDE9FE' }],
      mantras: [],
      mantraSettings: {},
      skills: [],
      capacities: [],
      capacityRatings: [],
      moods: {},
      experiments: [],
      urges: [],
      customUrgeTypes: [],
      preferences: {},
    };
    const result = mergeImportedData(payload);
    expect(result.notesCreated).toBe(1);
    const imported = getNotes().find((n) => n.content === 'Imported achievement');
    expect(imported?.achievementCategory).toBe('psychological');
    expect(getAchievementCategories().map((c) => c.id)).toContain('psychological');
    expect(getAchievements().some((n) => n.content === 'Imported achievement')).toBe(true);
  });
});
