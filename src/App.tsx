import { useState, useEffect, useMemo } from 'react';
import type { Habit, Note } from './types';
import {
  getHabits,
  getMonthCheckIns,
  getCheckInsForHabit,
  toggleCheckIn,
  subscribe,
  addHabit,
  updateHabit,
  archiveHabit,
  getNotes,
  addNote,
  deleteNote,
  exportAllData,
  getStorageStatus,
  undoLastToggle,
  redoLastUndo,
} from './store';
import './App.css';

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getDayLetter(day: number): string {
  const d = new Date(2025, 0, 5 + day); // Jan 5 2025 = Sunday
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return letters[d.getDay()];
}

function parseDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function App() {
  const now = new Date();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [newHabitName, setNewHabitName] = useState('');
  const [showNewHabitInput, setShowNewHabitInput] = useState(false);
  const [checkIns, setCheckIns] = useState<Map<string, Map<number, boolean>>>(new Map());
  const [darkMode, setDarkMode] = useState(() => {
    // Persist dark mode preference across sessions
    try {
      return localStorage.getItem('lifetrack-darkmode') === '1';
    } catch {
      return false;
    }
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [showNewNoteInput, setShowNewNoteInput] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingGoalValue, setEditingGoalValue] = useState('');
  const [view, setView] = useState<'grid' | 'stats'>('grid');
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('lifetrack-theme') || ''; } catch { return ''; }
  });

  // Apply theme class to <html> for CSS variable overrides
  useEffect(() => {
    const classes = ['theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono'];
    document.documentElement.classList.remove(...classes);
    if (theme) document.documentElement.classList.add(theme);
    try { localStorage.setItem('lifetrack-theme', theme); } catch { /* nop */ }
  }, [theme]);

  const themes = ['', 'theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono'];
  const themeLabels = ['Default', 'Ocean', 'Forest', 'Sunset', 'Rose', 'Mono'];
  function cycleTheme() {
    const idx = themes.indexOf(theme);
    setTheme(themes[(idx + 1) % themes.length]);
  }

  // Keyboard navigation state
  const [focusDay, setFocusDay] = useState(1);
  const [focusHabitIdx, setFocusHabitIdx] = useState(0);

  // Reset focus when month changes or habits change
  useEffect(() => {
    setFocusDay(1);
    setFocusHabitIdx(0);
  }, [year, month]);

  const daysInMonth = getDaysInMonth(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDay = today.getDate();

  // Global keyboard shortcuts (placed after daysInMonth is defined)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'z') {
        e.preventDefault();
        undoLastToggle();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoLastUndo();
        return;
      }

      if (view !== 'grid' || habits.length === 0) return;

      const habit = habits[Math.min(focusHabitIdx, habits.length - 1)];
      if (!habit) return;

      if (e.key === 'ArrowLeft') { e.preventDefault(); setFocusDay(Math.max(1, focusDay - 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setFocusDay(Math.min(daysInMonth, focusDay + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFocusHabitIdx(Math.max(0, focusHabitIdx - 1)); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusHabitIdx(Math.min(habits.length - 1, focusHabitIdx + 1)); }

      if (e.key === ' ') {
        e.preventDefault();
        const dateStr = parseDateStr(year, month, focusDay);
        toggleCheckIn(habit.id, dateStr);
      }

      if (e.key === 'n' && ctrl) {
        e.preventDefault();
        setShowNewHabitInput(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, habits, focusDay, focusHabitIdx, year, month, daysInMonth]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('lifetrack-darkmode', darkMode ? '1' : '0');
    } catch { /* non-critical */ }
  }, [darkMode]);

  useEffect(() => {
    function update() {
      const h = getHabits();
      setHabits(h);
      const ci = new Map<string, Map<number, boolean>>();
      for (const habit of h) {
        ci.set(habit.id, getMonthCheckIns(habit.id, year, month));
      }
      setCheckIns(ci);
      setNotes(getNotes());
    }
    update();
    return subscribe(update);
  }, [year, month]);

  function prevMonth() {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
  }

  function handleCellClick(habitId: string, day: number) {
    const dateStr = parseDateStr(year, month, day);
    toggleCheckIn(habitId, dateStr);
  }

  function handleAddHabit() {
    if (newHabitName.trim()) {
      addHabit(newHabitName.trim());
      setNewHabitName('');
      setShowNewHabitInput(false);
    }
  }

  function handleHabitNameSave(habitId: string, name: string) {
    if (name.trim()) {
      updateHabit(habitId, { name: name.trim() });
    }
    setEditingHabitId(null);
  }

  // Track new note content per keystroke, no intermediate state needed beyond newNoteContent
  function handleAddNote() {
    if (newNoteContent.trim()) {
      addNote(newNoteContent.trim());
      setNewNoteContent('');
      // Keep panel open so user can see the note they just added
    }
  }

  function handleDeleteNote(id: string) {
    deleteNote(id);
  }

  function handleGoalClick(habitId: string, currentGoal: number) {
    setEditingGoalId(habitId);
    setEditingGoalValue(String(currentGoal));
  }

  function handleGoalSave(habitId: string) {
    const parsed = parseInt(editingGoalValue, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      updateHabit(habitId, { goal: parsed });
    }
    setEditingGoalId(null);
    setEditingGoalValue('');
  }

  // Trigger a file download in the browser by creating a temporary anchor element.
  function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleExportJSON() {
    const allData = exportAllData();
    const json = JSON.stringify(allData, null, 2);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(json, `lifetrack-export-${stamp}.json`, 'application/json');
  }

  function handleExportCSV() {
    const allData = exportAllData();
    const habitMap = new Map(allData.habits.map((h) => [h.id, h.name]));

    // Build CSV: date, habit, completed
    const header = 'date,habit,completed';
    const rows = allData.checkIns.map((ci) => {
      const habitName = habitMap.get(ci.habitId) || ci.habitId;
      // Escape habit names containing commas or quotes
      const safeName = habitName.includes(',') || habitName.includes('"')
        ? `"${habitName.replace(/"/g, '""')}"`
        : habitName;
      return `${ci.date},${safeName},${ci.completed ? '1' : '0'}`;
    });

    const csv = [header, ...rows].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(csv, `lifetrack-export-${stamp}.csv`, 'text/csv;charset=utf-8');
  }

  // --- Streak & Statistics helpers ---

  // Build a sorted array of date strings (YYYY-MM-DD) for which a habit was checked.
  function getCheckedDates(habitId: string): string[] {
    const checks = getCheckInsForHabit(habitId).filter((c) => c.completed);
    const dates = checks.map((c) => c.date);
    dates.sort();
    return dates;
  }

  // Count consecutive days ending at endDate (inclusive), going backwards.
  // endDate is a Date object representing the last day to count from.
  function streakBackwards(dates: Set<string>, endDate: Date): number {
    let count = 0;
    const d = new Date(endDate);
    while (true) {
      const key = parseDateStr(d.getFullYear(), d.getMonth(), d.getDate());
      if (dates.has(key)) {
        count++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return count;
  }

  // Compute the longest streak from a sorted array of date strings.
  function longestStreak(dates: string[]): number {
    if (dates.length === 0) return 0;
    let max = 1;
    let current = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffMs = curr.getTime() - prev.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        current++;
        max = Math.max(max, current);
      } else {
        current = 1;
      }
    }
    return max;
  }

  // Compute stats for all habits: current streak, longest streak, completion rates, score.
  const habitStats = useMemo(() => {
    return habits.map((habit) => {
      const checked = getCheckedDates(habit.id);
      const dateSet = new Set(checked);
      const todayDate = new Date();
      const current = streakBackwards(dateSet, todayDate);
      const longest = longestStreak(checked);

      // Completion rates for different periods
      const now = new Date();
      const periods = [7, 30, 90, 365] as const;
      const rates: Record<number, number> = {};
      for (const days of periods) {
        let possible = 0;
        let done = 0;
        for (let i = 0; i < days; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const key = parseDateStr(d.getFullYear(), d.getMonth(), d.getDate());
          possible++;
          if (dateSet.has(key)) done++;
        }
        rates[days] = possible > 0 ? Math.round((done / possible) * 100) : 0;
      }

      // Weighted habit score (Loop-style exponential moving average).
      // Scores recent completions more heavily using a decay factor.
      // Window: 90 days. Frequency factor: 0.95 (today=1, yesterday=0.95, etc.).
      const SCORE_WINDOW = 90;
      const SCORE_FREQ = 0.95;
      let weightedSum = 0;
      let weightTotal = 0;
      for (let i = 0; i < SCORE_WINDOW; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = parseDateStr(d.getFullYear(), d.getMonth(), d.getDate());
        const weight = Math.pow(SCORE_FREQ, i);
        weightTotal += weight;
        if (dateSet.has(key)) {
          weightedSum += weight;
        }
      }
      const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 0;

      return {
        habitId: habit.id,
        habitName: habit.name,
        habitColor: habit.color,
        currentStreak: current,
        longestStreak: longest,
        totalChecks: checked.length,
        completion7d: rates[7],
        completion30d: rates[30],
        completion90d: rates[90],
        completion365d: rates[365],
        score,
      };
    });
  }, [habits]);

  // Days headers with letters
  const dayHeaders: { day: number; letter: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dayHeaders.push({ day: d, letter: getDayLetter(d) });
  }

  return (
    <div className="app">
      {/* Navbar — minimal */}
      <nav className="navbar">
        <span className="logo">
          <svg className="logo-icon" width="22" height="22" viewBox="0 0 64 64" fill="none">
            <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#logoGrad)"/>
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#a78bfa"/>
                <stop offset="100%" stopColor="#7c3aed"/>
              </linearGradient>
            </defs>
            <polyline points="18,33 27,42 46,22" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          LifeTrack
        </span>
        <div className="nav-actions">
          <button className="btn-icon" onClick={cycleTheme} title={`Theme: ${themeLabels[themes.indexOf(theme)]}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <div className="export-dropdown">
            <button className="btn-icon" title="Export data">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <div className="export-menu">
              <button className="export-item" onClick={handleExportJSON}>Export JSON</button>
              <button className="export-item" onClick={handleExportCSV}>Export CSV</button>
            </div>
          </div>
          <button className="btn-icon" onClick={() => setDarkMode(!darkMode)} title="Toggle dark mode">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* Toolbar: month selector + tabs */}
      <div className="toolbar">
        <div className="month-selector">
          <button className="month-arrow" onClick={prevMonth}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="month-label">{MONTH_NAMES[month]}, {year}</span>
          <button className="month-arrow" onClick={nextMonth}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div className="view-tabs">
          <button className={`view-tab ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')}>Grid</button>
          <button className={`view-tab ${view === 'stats' ? 'active' : ''}`} onClick={() => setView('stats')}>Statistics</button>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid-area">
          {habits.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No habits yet</p>
              <p className="empty-hint">Click the button below or press <kbd>Ctrl+N</kbd> to add your first habit.</p>
            </div>
          ) : (
          <div className="table-scroll">
            <table className="habit-grid">
              <thead>
                <tr>
                  <th className="col-habits">Habits</th>
                  {dayHeaders.map((h) => (
                    <th
                      key={h.day}
                      className={`col-day ${isCurrentMonth && h.day === todayDay ? 'today' : ''}`}
                    >
                      <span className="day-letter">{h.letter}</span>
                      <span className="day-number">{h.day}</span>
                    </th>
                  ))}
                  <th className="col-goal">Goal</th>
                  <th className="col-achieved">Achieved</th>
                </tr>
              </thead>
              <tbody>
                {habits.map((habit) => {
                  const habitChecks = checkIns.get(habit.id) || new Map();
                  let completedCount = 0;
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (habitChecks.get(d)) completedCount++;
                  }
                  const goal = habit.goal || daysInMonth;
                  const bgColor = habit.color;

                  return (
                    <tr key={habit.id}>
                      <td className="col-habits">
                        <div className="habit-row">
                          {editingHabitId === habit.id ? (
                            <input
                              className="habit-name-input"
                              defaultValue={habit.name}
                              autoFocus
                              onBlur={(e) => handleHabitNameSave(habit.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleHabitNameSave(habit.id, (e.target as HTMLInputElement).value);
                                if (e.key === 'Escape') setEditingHabitId(null);
                              }}
                            />
                          ) : (
                            <span
                              className="habit-name"
                              onClick={() => setEditingHabitId(habit.id)}
                              title="Click to rename"
                            >
                              {habit.name}
                            </span>
                          )}
                          <button
                            className="habit-archive"
                            onClick={() => archiveHabit(habit.id)}
                            title="Archive"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                      {dayHeaders.map((h, dayIdx) => {
                        const checked = habitChecks.get(h.day) || false;
                        const isToday = isCurrentMonth && h.day === todayDay;
                        const isFocused = focusDay === h.day && focusHabitIdx === dayIdx;
                        return (
                          <td
                            key={h.day}
                            className={`col-day ${isToday ? 'today' : ''} ${isFocused ? 'focused' : ''}`}
                            onClick={() => handleCellClick(habit.id, h.day)}
                          >
                            <div
                              className={`day-cell ${checked ? 'checked' : ''}`}
                              style={checked ? { backgroundColor: bgColor } : {}}
                            >
                              {checked && (
                                <svg className="check-icon" viewBox="0 0 24 24" width="12" height="12" fill="white">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="col-goal">
                        {editingGoalId === habit.id ? (
                          <input
                            className="goal-input"
                            type="number"
                            min="0"
                            value={editingGoalValue}
                            onChange={(e) => setEditingGoalValue(e.target.value)}
                            autoFocus
                            onBlur={() => handleGoalSave(habit.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleGoalSave(habit.id);
                              if (e.key === 'Escape') { setEditingGoalId(null); setEditingGoalValue(''); }
                            }}
                          />
                        ) : (
                          <span
                            className="goal-number"
                            onClick={() => handleGoalClick(habit.id, goal)}
                            title="Click to set goal"
                          >
                            {goal}
                          </span>
                        )}
                      </td>
                      <td className="col-achieved">
                        <span className="achieved-number">{completedCount}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      ) : (
        <>
          {/* Statistics View */}
          <div className="stats-container">
            {habits.length === 0 ? (
              <p className="stats-empty">Add habits to see statistics.</p>
            ) : (
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Habit</th>
                    <th>Score</th>
                    <th>Streak</th>
                    <th>Best</th>
                    <th>7d</th>
                    <th>30d</th>
                    <th>90d</th>
                    <th>365d</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {habitStats.map((stat) => (
                    <tr key={stat.habitId}>
                      <td className="stats-habit-name">
                        <span
                          className="stats-color-dot"
                          style={{ backgroundColor: stat.habitColor }}
                        />
                        {stat.habitName}
                      </td>
                      <td className="stats-number stats-score">
                        <span className="score-value">{stat.score}</span>
                      </td>
                      <td className="stats-number stats-streak">
                        {stat.currentStreak > 0 ? (
                          <span className="streak-badge">{stat.currentStreak}d</span>
                        ) : (
                          <span className="streak-zero">--</span>
                        )}
                      </td>
                      <td className="stats-number">{stat.longestStreak}d</td>
                      <td className="stats-number">{stat.completion7d}%</td>
                      <td className="stats-number">{stat.completion30d}%</td>
                      <td className="stats-number">{stat.completion90d}%</td>
                      <td className="stats-number">{stat.completion365d}%</td>
                      <td className="stats-number">{stat.totalChecks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Bottom bar: add habit + notes toggle */}
      <div className="bottom-bar">
        <div className="add-section">
          {showNewHabitInput ? (
            <div className="add-habit-form">
              <input
                className="new-habit-input"
                placeholder="Habit name..."
                value={newHabitName}
                onChange={(e) => setNewHabitName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddHabit();
                  if (e.key === 'Escape') { setShowNewHabitInput(false); setNewHabitName(''); }
                }}
              />
              <button className="btn btn-sm btn-primary" onClick={handleAddHabit}>Add</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setShowNewHabitInput(false); setNewHabitName(''); }}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={() => setShowNewHabitInput(true)}>
              + New Habit
            </button>
          )}
        </div>
        <div className="notes-toggle">
          <button
            className={`btn btn-ghost ${showNewNoteInput ? 'active' : ''}`}
            onClick={() => setShowNewNoteInput(!showNewNoteInput)}
            title="Toggle notes"
          >
            Notes
          </button>
          <span className={`storage-indicator storage-${getStorageStatus()}`} title={`Storage: ${getStorageStatus()}`}>
            <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
          </span>
        </div>
      </div>

      {/* Expandable notes panel */}
      {showNewNoteInput && (
        <div className="notes-panel">
          <div className="add-note-form">
            <textarea
              className="new-note-input"
              placeholder="Write a note..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              autoFocus
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) handleAddNote();
                if (e.key === 'Escape') { setShowNewNoteInput(false); setNewNoteContent(''); }
              }}
            />
            <button className="btn btn-sm btn-primary" onClick={handleAddNote}>Save</button>
          </div>
          {notes.length > 0 && (
            <ul className="notes-list">
              {notes.map((note) => (
                <li key={note.id} className="notes-item">
                  <span className="notes-content">{note.content}</span>
                  <span className="notes-date">
                    {new Date(note.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                  <button className="notes-delete" onClick={() => handleDeleteNote(note.id)} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}