import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Habit, Note, CheckIn, Mantra } from './types';
import {
  getHabits,
  getMonthCheckIns,
  toggleCheckIn,
  incrementCheckInCount,
  getCheckInCount,
  resetCheckInCount,
  decrementCheckInCount,
  getCheckInNotes,
  addCheckInNote,
  removeCheckInNote,
  getMonthCheckInNotes,
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
  getMantras,
  getMantraSettings,
  updateMantraSettings,
  restoreFromBackupIfNewer,
  diagnoseStorage,
  createUpgradeBackup,
  pruneOldBackups,
  MOODS,
  setMood,
  getMood,
  getMonthMoods,
  getPreferences,
  updatePreferences,
} from './store';
import { computeStreakStats, computeCompletionRate, computeWeightedScore, trackingStart } from './stats';
import { Heatmap, Sparkline } from './Heatmap';
import { HistoryView } from './HistoryView';
import { StacksView } from './StacksView';
import SkillsView from './SkillsView';
import { DraggableHabitRow } from './components/DraggableHabitRow';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import './App.css';
import ChaosView from './ChaosView';
import MantraView from './MantraView';
import SettingsView from './SettingsView';
import TodayView from './TodayView';
import ShortcutsHelp from './ShortcutsHelp';
import YearView from './YearView';
import ChallengeView from './ChallengeView';
import ExperimentsView from './ExperimentsView';
import UrgeSurfingView from './UrgeSurfingView';
import OnboardingHelp from './OnboardingHelp';
// (Mood view removed — emotional state is tracked via the 'emotional' chaos dimension.)
import { generateInsights, type Recommendation, type RecKind } from './recommendations';
import { computeCorrelations } from './correlations';
import { getDailyEntryMantra, todayStr, shouldShowMantraNotification, markMantraNotificationShown, MANTRA_DOMAINS, sendSystemNotification } from './mantras';

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

