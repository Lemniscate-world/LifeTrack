import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Habit, Note, CheckIn } from './types';
import {
  getHabits,
  getMonthCheckIns,
  toggleCheckIn,
  subscribe,
  addHabit,
  updateHabit,
  archiveHabit,
  getNotes,
  addNote,
  deleteNote,
  exportAllData,
  flushSave,
  getStorageStatus,
  getLastSaved,
  undoLastToggle,
  redoLastUndo,
  mergeImportedData,
  reorderHabits,
  linkHabitToParent as linkHabitToParentStore,
  unlinkHabitFromParent as unlinkHabitFromParentStore,
} from './store';
import { computeStreakStats, computeCompletionRate, computeWeightedScore } from './stats';
import { Heatmap, Sparkline } from './Heatmap';
import { HistoryView } from './HistoryView';
import { StacksView } from './StacksView';
import { DraggableHabitRow } from './components/DraggableHabitRow';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import './App.css';
import ChaosView from './ChaosView';
import { generateInsights, type Recommendation, type RecKind } from './recommendations';

// Detected at module load (window is always present in browser and Tauri).
// In test environments this is false. Module-level constant is acceptable
// because window.__TAURI_INTERNALS__ is attached by Tauri before app code runs.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getDayLetter(year: number, month: number, day: number): string {
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return letters[new Date(year, month, day).getDay()];
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
  // Per-instance guard so React StrictMode's double-mount (or HMR remounts)
  // doesn't permanently disable auto-restore. Was a module-level `let` before,
  // which meant the second mount would skip restore even if the first did
  // nothing — latent bug fixed here.
  const autoRestoreCheckedRef = useRef(false);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [newHabitName, setNewHabitName] = useState('');
  const [showNewHabitInput, setShowNewHabitInput] = useState(false);
  // Per-habit chaos config (optional)
  const [newHabitChaosEnabled, setNewHabitChaosEnabled] = useState(false);
  const [newHabitChaosDimension, setNewHabitChaosDimension] = useState<string>('physical');
  const [newHabitChaosImpact, setNewHabitChaosImpact] = useState<number>(50);
  const [newHabitChaosThreshold, setNewHabitChaosThreshold] = useState<number>(2);
  const [checkIns, setCheckIns] = useState<Map<string, Map<number, boolean>>>(new Map());
  // All check-ins across all months/habits — needed by the Statistics view to
  // compute lifetime streaks (best, longest gap, etc.).
  const [allCheckIns, setAllCheckIns] = useState<CheckIn[]>([]);
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
  const [editingChaosHabitId, setEditingChaosHabitId] = useState<string | null>(null);
  const [editChaosDim, setEditChaosDim] = useState('physical');
  const [editChaosImpact, setEditChaosImpact] = useState(50);
  const [editChaosThreshold, setEditChaosThreshold] = useState(2);
  // Stack parent picker (which habit triggers this one)
  const [editingStackParentId, setEditingStackParentId] = useState<string | null>(null);
  // Intentions editor (why you do this habit)
  const [editingWhyHabitId, setEditingWhyHabitId] = useState<string | null>(null);
  const [editWhyText, setEditWhyText] = useState('');
  const [view, setView] = useState<'grid' | 'stats' | 'history' | 'stacks' | 'chaos' | 'insights'>('grid');
  const [savedMsg, setSavedMsg] = useState('');

  // Periodically refresh the "last saved" display
  useEffect(() => {
    const updateMsg = () => {
      const ts = getLastSaved();
      if (ts === 0) {
        setSavedMsg('Not saved yet');
      } else {
        setSavedMsg(`Saved ${Math.round((Date.now() - ts) / 1000)}s ago`);
      }
    };
    updateMsg();
    const id = setInterval(updateMsg, 5000);
    return () => clearInterval(id);
  }, []);

  // Auto-check for backup recovery on startup (desktop only, fresh install)
  useEffect(() => {
    if (!isTauri || autoRestoreCheckedRef.current) return;
    autoRestoreCheckedRef.current = true;

    const check = async () => {
      try {
        const existing = getHabits().filter(h => !h.archived);
        if (existing.length > 0) return; // Already has data, skip auto-restore

        const { invoke } = await import('@tauri-apps/api/core');
        const backup = await invoke<string | null>('find_latest_backup');
        if (!backup) return;

        const parsed = JSON.parse(backup);
        if (!parsed?.habits?.length) return;

        const ok = window.confirm(
          `A backup with ${parsed.habits.length} habits and ${parsed.checkIns?.length || 0} check-ins was found.\n\nRestore it now?`
        );
        if (!ok) return;

        const result = mergeImportedData(parsed);
        alert(`Restore successful: ${result.habitsCreated} habits added, ${result.checkInsRestored} check-ins restored.`);
      } catch (e) {
        console.error('auto-restore failed:', e);
      }
    };
    const t = setTimeout(check, 500);
    return () => clearTimeout(t);
  }, []);

  // Auto-backup to app data directory every 30 minutes (desktop only)
  useEffect(() => {
    if (!isTauri) return;

    const runBackup = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const allData = exportAllData();
        const path = await invoke<string>('auto_backup', { jsonData: JSON.stringify(allData, null, 2) });
        console.log('Auto-backup saved to', path);
      } catch (e) {
        console.error('auto_backup failed:', e);
      }
    };
    // Run once on mount, then every 30 min
    runBackup();
    const id = setInterval(runBackup, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('lifetrack-theme') || ''; } catch { return ''; }
  });

  // Apply theme class to <html> for CSS variable overrides
  useEffect(() => {
    const classes = ['theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald'];
    document.documentElement.classList.remove(...classes);
    if (theme) document.documentElement.classList.add(theme);
    try { localStorage.setItem('lifetrack-theme', theme); } catch { /* nop */ }
  }, [theme]);

  const themes = ['', 'theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald'];
  const themeLabels = ['Default', 'Ocean', 'Forest', 'Sunset', 'Rose', 'Mono', 'Midnight', 'Emerald'];
  function cycleTheme() {
    const idx = themes.indexOf(theme);
    setTheme(themes[(idx + 1) % themes.length]);
  }

  // Keyboard navigation state
  const [focusDay, setFocusDay] = useState(1);
  const [focusHabitIdx, setFocusHabitIdx] = useState(0);
  const [keyboardUsed, setKeyboardUsed] = useState(false);

  // Key that changes when month changes — used to reset focus via remount
  const gridKey = `${year}-${month}`;

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
      const key = e.key.toLowerCase();

      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLastToggle();
        return;
      }
      if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoLastUndo();
        return;
      }

      if (view !== 'grid' || habits.length === 0) return;

      const habit = habits[Math.min(focusHabitIdx, habits.length - 1)];
      if (!habit) return;

      if (e.key === 'ArrowLeft') { e.preventDefault(); setKeyboardUsed(true); setFocusDay(Math.max(1, focusDay - 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setKeyboardUsed(true); setFocusDay(Math.min(daysInMonth, focusDay + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setKeyboardUsed(true); setFocusHabitIdx(Math.max(0, focusHabitIdx - 1)); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setKeyboardUsed(true); setFocusHabitIdx(Math.min(habits.length - 1, focusHabitIdx + 1)); }

      if (e.key === ' ') {
        e.preventDefault();
        setKeyboardUsed(true);
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
      // Refresh the lifetime check-in cache so Stats view shows fresh records.
      setAllCheckIns(exportAllData().checkIns);
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
      const chaosOpts = newHabitChaosEnabled
        ? {
            chaosDimension: newHabitChaosDimension,
            chaosImpact: newHabitChaosImpact,
            chaosThresholdDays: newHabitChaosThreshold,
          }
        : undefined;
      addHabit(newHabitName.trim(), chaosOpts);
      resetNewHabitForm();
    }
  }

  function resetNewHabitForm() {
    setNewHabitName('');
    setNewHabitChaosEnabled(false);
    setNewHabitChaosDimension('physical');
    setNewHabitChaosImpact(50);
    setNewHabitChaosThreshold(2);
    setShowNewHabitInput(false);
  }

  function handleHabitNameSave(habitId: string, name: string) {
    if (name.trim()) {
      updateHabit(habitId, { name: name.trim() });
    }
    setEditingHabitId(null);
  }

  function openChaosEditor(habit: Habit) {
    setEditingChaosHabitId(habit.id);
    // Use ?? (nullish coalescing) to preserve empty string for "None"
    setEditChaosDim(habit.chaosDimension ?? 'physical');
    setEditChaosImpact(habit.chaosImpact ?? 50);
    setEditChaosThreshold(habit.chaosThresholdDays ?? 2);
  }

  function saveChaosEditor() {
    if (editingChaosHabitId) {
      if (editChaosDim === '' || editChaosDim === null) {
        // Fully unlink: clear all three chaos fields
        updateHabit(editingChaosHabitId, {
          chaosDimension: undefined,
          chaosImpact: undefined,
          chaosThresholdDays: undefined,
        });
      } else {
        updateHabit(editingChaosHabitId, {
          chaosDimension: editChaosDim,
          chaosImpact: editChaosImpact,
          chaosThresholdDays: editChaosThreshold,
        });
      }
      setEditingChaosHabitId(null);
    }
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
    // Try Tauri native save dialog first, fall back to browser download
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('export_file', { jsonData: json }).catch(() => {
        // Fallback: browser download
        downloadBlob(json, `lifetrack-export-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      })
    ).catch(() => {
      downloadBlob(json, `lifetrack-export-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    });
  }

  function handleExportCSV() {
    const allData = exportAllData();
    const habitById = new Map(allData.habits.map((h) => [h.id, h]));
    // Per-habit lifetime stats (using the same persistent records)
    const lifetimeStats = new Map<string, {
      current: number; best: number; rate30: number; total: number;
    }>();
    const allCheckIns = allData.checkIns;
    const now = new Date();
    for (const habit of allData.habits) {
      const stats = computeStreakStats(habit, allCheckIns, now);
      const rate30 = computeCompletionRate(habit, allCheckIns, 30, now);
      lifetimeStats.set(habit.id, {
        current: stats.current,
        best: stats.best,
        rate30,
        total: stats.totalCompleted,
      });
    }

    const quote = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

    const header = [
      'date',
      'habit',
      'habit_id',
      'completed',
      'current_streak_at_date',
      'best_streak_at_date',
      'completion_rate_30d',
      'total_completed',
      'chaos_dimension',
    ].join(',');

    const rows = allData.checkIns.map((ci) => {
      const habit = habitById.get(ci.habitId);
      const ls = lifetimeStats.get(ci.habitId);
      const cols = [
        quote(ci.date),
        quote(habit?.name ?? ci.habitId),
        quote(ci.habitId),
        ci.completed ? '1' : '0',
        ls ? String(ls.current) : '',
        ls ? String(ls.best) : '',
        ls ? String(ls.rate30) : '',
        ls ? String(ls.total) : '',
        quote(habit?.chaosDimension ?? ''),
      ];
      return cols.join(',');
    });
    const csv = [header, ...rows].join('\n');
    downloadBlob(csv, `lifetrack-export-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  }

  function performBrowserImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const raw = evt.target?.result as string;
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') {
            alert('Invalid file format.');
            return;
          }
          const result = mergeImportedData(parsed);
          alert(`Import successful: ${result.habitsCreated} habits added, ${result.checkInsRestored} check-ins restored.`);
        } catch {
          alert('Failed to parse the file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleImportJSON() {
    if (isTauri) {
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke<string>('import_file').then((raw) => {
          try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
              alert('Invalid file format.');
              return;
            }
            const result = mergeImportedData(parsed);
            alert(`Import successful: ${result.habitsCreated} habits added, ${result.checkInsRestored} check-ins restored.`);
          } catch {
            alert('Failed to parse the file.');
          }
        }).catch((e) => {
          if (e !== 'Cancelled') alert('Import failed: ' + e);
        })
      ).catch(() => {
        performBrowserImport();
      });
    } else {
      performBrowserImport();
    }
  }

  // --- Streak & Statistics helpers ---
//
// Stats are computed from the persistent, persisted `bestStreak` / `longestGap`
// fields on each Habit (kept up-to-date by store.recalculateHabitRecords()).
// That avoids re-scanning every check-in on every render. We still call
// computeStreakStats() to derive the rolling-window rates (7d / 30d / …)
// and the weighted score.

  // Compute stats for all habits: current/best streak, longest gap, completion
  // rates for 7/30/90/365-day windows, and a weighted score.
  const habitStats = useMemo(() => {
    const now = new Date();
    return habits.map((habit) => {
      // Prefer the persisted record (kept in sync by store) to stay consistent
      // with what gets shown after a reload. Fall back to a live compute when
      // the record hasn't been written yet (shouldn't happen in practice).
      const stats = computeStreakStats(habit, allCheckIns, now);
      const current = stats.current;
      const longest = stats.best;
      const longestGap = stats.longestGap;
      const totalChecks = stats.totalCompleted;

      const completion7d = computeCompletionRate(habit, allCheckIns, 7, now);
      const completion30d = computeCompletionRate(habit, allCheckIns, 30, now);
      const completion90d = computeCompletionRate(habit, allCheckIns, 90, now);
      const completion365d = computeCompletionRate(habit, allCheckIns, 365, now);
      const score = computeWeightedScore(habit, allCheckIns, now);

      return {
        habitId: habit.id,
        habitName: habit.name,
        habitColor: habit.color,
        currentStreak: current,
        longestStreak: longest,
        longestGap,
        totalChecks,
        completion7d,
        completion30d,
        completion90d,
        completion365d,
        score,
      };
    });
  }, [habits, allCheckIns]);

  // --- Drag and drop (habit reordering) ---
  // We pass DropResult through @hello-pangea/dnd's onDragEnd. If the user drops
  // outside any droppable (e.g. dragging onto the bottom-bar), destination is
  // null — we ignore that.
  function handleDragEnd(result: { source: { index: number }; destination?: { index: number } | null }) {
    if (!result.destination) return;
    reorderHabits(result.source.index, result.destination.index);
  }

  // Days headers with letters
  const dayHeaders: { day: number; letter: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dayHeaders.push({ day: d, letter: getDayLetter(year, month, d) });
  }

  return (
    <div className="app">
      {/* Navbar — minimal */}
      <nav className="navbar">
        <span className="logo">
          <svg className="logo-icon" width="26" height="26" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Rounded square background */}
            <rect x="2" y="2" width="44" height="44" rx="11" fill="url(#logoGrad)" />
            {/* Rising streak line — represents progress, habit building */}
            <path
              d="M10 34 L16 28 L20 30 L26 20 L30 22 L36 12"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity="0.7"
            />
            {/* Checkmark — represents completion */}
            <polyline
              points="12,24 18,30 28,18"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <defs>
              <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#6d28d9" />
              </linearGradient>
            </defs>
          </svg>
          <span className="logo-text">
            <span className="logo-life">Life</span><span className="logo-track">Track</span>
          </span>
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
              <div className="export-sep"></div>
              <button className="export-item" onClick={handleImportJSON}>Import JSON</button>
              <button className="export-item" onClick={() => {
                import('@tauri-apps/api/core').then(({ invoke }) =>
                  invoke<string | null>('find_latest_backup').then((backup) => {
                    if (!backup) { alert('No backup found.'); return; }
                    const parsed = JSON.parse(backup);
                    const habitCount = parsed?.habits?.length || 0;
                    const checkinCount = parsed?.checkIns?.length || 0;
                    if (!habitCount) { alert('Backup is empty.'); return; }
                    if (!window.confirm(`Restore ${habitCount} habits + ${checkinCount} check-ins from backup?\n\nExisting habits with the same name will be merged, not duplicated.`)) return;
                    const result = mergeImportedData(parsed);
                    alert(`Restore successful: ${result.habitsCreated} habits added, ${result.checkInsRestored} check-ins restored.`);
                  }).catch((e) => alert('Restore failed: ' + e))
                ).catch((e) => alert('Restore failed: ' + e));
              }}>Restore from Backup</button>
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
          <button className={`view-tab ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>History</button>
          <button className={`view-tab ${view === 'stacks' ? 'active' : ''}`} onClick={() => setView('stacks')}>Stacks</button>
          <button className={`view-tab ${view === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')}>💡 Insights</button>
          <button className={`view-tab ${view === 'chaos' ? 'active' : ''}`} onClick={() => setView('chaos')}>Chaos</button>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid-area" key={gridKey} onClick={() => setKeyboardUsed(false)}>
          {habits.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No habits yet</p>
              <p className="empty-hint">Click the button below or press <kbd>Ctrl+N</kbd> to add your first habit.</p>
            </div>
          ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
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
              <Droppable droppableId="habit-list">
                {(dropProvided) => (
                  <tbody
                    ref={dropProvided.innerRef}
                    {...dropProvided.droppableProps}
                  >
                    {habits.map((habit, habitIdx) => {
                      const habitChecks = checkIns.get(habit.id) || new Map();
                  let completedCount = 0;
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (habitChecks.get(d)) completedCount++;
                  }
                  const goal = habit.goal || daysInMonth;

                  return (
                    <DraggableHabitRow habitId={habit.id} index={habitIdx}>
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
                          {habit.stackParent && (() => {
                            const parent = habits.find((h) => h.id === habit.stackParent);
                            return parent ? (
                              <span
                                className="habit-stack-badge"
                                title={`Triggered by: ${parent.name}`}
                                onClick={() => setFocusHabitIdx(habits.findIndex((h) => h.id === parent.id))}
                              >
                                ↳ {parent.name}
                              </span>
                            ) : null;
                          })()}
                          <button
                            className="habit-archive"
                            onClick={() => archiveHabit(habit.id)}
                            title="Archive"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                          </button>
                          <button
                            className={`habit-chaos-btn ${habit.chaosDimension ? 'linked' : ''}`}
                            onClick={() => openChaosEditor(habit)}
                            title={habit.chaosDimension ? `Chaos: ${habit.chaosDimension} +${habit.chaosImpact}%` : 'Link to chaos'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                            </svg>
                          </button>
                          <button
                            className={`habit-stack-btn ${habit.stackParent ? 'linked' : ''}`}
                            onClick={() => setEditingStackParentId(editingStackParentId === habit.id ? null : habit.id)}
                            title={habit.stackParent ? `After: ${habits.find((h) => h.id === habit.stackParent)?.name ?? '?'}` : 'Add to a stack (after another habit)'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                          </button>
                          <button
                            className={`habit-why-btn ${(habit.why?.length ?? 0) > 0 ? 'has-intentions' : ''}`}
                            onClick={() => {
                              setEditingWhyHabitId(editingWhyHabitId === habit.id ? null : habit.id);
                              setEditWhyText('');
                            }}
                            title={(habit.why?.length ?? 0) > 0 ? `${habit.why!.length} intention(s)` : 'Add intentions (why?)'}
                          >
                            💭
                          </button>
                        </div>
                        {editingWhyHabitId === habit.id && (
                          <div className="habit-why-edit">
                            <div className="why-header">Why do you do "{habit.name}"?</div>
                            {(habit.why ?? []).map((w, i) => (
                              <div key={i} className="why-row">
                                <span className="why-text">{w}</span>
                                <button
                                  className="why-remove"
                                  onClick={() => {
                                    const updated = (habit.why ?? []).filter((_, j) => j !== i);
                                    updateHabit(habit.id, { why: updated.length > 0 ? updated : undefined });
                                  }}
                                  title="Remove"
                                >×</button>
                              </div>
                            ))}
                            {(habit.why?.length ?? 0) < 5 && (
                              <div className="why-add-row">
                                <input
                                  className="why-input"
                                  placeholder="e.g. To feel energized..."
                                  value={editWhyText}
                                  onChange={(e) => setEditWhyText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && editWhyText.trim()) {
                                      const current = habit.why ?? [];
                                      updateHabit(habit.id, { why: [...current, editWhyText.trim()] });
                                      setEditWhyText('');
                                    }
                                    if (e.key === 'Escape') setEditingWhyHabitId(null);
                                  }}
                                />
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => {
                                    if (editWhyText.trim()) {
                                      const current = habit.why ?? [];
                                      updateHabit(habit.id, { why: [...current, editWhyText.trim()] });
                                      setEditWhyText('');
                                    }
                                  }}
                                >Add</button>
                              </div>
                            )}
                            <button className="why-close" onClick={() => setEditingWhyHabitId(null)}>Done</button>
                          </div>
                        )}
                        {editingChaosHabitId === habit.id && (
                          <div className="habit-chaos-edit">
                            <select value={editChaosDim} onChange={(e) => setEditChaosDim(e.target.value)} className="chaos-select-sm">
                              <option value="">— None (unlink) —</option>
                              <option value="physical">Physical</option>
                              <option value="financial">Financial</option>
                              <option value="social">Social</option>
                              <option value="structural">Structural</option>
                              <option value="spiritual">Spiritual</option>
                            </select>
                            <input type="number" min="1" max="100" value={Number.isFinite(editChaosImpact) ? editChaosImpact : ''} onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') { setEditChaosImpact(NaN); return; }
                              setEditChaosImpact(parseInt(raw, 10));
                            }} className="chaos-input-sm" title="Impact %" />
                            <span className="chaos-edit-label">if missed ≥</span>
                            <input type="number" min="1" max="90" value={Number.isFinite(editChaosThreshold) ? editChaosThreshold : ''} onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') { setEditChaosThreshold(NaN); return; }
                              setEditChaosThreshold(parseInt(raw, 10));
                            }} className="chaos-input-sm" title="Days" />
                            <span className="chaos-edit-label">days</span>
                            <button className="btn btn-sm btn-primary" onClick={saveChaosEditor}>OK</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => setEditingChaosHabitId(null)}>Cancel</button>
                          </div>
                        )}
                        {editingStackParentId === habit.id && (
                          <div className="habit-stack-edit">
                            <span className="stack-edit-label">Triggered by:</span>
                            <select
                              className="stack-select-sm"
                              value={habit.stackParent ?? ''}
                              onChange={(e) => {
                                const newParent = e.target.value;
                                if (newParent === '') {
                                  unlinkHabitFromParentStore(habit.id);
                                } else {
                                  linkHabitToParentStore(habit.id, newParent);
                                }
                              }}
                            >
                              <option value="">— None (remove from stack) —</option>
                              {habits
                                .filter((h) => h.id !== habit.id && !h.archived)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((h) => (
                                  <option key={h.id} value={h.id}>{h.name}</option>
                                ))}
                            </select>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setEditingStackParentId(null)}
                            >
                              Done
                            </button>
                          </div>
                        )}
                      </td>
                      {dayHeaders.map((h) => {
                        const checked = habitChecks.get(h.day) || false;
                        const isToday = isCurrentMonth && h.day === todayDay;
                        const isFocused = keyboardUsed && focusDay === h.day && focusHabitIdx === habitIdx;
                        return (
                          <td
                            key={h.day}
                            className={`col-day ${isToday ? 'today' : ''} ${isFocused ? 'focused' : ''}`}
                            onClick={() => handleCellClick(habit.id, h.day)}
                          >
                            <div
                              className={`day-cell ${checked ? 'checked' : ''}`}
                            >
                              {checked && (
                                <svg className="check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="5,13 10,18 19,7"/>
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
                    </DraggableHabitRow>
                  );
                })}
                    {dropProvided.placeholder}
                  </tbody>
                )}
              </Droppable>
            </table>
          </div>
          </DragDropContext>
          )}
        </div>
      ) : view === 'stats' ? (
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
                    <th>Current</th>
                    <th>Best</th>
                    <th>Gap</th>
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
                      <td className="stats-number">
                        {stat.longestStreak}d
                        {stat.longestStreak > 0 && (
                          <span className="stats-best-tag" title="All-time best">★</span>
                        )}
                      </td>
                      <td className="stats-number stats-gap">
                        {stat.longestGap > 0 ? `${stat.longestGap}d` : '—'}
                      </td>
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

            {/* Per-habit heatmaps + sparklines for visual context */}
            {habits.length > 0 && (
              <div className="stats-heatmaps">
                <h3 className="stats-section-title">Activity (last 365 days)</h3>
                <p className="stats-section-hint">
                  Pastel cells = completed days. Grey outline = explicit miss. Pale = before tracking started.
                </p>
                {habits.map((habit) => (
                  <div key={habit.id} className="stats-heatmap-row">
                    <div className="stats-heatmap-label">
                      <span
                        className="stats-color-dot"
                        style={{ backgroundColor: habit.color }}
                      />
                      <span className="stats-heatmap-name">{habit.name}</span>
                    </div>
                    <div className="stats-heatmap-and-spark">
                      <Heatmap habit={habit} checkIns={allCheckIns} />
                      <Sparkline habit={habit} checkIns={allCheckIns} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : view === 'history' ? (
        <HistoryView checkIns={allCheckIns} habits={habits} />
      ) : view === 'stacks' ? (
        <StacksView checkIns={allCheckIns} habits={habits} />
      ) : view === 'insights' ? (
        <InsightsView habits={habits} checkIns={allCheckIns} onLink={(childId, parentId) => {
          if (parentId) linkHabitToParentStore(childId, parentId);
          else void unlinkHabitFromParentStore(childId);
        }} onView={(newView) => setView(newView)} />
      ) : (
        <ChaosView />
      )}

      {/* Bottom bar: add habit + notes toggle */}
      <div className="bottom-bar">
        <div className="add-section">
          {showNewHabitInput ? (
            <div className="add-habit-form-wrap">
            <div className="add-habit-form">
              <input
                className="new-habit-input"
                placeholder="Habit name..."
                value={newHabitName}
                onChange={(e) => setNewHabitName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddHabit();
                  if (e.key === 'Escape') { resetNewHabitForm(); }
                }}
              />
              <button className="btn btn-sm btn-primary" onClick={handleAddHabit}>Add</button>
              <button className="btn btn-sm btn-ghost" onClick={resetNewHabitForm}>Cancel</button>
            </div>
            <div className="new-habit-chaos">
              <label className="chaos-toggle">
                <input
                  type="checkbox"
                  checked={newHabitChaosEnabled}
                  onChange={(e) => setNewHabitChaosEnabled(e.target.checked)}
                />
                <span>Link to chaos dimension</span>
              </label>
              {newHabitChaosEnabled && (
                <div className="chaos-config">
                  <select
                    className="chaos-select"
                    value={newHabitChaosDimension}
                    onChange={(e) => setNewHabitChaosDimension(e.target.value)}
                  >
                    <option value="physical">Physical</option>
                    <option value="financial">Financial</option>
                    <option value="social">Social</option>
                    <option value="structural">Structural</option>
                    <option value="spiritual">Spiritual</option>
                  </select>
                  <label className="chaos-field">
                    Impact %
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={newHabitChaosImpact}
                      onChange={(e) => setNewHabitChaosImpact(Math.max(1, Math.min(100, parseInt(e.target.value || '1', 10))))}
                    />
                  </label>
                  <label className="chaos-field">
                    Missed ≥ days
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={newHabitChaosThreshold}
                      onChange={(e) => setNewHabitChaosThreshold(Math.max(1, Math.min(90, parseInt(e.target.value || '1', 10))))}
                    />
                  </label>
                  <span className="chaos-hint">
                    Missing this habit for {newHabitChaosThreshold} day{newHabitChaosThreshold > 1 ? 's' : ''} adds +{newHabitChaosImpact}% to {newHabitChaosDimension}.
                  </span>
                </div>
              )}
            </div>
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
          <span
            className="saved-info"
            title="Click to save now"
            onClick={() => { flushSave(); }}
          >
            {savedMsg || 'Not saved yet'}
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

// --- Insights View (inline component) ---
function InsightsView({
  habits,
  checkIns,
  onLink,
  onView,
}: {
  habits: Habit[];
  checkIns: CheckIn[];
  // eslint-disable-next-line no-unused-vars
  onLink: (childId: string, parentId: string | null) => void;
  // eslint-disable-next-line no-unused-vars
  onView: (_v: 'grid' | 'stats' | 'history' | 'stacks' | 'chaos' | 'insights') => void;
}) {
  const { recommendations } = useMemo(
    () => generateInsights(habits, checkIns),
    // Recompute when checkIns length changes (new check-in), or habits change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habits, checkIns.length],
  );

  const habitById = useMemo(() => {
    const m = new Map<string, Habit>();
    for (const h of habits) m.set(h.id, h);
    return m;
  }, [habits]);

  // --- Ollama Deep Analysis state ---
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleDeepAnalysis = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    setAiResponse(null);
    try {
      const summary = habits
        .filter((h) => !h.archived)
        .map((h) => {
          const completed = checkIns.filter((ci) => ci.habitId === h.id && ci.completed).length;
          const total = checkIns.filter((ci) => ci.habitId === h.id).length;
          const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
          const best = h.bestStreak ?? 0;
          const stacked = h.stackParent
            ? `after: ${habits.find((p) => p.id === h.stackParent)?.name ?? '?'}`
            : 'none';
          return `${h.name}: ${completed}/${total} done (${rate}%), best streak ${best}, stack ${stacked}`;
        })
        .join('\n');
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setAiResponse('🤖 Deep Analysis requires the desktop app (Tauri). Ollama is not available in the browser.');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const response = await invoke<string>('analyze_habits', {
        summaryJson: summary,
        model: null,
      });
      setAiResponse(response);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  }, [habits, checkIns]);

  const kindIcon: Record<RecKind, string> = {
    MISS_PATTERN: '📉',
    STACK_SUGGESTION: '🔗',
    RECORD_APPROACH: '🔥',
    CHAOS_CORRELATION: '🌀',
    NEGLECTED: '⏰',
    RECOVERY_PATTERN: '🔄',
    PRIME_TIME: '⭐',
    CORRELATION: '🤝',
    TREND: '📊',
    WEEKLY_SUMMARY: '📋',
  };

  // eslint-disable-next-line no-unused-vars
  const kindAction: Record<RecKind, (r: Recommendation) => void> = {
    MISS_PATTERN: () => onView('history'),
    STACK_SUGGESTION: (rec) => {
      if (rec.habitIds.length >= 2) onLink(rec.habitIds[0], rec.habitIds[1]);
    },
    RECORD_APPROACH: () => onView('stats'),
    CHAOS_CORRELATION: () => onView('chaos'),
    NEGLECTED: () => onView('grid'),
    RECOVERY_PATTERN: () => onView('history'),
    PRIME_TIME: () => onView('stats'),
    CORRELATION: (rec) => {
      if (rec.habitIds.length >= 2) onLink(rec.habitIds[0], rec.habitIds[1]);
    },
    TREND: () => onView('history'),
    WEEKLY_SUMMARY: () => onView('history'),
  };

  if (recommendations.length === 0) {
    return (
      <div className="insights-view">
        <div className="insights-empty">
          <span style={{ fontSize: 40, display: 'block', marginBottom: 16 }}>💡</span>
          <h3>Not enough data yet</h3>
          <p>
            Track your habits consistently for a week, and I'll start surfacing
            personalized insights — no cloud, no AI API, all local.
          </p>
          <button className="btn btn-primary" onClick={() => onView('grid')}>
            Go to Grid
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="insights-view">
      <div className="insights-header">
        <h2>💡 Insights</h2>
        <span className="insights-subtitle">
          {recommendations.length} recommendation{recommendations.length > 1 ? 's' : ''} — 100% local
        </span>
        <button
          className="btn btn-sm btn-ghost ai-analyze-btn"
          onClick={handleDeepAnalysis}
          disabled={aiLoading}
          title="Run local AI analysis via Ollama"
        >
          {aiLoading ? '⏳ Analyzing...' : '🤖 Deep Analysis'}
        </button>
      </div>

      {aiError && <div className="ai-error">{aiError}</div>}

      {aiResponse && (
        <div className="ai-response-card">
          <div className="ai-response-header">🤖 AI Analysis <span className="ai-badge">Ollama</span></div>
          <div className="ai-response-body">{aiResponse}</div>
        </div>
      )}

      <div className="insights-list">
        {recommendations.map((rec, i) => {
          const habitNames = rec.habitIds
            .map((id) => habitById.get(id)?.name ?? id)
            .join(' → ');
          return (
            <div key={i} className={`insight-card insight-${rec.kind.toLowerCase()}`}>
              <div className="insight-icon">{kindIcon[rec.kind]}</div>
              <div className="insight-body">
                <div className="insight-title">{rec.title}</div>
                <div className="insight-detail">{rec.detail}</div>
                <div className="insight-meta">
                  <span
                    className="insight-strength"
                    style={{ '--pct': `${rec.strength}%` } as Record<string, string>}
                  >
                    Relevance {rec.strength}%
                  </span>
                  <span className="insight-habits">{habitNames}</span>
                </div>
              </div>
              {rec.actionLabel && (
                <button
                  className="btn btn-sm btn-primary insight-action"
                  onClick={() => kindAction[rec.kind](rec)}
                >
                  {rec.actionLabel}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}