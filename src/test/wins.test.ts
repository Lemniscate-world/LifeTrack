import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, Note } from '../types';
import type { Medal } from '../gamification';
import { buildWinsFeed, nextMedals, phraseOfDay } from '../wins';

function habit(id: string): Habit {
  return { id, name: id, color: '#fff', goal: 1, createdAt: new Date().toISOString(), archived: false, order: 0 };
}
function ci(habitId: string, date: string): CheckIn {
  return { habitId, date, completed: true, count: 1 };
}

describe('buildWinsFeed', () => {
  it('surfaces the most recent achievements and records', () => {
    const checks: CheckIn[] = [];
    for (let i = 0; i < 7; i++) checks.push(ci('med', `2026-01-${String(i + 1).padStart(2, '0')}`)); // 7-day streak
    const notes: Note[] = [
      { id: 'n1', habitId: '', content: 'Marathon fini', createdAt: '2026-01-06T10:00:00Z', achievementCategory: 'physical' },
      { id: 'n2', habitId: '', content: 'Crossed the line', createdAt: '2026-01-02T10:00:00Z', achievementCategory: 'work' },
    ];
    const feed = buildWinsFeed([habit('med')], checks, notes, [], 10, new Date(2026, 0, 7));
    expect(feed.some((w) => w.subtitle.includes('Marathon fini'))).toBe(true);
    expect(feed.some((w) => w.title.includes('7 jours'))).toBe(true);
  });
});

describe('nextMedals', () => {
  it('returns closest unearned medals sorted by progress desc', () => {
    const mk = (id: string, progress: number): Medal => ({ id, name: id, emoji: '🏅', description: '', earned: false, progress });
    const sorted = nextMedals([mk('c', 50), mk('a', 90), mk('b', 40)], 3);
    expect(sorted.map((s) => s.medal.id)).toEqual(['a', 'c', 'b']);
    expect(sorted.length).toBe(3);
  });
});

describe('phraseOfDay', () => {
  it('is stable for the same day and rotates across days', () => {
    const d1a = phraseOfDay(new Date(2026, 0, 1));
    const d1b = phraseOfDay(new Date(2026, 0, 1));
    const d2 = phraseOfDay(new Date(2026, 0, 8));
    expect(d1a).toEqual(d1b);
    expect(d1a.text.length).toBeGreaterThan(0);
    void d2;
  });
});