// CapacitiesSummary — shows life-aspect ratings derived from habit performance.
// For each Skill, computes a score (0-100%) from its linked habits' completion rates.
// Provides a Niko-Niko-style view: "Athleticism: 8.5%" / "Mindfulness: 25%".
import React from 'react';
import type { Habit, CheckIn, AppData, CapacityRating } from '../types';

interface CapacitiesSummaryProps {
  habits: Habit[];
  allCheckIns: CheckIn[];
}

interface AspectRow {
  id: string;
  name: string;
  emoji: string;
  color: string;
  score: number; // 0-100
  source: 'habit_links' | 'goal_completion';
  detail: string;
}

const ASPECT_EMOJI: Record<string, { emoji: string; color: string }> = {
  'default-mindfulness': { emoji: '🧠', color: '#EDE9FE' },
  'default-fitness': { emoji: '💪', color: '#D1FAE5' },
  'default-focus': { emoji: '⚡', color: '#DBEAFE' },
  'default-learning': { emoji: '📚', color: '#FEF3C7' },
  'default-resilience': { emoji: '🌱', color: '#FCE7F3' },
};

/**
 * Computes a 0-100 score for each Skill based on linked habit completion.
 * Score = avg completion rate (30d) across linked habits, weighted by XP.
 */
function computeAspectScores(
  data: AppData,
  allCheckIns: CheckIn[],
): AspectRow[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const habitById = new Map<string, Habit>();
  for (const h of data.habits) habitById.set(h.id, h);

  const rows: AspectRow[] = [];

  // From Skills → linked habits
  for (const skill of data.skills) {
    if (!skill.links || skill.links.length === 0) {
      // Skill with no links: score 0
      const preset = ASPECT_EMOJI[skill.id] ?? { emoji: skill.emoji ?? '📊', color: skill.color ?? '#E5E7EB' };
      rows.push({
        id: skill.id,
        name: skill.name,
        emoji: preset.emoji,
        color: preset.color,
        score: 0,
        source: 'habit_links',
        detail: 'No habits linked yet',
      });
      continue;
    }
    let totalWeightedScore = 0;
    let totalWeight = 0;
    for (const link of skill.links) {
      const habit = habitById.get(link.habitId);
      if (!habit || habit.archived) continue;
      // 30-day completion rate for this habit
      const checks = allCheckIns.filter(
        (ci) => ci.habitId === link.habitId && ci.date >= cutoffStr && ci.completed,
      );
      // Count unique days
      const days = new Set(checks.map((c) => c.date)).size;
      const rate = days / 30;
      const weight = link.xpPerCompletion || 1;
      totalWeightedScore += rate * weight;
      totalWeight += weight;
    }
    const avg = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    const preset = ASPECT_EMOJI[skill.id] ?? { emoji: skill.emoji ?? '📊', color: skill.color ?? '#E5E7EB' };
    rows.push({
      id: skill.id,
      name: skill.name,
      emoji: preset.emoji,
      color: preset.color,
      score: Math.round(avg * 100),
      source: 'habit_links',
      detail: `${skill.links.length} habit${skill.links.length > 1 ? 's' : ''} linked · last 30 days`,
    });
  }

  return rows;
}

/**
 * Computes aspect scores from goal completions (alternative view).
 * For each capacity with explicit ratings, shows the latest score.
 */
function computeGoalScores(
  data: AppData,
): AspectRow[] {
  const ratings = data.capacityRatings ?? [];
  const ratingsByCapacity = new Map<string, CapacityRating[]>();
  for (const r of ratings) {
    let arr = ratingsByCapacity.get(r.capacityId);
    if (!arr) {
      arr = [];
      ratingsByCapacity.set(r.capacityId, arr);
    }
    arr.push(r);
  }
  const rows: AspectRow[] = [];
  for (const capacity of (data.capacities ?? [])) {
    const capRatings = ratingsByCapacity.get(capacity.id) ?? [];
    if (capRatings.length === 0) {
      rows.push({
        id: capacity.id,
        name: capacity.name,
        emoji: '📈',
        color: '#E5E7EB',
        score: 0,
        source: 'goal_completion',
        detail: 'No ratings yet',
      });
      continue;
    }
    // Average of last 5 ratings
    const recent = [...capRatings]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    const avg = recent.reduce((sum, r) => sum + (r.rating ?? 0), 0) / recent.length;
    rows.push({
      id: capacity.id,
      name: capacity.name,
      emoji: '📈',
      color: '#E5E7EB',
      score: Math.round(avg * 10), // rating is 0-10 → 0-100
      source: 'goal_completion',
      detail: `Last ${recent.length} rating${recent.length > 1 ? 's' : ''} · max 10`,
    });
  }
  return rows;
}

export function CapacitiesSummary({ habits, allCheckIns }: CapacitiesSummaryProps) {
  const [skillRows, setSkillRows] = React.useState<AspectRow[]>([]);
  const [goalRows, setGoalRows] = React.useState<AspectRow[]>([]);

  React.useEffect(() => {
    // Load full data (capacities + skills + ratings) on mount + when habits change
    import('../store').then((store) => {
      const fullData = store.exportAllData();
      setSkillRows(computeAspectScores(fullData, allCheckIns));
      setGoalRows(computeGoalScores(fullData));
    });
  }, [allCheckIns, habits]);

  const allRows = [...skillRows, ...goalRows];
  if (allRows.length === 0) {
    return null;
  }

  return (
    <div className="capacities-summary">
      <h3 className="capacities-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        Life Aspects
      </h3>
      <p className="capacities-subtitle">
        How each area of your life is performing. Derived from habit completion (30-day window).
      </p>
      <div className="capacities-grid">
        {allRows.map((row) => (
          <div
            key={row.id}
            className="aspect-card"
            style={{ borderLeftColor: row.color }}
            title={row.detail}
          >
            <div className="aspect-header">
              <span className="aspect-emoji">{row.emoji}</span>
              <span className="aspect-name">{row.name}</span>
            </div>
            <div className="aspect-score-row">
              <span className="aspect-score-value">{row.score}%</span>
              <div className="aspect-bar">
                <div
                  className="aspect-bar-fill"
                  style={{
                    width: `${Math.min(100, row.score)}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
            </div>
            <div className="aspect-detail">{row.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}