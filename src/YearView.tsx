import { useMemo } from 'react';
import type { Habit, CheckIn } from './types';

interface YearViewProps {
  habits: Habit[];
  checkIns: CheckIn[];
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getIntensity(date: string, checkIns: CheckIn[], habits: Habit[]): number {
  // Count how many habits were completed on this day
  const dayCheckIns = checkIns.filter(ci => ci.date === date && ci.completed);
  const totalHabits = habits.filter(h => !h.archived).length;
  if (totalHabits === 0) return 0;
  return Math.round((dayCheckIns.length / totalHabits) * 4); // 0-4 scale
}

export default function YearView({ habits, checkIns }: YearViewProps) {
  const now = new Date();
  const activeHabits = habits.filter(h => !h.archived);

  const { weeks, monthLabels } = useMemo(() => {
    const endDate = new Date(now);
    endDate.setUTCHours(0, 0, 0, 0);
    
    // Start from 52 weeks ago, aligned to Sunday
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 364); // 365 days = 52 weeks + 1 day
    // Align to Sunday
    while (startDate.getUTCDay() !== 0) {
      startDate.setUTCDate(startDate.getUTCDate() - 1);
    }

    const weeks: { date: string; intensity: number; month: number }[][] = [];
    const mlabels: { week: number; label: string }[] = [];
    let currentWeek: { date: string; intensity: number; month: number }[] = [];
    let lastMonth = -1;

    const d = new Date(startDate);
    let weekIdx = 0;
    while (d <= endDate) {
      const dateStr = d.toISOString().slice(0, 10);
      const month = d.getUTCMonth();
      
      currentWeek.push({
        date: dateStr,
        intensity: getIntensity(dateStr, checkIns, habits),
        month,
      });

      if (d.getUTCDay() === 6 || d.getTime() === endDate.getTime()) {
        weeks.push(currentWeek);
        // Check for month change
        const firstOfWeek = currentWeek[0].month;
        if (firstOfWeek !== lastMonth) {
          mlabels.push({ week: weekIdx, label: MONTHS_SHORT[firstOfWeek] });
          lastMonth = firstOfWeek;
        }
        currentWeek = [];
        weekIdx++;
      }

      d.setUTCDate(d.getUTCDate() + 1);
    }

    return { weeks, monthLabels: mlabels };
  }, [checkIns, habits, now]);

  // Per-habit stats for the year
  const habitYearStats = useMemo(() => {
    const yearAgo = new Date(now);
    yearAgo.setUTCDate(yearAgo.getUTCDate() - 365);
    const yearAgoStr = yearAgo.toISOString().slice(0, 10);

    return activeHabits.map(h => {
      const yearCheckIns = checkIns.filter(ci => ci.habitId === h.id && ci.date >= yearAgoStr);
      const completed = yearCheckIns.filter(ci => ci.completed).length;
      const total = yearCheckIns.length || 1;
      const pct = Math.round((completed / total) * 100);
      const bestStreak = h.bestStreak ?? 0;
      const totalDone = h.totalCompleted ?? completed;
      return { habit: h, completed, total, pct, bestStreak, totalDone };
    }).sort((a, b) => b.pct - a.pct);
  }, [activeHabits, checkIns, now]);

  const intensityColors = [
    'var(--border)',
    'color-mix(in srgb, var(--accent) 25%, transparent)',
    'color-mix(in srgb, var(--accent) 50%, transparent)',
    'color-mix(in srgb, var(--accent) 75%, transparent)',
    'var(--accent)',
  ];

  return (
    <div className="year-view">
      <h2>📅 Year in Review</h2>
      
      {/* Contribution Grid */}
      <div className="year-grid-container">
        <div className="year-grid-wrapper">
          {/* Month labels */}
          <div className="year-month-labels">
            {monthLabels.map((ml, i) => (
              <span key={i} className="year-month-label" style={{ gridColumn: ml.week + 1 }}>
                {ml.label}
              </span>
            ))}
          </div>
          
          {/* Day grid */}
          <div className="year-grid">
            {/* Day of week labels */}
            <div className="year-dow-col">
              <span>Mon</span><span>Wed</span><span>Fri</span>
            </div>
            
            <div className="year-cells">
              {weeks.map((week, wi) => (
                <div key={wi} className="year-week-col">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      className="year-cell"
                      style={{ backgroundColor: intensityColors[day.intensity] || intensityColors[0] }}
                      title={`${day.date}: ${day.intensity * 25}%`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="year-legend">
          <span>Less</span>
          {intensityColors.map((c, i) => (
            <div key={i} className="year-cell" style={{ backgroundColor: c, width: 14, height: 14 }} />
          ))}
          <span>More</span>
        </div>
      </div>

      {/* Per-habit year stats */}
      <div className="year-habit-stats">
        <h3>Habit Breakdown</h3>
        {habitYearStats.map(hs => (
          <div key={hs.habit.id} className="year-habit-row">
            <span className="year-habit-color" style={{ backgroundColor: hs.habit.color }} />
            <span className="year-habit-name">{hs.habit.name}</span>
            <div className="year-habit-bar-track">
              <div className="year-habit-bar-fill" style={{ width: `${hs.pct}%` }} />
            </div>
            <span className="year-habit-pct">{hs.pct}%</span>
            <span className="year-habit-total">{hs.totalDone} done</span>
          </div>
        ))}
      </div>
    </div>
  );
}
