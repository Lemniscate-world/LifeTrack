// src/AchievementsView.tsx
// Achievements: notes tagged with a category, displayed as a timeline grouped
// by category (Psychological, Energy, Physical, etc.).
//
// v0.5.0: now also hosts the gamification panel — level / XP, medals,
// week-over-week comparison and "personas you're becoming".

import { useState, useEffect, useMemo } from 'react';
import {
  getAchievementCategories,
  getAchievements,
  tagNoteAchievement,
  exportAllData,
  getPreferences,
  subscribe,
  getPersonas,
  addPersona,
  updatePersona,
  deletePersona,
  addChallenge,
} from './store';
import { buildAiContext } from './aiContext';
import {
  detectFadedWins,
  type FadedWin,
} from './boost';
import {
  computeXp,
  levelProgress,
  computeMedals,
  bestStreakAllTime,
  compareLastWeeks,
  personaProgress,
  suggestPersonas,
  type PersonaSuggestion,
} from './gamification';
import {
  evolutionSummary,
  scoredDays,
  type EvolutionSummary,
} from './evolution';
import {
  compareWindows,
  buildLocalSummary,
} from './summary';
import {
  buildWinsFeed,
  nextMedals,
  phraseOfDay,
} from './wins';
import { computeAutoAchievements } from './autoAchievements';
import type { Note } from './types';

