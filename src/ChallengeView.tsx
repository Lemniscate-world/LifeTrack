import { useState } from 'react';
import type { Habit, CheckIn, Challenge } from './types';
import {
  getChallenges,
  getActiveChallenges,
  addChallenge,
  deleteChallenge,
  resolveChallengeStatuses,
} from './store';
import {
  suggestAdaptiveTarget,
  computeChallengeProgress,
  pickSuggestion,
  buildChallengeName,
  todayKey,
} from './challenges';

interface ChallengeViewProps {
  habits: Habit[];
  checkIns: CheckIn[];
}

export default function ChallengeView({ habits, checkIns }: ChallengeViewProps) {
  const active = habits.filter(h => !h.archived);
  const today = todayKey();

  // Auto-resolve stale challenges (window fully elapsed) on render.
  resolveChallengeStatuses();
  const challenges = getChallenges();
  const activeChallenges = getActiveChallenges();
  const activeHabitIds = new Set(activeChallenges.map(c => c.habitId));

  const [selectedHabit, setSelectedHabit] = useState('');
  const [customDays, setCustomDays] = useState<number>(30);
  const [dailyGoal, setDailyGoal] = useState<number>(1);
  const [goalTouched, setGoalTouched] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Adaptive suggestion for the currently selected habit.
  const selected = selectedHabit ? active.find(h => h.id === selectedHabit) : null;
  const suggestion = selected
    ? suggestAdaptiveTarget(selected, checkIns, 14, new Date())
    : null;
  // A suggested habit to challenge (most neglected, not already challenged).
  const suggestedHabit = pickSuggestion(active, checkIns, activeHabitIds, new Date());
  const suggestedTarget = suggestedHabit
    ? suggestAdaptiveTarget(suggestedHabit, checkIns, 14, new Date())
    : null;

  const habitById = new Map(active.map(h => [h.id, h]));

  const applySuggestion = () => {
    if (suggestion) {
      setCustomDays(suggestion.days);
      setDailyGoal(suggestion.dailyGoal);
      setGoalTouched(true);
    }
  };

  const startChallenge = (habit: Habit, days: number, goal: number, adaptive: boolean) => {
    const name = buildChallengeName(habit.name, days, goal);
    addChallenge(habit.id, name, days, goal, adaptive);
    setToast(`🎯 Challenge started: ${name}`);
    setTimeout(() => setToast(null), 3000);
  };

  if (active.length === 0) {
    return <div className="challenge-view"><p style={{textAlign:'center',color:'var(--text-muted)'}}>Add habits to start a challenge.</p></div>;
  }

  const progressOf = (c: Challenge) => {
    return computeChallengeProgress(c.habitId, c.startDate, c.days, c.dailyGoal, checkIns, today);
  };

  return (
    <div className="challenge-view">
      <h2>🎯 Intelligent Challenges</h2>
      <p className="challenge-desc">
        Persistent, adaptive challenges. The target adapts to your history — and it's saved,
        so a reload never loses your progress.
      </p>

      {toast && <div className="challenge-toast">{toast}</div>}

      {/* --- Start a challenge --- */}
      <div className="challenge-creator">
        <h3>Start a new challenge</h3>

        {/* Smart suggestion */}
        {suggestedHabit && suggestedTarget && (
          <div className="challenge-suggestion">
            <div className="challenge-suggestion-head">
              <span>🤖 Suggested for you</span>
            </div>
            <div className="challenge-suggestion-body">
              <strong>{buildChallengeName(suggestedHabit.name, suggestedTarget.days, suggestedTarget.dailyGoal)}</strong>
              <p>{suggestedTarget.reason}</p>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => startChallenge(suggestedHabit, suggestedTarget.days, suggestedTarget.dailyGoal, true)}
              >
                Start it
              </button>
            </div>
          </div>
        )}

        {/* Manual creator */}
        <div className="challenge-create-row">
          <select
            value={selectedHabit}
            onChange={(e) => {
              setSelectedHabit(e.target.value);
              const h = active.find(x => x.id === e.target.value);
              if (h && !goalTouched) {
                const s = suggestAdaptiveTarget(h, checkIns, 14, new Date());
                setCustomDays(s.days);
                setDailyGoal(s.dailyGoal);
              }
            }}
          >
            <option value="" disabled>Choose a habit…</option>
            {active
              .filter(h => !activeHabitIds.has(h.id))
              .map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
          </select>
          <label className="challenge-field">
            Days
            <input
              type="number"
              min={1}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
          <label className="challenge-field">
            ×/day
            <input
              type="number"
              min={1}
              max={30}
              value={dailyGoal}
              onChange={(e) => {
                setDailyGoal(Math.max(1, parseInt(e.target.value, 10) || 1));
                setGoalTouched(true);
              }}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={!selected}
            onClick={() => selected && startChallenge(selected, customDays, dailyGoal, false)}
          >
            Start
          </button>
        </div>

        {selected && suggestion && !goalTouched && (
          <button className="btn btn-sm btn-ghost" onClick={applySuggestion}>
            ⚡ Use adaptive target: {suggestion.days} days, {suggestion.dailyGoal}×/day
          </button>
        )}
        {selected && suggestion && (
          <p className="challenge-hint">{suggestion.reason}</p>
        )}
      </div>

      {/* --- Active challenges --- */}
      <div className="challenge-list">
        {challenges.length === 0 && (
          <p className="challenge-none">No challenges yet. Pick a habit above to begin.</p>
        )}

        {challenges.map((challenge) => {
          const habit = habitById.get(challenge.habitId);
          const progress = progressOf(challenge);
          const pct = progress.pct;
          return (
            <div key={challenge.id} className={`challenge-card challenge-${challenge.status}`}>
              <div className="challenge-card-head">
                <span className="challenge-card-name">
                  {challenge.status === 'active' ? '🎯' : challenge.status === 'completed' ? '🏆' : '❌'}{' '}
                  {challenge.name}
                  {challenge.adaptive && <span className="challenge-adaptive-badge" title="Target auto-tuned to your history">⚡ adaptive</span>}
                </span>
                <span className={`challenge-card-status ${challenge.status}`}>{challenge.status}</span>
                <button
                  className="btn btn-sm btn-ghost challenge-delete"
                  onClick={() => deleteChallenge(challenge.id)}
                  title="Delete challenge"
                  aria-label="Delete challenge"
                >
                  ✕
                </button>
              </div>

              {habit && <div className="challenge-card-habit">on “{habit.name}” · goal {challenge.dailyGoal}×/day · {challenge.days} days</div>}

              {challenge.status === 'active' ? (
                <>
                  <div className="challenge-progress">
                    <div className="challenge-ring">
                      <svg viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="8" />
                        <circle
                          cx="50" cy="50" r="42"
                          fill="none"
                          stroke={pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'}
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${pct * 2.64} 264`}
                          transform="rotate(-90 50 50)"
                          style={{ transition: 'stroke-dasharray 0.5s ease' }}
                        />
                        <text x="50" y="48" textAnchor="middle" fill="var(--text)" fontSize="18" fontWeight="700">
                          {pct}%
                        </text>
                        <text x="50" y="62" textAnchor="middle" fill="var(--text-muted)" fontSize="10">
                          {progress.completedDays}/{progress.totalDays} days
                        </text>
                      </svg>
                    </div>
                  </div>
                  <div className="challenge-status">
                    <div className="challenge-remaining">
                      🔥 {progress.currentStreak}-day streak · {progress.daysRemaining} day{progress.daysRemaining !== 1 ? 's' : ''} left
                    </div>
                  </div>
                </>
              ) : (
                <div className="challenge-status">
                  {challenge.status === 'completed'
                    ? <div className="challenge-complete">🏆 Challenge complete! {progress.completedDays}/{progress.totalDays} days hit.</div>
                    : <div className="challenge-failed">Challenge missed — {progress.completedDays}/{progress.totalDays} days hit. Start again, or pick a gentler target.</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
