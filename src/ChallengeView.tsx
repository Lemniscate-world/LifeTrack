import { useState } from 'react';
import type { Habit, CheckIn } from './types';

interface ChallengeViewProps {
  habits: Habit[];
  checkIns: CheckIn[];
}

export default function ChallengeView({ habits, checkIns }: ChallengeViewProps) {
  const active = habits.filter(h => !h.archived);
  const [selectedHabit, setSelectedHabit] = useState(active[0]?.id ?? '');

  const habit = active.find(h => h.id === selectedHabit);
  
  const challenge = (() => {
    if (!habit) return null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    
    // Last 30 days
    const days: { date: string; completed: boolean; day: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const ci = checkIns.find(c => c.habitId === habit.id && c.date === ds);
      days.push({
        date: ds,
        completed: ci?.completed ?? false,
        day: 30 - i,
      });
    }

    const completedCount = days.filter(d => d.completed).length;
    const pct = Math.round((completedCount / 30) * 100);
    const remaining = 30 - completedCount;
    const isToday = days[days.length - 1]?.date === today;

    return { days, completedCount, pct, remaining, isToday };
  })();

  if (active.length === 0) {
    return <div className="challenge-view"><p style={{textAlign:'center',color:'var(--text-muted)'}}>Add habits to start a challenge.</p></div>;
  }

  return (
    <div className="challenge-view">
      <h2>🎯 30-Day Challenge</h2>
      <p className="challenge-desc">Pick a habit and commit to 30 days. Every check-in counts.</p>

      <div className="challenge-select">
        <select value={selectedHabit} onChange={e => setSelectedHabit(e.target.value)}>
          {active.map(h => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </div>

      {challenge && habit && (
        <>
          {/* Progress Ring */}
          <div className="challenge-progress">
            <div className="challenge-ring">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="42"
                  fill="none"
                  stroke={challenge.pct >= 80 ? '#22c55e' : challenge.pct >= 50 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${challenge.pct * 2.64} 264`}
                  transform="rotate(-90 50 50)"
                  style={{ transition: 'stroke-dasharray 0.5s ease' }}
                />
                <text x="50" y="48" textAnchor="middle" fill="var(--text)" fontSize="18" fontWeight="700">
                  {challenge.pct}%
                </text>
                <text x="50" y="62" textAnchor="middle" fill="var(--text-muted)" fontSize="10">
                  {challenge.completedCount}/30 days
                </text>
              </svg>
            </div>
          </div>

          {/* Status */}
          <div className="challenge-status">
            {challenge.completedCount === 30 ? (
              <div className="challenge-complete">🏆 Challenge Complete! You did it!</div>
            ) : (
              <div className="challenge-remaining">
                {challenge.remaining} day{challenge.remaining !== 1 ? 's' : ''} remaining
                {!challenge.isToday && ' — check in today to stay on track!'}
              </div>
            )}
          </div>

          {/* Day Grid */}
          <div className="challenge-grid">
            {challenge.days.map((d, i) => (
              <div
                key={i}
                className={`challenge-day ${d.completed ? 'done' : 'missed'} ${d.date === new Date().toISOString().slice(0, 10) ? 'today' : ''}`}
                title={`Day ${d.day}: ${d.date}`}
              >
                <span className="challenge-day-num">{d.day}</span>
                <span className="challenge-day-mark">{d.completed ? '✓' : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