export default function AchievementsView() {
  const [tick, setTick] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Persona creation form state
  const [showPersonaForm, setShowPersonaForm] = useState(false);
  const [personaName, setPersonaName] = useState('');
  const [personaEmoji, setPersonaEmoji] = useState('⭐');
  const [personaDesc, setPersonaDesc] = useState('');
  const [personaHabits, setPersonaHabits] = useState<string[]>([]);
  const [medalFilter, setMedalFilter] = useState<'all' | 'earned'>('all');

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  // Fresh snapshot of all data (including archived habits) on every store change.
  const data = useMemo(() => {
    void tick; // re-run whenever the store notifies
    return exportAllData();
  }, [tick]);

  const categories = getAchievementCategories();
  const achievements = getAchievements();

  const byCategory = new Map<string, Note[]>();
  for (const note of achievements) {
    const key = note.achievementCategory ?? 'other';
    const list = byCategory.get(key);
    if (list) list.push(note);
    else byCategory.set(key, [note]);
  }

  const totalCount = achievements.length;

  // --- Auto achievements (v0.6.1): milestones derived from real data ---
  const autoAchievements = useMemo(
    () => computeAutoAchievements({
      habits: data.habits,
      checkIns: data.checkIns,
      notes: data.notes,
      challenges: data.challenges,
      experiments: data.experiments,
      urges: data.urges,
      journalEntries: data.journalEntries,
      projects: data.projects ?? [],
    }),
    [data],
  );

  // --- Gamification (all derived, never stored) ---
  const xpBreakdown = useMemo(
    () => computeXp(data.habits, data.checkIns, data.notes, data.challenges),
    [data],
  );
  const progress = useMemo(() => levelProgress(xpBreakdown.total), [xpBreakdown.total]);
  const medals = useMemo(
    () => computeMedals(
      data.habits,
      data.checkIns,
      data.notes,
      data.challenges,
      xpBreakdown.total,
      progress.level,
      {
        urges: data.urges,
        moods: data.moods,
        capacityRatings: data.capacityRatings,
        skills: data.skills,
        capacities: data.capacities,
        levers: data.levers,
        personas: data.personas,
        journalCount: data.journalEntries.length,
      },
    ),
    [data, xpBreakdown.total, progress.level],
  );
  const comparison = useMemo(() => compareLastWeeks(data.habits, data.checkIns), [data]);
  const bestStreak = useMemo(() => bestStreakAllTime(data.habits, data.checkIns), [data]);
  const evolution: EvolutionSummary = useMemo(
    () => evolutionSummary(data.habits, data.checkIns, data.notes, data.urges, data.challenges),
    [data],
  );
  const evolutionSeries = useMemo(
    () => scoredDays(data.habits, data.checkIns, data.notes, data.urges, data.challenges),
    [data],
  );
  const deepCompare = useMemo(
    () => compareWindows(data.habits, data.checkIns, data.notes, data.urges, data.challenges, 30),
    [data],
  );
  const localSummary = useMemo(
    () => buildLocalSummary({
      evolutionScore: evolution.totalScore,
      activeDays: evolution.activeDays,
      xp: xpBreakdown.total,
      level: progress.level,
      medals,
      weekImproved: comparison.improved,
      bestDayScore: evolution.bestDay?.score ?? 0,
      urgesSurfed: data.urges.filter((u) => u.outcome === 'surfed').length,
      moodsLogged: Object.keys(data.moods ?? {}).length,
    }),
    [evolution, xpBreakdown.total, progress.level, medals, comparison, data],
  );
  const wins = useMemo(
    () => buildWinsFeed(data.habits, data.checkIns, data.notes, data.urges),
    [data],
  );
  const upNext = useMemo(() => nextMedals(medals, 3), [medals]);
  const fadedWins = useMemo(
    () => detectFadedWins(data.habits, data.checkIns),
    [data],
  );
  const dayPhrase = useMemo(() => {
    void tick; // re-run whenever the store notifies
    return phraseOfDay(new Date());
  }, [tick]);
  const personas = useMemo(() => {
    void tick; // re-run whenever the store notifies
    return getPersonas();
  }, [tick]);
  const personaStats = useMemo(
    () =>
      personas.map((p) => {
        const progress = personaProgress(p, data.habits, data.checkIns);
        // Reflective personas (accepted suggestions with no habits) still show;
        // they just have no completion bar.
        return {
          persona: p,
          progress,
          pct: progress?.pct ?? null,
          habits: progress?.habits ?? [],
        };
      }),
    [personas, data],
  );
  const activeHabits = data.habits.filter((h) => !h.archived);

  // Auto-detected personas — suggestions the user can accept or dismiss.
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const personaSuggestions: PersonaSuggestion[] = useMemo(() => {
    const fresh = suggestPersonas(data.habits, data.checkIns, undefined, {
      moods: data.moods,
      urges: data.urges,
      levers: data.levers,
      noteCount: data.notes.length,
    });
    return fresh
      .filter((s) => !dismissedSuggestions.includes(s.name))
      .filter((s) => !personas.some((p) => p.name === s.name)); // don't suggest already-created personas
  }, [data, dismissedSuggestions, personas]);

  const handleAcceptSuggestion = (s: PersonaSuggestion) => {
    addPersona(s.name, s.emoji, s.habitIds, s.description, s.kind);
    setDismissedSuggestions((prev) => [...prev, s.name]);
  };

  const handleDismissSuggestion = (name: string) => {
    setDismissedSuggestions((prev) => [...prev, name]);
  };

  const handleReviveWin = (w: FadedWin) => {
    const { days, dailyGoal, adaptive } = w.revive;
    const name = `Relance record : ${w.habit.name} (${w.bestStreak} j)`;
    addChallenge(w.habit.id, name, days, dailyGoal, adaptive);
  };

  const handleSummarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    setAiError(null);
    setAiSummary(null);
    try {
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setAiError('AI summary requires the desktop app (AI provider).');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const context = buildAiContext(exportAllData());
      const beforeAfterJson = deepCompare ? JSON.stringify(deepCompare) : null;
      const response = await invoke<string>('summarize_achievements', {
        summaryJson: context,
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
        beforeAfterJson,
      });
      setAiSummary(response);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Something went wrong while summarizing.');
    } finally {
      setSummarizing(false);
    }
  };

  const toggleFormHabit = (id: string) => {
    setPersonaHabits((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreatePersona = () => {
    if (!personaName.trim() || personaHabits.length === 0) return;
    addPersona(personaName, personaEmoji, personaHabits, personaDesc);
    setPersonaName('');
    setPersonaEmoji('⭐');
    setPersonaDesc('');
    setPersonaHabits([]);
    setShowPersonaForm(false);
  };

  const togglePersonaHabit = (personaId: string, habitId: string) => {
    const p = personas.find((x) => x.id === personaId);
    if (!p) return;
    const next = p.habitIds.includes(habitId)
      ? p.habitIds.filter((id) => id !== habitId)
      : [...p.habitIds, habitId];
    updatePersona(personaId, { habitIds: next });
  };

  const earnedMedals = medals.filter((m) => m.earned).length;

  return (
    <div className="achievements-view">
      <div className="achievements-header">
        <h2>🏆 Achievements</h2>
        <p className="achievements-subtitle">
          {totalCount === 0
            ? 'No achievements yet — tag a note as an achievement when you write it'
            : `${totalCount} achievement${totalCount > 1 ? 's' : ''} across ${byCategory.size} categor${byCategory.size > 1 ? 'ies' : 'y'}`}
        </p>
        <p className="achievements-subtitle-meta">
          <em>Wins</em> · your specific events & milestones, tagged on notes. Your enduring
          abilities (skills & capacities levelled through habits) live in the <strong>Skills</strong> tab.
        </p>
      </div>

      {/* ============ Évolution v2 — EN PREMIER, ouvert ============ */}
      {evolution.today && (() => {
        const last7 = evolutionSeries.slice(-7);
        const prev7 = evolutionSeries.slice(-14, -7);
        const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
        const a7 = Math.round(avgOf(last7.map((s) => s.score)) * 10) / 10;
        const p7 = Math.round(avgOf(prev7.map((s) => s.score)) * 10) / 10;
        const wd = evolution.weekDelta;
        const verdict = !wd
          ? 'Pas encore assez de recul pour un verdict hebdomadaire.'
          : wd.improved && wd.deltaPct >= 10
            ? 'Tu montes nettement — identifie ce qui marche cette semaine et verrouille-le.'
            : wd.improved
              ? 'Progression légère — continue exactement pareil.'
              : wd.delta === 0
                ? 'Stable — choisis UN seul levier à pousser cette semaine.'
                : 'En baisse — réduis le périmètre et garde le noyau (top 3 rendement).';
        const maxScore = Math.max(...evolutionSeries.map((s) => s.score), 1);
        const shown = evolutionSeries.slice(-60);
        const avgShown = avgOf(shown.map((s) => s.score));
        return (
          <details className="ach-fold" open>
            <summary>
              🌱 Évolution
              <span className="ach-count">
                aujourd'hui {evolution.today.score} pts{evolution.dayDelta ? ` · ${evolution.dayDelta.delta > 0 ? '+' : ''}${evolution.dayDelta.deltaPct}% vs hier` : ''}
              </span>
            </summary>
            <section className="evolution-section">
              <div className="evo-verdict">{verdict}</div>

              <div className="evolution-deltas">
                <div className="evolution-delta">
                  <span className="evolution-delta-label">Hier → aujourd'hui</span>
                  {evolution.dayDelta ? (
                    <>
                      <span className={`evolution-delta-value ${evolution.dayDelta.improved ? 'up' : 'down'}`}>
                        {evolution.dayDelta.delta > 0 ? '+' : ''}{evolution.dayDelta.delta}
                      </span>
                      <span className={`evolution-delta-pct ${evolution.dayDelta.improved ? 'up' : 'down'}`}>
                        {evolution.dayDelta.deltaPct > 0 ? '+' : ''}{evolution.dayDelta.deltaPct}%
                      </span>
                    </>
                  ) : <span className="evolution-delta-value neutral">—</span>}
                </div>
                <div className="evolution-delta">
                  <span className="evolution-delta-label">Semaine vs dernière</span>
                  {wd ? (
                    <>
                      <span className={`evolution-delta-value ${wd.improved ? 'up' : 'down'}`}>
                        {wd.delta > 0 ? '+' : ''}{wd.delta}
                      </span>
                      <span className={`evolution-delta-pct ${wd.improved ? 'up' : 'down'}`}>
                        {wd.deltaPct > 0 ? '+' : ''}{wd.deltaPct}%
                      </span>
                    </>
                  ) : <span className="evolution-delta-value neutral">—</span>}
                </div>
                <div className="evolution-delta">
                  <span className="evolution-delta-label">Mois vs dernier</span>
                  {evolution.monthDelta ? (
                    <>
                      <span className={`evolution-delta-value ${evolution.monthDelta.improved ? 'up' : 'down'}`}>
                        {evolution.monthDelta.delta > 0 ? '+' : ''}{evolution.monthDelta.delta}
                      </span>
                      <span className={`evolution-delta-pct ${evolution.monthDelta.improved ? 'up' : 'down'}`}>
                        {evolution.monthDelta.deltaPct > 0 ? '+' : ''}{evolution.monthDelta.deltaPct}%
                      </span>
                    </>
                  ) : <span className="evolution-delta-value neutral">—</span>}
                </div>
                <div className="evolution-delta">
                  <span className="evolution-delta-label">Moyenne 7j vs 7j préc.</span>
                  <span className={`evolution-delta-value ${a7 >= p7 ? 'up' : 'down'}`}>{a7} <small>vs {p7}</small></span>
                </div>
              </div>

              <div className="evolution-stats">
                <div className="evolution-stat">
                  <span className="evolution-stat-value">{evolution.totalScore}</span>
                  <span className="evolution-stat-label">croissance cumulée</span>
                </div>
                <div className="evolution-stat">
                  <span className="evolution-stat-value">{evolution.activeDays}</span>
                  <span className="evolution-stat-label">jours actifs</span>
                </div>
                {evolution.bestDay && (
                  <div className="evolution-stat">
                    <span className="evolution-stat-value">{evolution.bestDay.score}</span>
                    <span className="evolution-stat-label">record ({evolution.bestDay.date})</span>
                  </div>
                )}
              </div>

              {shown.length > 1 && (
                <div className="evolution-chart">
                  <div className="evolution-bars" style={{ position: 'relative' }}>
                    <div
                      className="evo-avgline"
                      style={{ bottom: `${Math.max(2, (avgShown / maxScore) * 100)}%` }}
                      title={`Moyenne période : ${Math.round(avgShown * 10) / 10} pts`}
                    />
                    {shown.map((s) => (
                      <div
                        key={s.date}
                        className={`evolution-bar ${s.score > 0 ? 'has' : ''} ${s.date === evolution.today?.date ? 'today' : ''}`}
                        style={{ height: `${Math.max(s.score > 0 ? 8 : 2, (s.score / maxScore) * 100)}%` }}
                        title={`${s.date} · ${s.score} pts${s.date === evolution.today?.date ? " (aujourd'hui)" : ''}`}
                      />
                    ))}
                  </div>
                  <p className="evo-chart-note">60 derniers jours · pointillés = moyenne de la période</p>
                </div>
              )}
            </section>
          </details>
        );
      })()}

      {/* ============ Gamification panel ============ */}
      <section className="gamification">
        {/* Level / XP */}
        <div className="gamification-level">
          <div className="gamification-level-badge">
            <span className="gamification-rank-emoji">{progress.rankEmoji}</span>
            <span className="gamification-level-number">{progress.level}</span>
            <span className="gamification-rank-name">{progress.rankName}</span>
          </div>
          <div className="gamification-level-info">
            <div className="gamification-xp-bar">
              <div className="gamification-xp-fill" style={{ width: `${progress.progressPct}%` }} />
            </div>
            <div className="gamification-xp-label">
              {xpBreakdown.total} XP total · {progress.xpIntoLevel} / {progress.xpForNext} XP to level {progress.level + 1}
            </div>
            <div className="gamification-xp-breakdown">
              {xpBreakdown.checkIns} check-in · {xpBreakdown.goalDays} goal-day · {xpBreakdown.streakMilestones} streak ·{' '}
              {xpBreakdown.challenges} challenge · {xpBreakdown.achievements} win XP
            </div>
          </div>
        </div>

        {/* Wins feed: don't forget what you've done */}
        <details className="ach-fold">
          <summary>⚡ Victoires récentes <span className="ach-count">{wins.length}</span></summary>
        <div className="gamification-wins">
          <div className="gamification-wins-head">
            <h3>🎉 Vos victoires récentes</h3>
            <span className="gamification-wins-phrase">{dayPhrase.emoji} {dayPhrase.text}</span>
          </div>
          {wins.length > 0 && (
            <ul className="gamification-wins-list">
              {wins.map((w) => (
                <li key={w.id} className="gamification-win">
                  <span className="gamification-win-emoji">{w.emoji}</span>
                  <div className="gamification-win-body">
                    <span className="gamification-win-title">{w.title}{w.date ? ` · ${w.date}` : ''}</span>
                    <span className="gamification-win-sub">{w.subtitle}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {upNext.length > 0 && (
            <div className="gamification-upnext">
              <span className="gamification-upnext-label">À un pas :</span>
              <div className="gamification-upnext-list">
                {upNext.map((u) => (
                  <span key={u.medal.id} className="gamification-upnext-item" title={u.medal.description}>
                    {u.medal.emoji} {u.medal.name} · {u.medal.progress}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        </details>

        {/* Relance of old wins: don't let your proven records fade silently */}
        <details className="ach-fold">
          <summary>🔁 À revivre <span className="ach-count">{fadedWins.length}</span></summary>
        {fadedWins.length > 0 && (
          <div className="gamification-relive">
            <span className="gamification-relive-hint">
              Tu as déjà PROUVÉ ces records — la preuve est dans tes données. Un challenge adaptatif
              les re-chaîne à ton rythme réel (pas à ton rythme de rêve).
            </span>
            <ul className="gamification-relive-list">
              {fadedWins.slice(0, 4).map((w) => {
                const ratio = w.bestStreak > 0 ? Math.min(100, Math.round((w.currentStreak / w.bestStreak) * 100)) : 0;
                return (
                <li key={w.habit.id} className="gamification-relive-item">
                  <div className="gamification-relive-body">
                    <span className="gamification-relive-name">{w.habit.name}</span>
                    <span className="gamification-relive-meta">
                      record {w.bestStreak} j (il y a {w.daysSinceBest} j) · aujourd'hui {w.currentStreak} j{w.faded ? ' · en sourdine' : ''}
                    </span>
                    <div className="relive-gap" title={`${ratio}% du record historique`}>
                      <div className="relive-gap-fill" style={{ width: `${Math.max(2, ratio)}%` }} />
                      <div className="relive-gap-mark" />
                    </div>
                    <span className="relive-objectif">
                      {ratio >= 100 ? 'record battu 🏆' : `objectif : égaler ${w.bestStreak} j — il reste ${Math.max(0, w.bestStreak - w.currentStreak)} j`}
                    </span>
                  </div>
                  <div className="gamification-relive-actions">
                    <span className="gamification-relive-reason">{w.suggestion.reason}</span>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleReviveWin(w)}
                      title="Crée un challenge pour remonter ce record"
                    >
                      🔥 Relancer ({w.revive.days} j)
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          </div>
        )}
        </details>

        {/* Comparison vs last week */}
        <details className="ach-fold" open>
          <summary>📈 Rythme hebdo</summary>
        <div className="gamification-compare">
          <h3 className="ach-hidden">📈 vs who you were last week</h3>
          <div className="gamification-compare-stats">
            <div className="gamification-compare-stat">
              <span className="gamification-compare-value">{comparison.currentXp}</span>
              <span className="gamification-compare-label">XP this week</span>
            </div>
            <div className="gamification-compare-arrow">{comparison.improved ? '📈' : '📉'}</div>
            <div className="gamification-compare-stat">
              <span className={`gamification-compare-value ${comparison.improved ? 'up' : 'down'}`}>
                {comparison.deltaPct > 0 ? '+' : ''}{comparison.deltaPct}%
              </span>
              <span className="gamification-compare-label">vs last week</span>
            </div>
            <div className="gamification-compare-stat">
              <span className="gamification-compare-value">{bestStreak}</span>
              <span className="gamification-compare-label">best streak ever</span>
            </div>
          </div>
          <p className="gamification-compare-note">
            {comparison.currentCompleted} complétions cette semaine vs {comparison.previousCompleted} la semaine passée
          </p>
        </div>
        </details>

        {/* Medals */}
        <details className="ach-fold" open>
          <summary>🏅 Médailles <span className="ach-count">{earnedMedals}/{medals.length}</span></summary>
        <div className="gamification-medals">
          <div className="gamification-medals-head">
            <h3>🎖️ Medals <span className="gamification-medals-count">{earnedMedals}/{medals.length}</span></h3>
            <div className="gamification-medals-filter">
              <button
                className={`btn btn-sm ${medalFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setMedalFilter('all')}
              >
                All
              </button>
              <button
                className={`btn btn-sm ${medalFilter === 'earned' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setMedalFilter('earned')}
              >
                Earned
              </button>
            </div>
          </div>

          {(() => {
            const groups = new Map<string, { emoji: string; medals: typeof medals }>();
            for (const m of medals) {
              if (medalFilter === 'earned' && !m.earned) continue;
              const cat = m.category ?? 'Other';
              if (!groups.has(cat)) groups.set(cat, { emoji: '🎖️', medals: [] });
              groups.get(cat)!.medals.push(m);
            }
            return Array.from(groups.entries()).map(([cat, group]) => (
              <div key={cat} className="gamification-medal-group">
                <h4 className="gamification-medal-category">{group.emoji} {cat}</h4>
                <div className="gamification-medals-grid">
                  {group.medals.map((m) => (
                    <div
                      key={m.id}
                      className={`gamification-medal ${m.earned ? 'earned' : ''}`}
                      title={m.description}
                    >
                      <span className="gamification-medal-emoji">{m.emoji}</span>
                      <span className="gamification-medal-name">{m.name}</span>
                      {m.progress !== undefined && !m.earned && (
                        <span className="gamification-medal-progress">{m.progress}%</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
             ));
          })()}
        </div>
        </details>

        {/* Personas */}
        <details className="ach-fold">
          <summary>🧭 Personas <span className="ach-count">{personaStats.length}</span></summary>
        <div className="gamification-personas">
          <h3 className="ach-hidden">Who you're becoming</h3>
          <button
            className={`btn btn-sm ${showPersonaForm ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => setShowPersonaForm((v) => !v)}
          >
            {showPersonaForm ? 'Cancel' : '+ Add a persona'}
          </button>

          {showPersonaForm && (
            <div className="gamification-persona-form">
              <input
                placeholder="Name — e.g. Early riser"
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
              />
              <input
                className="gamification-persona-emoji-input"
                placeholder="⭐"
                value={personaEmoji}
                onChange={(e) => setPersonaEmoji(e.target.value)}
                maxLength={4}
                aria-label="Persona emoji"
              />
              <input
                placeholder="Who you want to become (optional)"
                value={personaDesc}
                onChange={(e) => setPersonaDesc(e.target.value)}
              />
              <div className="gamification-persona-habits">
                {activeHabits.length === 0 && (
                  <p className="gamification-none">Add habits first to link them to a persona.</p>
                )}
                {activeHabits.map((h) => (
                  <label key={h.id} className="gamification-persona-habit-option">
                    <input
                      type="checkbox"
                      checked={personaHabits.includes(h.id)}
                      onChange={() => toggleFormHabit(h.id)}
                    />
                    <span>{h.name}</span>
                  </label>
                ))}
              </div>
              <button
                className="btn btn-sm btn-primary"
                disabled={!personaName.trim() || personaHabits.length === 0}
                onClick={handleCreatePersona}
              >
                Create persona
              </button>
            </div>
          )}

          <div className="gamification-personas-grid">
            {personaSuggestions.length > 0 && (
              <div className="gamification-persona-suggestions">
                <h4>✨ Detected personas <span>— emerging from your habits, tap to accept</span></h4>
                {personaSuggestions.map((s) => (
                  <div className="gamification-persona-suggestion" key={s.name}>
                    <span className="gamification-persona-emoji">{s.emoji}</span>
                    <div className="gamification-persona-suggestion-body">
                      <span className="gamification-persona-suggestion-name">{s.name}</span>
                      <span className="gamification-persona-suggestion-desc">{s.description}</span>
                      <span className="gamification-persona-suggestion-reason">{s.reason}</span>
                    </div>
                    <div className="gamification-persona-suggestion-actions">
                      <span className="gamification-persona-suggestion-pct">{s.avgPct}%</span>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleAcceptSuggestion(s)}
                        title="Create this persona"
                      >
                        ✓ Accept
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleDismissSuggestion(s.name)}
                        title="Dismiss"
                        aria-label="Dismiss suggestion"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {personaStats.length === 0 && !showPersonaForm && (
              <p className="gamification-none">
                No personas yet — define who you want to become and link the habits that build
                that version of you. Progress updates automatically.
              </p>
            )}
            {personaStats.map((pp) => (
              <div key={pp.persona.id} className="gamification-persona">
                <div className="gamification-persona-top">
                  <span className="gamification-persona-emoji">{pp.persona.emoji}</span>
                  <div className="gamification-persona-title">
                    <span className="gamification-persona-name">{pp.persona.name}</span>
                    {pp.persona.description && (
                      <span className="gamification-persona-desc">{pp.persona.description}</span>
                    )}
                  </div>
                  <button
                    className="btn btn-sm btn-ghost gamification-persona-delete"
                    onClick={() => deletePersona(pp.persona.id)}
                    title="Delete persona"
                    aria-label="Delete persona"
                  >
                    ✕
                  </button>
                </div>
                <div className="gamification-persona-progress">
                  {pp.pct !== null ? (
                    <>
                      <div className="gamification-persona-bar">
                        <div style={{ width: `${pp.pct}%` }} />
                      </div>
                      <span className="gamification-persona-pct">{pp.pct}%</span>
                    </>
                  ) : (
                    <span className="gamification-persona-reflective">🔭 persona d'auto-observation — vis à vis du journal</span>
                  )}
                </div>
                <div className="gamification-persona-habit-chips">
                  {pp.habits.map((h) => (
                    <span key={h.habitId} className="gamification-persona-chip">
                      {h.habitName}
                      <button
                        className="gamification-persona-chip-remove"
                        onClick={() => togglePersonaHabit(pp.persona.id, h.habitId)}
                        title="Unlink habit"
                        aria-label={`Unlink ${h.habitName}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <select
                    className="gamification-persona-add"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) togglePersonaHabit(pp.persona.id, e.target.value);
                    }}
                    title="Link another habit"
                    aria-label="Link another habit"
                  >
                    <option value="">+ add habit</option>
                    {activeHabits
                      .filter((h) => !pp.habits.some((x) => x.habitId === h.id))
                      .map((h) => (
                        <option key={h.id} value={h.id}>{h.name}</option>
                      ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
        </details>
      </section>


      {/* ============ AI summary ============ */}
      {(totalCount > 0 || localSummary.length > 0) && (
        <details className="ach-fold">
          <summary>🤖 Résumé IA</summary>
        <div className="achievements-ai section-card">
          {localSummary.length > 0 && (
            <div className="achievements-local">
              <div className="achievements-ai-label">🎯 Your snapshot, right now</div>
              <ul className="achievements-local-list">
                {localSummary.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          )}
          {!aiSummary && !aiError && (
            <button
              className="btn btn-primary"
              onClick={handleSummarize}
              disabled={summarizing}
            >
              {summarizing
                ? '✨ Writing your story…'
                : deepCompare
                  ? '✨ Deep before/after story of your last 30 days'
                  : '✨ AI summary of your progress'}
            </button>
          )}
          {aiError && <p className="achievements-ai-error">{aiError}</p>}
          {aiSummary && (
            <div className="achievements-ai-card">
              <div className="achievements-ai-label">✨ Your progress, in one paragraph</div>
              <p className="achievements-ai-text">{aiSummary}</p>
              <button className="btn btn-sm btn-ghost" onClick={() => setAiSummary(null)}>Hide</button>
            </div>
          )}
        </div>
        </details>
      )}

      {totalCount === 0 && (
        <p className="achievements-hint">
          Open the <strong>Notes</strong> panel in the Grid view, write about something you
          accomplished (a psychological win, an energy milestone, …) and pick a category before
          saving. It will appear here on your timeline.
        </p>
      )}

      {/* ============ Auto achievements (derived from data, never stored) ============ */}
      {autoAchievements.length > 0 && (
        <div className="achievements-auto">
          <h3>⚡ Succès automatiques — dérivés de tes données</h3>
          <div className="achievements-auto-list">
            {autoAchievements.map((a) => (
              <div className="achievement-auto-item" key={a.id}>
                <span className="achievement-auto-emoji">{a.emoji}</span>
                <div className="achievement-auto-main">
                  <div className="achievement-auto-title">{a.title}</div>
                  <div className="achievement-auto-detail">{a.detail}</div>
                </div>
                <span className="achievement-auto-date">{a.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ Timeline ============ */}
      <div className="achievements-grid">
        {categories.map((cat) => {
          const list = byCategory.get(cat.id) ?? [];
          return (
            <div key={cat.id} className={`achievement-card ${list.length === 0 ? 'empty' : ''}`}>
              <div className="achievement-card-header">
                <span className="achievement-cat-emoji" style={{ background: cat.color }}>{cat.emoji}</span>
                <span className="achievement-cat-name">{cat.name}</span>
                <span className="achievement-count">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <span className="achievement-empty-cat">No achievements yet</span>
              ) : (
                <ul className="achievement-timeline">
                  {list.map((note) => (
                    <li key={note.id} className="achievement-item">
                      <span className="achievement-item-date">
                        {new Date(note.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="achievement-item-text">{note.content}</span>
                      <button
                        className="achievement-item-untag"
                        onClick={() => tagNoteAchievement(note.id, null)}
                        title="Remove achievement tag"
                        aria-label="Remove achievement tag"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {totalCount > 0 && (
        <p className="achievements-footer">
          Achievements are <strong>wins</strong> — notes you tagged with a category. Remove a tag with the ✕ button to
          unmark it. Skills & capacities (your enduring abilities) are tracked separately in the Skills tab.
        </p>
      )}
    </div>
  );
}
