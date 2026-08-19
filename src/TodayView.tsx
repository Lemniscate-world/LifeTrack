import { useState, useEffect, useMemo } from 'react';
import type { Habit, CheckIn, Mantra } from './types';
import { computeStreakStats, computeCompletionRate } from './stats';
import { MANTRA_DOMAINS } from './mantras';
import { generateInsights } from './recommendations';
import { buildOnThisDay } from './memories';
import { exportAllData, MOODS, setMood, getMood, subscribe } from './store';
import { weeklySummary } from './weeklySummary';
import { buildPreferenceReport } from './preferences';
import { logTimeInsights } from './checkTimes';
import { todayKey } from './dates';

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
  const now = useMemo(() => new Date(), []);
  const todayStr = todayKey(now);

  // Re-render when the store changes (mood set, check-ins…).
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const [mood, setMoodLocal] = useState<string | undefined>(() => {
    try { return getMood(todayStr); } catch { return undefined; }
  });

  // Trailing-7-days digest (local, derived).
  const week = useMemo(() => weeklySummary(habits, checkIns, now), [habits, checkIns, now]);

  // When do I actually log? (hour-of-day analysis, requires checkedAt timestamps)
  const logRhythm = useMemo(() => logTimeInsights(habits, checkIns, 90, now), [habits, checkIns, now]);

  // One focused thing worth trying today, from the preference engine.
  const tryToday = useMemo(() => {
    try {
      const d = exportAllData();
      const report = buildPreferenceReport({
        habits: d.habits ?? [],
        checkIns: d.checkIns ?? [],
        notes: d.notes ?? [],
        moods: d.moods ?? {},
        capacities: (d.capacities ?? []).map((c) => ({ id: c.id, name: c.name })),
        capacityRatings: d.capacityRatings ?? [],
        projects: d.projects ?? [],
        protocols: d.protocols ?? [],
        experiments: (d.experiments ?? []).map((e) => ({ id: e.id, title: e.title })),
        challenges: (d.challenges ?? []).map((c) => ({ id: c.id, name: c.name })),
      });
      const proto = report.protocols.find((p) => !p.alreadyPursued);
      return proto ?? null;
    } catch { return null; }
  }, []);

  const setMoodForToday = (id: string) => {
    setMoodLocal(id);
    try { setMood(todayStr, id); } catch { /* ignore */ }
  };

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
  }, [habits, checkIns, todayStr, now]);

  const topStreaks = todayStats.streaks.filter(s => s.stats.current >= 3).slice(0, 3);
  const needsAttention = todayStats.streaks.filter(s => !s.doneToday && s.stats.current === 0).slice(0, 3);

  // Monthly focus habit
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const focusHabit = habits.find(h => h.focusMonth === thisMonth);
  const focusStats = focusHabit ? todayStats.streaks.find(s => s.habit.id === focusHabit.id) : null;

  const mantraDomain = todayMantra ? MANTRA_DOMAINS.find(d => d.id === todayMantra.domain) : null;

  // On-this-day memories + present progress tie-in (remember past, anchor now).
  const memories = useMemo(() => {
    try {
      const d = exportAllData();
      return buildOnThisDay(d.habits ?? [], d.checkIns ?? [], d.notes ?? [], d.journalEntries ?? [], now);
    } catch { return []; }
  }, [now]);

  return (
    <div className="today-view">
      {/* Today progress + quick mood */}
      <div className="today-progress-card">
        <div className="today-progress-top">
          <span className="today-progress-label">Aujourd'hui</span>
          <span className="today-progress-value">{todayStats.donePct}%</span>
        </div>
        <div className="skill-progress-track large">
          <div
            className="skill-progress-fill"
            style={{ width: `${todayStats.donePct}%`, background: 'var(--accent,#8b5cf6)' }}
          />
        </div>
        <div className="today-mood-row">
          {MOODS.map((m) => (
            <button
              key={m.id}
              className={`today-mood-btn ${mood === m.id ? 'active' : ''}`}
              onClick={() => setMoodForToday(m.id)}
              title={m.label}
            >
              {m.emoji}
            </button>
          ))}
        </div>
      </div>

      {/* This week */}
      <div className="today-section">
        <h3>📅 Cette semaine</h3>
        <div className="today-week">
          {week.days.map((d) => (
            <div
              key={d.date}
              className={`today-week-day ${d.pct >= 100 ? 'full' : d.pct > 0 ? 'partial' : 'empty'}`}
              title={`${d.date} · ${d.pct}%`}
            >
              <span className="today-week-pct">{d.pct}%</span>
              <span className="today-week-date">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
        <div className="skill-progress-bar-labels">
          <span>Moyenne : {week.avgPct}% · {week.totalDone} réalisation(s)</span>
          <span>{week.activeHabits} habitude(s) actives</span>
        </div>
      </div>

      {/* Mantra Banner */}
      {todayMantra && mantraDomain && (
        <div className="today-mantra" style={{ borderLeftColor: mantraDomain.color }}>
          <span className="today-mantra-domain">{mantraDomain.icon} {mantraDomain.name}</span>
          <blockquote>"{todayMantra.text}"</blockquote>
        </div>
      )}

      {/* On-this-day memory (remember past, anchor present) */}
      {memories.length > 0 && (
        <div className="today-memories">
          <h3 className="today-memories-title">💭 Il y a un an, à cette époque…</h3>
          <div className="today-memories-list">
            {memories.map(m => (
              <div key={m.id} className="today-memory">
                <span className="today-memory-emoji">{m.emoji}</span>
                <div className="today-memory-body">
                  <span className="today-memory-title">{m.title}</span>
                  <span className="today-memory-text">{m.body}</span>
                </div>
              </div>
            ))}
          </div>
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

      {/* One thing worth trying today (from the preference engine) */}
      {tryToday && (
        <div className="today-try">
          <div className="today-try-head">
            <span className="today-try-icon">🧪</span>
            <span className="today-try-title">Aujourd'hui, essaie</span>
          </div>
          <div className="today-try-name">{tryToday.protocol.title}</div>
          <div className="today-try-protocol">{tryToday.protocol.protocol}</div>
          <div className="today-try-source">
            {tryToday.protocol.source} · preuve {tryToday.protocol.evidenceLevel}
          </div>
        </div>
      )}

      {/* Ton rythme de log (heure des check-ins) */}
      {logRhythm.length > 0 && (
        <div className="today-section">
          <h3>🕐 Ton rythme de log</h3>
          {logRhythm.map((line, i) => (
            <div key={i} className="today-tip">{line}</div>
          ))}
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
            Chaque check-in enregistre son heure — plus tu logs, plus LifeTrack connaît ton rythme.
          </div>
        </div>
      )}

      {/* All done? */}
      {todayStats.donePct === 100 && todayStats.active.length > 0 && (
        <div className="today-perfect">
          🎉 All habits completed today! You're on fire.
        </div>
      )}
    </div>
  );
}