// --- Habit Categories ---
const DEFAULT_CATEGORIES = [
  { id: 'health', name: 'Health', color: '#10b981', emoji: '💪' },
  { id: 'work', name: 'Work', color: '#6366f1', emoji: '💼' },
  { id: 'personal', name: 'Personal', color: '#f59e0b', emoji: '🌟' },
  { id: 'learning', name: 'Learning', color: '#8b5cf6', emoji: '📚' },
  { id: 'mindfulness', name: 'Mindfulness', color: '#ec4899', emoji: '🧘' },
  { id: 'finance', name: 'Finance', color: '#14b8a6', emoji: '💰' },
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
    // v0.3.2: Read from preferences (survives reinstall), fall back to legacy localStorage
    const prefs = getPreferences();
    if (prefs.darkMode) return true;
    try { return localStorage.getItem('lifetrack-darkmode') === '1'; } catch { return false; }
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [showNewNoteInput, setShowNewNoteInput] = useState(false);
  // Per-day check-in note popup
  const [notePopup, setNotePopup] = useState<{ habitId: string; date: string; habitName: string; notes: string[] } | null>(null);
  const [notePopupText, setNotePopupText] = useState('');
  // Map of dateKey -> note for the currently hovered/visible habit (lazy loaded)
  const [checkInNotes, setCheckInNotes] = useState<Map<string, string[]>>(new Map());
  // Monthly moods
  const [monthMoods, setMonthMoods] = useState<Map<number, string>>(new Map());
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
  const [view, setView] = useState<'today' | 'grid' | 'stats' | 'history' | 'year' | 'challenge' | 'stacks' | 'skills' | 'chaos' | 'insights' | 'experiments' | 'urges' | 'mantras' | 'settings'>('grid');
  const [savedMsg, setSavedMsg] = useState('');
  // Shortcuts help + toast
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // --- Mantra state ---
  const [showMantraBanner, setShowMantraBanner] = useState(false);
  const [dailyEntryMantra, setDailyEntryMantra] = useState<Mantra | null>(null);
  const mantraBannerShownRef = useRef(false);

  // --- Startup: diagnose storage + auto-restore from backup if needed ---
  useEffect(() => {
    diagnoseStorage();
    const restored = restoreFromBackupIfNewer();
    if (restored) {
      console.log('✅ Auto-restored data from backup');
    }
    // Create a pre-upgrade safety snapshot once per day (survives code updates).
    // Check for ANY backup with today's date prefix (keys include HH-MM suffix).
    const todayPrefix = `lifetrack-upgrade-backup-${new Date().toISOString().slice(0, 10)}`;
    const todayExists = typeof localStorage !== 'undefined'
      && (() => { for (let i = 0; i < localStorage.length; i++) { if (localStorage.key(i)?.startsWith(todayPrefix)) return true; } return false; })();
    if (!todayExists) {
      const backupKey = createUpgradeBackup();
      if (backupKey) {
        console.log(`🔒 Daily safety backup: ${backupKey}`);
        pruneOldBackups(7); // keep rolling 7-day window
      }
    }
  }, []);

  // Show daily mantra banner on entry (once per session / once per day)
  useEffect(() => {
    const t = setTimeout(() => {
      if (mantraBannerShownRef.current) return;

      const settings = getMantraSettings();
      if (settings.showOnEntry) {
        const today = todayStr();
        if (settings.lastEntryDate !== today) {
          const allMantras = getMantras();
          const entryMantra = getDailyEntryMantra(allMantras);
          if (entryMantra) {
            mantraBannerShownRef.current = true;
            setDailyEntryMantra(entryMantra);
            setShowMantraBanner(true);
            updateMantraSettings({ lastEntryDate: today });
          }
        }
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);

  // Periodic check for morning/evening notification times (every 30s)
  useEffect(() => {
    const checkNotifications = () => {
      const settings = getMantraSettings();
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Morning notification (independent from entry banner)
      if (shouldShowMantraNotification(settings, 'morning') && currentTime >= settings.morningTime) {
        const updated = markMantraNotificationShown(settings, 'morning');
        updateMantraSettings({ lastMorningDate: updated.lastMorningDate });
        const allMantras = getMantras();
        const entryMantra = getDailyEntryMantra(allMantras);
        if (entryMantra) {
          setDailyEntryMantra(entryMantra);
          setShowMantraBanner(true);
          // Also try system notification
          sendSystemNotification(
            `🌅 Morning Mantra — ${MANTRA_DOMAINS.find((d) => d.id === entryMantra.domain)?.name ?? ''}`,
            entryMantra.text,
          );
        }
      }

      // Evening notification
      if (shouldShowMantraNotification(settings, 'evening') && currentTime >= settings.eveningTime) {
        const updated = markMantraNotificationShown(settings, 'evening');
        updateMantraSettings({ lastEveningDate: updated.lastEveningDate });
        const allMantras = getMantras();
        const entryMantra = getDailyEntryMantra(allMantras);
        if (entryMantra) {
          setDailyEntryMantra(entryMantra);
          setShowMantraBanner(true);
          // Also try system notification
          sendSystemNotification(
            `🌙 Evening Mantra — ${MANTRA_DOMAINS.find((d) => d.id === entryMantra.domain)?.name ?? ''}`,
            entryMantra.text,
          );
        }
      }
    };

    // Check every 30 seconds
    checkNotifications();
    const interval = setInterval(checkNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

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

        // Auto-restore silently — no prompt. User opted in via "I want them at reinstall".
        const result = mergeImportedData(parsed);
        console.info(
          `[LifeTrack] Auto-restored from backup: ${result.habitsCreated} habits, ${result.checkInsRestored} check-ins, ${result.notesCreated} notes.`
        );
        if (result.habitsCreated > 0 || result.checkInsRestored > 0) {
          alert(
            `Backup restored automatically:\n` +
            `• ${result.habitsCreated} habits added\n` +
            `• ${result.checkInsRestored} check-ins restored\n` +
            `• ${result.notesCreated} notes restored`
          );
        }
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
        console.debug('Auto-backup saved to', path);
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
    const prefs = getPreferences();
    if (prefs.theme) return prefs.theme;
    try { return localStorage.getItem('lifetrack-theme') || ''; } catch { return ''; }
  });

  // Apply theme class to <html> for CSS variable overrides
  useEffect(() => {
    const classes = ['theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald'];
    document.documentElement.classList.remove(...classes);
    if (theme) document.documentElement.classList.add(theme);
    updatePreferences({ theme });
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
        const entry = undoLastToggle();
        if (entry) showToast(`↩ Undo: ${entry.previousState ? 'restored' : 'removed'} check-in`);
        return;
      }
      if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const entry = redoLastUndo();
        if (entry) showToast(`↪ Redo: ${entry.previousState ? 'restored' : 'removed'} check-in`);
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
        if (habit.multiClick === false) {
          toggleCheckIn(habit.id, dateStr);
        } else if (e.ctrlKey || e.metaKey) {
          resetCheckInCount(habit.id, dateStr);
        } else if (e.shiftKey) {
          decrementCheckInCount(habit.id, dateStr);
        } else {
          incrementCheckInCount(habit.id, dateStr);
        }
      }

      if (e.key === 'n' && ctrl) {
        e.preventDefault();
        setShowNewHabitInput(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, habits, focusDay, focusHabitIdx, year, month, daysInMonth]);

  // Global keyboard shortcuts (tab switching, save) — active in all views
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      // Tab switching: Ctrl+1..9 + Ctrl+0
      if (ctrl && e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        const tabs: string[] = ['settings', 'today', 'grid', 'stats', 'history', 'year', 'stacks', 'skills', 'insights', 'chaos', 'mantras', 'experiments'];
        const idx = e.key === '0' ? 0 : parseInt(e.key, 10);
        const viewKey = tabs[idx] as typeof view;
        if (viewKey) setView(viewKey);
      }
      // Ctrl+S: save indicator (already auto-saved, but gives user confidence)
      if (ctrl && e.key === 's') {
        e.preventDefault();
        flushSave();
        setSavedMsg('Saved just now');
      }
      // ?: Show shortcuts help
      if (e.key === '?' && !ctrl && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowShortcuts(prev => !prev);
        }
      }
    }
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Persist to BOTH preferences (survives reinstall) and legacy localStorage
    updatePreferences({ darkMode });
    try { localStorage.setItem('lifetrack-darkmode', darkMode ? '1' : '0'); } catch { /* nop */ }
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
      // Load per-day check-in notes for the current month (for note indicator dots).
      const noteMap = new Map<string, string[]>();
      for (const habit of h) {
        const habitNotes = getMonthCheckInNotes(habit.id, year, month);
        for (const [day, notes] of habitNotes) {
          const dateKey = parseDateStr(year, month, day);
          noteMap.set(`${habit.id}::${dateKey}`, notes);
        }
      }
      setCheckInNotes(noteMap);
      // Load moods for current month
      setMonthMoods(getMonthMoods(year, month));
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

  function handleCellClick(habitId: string, day: number, isMultiClick: boolean = true, ctrlKey: boolean = false, shiftKey: boolean = false) {
    const dateStr = parseDateStr(year, month, day);
    if (!isMultiClick) {
      // Simple toggle mode: just on/off, no count
      toggleCheckIn(habitId, dateStr);
      return;
    }
    if (ctrlKey) {
      resetCheckInCount(habitId, dateStr);
    } else if (shiftKey) {
      decrementCheckInCount(habitId, dateStr);
    } else {
      incrementCheckInCount(habitId, dateStr);
    }
  }

  // Right-click on a day cell: open the note popup for that habit+day.
  function handleCellContextMenu(e: React.MouseEvent, habitId: string, habitName: string, day: number) {
    e.preventDefault();
    const dateStr = parseDateStr(year, month, day);
    const existingNotes = getCheckInNotes(habitId, dateStr);
    setNotePopup({ habitId, date: dateStr, habitName, notes: existingNotes });
    setNotePopupText('');
  }

  // Save the note from the popup.
  function handleNotePopupSave() {
    if (!notePopup) return;
    const trimmed = notePopupText.trim();
    if (trimmed) {
      addCheckInNote(notePopup.habitId, notePopup.date, trimmed);
    }
    // Refresh local cache
    const updated = getCheckInNotes(notePopup.habitId, notePopup.date);
    setCheckInNotes((prev) => {
      const next = new Map(prev);
      const key = `${notePopup.habitId}::${notePopup.date}`;
      if (updated.length > 0) next.set(key, updated);
      else next.delete(key);
      return next;
    });
    setNotePopup(prev => prev ? { ...prev, notes: updated } : null);
    setNotePopupText('');
  }

  // Close the note popup without saving.
  function handleNotePopupClose() {
    setNotePopup(null);
    setNotePopupText('');
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
      // Days since tracking started (for reliability indicator)
      const start = trackingStart(habit, allCheckIns);
      const trackingDays = start
        ? Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000))
        : 0;

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
        trackingDays,
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
      {/* Skip link for keyboard users */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {/* Navbar — minimal */}
      <nav className="navbar" aria-label="Main navigation">
        <span className="logo">
          <svg className="logo-icon" width="28" height="28" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Outer ring — represents the cycle of habit formation */}
            <circle cx="24" cy="24" r="21" stroke="url(#logoRing)" strokeWidth="3" fill="none" opacity="0.5" />
            {/* Inner circle — the daily commitment */}
            <circle cx="24" cy="24" r="14" stroke="url(#logoInner)" strokeWidth="2" fill="none" />
            {/* Ascending path — progress, growth, streak building */}
            <path d="M10 30 L17 22 L21 25 L27 15 L31 18 L37 8" stroke="url(#logoLine)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {/* Checkmark — completion, satisfaction */}
            <circle cx="24" cy="24" r="5" fill="url(#logoDot)" />
            <defs>
              <linearGradient id="logoRing" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
              <linearGradient id="logoInner" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
              <linearGradient id="logoLine" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <radialGradient id="logoDot" cx="0.4" cy="0.35">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f59e0b" />
              </radialGradient>
            </defs>
          </svg>
          <span className="logo-text">
            <span className="logo-life">Life</span><span className="logo-track">Track</span>
          </span>
        </span>
        <div className="nav-actions">
          <button className="btn-icon" onClick={cycleTheme} title={`Theme: ${themeLabels[themes.indexOf(theme)]}`} aria-label={`Current theme: ${themeLabels[themes.indexOf(theme)]}. Click to switch.`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <div className="export-dropdown">
            <button className="btn-icon" title="Export data" aria-label="Export or restore data">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <button className="btn-icon" onClick={() => setShowOnboarding(true)} title="How to use LifeTrack" aria-label="Open tutorial">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </button>
          <button className="btn-icon" onClick={() => setDarkMode(!darkMode)} title="Toggle dark mode" aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* Toolbar: month selector + tabs */}
      <div className="toolbar" id="main-content">
        <div className="month-selector">
          <button className="month-arrow" onClick={prevMonth} title="Previous month" aria-label="Previous month">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="month-label" aria-live="polite">{MONTH_NAMES[month]}, {year}</span>
          <button className="month-arrow" onClick={nextMonth} title="Next month" aria-label="Next month">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div className="view-tabs" role="tablist" aria-label="View selector">
          <button role="tab" aria-selected={view === 'today'} className={`view-tab ${view === 'today' ? 'active' : ''}`} onClick={() => setView('today')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Today
          </button>
          <button role="tab" aria-selected={view === 'grid'} className={`view-tab ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')}>Grid</button>
          <button role="tab" aria-selected={view === 'stats'} className={`view-tab ${view === 'stats' ? 'active' : ''}`} onClick={() => setView('stats')}>Statistics</button>
          <button role="tab" aria-selected={view === 'history'} className={`view-tab ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>History</button>
          <button role="tab" aria-selected={view === 'year'} className={`view-tab ${view === 'year' ? 'active' : ''}`} onClick={() => setView('year')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Year
          </button>
          <button role="tab" aria-selected={view === 'challenge'} className={`view-tab ${view === 'challenge' ? 'active' : ''}`} onClick={() => setView('challenge')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> 30 Days
          </button>
          <button role="tab" aria-selected={view === 'stacks'} className={`view-tab ${view === 'stacks' ? 'active' : ''}`} onClick={() => setView('stacks')}>Stacks</button>
          <button role="tab" aria-selected={view === 'skills'} className={`view-tab ${view === 'skills' ? 'active' : ''}`} onClick={() => setView('skills')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Skills
          </button>
          <button role="tab" aria-selected={view === 'insights'} className={`view-tab ${view === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg> Insights
          </button>
          <button role="tab" aria-selected={view === 'experiments'} className={`view-tab ${view === 'experiments' ? 'active' : ''}`} onClick={() => setView('experiments')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Experiments
          </button>
          <button role="tab" aria-selected={view === 'urges'} className={`view-tab ${view === 'urges' ? 'active' : ''}`} onClick={() => setView('urges')}>
            🌊 Urges
          </button>
          <button role="tab" aria-selected={view === 'chaos'} className={`view-tab ${view === 'chaos' ? 'active' : ''}`} onClick={() => setView('chaos')}>Chaos</button>
          <button role="tab" aria-selected={view === 'mantras'} className={`view-tab ${view === 'mantras' ? 'active' : ''}`} onClick={() => setView('mantras')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4.5 12.5l3 3 5-7"/><circle cx="12" cy="12" r="10"/></svg> Mantras
          </button>
          <button role="tab" aria-selected={view === 'settings'} className={`view-tab ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Settings
          </button>
        </div>
      </div>

      {view === 'today' ? (
        <TodayView
          habits={habits}
          checkIns={allCheckIns}
          todayMantra={dailyEntryMantra}
        />
      ) : view === 'grid' ? (
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
                  <th className="col-drag-handle"></th>
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
                  <th className="col-goal" title="Monthly target">Goal</th>
                  <th className="col-achieved">Done</th>
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
                  const hs = habitStats.find(s => s.habitId === habit.id);
                  const streakLevel = hs ? (hs.currentStreak >= 30 ? 3 : hs.currentStreak >= 7 ? 2 : hs.currentStreak >= 3 ? 1 : 0) : 0;
                  // Count total executions this month (sum of counts across all days)
                  let totalExecs = 0;
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (habitChecks.get(d)) {
                      const dateKey = parseDateStr(year, month, d);
                      totalExecs += getCheckInCount(habit.id, dateKey);
                    }
                  }
                  // Days with at least one execution
                  let activeDays = 0;
                  for (let d = 1; d <= daysInMonth; d++) {
                    if (habitChecks.get(d)) activeDays++;
                  }
                  const goal = habit.goal || daysInMonth;

                  return (
                    <DraggableHabitRow key={habit.id} habitId={habit.id} index={habitIdx} className={habit.stackParent ? 'has-stack' : ''}>
                      <td className={`col-habits streak-level-${streakLevel}`}>
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
                              {habit.focusMonth && (
                                <span className="focus-badge" title={`Focus of ${habit.focusMonth}`}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg></span>
                              )}
                              {(() => {
                                const hs = habitStats.find(s => s.habitId === habit.id);
                                if (hs && hs.currentStreak >= 30) return <span className="streak-badge streak-30" title="30+ day streak!"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9H4.5a2.5 2.5 0 010-5C7 4 6 9 6 9z"/><path d="M18 9h1.5a2.5 2.5 0 000-5C17 4 18 9 18 9z"/><path d="M4 22h16"/><path d="M10 22V2h4v20"/></svg></span>;
                                if (hs && hs.currentStreak >= 7) return <span className="streak-badge streak-7" title="7+ day streak!"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.62 0-6 .03-.18.06-.36.1-.54A9.98 9.98 0 0012 2a10 10 0 100 20 9.98 9.98 0 006.9-2.46"/></svg></span>;
                                return null;
                              })()}
                            </span>
                          )}
                          {habit.stackParent && (() => {
                            const parent = habits.find((h) => h.id === habit.stackParent);
                            if (!parent) return null;
                            const whenLabel = habit.stackWhen === 'before' ? '↑' : habit.stackWhen === 'with' ? '↔' : '↓';
                            return (
                              <span
                                className="habit-stack-badge"
                                title={`${whenLabel} ${parent.name}`}
                                onClick={() => setFocusHabitIdx(habits.findIndex((h) => h.id === parent.id))}
                              >
                                {whenLabel} {parent.name}
                              </span>
                            );
                          })()}
                          <select
                            className="habit-category-select"
                            value={habit.category ?? ''}
                            onChange={(e) => updateHabit(habit.id, { category: e.target.value || undefined })}
                            title={habit.category ? `Category: ${habit.category}` : 'Set category'}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">—</option>
                            {DEFAULT_CATEGORIES.map(c => (
                              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                            ))}
                          </select>
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
                            title={habit.stackParent ? `${habit.stackWhen === 'before' ? 'Before' : habit.stackWhen === 'with' ? 'With' : 'After'}: ${habits.find((h) => h.id === habit.stackParent)?.name ?? '?'}` : 'Add to a stack'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                          </button>
                          <button
                            className={`habit-multiclick-btn ${habit.multiClick === true ? 'active' : ''}`}
                            onClick={() => updateHabit(habit.id, { multiClick: !habit.multiClick })}
                            title={habit.multiClick === true ? 'Multi-click: ON (click to disable)' : 'Multi-click: OFF — simple toggle'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          </button>
                          <button
                            className={`habit-focus-btn ${habit.focusMonth ? 'active' : ''}`}
                            onClick={() => {
                              const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                              const isFocused = habit.focusMonth === thisMonth;
                              updateHabit(habit.id, { focusMonth: isFocused ? undefined : thisMonth });
                            }}
                            title={habit.focusMonth ? `Focus: ${habit.focusMonth}` : 'Set as monthly focus'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          <button
                            className={`habit-why-btn ${(habit.why?.length ?? 0) > 0 ? 'has-intentions' : ''}`}
                            onClick={() => {
                              const isOpening = editingWhyHabitId !== habit.id;
                              setEditingWhyHabitId(isOpening ? habit.id : null);
                              setEditWhyText(''); // always reset when toggling
                            }}
                            title={(habit.why?.length ?? 0) > 0 ? `${habit.why!.length} intention(s)` : 'Add intentions (why?)'}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.66 2.97a10 10 0 104.68 0"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
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
                              <option value="emotional">Emotional</option>
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
                            <span className="stack-edit-label">When:</span>
                            <select
                              className="stack-select-sm"
                              value={habit.stackWhen ?? 'after'}
                              onChange={(e) => {
                                if (habit.stackParent) {
                                  linkHabitToParentStore(habit.id, habit.stackParent, e.target.value as 'before' | 'after' | 'with');
                                }
                              }}
                            >
                              <option value="before">⬆ Before</option>
                              <option value="after">⬇ After</option>
                              <option value="with">↔ With</option>
                            </select>
                            <span className="stack-edit-label">from:</span>
                            <select
                              className="stack-select-sm"
                              value={habit.stackParent ?? ''}
                              onChange={(e) => {
                                const newParent = e.target.value;
                                if (newParent === '') {
                                  unlinkHabitFromParentStore(habit.id);
                                } else {
                                  linkHabitToParentStore(habit.id, newParent, habit.stackWhen ?? 'after');
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
                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
                        const currentCount = checked ? getCheckInCount(habit.id, dateKey) : 0;
                        // Note indicator
                        const noteKey = `${habit.id}::${dateKey}`;
                        const cellNotes = checkInNotes.get(noteKey);
                        const hasNote = !!cellNotes && cellNotes.length > 0;
                        const noteCount = cellNotes?.length ?? 0;
                        const noteTooltip = hasNote ? `📝 ${cellNotes!.join(' | ')}` : '';
                        const isMultiClick = habit.multiClick === true; // OFF by default, user opts IN
                        // Count badge only shown when multi-click is on: in simple
                        // toggle mode the count is always 1 (or 0) and a number
                        // next to the checkmark would just be visual noise.
                        const showCount = isMultiClick && currentCount >= 1;
                        return (
                          <td
                            key={h.day}
                            className={`col-day ${isToday ? 'today' : ''} ${isFocused ? 'focused' : ''}`}
                            onClick={(e) => handleCellClick(habit.id, h.day, isMultiClick, e.ctrlKey || e.metaKey, e.shiftKey)}
                            onContextMenu={(e) => handleCellContextMenu(e, habit.id, habit.name, h.day)}
                            title={hasNote ? noteTooltip : isMultiClick ? `Click +1 · Shift+Click −1 · Ctrl+Click reset · Right-click note` : `Click to toggle · Right-click to add note`}
                          >
                            <div className={`day-cell ${checked ? 'checked' : ''} ${hasNote ? 'has-note' : ''}`}>
                              {checked && (
                                <svg className="check-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="5,13 10,18 19,7"/>
                                </svg>
                              )}
                              {showCount && (
                                <span className="day-cell-count">{currentCount}</span>
                              )}
                              {hasNote && <span className="day-cell-note-dot" title={noteTooltip}>{noteCount > 1 ? noteCount : '●'}</span>}
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
                        <div className="achieved-cell">
                          <span className="achieved-number" title={`${activeDays}d active · ${totalExecs} total`}>
                            {goal > 0 ? `${totalExecs}/${goal}` : `${totalExecs}`}
                          </span>
                          {goal > 0 && (
                            <div className="achieved-bar" style={{ '--pct': `${Math.min(100, Math.round((totalExecs / goal) * 100))}%` } as React.CSSProperties}>
                              <div className="achieved-bar-fill" />
                            </div>
                          )}
                        </div>
                      </td>
                    </DraggableHabitRow>
                  );
                })}
                    {/* Mood tracker row */}
                    <tr className="mood-row">
                      <td className="col-drag-handle"></td>
                      <td className="col-habits">
                        <span className="mood-label">Mood</span>
                      </td>
                      {dayHeaders.map((h) => {
                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
                        const moodId = monthMoods.get(h.day);
                        const mood = moodId ? MOODS.find(m => m.id === moodId) : null;
                        const isToday = isCurrentMonth && h.day === todayDay;
                        return (
                          <td
                            key={h.day}
                            className={`col-day mood-cell ${isToday ? 'today' : ''}`}
                            onClick={() => {
                              const currentMood = getMood(dateKey);
                              const currentIdx = currentMood ? MOODS.findIndex(m => m.id === currentMood) : -1;
                              const nextIdx = (currentIdx + 1) % MOODS.length;
                              setMood(dateKey, MOODS[nextIdx].id);
                              setMonthMoods(getMonthMoods(year, month));
                            }}
                            title={mood ? mood.label : 'Click to set mood'}
                          >
                            <div className="day-cell mood-display" style={mood ? { background: mood.color + '22', color: mood.color } : {}}>
                              {mood ? mood.emoji : '·'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="col-goal"></td>
                      <td className="col-achieved"></td>
                    </tr>
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
                          <span className="stats-best-tag" title="All-time best"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>
                        )}
                      </td>
                      <td className="stats-number stats-gap">
                        {stat.longestGap > 0 ? `${stat.longestGap}d` : '—'}
                      </td>
                      <td className="stats-number">{stat.trackingDays >= 7 ? `${stat.completion7d}%` : '—'}</td>
                      <td className="stats-number">{stat.trackingDays >= 14 ? `${stat.completion30d}%` : '—'}</td>
                      <td className="stats-number">{stat.trackingDays >= 30 ? `${stat.completion90d}%` : '—'}</td>
                      <td className="stats-number">{stat.trackingDays >= 60 ? `${stat.completion365d}%` : '—'}</td>
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
      ) : view === 'year' ? (
        <YearView habits={habits} checkIns={allCheckIns} />
      ) : view === 'challenge' ? (
        <ChallengeView habits={habits} checkIns={allCheckIns} />
      ) : view === 'stacks' ? (
        <StacksView checkIns={allCheckIns} habits={habits} />
      ) : view === 'insights' ? (
        <InsightsView habits={habits} checkIns={allCheckIns} onLink={(childId, parentId) => {
          if (parentId) linkHabitToParentStore(childId, parentId);
          else void unlinkHabitFromParentStore(childId);
        }} onView={(newView) => setView(newView)} />
      ) : view === 'mantras' ? (
        <MantraView />
      ) : view === 'settings' ? (
        <SettingsView
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          theme={theme}
          onSetTheme={setTheme}
          onExportJSON={handleExportJSON}
          onExportCSV={handleExportCSV}
          onImportJSON={handleImportJSON}
          onRestoreBackup={() => {
            // First: try localStorage backup (instant, no Tauri needed)
            const restored = restoreFromBackupIfNewer();
            if (restored) {
              alert('✅ Restored from localStorage backup! Your data should be back.');
              diagnoseStorage();
              return;
            }
            // Second: try Tauri file backup
            import('@tauri-apps/api/core').then(({ invoke }) =>
              invoke<string | null>('find_latest_backup').then((backup) => {
                if (!backup) { alert('No backup found in files or localStorage.'); return; }
                const parsed = JSON.parse(backup);
                const habitCount = parsed?.habits?.length || 0;
                const checkinCount = parsed?.checkIns?.length || 0;
                if (!habitCount) { alert('Backup is empty.'); return; }
                if (!window.confirm(`Restore ${habitCount} habits + ${checkinCount} check-ins from file backup?\n\nExisting habits with the same name will be merged, not duplicated.`)) return;
                const result = mergeImportedData(parsed);
                alert(`Restore successful: ${result.habitsCreated} habits added, ${result.checkInsRestored} check-ins restored.`);
              }).catch((e) => alert('Restore failed: ' + e))
            ).catch((e) => alert('Restore failed: ' + e));
          }}
          onViewMantras={() => setView('mantras')}
        />
      ) : view === 'skills' ? (
        <SkillsView />
      ) : view === 'experiments' ? (
        <ExperimentsView />
      ) : view === 'urges' ? (
        <UrgeSurfingView />
      ) : (
        <ChaosView />
      )}

      {/* Daily Mantra Banner */}
      {showMantraBanner && dailyEntryMantra && (
        <div className="mantra-banner">
          <div className="mantra-banner-content">
            <span className="mantra-banner-domain">
              {MANTRA_DOMAINS.find((d) => d.id === dailyEntryMantra.domain)?.icon} {' '}
              {MANTRA_DOMAINS.find((d) => d.id === dailyEntryMantra.domain)?.name}
            </span>
            <blockquote className="mantra-banner-text">
              "{dailyEntryMantra.text}"
            </blockquote>
          </div>
          <button
            className="mantra-banner-close"
            onClick={() => setShowMantraBanner(false)}
            title="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
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
                    <option value="emotional">Emotional</option>
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

      {/* Toast notification */}
      {toastMsg && (
        <div className="toast">{toastMsg}</div>
      )}

      {/* Shortcuts help modal */}
      {showShortcuts && (
        <ShortcutsHelp onClose={() => setShowShortcuts(false)} />
      )}

      {/* Per-day check-in note popup */}
      {notePopup && (
        <div className="note-popup-overlay" onClick={handleNotePopupClose}>
          <div className="note-popup" onClick={(e) => e.stopPropagation()}>
            <div className="note-popup-header">
              <span className="note-popup-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:4}}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> {notePopup.habitName} — {notePopup.date}
              </span>
              <button className="note-popup-close" onClick={handleNotePopupClose} title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            {/* Existing notes list */}
            {notePopup.notes.length > 0 && (
              <div className="note-popup-list">
                {notePopup.notes.map((n, i) => (
                  <div key={i} className="note-popup-item">
                    <span className="note-popup-item-text">{n}</span>
                    <button
                      className="note-popup-item-del"
                      onClick={() => {
                        removeCheckInNote(notePopup.habitId, notePopup.date, i);
                        const updated = getCheckInNotes(notePopup.habitId, notePopup.date);
                        setNotePopup(prev => prev ? { ...prev, notes: updated } : null);
                        setCheckInNotes(prev => {
                          const next = new Map(prev);
                          const key = `${notePopup.habitId}::${notePopup.date}`;
                          if (updated.length > 0) next.set(key, updated);
                          else next.delete(key);
                          return next;
                        });
                      }}
                      title="Delete note"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="note-popup-input"
              placeholder="Add a note... (Ctrl+Enter to save)"
              value={notePopupText}
              onChange={(e) => setNotePopupText(e.target.value)}
              autoFocus
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) handleNotePopupSave();
                if (e.key === 'Escape') handleNotePopupClose();
              }}
            />
            <div className="note-popup-actions">
              <span className="note-popup-hint">Ctrl+Enter to add</span>
              <button className="btn btn-sm btn-primary" onClick={handleNotePopupSave}>Add Note</button>
              <button className="btn btn-sm btn-ghost" onClick={handleNotePopupClose}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding tutorial */}
      {showOnboarding && <OnboardingHelp onDismiss={() => setShowOnboarding(false)} />}

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
  onView: (_v: 'grid' | 'stats' | 'history' | 'stacks' | 'chaos' | 'insights' | 'mantras' | 'settings' | 'today' | 'year' | 'challenge' | 'experiments') => void;
}) {
  const { recommendations, generatedAt } = useMemo(
    () => {
      try {
        const allData = exportAllData();
        return generateInsights(habits, checkIns, new Date(), allData.moods ?? {});
      } catch { return generateInsights(habits, checkIns); }
    },
    [habits, checkIns],
  );

  // Compute correlations from available data
  const correlations = useMemo(() => {
    try {
      const allData = exportAllData();
      const caps = (allData.capacities ?? []).map(c => ({ id: c.id, name: c.name }));
      return computeCorrelations(habits, checkIns, allData.moods ?? {}, caps, allData.capacityRatings ?? []);
    } catch { return []; }
  }, [habits, checkIns]);

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
      // Build a rich summary including recent notes for AI analysis.
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentCutoff = thirtyDaysAgo.toISOString().slice(0, 10);

      const habitSummaries: string[] = [];
      const allNotes: string[] = [];

      for (const h of habits.filter(h => !h.archived)) {
        const habitCheckIns = checkIns.filter(ci => ci.habitId === h.id);
        const completed = habitCheckIns.filter(ci => ci.completed).length;
        const total = habitCheckIns.length;
        const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
        const best = h.bestStreak ?? 0;
        const stacked = h.stackParent
          ? `after: ${habits.find((p) => p.id === h.stackParent)?.name ?? '?'}`
          : 'none';

        // Collect recent notes for this habit
        const recentNotes: string[] = [];
        for (const ci of habitCheckIns) {
          if (ci.date < recentCutoff) continue;
          // Support both new `notes[]` and legacy `note` (singular)
          const candidates: string[] = ci.notes ?? [];
          const legacyNote = (ci as unknown as Record<string, unknown>).note;
          if (typeof legacyNote === 'string' && legacyNote.trim()) candidates.push(legacyNote.trim());
          for (const n of candidates) {
            if (n && n.trim()) recentNotes.push(n.trim());
          }
        }

        let line = `${h.name}: ${completed}/${total} done (${rate}%), best streak ${best}, stack ${stacked}`;
        if (recentNotes.length > 0) {
          line += `\n  notes: ${recentNotes.join(' | ')}`;
          allNotes.push(...recentNotes.map(n => `[${h.name}] ${n}`));
        }
        habitSummaries.push(line);
      }

      const summary = habitSummaries.join('\n')
        + (allNotes.length > 0 ? '\n\nALL RECENT NOTES (last 30 days):\n' + allNotes.join('\n') : '');
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
    STREAK_MILESTONE: '🎯',
    PERFECT_WEEK: '✨',
    MANTRA_MATCH: '🧘',
    NOTE_POSITIVE: '💚',
    NOTE_OBSTACLE: '💡',
    GOAL_PROGRESS: '🎯',
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
    STREAK_MILESTONE: () => onView('stats'),
    PERFECT_WEEK: () => onView('history'),
    MANTRA_MATCH: () => onView('mantras'),
    NOTE_POSITIVE: () => onView('grid'),
    NOTE_OBSTACLE: () => onView('grid'),
    GOAL_PROGRESS: () => onView('stats'),
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
        <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:6}}><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>Insights</h2>
        <span className="insights-subtitle">
          {recommendations.length} recommendation{recommendations.length > 1 ? 's' : ''} — 100% local
          <span className="insights-generated" title="Recomputed when your data changes">
            · {new Date(generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
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

      {/* Correlations */}
      {correlations.length > 0 && (
        <div className="correlations-section">
          <h3>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:4}}>
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Correlations
          </h3>
          <div className="correlations-list">
            {correlations.slice(0, 6).map((c, i) => (
              <div key={i} className={`correlation-item ${c.direction} ${c.strength}`}>
                <span className="correlation-pair">{c.metricA} ↔ {c.metricB}</span>
                <span className={`correlation-value ${c.direction}`}>
                  {c.direction === 'positive' ? '↑' : '↓'} {Math.abs(c.coefficient).toFixed(2)}
                </span>
                <span className="correlation-strength">{c.strength}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
