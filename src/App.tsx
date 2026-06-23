import { useState, useEffect, useMemo } from 'react';
import type { Habit, Note } from './types';
import {
  getHabits,
  getMonthCheckIns,
  getCompletionForMonth,
  toggleCheckIn,
  subscribe,
  addHabit,
  updateHabit,
  archiveHabit,
  getNotes,
  addNote,
  deleteNote,
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

// Derive a darker shade from a pastel hex color for the progress bar fill.
// Reduces each RGB component by 25% while keeping the same hue.
function darkenHex(hex: string, factor: number = 0.65): string {
  const color = hex.replace('#', '');
  // Handle shorthand hex like #FFF
  const full = color.length === 3
    ? color[0] + color[0] + color[1] + color[1] + color[2] + color[2]
    : color;
  const r = Math.round(parseInt(full.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(full.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(full.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export default function App() {
  const now = new Date();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [newHabitName, setNewHabitName] = useState('');
  const [showNewHabitInput, setShowNewHabitInput] = useState(false);
  const [checkIns, setCheckIns] = useState<Map<string, Map<number, boolean>>>(new Map());
  const [darkMode, setDarkMode] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [showNewNoteInput, setShowNewNoteInput] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingGoalValue, setEditingGoalValue] = useState('');

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
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

  const daysInMonth = getDaysInMonth(year, month);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDay = today.getDate();

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
      setShowNewNoteInput(false);
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

  // Days headers with letters
  const dayHeaders: { day: number; letter: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dayHeaders.push({ day: d, letter: getDayLetter(d) });
  }

  return (
    <div className="app">
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-left">
          <span className="logo">LifeTrack</span>
          <span className="nav-link">How it works <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor"><path d="M1 1l4 4 4-4"/></svg></span>
        </div>
        <div className="nav-right">
          <button className="btn-upgrade">Upgrade to Premium</button>
          <button className="btn-icon" onClick={() => setDarkMode(!darkMode)} title="Toggle dark mode">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
            </svg>
          </button>
          <span className="user-email">Lemniscate_zero@proton.me <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor"><path d="M1 1l4 4 4-4"/></svg></span>
        </div>
      </nav>

      {/* Month Selector */}
      <div className="month-selector">
        <button className="month-arrow" onClick={prevMonth}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <span className="month-label">{MONTH_NAMES[month]}, {year}</span>
        <button className="month-arrow" onClick={nextMonth}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
        </button>
      </div>

      {/* Main Grid Table */}
      <div className="table-container">
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
              <th className="col-goal">Done / Goal</th>
              <th className="col-progress"></th>
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
              const progressPct = Math.min(Math.round((completedCount / Math.max(goal, 1)) * 100), 100);
              const bgColor = habit.color;

              return (
                <tr key={habit.id}>
                  <td className="col-habits">
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z"/>
                      </svg>
                    </button>
                  </td>
                  {dayHeaders.map((h) => {
                    const checked = habitChecks.get(h.day) || false;
                    const isToday = isCurrentMonth && h.day === todayDay;
                    return (
                      <td
                        key={h.day}
                        className={`col-day ${isToday ? 'today' : ''}`}
                        onClick={() => handleCellClick(habit.id, h.day)}
                      >
                        <div
                          className={`day-cell ${checked ? 'checked' : ''} ${isToday ? 'today' : ''}`}
                          style={checked ? { backgroundColor: bgColor } : {}}
                        >
                          {checked && (
                            <svg className="check-icon" viewBox="0 0 24 24" width="14" height="14" fill="white">
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
                        className="goal-clickable"
                        onClick={() => handleGoalClick(habit.id, goal)}
                        title="Click to set goal"
                      >
                        <span className="goal-done">{completedCount}</span>
                        <span className="goal-sep">/</span>
                        <span className="goal-total">{goal}</span>
                      </span>
                    )}
                  </td>
                  <td className="col-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${progressPct}%`, backgroundColor: darkenHex(habit.color) }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Habit Button */}
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
            <button className="btn btn-primary btn-sm" onClick={handleAddHabit}>Add</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowNewHabitInput(false); setNewHabitName(''); }}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-outline" onClick={() => setShowNewHabitInput(true)}>
            + New Habit
          </button>
        )}
      </div>

      {/* Notes Section */}
      <div className="notes-section">
        <div className="notes-header">
          <h3>Notes</h3>
          {!showNewNoteInput && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowNewNoteInput(true)}>
              + New Note
            </button>
          )}
        </div>
        {showNewNoteInput && (
          <div className="add-note-form">
            <textarea
              className="new-note-input"
              placeholder="Write your note..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              autoFocus
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) handleAddNote();
                if (e.key === 'Escape') { setShowNewNoteInput(false); setNewNoteContent(''); }
              }}
            />
            <div className="add-note-actions">
              <button className="btn btn-primary btn-sm" onClick={handleAddNote}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowNewNoteInput(false); setNewNoteContent(''); }}>Cancel</button>
            </div>
          </div>
        )}
        {notes.length === 0 && !showNewNoteInput ? (
          <p className="notes-empty">No notes yet. Click + New Note to create one.</p>
        ) : (
          <ul className="notes-list">
            {notes.map((note) => (
              <li key={note.id} className="notes-item">
                <p className="notes-content">{note.content}</p>
                <span className="notes-date">
                  {new Date(note.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <button
                  className="notes-delete"
                  onClick={() => handleDeleteNote(note.id)}
                  title="Delete note"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}