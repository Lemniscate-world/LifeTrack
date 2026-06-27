// src/HistoryView.tsx
// Reverse-chronological timeline of all check-ins, grouped by day.
// Designed for the "Data Nerd" persona — quick visual scan of activity.
//
// API:
//   <HistoryView checkIns={allCheckIns} habits={habits} today={...} />
//
// Performance:
//   - We pre-sort once with useMemo (cheap: tens of thousands of entries max)
//   - Grouping is O(n) and rendered as collapsible day sections.

import { useMemo, useState } from 'react';
import type { CheckIn, Habit } from './types';
import { toDateKey, addDays } from './stats';

interface Props {
  checkIns: CheckIn[];
  habits: Habit[];
  today?: Date;
  /** Max number of day-sections to render. Defaults to 90. */
  dayWindow?: number;
}

const HABIT_NAME_BY_ID = new Map<string, string>();
function habitNameFor(habits: Habit[], id: string): string {
  if (HABIT_NAME_BY_ID.has(id)) return HABIT_NAME_BY_ID.get(id)!;
  const h = habits.find((x) => x.id === id);
  const name = h?.name ?? id;
  HABIT_NAME_BY_ID.set(id, name);
  return name;
}

function habitColorFor(habits: Habit[], id: string): string {
  return habits.find((x) => x.id === id)?.color ?? '#cbd5e1';
}

function formatDayLabel(dateStr: string, today: Date): string {
  const d = new Date(dateStr + 'T00:00:00');
  const todayKey = toDateKey(today);
  const yesterdayKey = toDateKey(addDays(today, -1));
  if (dateStr === todayKey) return 'Today';
  if (dateStr === yesterdayKey) return 'Yesterday';
  // Format like "Monday, June 22"
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export function HistoryView({ checkIns, habits, today = new Date(), dayWindow = 90 }: Props) {
  const [filterHabitId, setFilterHabitId] = useState<string>('');
  const [showMisses, setShowMisses] = useState(true);

  const grouped = useMemo(() => {
    HABIT_NAME_BY_ID.clear();
    const filtered = filterHabitId
      ? checkIns.filter((c) => c.habitId === filterHabitId)
      : checkIns;

    const map = new Map<string, CheckIn[]>();
    for (const c of filtered) {
      if (!showMisses && !c.completed) continue;
      const arr = map.get(c.date);
      if (arr) arr.push(c);
      else map.set(c.date, [c]);
    }

    // Sort by date desc; entries within a day sorted by habit name asc.
    const days = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    for (const [, entries] of days) {
      entries.sort((a, b) => habitNameFor(habits, a.habitId).localeCompare(habitNameFor(habits, b.habitId)));
    }
    return days.slice(0, dayWindow);
  }, [checkIns, habits, filterHabitId, showMisses, dayWindow]);

  if (habits.length === 0) {
    return <p className="history-empty">Add habits to see your history.</p>;
  }

  return (
    <div className="history-container">
      <div className="history-controls">
        <label className="history-filter">
          <span>Habit:</span>
          <select
            value={filterHabitId}
            onChange={(e) => setFilterHabitId(e.target.value)}
          >
            <option value="">All habits</option>
            {habits.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <label className="history-toggle">
          <input
            type="checkbox"
            checked={showMisses}
            onChange={(e) => setShowMisses(e.target.checked)}
          />
          <span>Show misses</span>
        </label>
      </div>

      {grouped.length === 0 ? (
        <p className="history-empty">No history yet — start checking off habits.</p>
      ) : (
        <ol className="history-timeline">
          {grouped.map(([date, entries]) => {
            const completedCount = entries.filter((e) => e.completed).length;
            return (
              <li key={date} className="history-day">
                <header className="history-day-header">
                  <span className="history-day-label">{formatDayLabel(date, today)}</span>
                  <span className="history-day-date">{date}</span>
                  <span className="history-day-count">
                    {completedCount}/{entries.length} done
                  </span>
                </header>
                <ul className="history-day-entries">
                  {entries.map((e, idx) => (
                    <li
                      key={`${e.habitId}-${date}-${idx}`}
                      className={`history-entry ${e.completed ? 'done' : 'missed'}`}
                    >
                      <span
                        className="history-entry-dot"
                        style={{ backgroundColor: habitColorFor(habits, e.habitId) }}
                      />
                      <span className="history-entry-name">
                        {habitNameFor(habits, e.habitId)}
                      </span>
                      <span className="history-entry-status">
                        {e.completed ? '✓' : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}