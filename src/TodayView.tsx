import { useMemo } from 'react';
import type { Habit, CheckIn, Mantra } from './types';
import { computeStreakStats, computeCompletionRate } from './stats';
import { MANTRA_DOMAINS } from './mantras';
import { generateInsights } from './recommendations';

const MILESTONES = new Set([7, 14, 21, 30, 60, 90, 100, 180, 365]);

const TIPS = [
  'Small daily wins compound into massive results. Keep showing up.',
  'The best habit system is the one you actually use. Consistency > perfection.',
  'Missed a day? That\'s a data point, not a failure. Learn and continue.',
  'Habits are not about willpower — they\'re about environment design.',
];

interface TodayViewProps {
  habits: Habit[];
  checkIns: CheckIn[];
  todayMantra: Mantra | null;
}

export default function TodayView({ habits, checkIns, todayMantra }: TodayViewProps) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const todayStats = useMemo(() => {
    const active = habits.filter(h => !h.archived);
    const todayDone = checkIns.filter(ci => ci.date === todayStr && ci.completed);
    const todayTotal = checkIns.filter(ci => ci.date === todayStr);
    const donePct = todayTotal.length > 0 ? Math.round((todayDone.length / todayTotal.length) * 100) : 0;

    const streaks = active.map(h => ({
      habit: h,
      stats: computeStreakStats(h, checkIns, now),
      rate7: computeCompletionRate(h, checkIns, 7, now),
      doneToday: checkIns.some(ci => ci.habitId === h.id && ci.date === todayStr && ci.completed),
    })).sort((a, b) => b.stats.current - a.stats.current);

    return { active, todayDone, todayTotal, donePct, streaks };
  }, [habits, checkIns, todayStr]);

  const topStreaks = todayStats.streaks.filter(s => s.stats.current >= 3).slice(0, 3);
  const needsAttention = todayStats.streaks.filter(s => !s.doneToday && s.stats.current === 0).slice(0, 3);

  // Monthly focus habit
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const focusHabit = habits.find(h => h.focusMonth === thisMonth);
  const focusStats = focusHabit ? todayStats.streaks.find(s => s.habit.id === focusHabit.id) : null;

  const mantraDomain = todayMantra ? MANTRA_DOMAINS.find(d => d.id === todayMantra.domain) : null;

  return (
    <div className="today-view">
      {/* Mantra Banner */}
      {todayMantra && mantraDomain && (
        <div className="today-mantra" style={{ borderLeftColor: mantraDomain.color }}>
          <span className="today-mantra-domain">{mantraDomain.icon} {mantraDomain.name}</span>
          <blockquote>"{todayMantra.text}"</blockquote>
        </div>
      )}

      {/* Stats Row */}
      <div className="today-stats-row">
        <div className="today-stat">
          <span className="today-stat-value">{todayStats.donePct}%</span>
          <span className="today-stat-label">Today</span>
        </div>
        <div className="today-stat">
          <span className="today-stat-value">{todayStats.active.length}</span>
          <span className="today-stat-label">Habits</span>
        </div>
        <div className="today-stat">
          <span className="today-stat-value">{todayStats.todayDone.length}/{todayStats.todayTotal.length}</span>
          <span className="today-stat-label">Done</span>
        </div>
      </div>

      {/* Monthly Focus */}
      {focusHabit && focusStats && (
        <div className="today-focus-card" style={{ borderLeftColor: focusHabit.color }}>
          <div className="today-focus-header">
            <span className="today-focus-icon">🎯</span>
            <span className="today-focus-title">Focus of the month: {focusHabit.name}</span>
          </div>
          <div className="today-focus-stats">
            <div className="today-focus-stat">
              <span className="today-focus-value">{focusStats.stats.current}d</span>
              <span className="today-focus-label">streak</span>
            </div>
            <div className="today-focus-stat">
              <span className="today-focus-value">{focusStats.rate7}%</span>
              <span className="today-focus-label">this week</span>
            </div>
            <div className="today-focus-stat">
              <span className="today-focus-value">{focusStats.stats.totalCompleted}</span>
              <span className="today-focus-label">total</span>
            </div>
            <div className="today-focus-stat">
              <span className={`today-focus-value ${focusStats.doneToday ? 'done' : ''}`}>{focusStats.doneToday ? '✅' : '⏳'}</span>
              <span className="today-focus-label">today</span>
            </div>
          </div>
        </div>
      )}

      {/* Top Streaks */}
      {topStreaks.length > 0 && (
        <div className="today-section">
          <h3>🔥 Active Streaks</h3>
          <div className="today-streaks">
            {topStreaks.map(s => (
              <div key={s.habit.id} className={`today-streak-card${MILESTONES.has(s.stats.current) ? ' milestone' : ''}`} style={{ borderLeftColor: s.habit.color }}>
                <span className="today-streak-name">{s.habit.name}</span>
                <span className="today-streak-count">{s.stats.current}d</span>
                <span className="today-streak-rate">{s.rate7}% this week</span>
                {MILESTONES.has(s.stats.current) && <span className="milestone-badge">🎯</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs Attention */}
      {needsAttention.length > 0 && (
        <div className="today-section">
          <h3>⏰ Needs Attention</h3>
          <div className="today-streaks">
            {needsAttention.map(s => (
              <div key={s.habit.id} className="today-streak-card today-needs" style={{ borderLeftColor: s.habit.color }}>
                <span className="today-streak-name">{s.habit.name}</span>
                <span className="today-streak-count">—</span>
                <span className="today-streak-rate">Not checked today</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Tip */}
      {(() => {
        const insights = generateInsights(habits, checkIns, now);
        const topInsight = insights.recommendations[0];
        const tip = topInsight
          ? `💡 ${topInsight.title}`
          : TIPS[new Date().getDate() % TIPS.length];
        return (
          <div className="today-tip">
            {tip}
          </div>
        );
      })()}

      {/* All done? */}
      {todayStats.donePct === 100 && todayStats.active.length > 0 && (
        <div className="today-perfect">
          🎉 All habits completed today! You're on fire.
        </div>
      )}
    </div>
  );
}
