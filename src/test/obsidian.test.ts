import { describe, expect, it } from 'vitest';
import {
  analyzeNote,
  analyzeNotes,
  extractObsidianLinks,
  extractObsidianThemes,
  getThemeById,
  matchMentions,
} from '../obsidian';
import type { Habit } from '../types';

const habits: Habit[] = [
  { id: 'h1', name: 'Gym', category: 'sport', color: '#ef4444', icon: '🏋️', defaultStrength: 3 },
  { id: 'h2', name: 'Méditation', category: 'mental', color: '#3b82f6', icon: '🧘', defaultStrength: 3 },
] as unknown as Habit[];

describe('obsidian.extractObsidianThemes', () => {
  it('detects themes from keyword lexicon', () => {
    const hits = extractObsidianThemes('Journée stressante, grosse fatigue. Mais j’ai réussi mon examen, fier de moi.');
    const ids = hits.map((h) => h.themeId);
    expect(ids).toContain('stress');
    expect(ids).toContain('fatigue');
    expect(ids).toContain('victory');
    const victory = hits.find((h) => h.themeId === 'victory');
    expect(victory?.count).toBeGreaterThanOrEqual(2); // réussi + fier
  });

  it('is case and accent tolerant', () => {
    const hits = extractObsidianThemes('ÉPUISÉ et débordé');
    expect(hits.map((h) => h.themeId).sort()).toEqual(['fatigue', 'stress']);
  });

  it('returns empty when no keywords match', () => {
    expect(extractObsidianThemes('Note de test banale')).toEqual([]);
  });

  it('sorts hits by descending count', () => {
    const hits = extractObsidianThemes('fatigue fatigue fatigue stress');
    expect(hits[0].themeId).toBe('fatigue');
  });

  it('adds short examples from the note text', () => {
    const hits = extractObsidianThemes('Grosse fatigue aujourd’hui vraiment');
    expect(hits[0].examples.length).toBeGreaterThan(0);
    expect(hits[0].examples[0].toLowerCase()).toContain('fatigue');
  });
});

describe('obsidian.extractObsidianLinks', () => {
  it('extracts simple wikilinks', () => {
    expect(extractObsidianLinks('Aujourd’hui [[Gym]] était dur, et [[Méditation]] m’a aidé.')).toEqual(['Gym', 'Méditation']);
  });

  it('handles links with alias', () => {
    expect(extractObsidianLinks('Voir [[Gym|séance du matin]]')).toEqual(['Gym']);
  });

  it('ignores broken links and dedupes nothing (raw output)', () => {
    expect(extractObsidianLinks('no link here [[]]')).toEqual([]);
  });
});

describe('obsidian.matchMentions', () => {
  it('matches links to habits by name, case and accent insensitive', () => {
    const mentions = matchMentions(['Gym', 'gym', 'Méditation', 'MEDITATION'], habits);
    expect(mentions.length).toBe(2);
    const gym = mentions.find((m) => m.habitId === 'h1');
    expect(gym?.count).toBe(2);
  });

  it('ignores links that match no habit', () => {
    const mentions = matchMentions(['Frise inconnue', 'Gym'], habits);
    expect(mentions.map((m) => m.habitName)).toEqual(['Gym']);
  });
});

describe('obsidian.analyzeNote', () => {
  it('combines themes and mentions into one analysis', () => {
    const note = analyzeNote('2026-08-14.md', 'Épuisé, mais [[Gym]] réussi !', habits);
    expect(note.sentiment).toBe(0); // -1 fatigue + 1 victory
    expect(note.mentions[0].habitId).toBe('h1');
    expect(note.themes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('obsidian.analyzeNotes', () => {
  it('aggregates theme and mention totals across notes', () => {
    const res = analyzeNotes(
      [
        { fileName: 'a.md', content: 'fatigue stress' },
        { fileName: 'b.md', content: 'fatigue, mais fier de mon focus. [[Gym]] OK.' },
      ],
      habits,
    );
    expect(res.notes.length).toBe(2);
    const fatigue = res.themeTotals.find((t) => t.themeId === 'fatigue');
    expect(fatigue?.count).toBe(2);
    const gym = res.mentionTotals.find((m) => m.habitId === 'h1');
    expect(gym?.count).toBe(1);
    expect(res.hardestNotes).toEqual(['a.md']);
  });

  it('computes overall sentiment and picks hardest notes', () => {
    const res = analyzeNotes(
      [
        { fileName: 'bad.md', content: 'fatigue stress douleur frustration énervé' },
        { fileName: 'good.md', content: 'réussi fier heureux gratitude' },
        { fileName: 'mid.md', content: 'routine' },
      ],
      habits,
    );
    expect(res.sentiment).toBeLessThan(0);
    expect(res.hardestNotes[0]).toBe('bad.md');
  });

  it('returns empty aggregates for no notes', () => {
    const res = analyzeNotes([], habits);
    expect(res.themeTotals).toEqual([]);
    expect(res.mentionTotals).toEqual([]);
    expect(res.notes).toEqual([]);
  });
});

describe('obsidian.getThemeById', () => {
  it('returns the theme or undefined', () => {
    expect(getThemeById('stress')?.label).toBe('Stress');
    expect(getThemeById('nope')).toBeUndefined();
  });
});
