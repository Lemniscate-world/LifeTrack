import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Habit, Note, CheckIn, Mantra } from './types';
import { dateKeyFromParts } from './dates';
import ViewTabs, { type ViewKey } from './components/ViewTabs';
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
  getAchievementCategories,
  tagNoteAchievement,
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
  attemptFileRecovery,
  diagnoseStorage,
  createUpgradeBackup,
  pruneOldBackups,
  MOODS,
  setMood,
  getMood,
  getMonthMoods,
  setEnergy,
  getEnergy,
  getMonthEnergies,
  setConcentration,
  getConcentration,
  getMonthConcentrations,
  setDepression,
  getDepression,
  getMonthDepressions,
  getPreferences,
  updatePreferences,
  getActiveChallenges,
  getFeeds,
  getProtocols,
  getIngestedSources,
  applyFeedIngest,
  getDismissedRecs,
  dismissRec,
  resetDismissedRecs,
} from './store';
import { computeStreakStats, computeCompletionRate, computeWeightedScore, trackingStart } from './stats';
import { Heatmap, Sparkline } from './Heatmap';
import { HistoryView } from './HistoryView';
import { StacksView } from './StacksView';
import SkillsView from './SkillsView';
import { DraggableHabitRow } from './components/DraggableHabitRow';
import { CapacitiesSummary } from './components/CapacitiesSummary';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import './App.css';
import ChaosView from './ChaosView';
import AchievementsView from './AchievementsView';
import MantraView from './MantraView';
import SettingsView from './SettingsView';
import TodayView from './TodayView';
import ShortcutsHelp from './ShortcutsHelp';
import YearView from './YearView';
import ChallengeView from './ChallengeView';
import ExperimentsView from './ExperimentsView';
import JournalView from './JournalView';
import UrgeSurfingView from './UrgeSurfingView';
import ProjectsView from './ProjectsView';
import KnowledgeView from './KnowledgeView';
import ObsidianView from './ObsidianView';
import MissionsView from './MissionsView';
import CorrelationsView from './CorrelationsView';
import GainsView from './GainsView';
import { playCompletionSound, playLevelUpSound } from './audio';
import OnboardingHelp from './OnboardingHelp';
import { buildAiContext } from './aiContext';
import { parseAiAnalysis, aiAnalysisToInsights, type AiAnalysis, type AiChatMessage } from './aiAnalysis';
// (Mood view removed — emotional state is tracked via the 'emotional' chaos dimension.)
import { generateInsights, type Recommendation, type RecKind } from './recommendations';
import { computeCorrelations } from './correlations';
import PsychoanalysisView from './PsychoanalysisView';
import LeversView from './LeversView';
import { computeXp, levelForXp, rankForLevel } from './gamification';
import Confetti from './Confetti';
import { getDailyEntryMantra, todayStr, shouldShowMantraNotification, markMantraNotificationShown, MANTRA_DOMAINS, sendSystemNotification } from './mantras';
import { buildMemoryReminder, buildOnThisDay } from './memories';
import { runFeedCycle, pickFetcher, enrichWithAi } from './autoIngest';
import { runAutoMissions } from './missionEngine';
import { runAutoKnowledge } from './knowledgeEngine';
import { rotateRecommendations, recKey } from './recRotation';
import { generateDeepInsights, downloadPlanIcs, type DeepInsight } from './deepInsights';

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
  return dateKeyFromParts(year, month + 1, day);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// --- AI Coach structured output (v0.3.4) ---
// Types + parser live in ./aiAnalysis.ts (shared with tests).

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
  const [newNoteCategory, setNewNoteCategory] = useState('');
  const [showNewNoteInput, setShowNewNoteInput] = useState(false);
  // Per-day check-in note popup
  const [notePopup, setNotePopup] = useState<{ habitId: string; date: string; habitName: string; notes: string[] } | null>(null);
  const [notePopupText, setNotePopupText] = useState('');
  // Map of dateKey -> note for the currently hovered/visible habit (lazy loaded)
  const [checkInNotes, setCheckInNotes] = useState<Map<string, string[]>>(new Map());
  // Monthly moods
  const [monthMoods, setMonthMoods] = useState<Map<number, string>>(new Map());
  // Monthly energy levels (%)
  const [monthEnergies, setMonthEnergies] = useState<Map<number, number>>(new Map());
  const [monthConcentrations, setMonthConcentrations] = useState<Map<number, number>>(new Map());
  const [monthDepressions, setMonthDepressions] = useState<Map<number, number>>(new Map());
  // Energy precision picker (slider + exact % input)
  const [energyPicker, setEnergyPicker] = useState<{ dateKey: string; label: string; value: number } | null>(null);
  const [energyPickerInput, setEnergyPickerInput] = useState('');
  // Concentration precision picker (slider + exact % input)
  const [concPicker, setConcPicker] = useState<{ dateKey: string; label: string; value: number } | null>(null);
  const [concPickerInput, setConcPickerInput] = useState('');
  const [depPicker, setDepPicker] = useState<{ dateKey: string; label: string; value: number } | null>(null);
  const [depPickerInput, setDepPickerInput] = useState('');
  const [depThreshold, setDepThreshold] = useState(() => getPreferences().depressionAlertThreshold ?? 70);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingGoalValue, setEditingGoalValue] = useState('');
  const [editingChaosHabitId, setEditingChaosHabitId] = useState<string | null>(null);
  const [editChaosLinks, setEditChaosLinks] = useState<{ dimension: string; impact: number; cause?: string }[]>([{ dimension: 'physical', impact: 50 }]);
  const [editChaosThreshold, setEditChaosThreshold] = useState(2);
  // Stack parent picker (which habit triggers this one)
  const [editingStackParentId, setEditingStackParentId] = useState<string | null>(null);
  // Intentions editor (why you do this habit)
  const [editingWhyHabitId, setEditingWhyHabitId] = useState<string | null>(null);
  const [editWhyText, setEditWhyText] = useState('');
  // v0.3.2: Toggle to display archived habits in the grid
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<ViewKey>('grid');
  const [savedMsg, setSavedMsg] = useState('');
  // Shortcuts help + toast
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Gamification: level-up celebration (confetti + toast)
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [levelUpLabel, setLevelUpLabel] = useState('');
  const lastLevelRef = useRef<number | null>(null);
  const levelUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Rebuild/reinstall safety net: if localStorage is empty but a JSON copy
    // exists on disk (Documents/Desktop/AppData), recover it. Retried a few
    // times in case the plugin bridges are still warming up at first boot.
    const tryRecovery = (attempt: number) => {
      attemptFileRecovery().then((recovered) => {
        if (recovered) {
          console.log('🛟 Recovered data from filesystem backup');
          setHabits(getHabits());
        } else if (attempt < 2) {
          setTimeout(() => tryRecovery(attempt + 1), 3000);
        }
      }).catch(() => { /* best-effort */ });
    };
    tryRecovery(0);
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

  // Daily "remember the past" system reminder (memoryReminder settings).
  useEffect(() => {
    const checkMemoryReminder = () => {
      const prefs = getPreferences();
      if (!prefs.memoryReminderEnabled) return;
      const time = prefs.memoryReminderTime ?? '20:00';
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const today = todayStr();
      if (prefs.lastMemoryReminderDate === today || currentTime < time) return;
      try {
        const d = exportAllData();
        const recol = buildOnThisDay(d.habits ?? [], d.checkIns ?? [], d.notes ?? [], d.journalEntries ?? [], now);
        const msg = buildMemoryReminder(recol, now);
        sendSystemNotification(msg.title, msg.body);
      } catch { /* ignore */ }
      updatePreferences({ lastMemoryReminderDate: today });
    };
    checkMemoryReminder();
    const id = setInterval(checkMemoryReminder, 30000);
    return () => clearInterval(id);
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
    const classes = ['theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald', 'theme-bw'];
    document.documentElement.classList.remove(...classes);
    if (theme) document.documentElement.classList.add(theme);
    updatePreferences({ theme });
    try { localStorage.setItem('lifetrack-theme', theme); } catch { /* nop */ }
  }, [theme]);

  const themes = ['', 'theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald', 'theme-bw'];
  const themeLabels = ['Default', 'Ocean', 'Forest', 'Sunset', 'Rose', 'Mono', 'Midnight', 'Emerald', 'Noir & Blanc'];
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
        const tabs: string[] = ['settings', 'today', 'grid', 'stats', 'history', 'year', 'stacks', 'skills', 'insights', 'chaos', 'mantras', 'experiments', 'journal', 'achievements', 'urges', 'psycho', 'projects', 'knowledge', 'obsidian', 'missions'];
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
      // Load energy levels for current month
      setMonthEnergies(getMonthEnergies(year, month));
      // Load concentration levels for current month
      setMonthConcentrations(getMonthConcentrations(year, month));
      // Load depression levels for current month
      setMonthDepressions(getMonthDepressions(year, month));
    }
    update();
    return subscribe(update);
  }, [year, month]);

  // --- Permanent automated ingestion loop (v0.6.1) ---
  // While LifeTrack runs, its curated feeds refresh by themselves on a schedule,
  // are re-structured by the local AI (best-effort), and enrich the knowledge
  // library — nothing to paste, nothing to click. Skipped in the test runner so
  // the suite never touches the network.
  useEffect(() => {
    if (import.meta.env?.MODE === 'test') return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      try {
        if (cancelled) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const prefs = getPreferences();
        if (prefs.autoIngestEnabled === false) return;
        const feeds = getFeeds().filter((f) => f.enabled);
        if (feeds.length === 0) return;
        const fetcher = await pickFetcher();
        const outcome = await runFeedCycle(feeds, getProtocols(), getIngestedSources(), fetcher, new Date());
        if (cancelled) return;
        const { outcome: enriched } = await enrichWithAi(outcome, {
          enabled: prefs.ingestAiEnabled !== false,
          model: prefs.aiModel,
          provider: prefs.aiProvider,
          apiKey: prefs.aiApiKey,
        });
        if (!cancelled) applyFeedIngest(enriched);
        // Sky-driven missions: weak-domain transits become missions by themselves.
        if (!cancelled) runAutoMissions();
        // Zero-touch knowledge: adopt the top suggested protocols (create habits).
        if (!cancelled) runAutoKnowledge();
      } catch {
        // Best-effort: a failed feed must never break the app.
      }
    };

    run();
    const hours = Math.max(1, getPreferences().autoIngestIntervalHours ?? 6);
    timer = setInterval(run, hours * 60 * 60 * 1000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  // --- Zero-touch knowledge engine: register Windows logon start by default ---
  // so the ingestion loop keeps running even when LifeTrack is not open.
  useEffect(() => {
    if (import.meta.env?.MODE === 'test') return;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && getPreferences().autostartEnabled !== false) {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_autostart', { enabled: true }))
        .catch(() => { /* best-effort */ });
    }
  }, []);

  // --- Zero-touch mission engine: create weak-domain transit missions once ---
  // at startup, even when the feed loop is offline or disabled.
  useEffect(() => {
    if (import.meta.env?.MODE === 'test') return;
    runAutoMissions();
    runAutoKnowledge();
  }, []);

  // Gamification: detect level-ups on every store change and celebrate.
  useEffect(() => {
    const checkLevelUp = () => {
      const all = exportAllData();
      const xp = computeXp(all.habits, all.checkIns, all.notes, all.challenges).total;
      const level = levelForXp(xp);
      if (lastLevelRef.current === null) {
        lastLevelRef.current = level; // initialise without celebrating
        return;
      }
      if (level > lastLevelRef.current) {
        lastLevelRef.current = level;
        const rank = rankForLevel(level);
        setLevelUpLabel(`${rank.rankEmoji} Level ${level} — ${rank.rankName}`);
        setShowLevelUp(true);
        showToast(`🎉 Level up! You reached level ${level}`);
        playLevelUpSound(getPreferences().soundEnabled !== false);
        if (levelUpTimerRef.current) clearTimeout(levelUpTimerRef.current);
        levelUpTimerRef.current = setTimeout(() => setShowLevelUp(false), 3600);
      } else {
        lastLevelRef.current = level;
      }
    };
    checkLevelUp();
    return subscribe(checkLevelUp);
  }, []);

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
    const soundOn = getPreferences().soundEnabled !== false;
    if (!isMultiClick) {
      // Simple toggle mode: just on/off, no count
      toggleCheckIn(habitId, dateStr);
      playCompletionSound(soundOn);
      return;
    }
    if (ctrlKey) {
      resetCheckInCount(habitId, dateStr);
    } else if (shiftKey) {
      decrementCheckInCount(habitId, dateStr);
    } else {
      incrementCheckInCount(habitId, dateStr);
      playCompletionSound(soundOn);
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
    const existing = (Array.isArray(habit.chaosLinks) && habit.chaosLinks.length > 0)
      ? habit.chaosLinks
      : habit.chaosDimension
        ? [{ dimension: habit.chaosDimension, impact: habit.chaosImpact ?? 50 }]
        : [];
    setEditChaosLinks(existing.length > 0 ? existing : [{ dimension: 'physical', impact: 50 }]);
    setEditChaosThreshold(habit.chaosThresholdDays ?? 2);
  }

  function saveChaosEditor() {
    if (editingChaosHabitId) {
      const links = editChaosLinks.filter((l) => l.dimension && l.impact > 0);
      if (links.length === 0) {
        // Fully unlink: clear all chaos fields
        updateHabit(editingChaosHabitId, {
          chaosLinks: undefined,
          chaosDimension: undefined,
          chaosImpact: undefined,
          chaosThresholdDays: undefined,
        });
      } else {
        updateHabit(editingChaosHabitId, {
          chaosLinks: links,
          chaosThresholdDays: editChaosThreshold,
        });
      }
      setEditingChaosHabitId(null);
    }
  }

  // Track new note content per keystroke, no intermediate state needed beyond newNoteContent
  function handleAddNote() {
    if (newNoteContent.trim()) {
      addNote(newNoteContent.trim(), newNoteCategory || undefined);
      setNewNoteContent('');
      setNewNoteCategory('');
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
  // Habits that act as stack PARENTS (some other habit hangs off them)
  const stackParentIds = useMemo(() => new Set(habits.map((h) => h.stackParent).filter(Boolean) as string[]), [habits]);

  const habitStats = useMemo(() => {    const now = new Date();
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
    // Diagnostic: log to help chase the "1-2 lines off" report
    console.log('[drag] source', result.source.index, '→ dest', result.destination.index);
    // hello-pangea gives dest as post-removal index; reorderHabits handles that.
    reorderHabits(result.source.index, result.destination.index);
  }

  // Days headers with letters
  const dayHeaders: { day: number; letter: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dayHeaders.push({ day: d, letter: getDayLetter(year, month, d) });
  }

  // Compact grid effective state (auto-compact + densité)
  const compactPrefs = getPreferences();
  const activeHabitsCount = habits.filter((h) => !h.archived).length;
  const autoCompactOn = compactPrefs.autoCompact !== false && activeHabitsCount >= (compactPrefs.compactThreshold ?? 30);
  const effectiveCompact = compactPrefs.compactGrid === true || autoCompactOn;
  const densityCls = compactPrefs.compactLevel === 1 ? ' compact-density-1' : compactPrefs.compactLevel === 2 ? ' compact-density-2' : '';

  // --- Deep analysis hoisted to App level so the Grid can render the plans ---
  const deepInsights = useMemo((): DeepInsight[] => {
    try {
      const allData = exportAllData();
      return generateDeepInsights(habits, allCheckIns, allData.moods ?? {}, allData.energies ?? {}, new Date(), getProtocols());
    } catch { return []; }
  }, [habits, allCheckIns]);

  // habitId → planned ISO dates (from goal plan cards) — circles in the grid.
  const planDatesByHabit = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of deepInsights) {
      if (!c.plan || c.plan.dates.length === 0) continue;
      const hid = c.id.split('|')[1];
      if (!hid) continue;
      const set = m.get(hid) ?? new Set<string>();
      for (const d of c.plan.dates) set.add(d);
      m.set(hid, set);
    }
    return m;
  }, [deepInsights]);
  const plannedThisMonth = useMemo(() => {
    let n = 0;
    const mm = `${year}-${String(month + 1).padStart(2, '0')}`;
    for (const set of planDatesByHabit.values()) for (const d of set) if (d.startsWith(mm)) n++;
    return n;
  }, [planDatesByHabit, year, month]);

  return (
    <div className="app">
      {showLevelUp && <Confetti message={levelUpLabel} />}
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
        <ViewTabs view={view} onView={setView} />
      </div>

      <div className="view-scroll">
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
              <div className="empty-suggestions">
                <button className="btn btn-sm btn-ghost" onClick={() => addHabit('Méditation')}>+ Méditation</button>
                <button className="btn btn-sm btn-ghost" onClick={() => addHabit('Sport')}>+ Sport</button>
                <button className="btn btn-sm btn-ghost" onClick={() => addHabit('Lecture')}>+ Lecture</button>
              </div>
              <p className="empty-hint" style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
                Astuce : essaie le thème <strong>Noir & Blanc</strong> dans Réglages → Apparence.
              </p>
            </div>
          ) : (
            <>
              <div className="grid-toolbar">
                <span className="grid-toolbar-info">
                  {habits.filter((h) => !h.archived).length} active · {habits.filter((h) => h.archived).length} archived
                </span>
                {plannedThisMonth > 0 && (
                  <span className="grid-plan-banner" title="Jours planifiés par ton plan d'objectif (voir Insights)">
                    🎯 {plannedThisMonth} jour{plannedThisMonth > 1 ? 's' : ''} planifié{plannedThisMonth > 1 ? 's' : ''} cerclé{plannedThisMonth > 1 ? 's' : ''}
                  </span>
                )}
                <button
                  className={`btn btn-sm ${effectiveCompact ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => updatePreferences({ compactGrid: !getPreferences().compactGrid })}
                  title={effectiveCompact ? (autoCompactOn && !compactPrefs.compactGrid ? `Compact grid: auto (≥${compactPrefs.compactThreshold ?? 30} habitudes) — click to force on` : 'Compact grid: on — click to switch to normal density') : 'Compact grid: off — smaller cells so more habits fit on screen'}
                  aria-pressed={effectiveCompact}
                >
                  ⚡ Compact
                </button>
                <button
                  className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setShowArchived((v) => !v)}
                  title="Toggle archived habits"
                >
                  {showArchived ? 'Hide archived' : 'Show archived'}
                </button>
              </div>
              <DragDropContext onDragEnd={handleDragEnd}>
                <div className={`table-scroll${effectiveCompact ? ' compact-grid' : ''}${densityCls}`}>
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
                    {habits
                      .filter((habit) => showArchived || !habit.archived)
                      .map((habit, habitIdx) => {
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
                    <DraggableHabitRow key={habit.id} habitId={habit.id} index={habitIdx} className={`${habit.stackParent ? 'has-stack' : ''} ${stackParentIds.has(habit.id) ? 'is-stack-parent' : ''}`}>
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
                            className={`habit-chaos-btn ${(habit.chaosLinks?.length ?? 0) > 0 || habit.chaosDimension ? 'linked' : ''}`}
                            onClick={() => openChaosEditor(habit)}
                            title={(habit.chaosLinks && habit.chaosLinks.length > 0)
                              ? `Chaos: ${habit.chaosLinks.map((l) => `${l.dimension}+${l.impact}%`).join(', ')}`
                              : habit.chaosDimension
                                ? `Chaos: ${habit.chaosDimension} +${habit.chaosImpact}%`
                                : 'Link to chaos'}
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
                            <div className="chaos-edit-links">
                              {editChaosLinks.map((link, i) => (
                                <div className="chaos-edit-link" key={i}>
                                  <select
                                    value={link.dimension}
                                    onChange={(e) => {
                                      const next = [...editChaosLinks];
                                      next[i] = { ...next[i], dimension: e.target.value };
                                      setEditChaosLinks(next);
                                    }}
                                    className="chaos-select-sm"
                                  >
                                    <option value="">— None (unlink) —</option>
                                    <option value="physical">Physical</option>
                                    <option value="financial">Financial</option>
                                    <option value="social">Social</option>
                                    <option value="structural">Structural</option>
                                    <option value="spiritual">Spiritual</option>
                                    <option value="emotional">Emotional</option>
                                    <option value="energy">Energy</option>
                                  </select>
                                  <input
                                    type="number" min="1" max="100"
                                    value={Number.isFinite(link.impact) ? link.impact : ''}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const next = [...editChaosLinks];
                                      next[i] = { ...next[i], impact: raw === '' ? NaN : parseInt(raw, 10) };
                                      setEditChaosLinks(next);
                                    }}
                                    className="chaos-input-sm" title="Impact %"
                                  />
                                  <textarea
                                    className="chaos-cause-input"
                                    rows={2}
                                    placeholder="Pourquoi cette habitude déstabilise ? (ex : je saute un repas → irritabilité le soir)"
                                    value={link.cause ?? ''}
                                    onChange={(e) => {
                                      const next = [...editChaosLinks];
                                      next[i] = { ...next[i], cause: e.target.value };
                                      setEditChaosLinks(next);
                                    }}
                                    title="Cause / pourquoi"
                                  />
                                  {editChaosLinks.length > 1 && (
                                    <button
                                      className="btn btn-sm btn-ghost"
                                      onClick={() => setEditChaosLinks((prev) => prev.filter((_, idx) => idx !== i))}
                                      title="Retirer cette zone"
                                      style={{ padding: '0 0.3rem', fontSize: '0.75rem' }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ))}
                              {editChaosLinks.length < 2 && (
                                <button
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => setEditChaosLinks((prev) => [...prev, { dimension: 'physical', impact: 50 }])}
                                  title="Ajouter une seconde zone de chaos"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  + zone
                                </button>
                              )}
                            </div>
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
                        // Goal-plan circle: this day is part of a catch-up/next-month
                        // plan computed by the deep engine for THIS habit.
                        const cellIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
                        const isPlanned = !checked && (planDatesByHabit.get(habit.id)?.has(cellIso) ?? false);
                        return (
                          <td
                            key={h.day}
                            className={`col-day ${isToday ? 'today' : ''} ${isFocused ? 'focused' : ''}`}
                            onClick={(e) => handleCellClick(habit.id, h.day, isMultiClick, e.ctrlKey || e.metaKey, e.shiftKey)}
                            onContextMenu={(e) => handleCellContextMenu(e, habit.id, habit.name, h.day)}
                            title={hasNote ? noteTooltip : isMultiClick ? `Click +1 · Shift+Click −1 · Ctrl+Click reset · Right-click note` : `Click to toggle · Right-click to add note`}
                          >
                            <div className={`day-cell ${checked ? 'checked' : ''} ${hasNote ? 'has-note' : ''} ${isPlanned ? 'plan-target' : ''}`}>
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
                        {(() => {
                          const ch = getActiveChallenges().find((c) => c.habitId === habit.id);
                          if (!ch) return null;
                          return (
                            <span
                              className="grid-challenge-chip"
                              title={`Active challenge: ${ch.name} — day ${Math.min(ch.days, 1 + Math.round((Date.now() - new Date(ch.startDate).getTime()) / 86400000))} of ${ch.days}`}
                            >
                              🎯
                            </span>
                          );
                        })()}
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
                    {/* Energy tracker row (% precision) */}
                    <tr className="energy-row">
                      <td className="col-drag-handle"></td>
                      <td className="col-habits">
                        <span className="mood-label energy-label">Énergie</span>
                      </td>
                      {dayHeaders.map((h) => {
                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
                        const energy = monthEnergies.get(h.day);
                        const isToday = isCurrentMonth && h.day === todayDay;
                        const color = energy === undefined ? undefined : energy >= 70 ? '#10b981' : energy >= 40 ? '#f59e0b' : '#ef4444';
                        return (
                          <td
                            key={h.day}
                            className={`col-day mood-cell energy-cell ${isToday ? 'today' : ''}`}
                            onClick={() => {
                              const cur = getEnergy(dateKey);
                              setEnergyPicker({ dateKey, label: `Jour ${h.day}`, value: cur ?? 50 });
                              setEnergyPickerInput(String(cur ?? 50));
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              const cur = getEnergy(dateKey);
                              setEnergy(dateKey, cur === undefined || cur <= 10 ? null : cur - 10);
                              setMonthEnergies(getMonthEnergies(year, month));
                            }}
                            title={energy !== undefined ? `Énergie : ${energy}% (clic = saisie précise, clic droit -10)` : 'Définir l’énergie (clic = saisie précise, clic droit -10)'}
                          >
                            <div className="day-cell energy-display" style={color ? { background: color + '22', color } : {}}>
                              {energy !== undefined ? `${energy}%` : '·'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="col-goal"></td>
                      <td className="col-achieved"></td>
                    </tr>
                    {/* Concentration tracker row (% precision) */}
                    <tr className="energy-row">
                      <td className="col-drag-handle"></td>
                      <td className="col-habits">
                        <span className="mood-label energy-label">🎯 Concentration</span>
                      </td>
                      {dayHeaders.map((h) => {
                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
                        const conc = monthConcentrations.get(h.day);
                        const isToday = isCurrentMonth && h.day === todayDay;
                        const color = conc === undefined ? undefined : conc >= 70 ? '#10b981' : conc >= 40 ? '#f59e0b' : '#ef4444';
                        return (
                          <td
                            key={h.day}
                            className={`col-day mood-cell energy-cell ${isToday ? 'today' : ''}`}
                            onClick={() => {
                              const cur = getConcentration(dateKey);
                              setConcPicker({ dateKey, label: `Jour ${h.day}`, value: cur ?? 50 });
                              setConcPickerInput(String(cur ?? 50));
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              const cur = getConcentration(dateKey);
                              setConcentration(dateKey, cur === undefined || cur <= 10 ? null : cur - 10);
                              setMonthConcentrations(getMonthConcentrations(year, month));
                            }}
                            title={conc !== undefined ? `Concentration : ${conc}% (clic = saisie précise, clic droit -10)` : 'Définir la concentration (clic = saisie précise, clic droit -10)'}
                          >
                            <div className="day-cell energy-display" style={color ? { background: color + '22', color } : {}}>
                              {conc !== undefined ? `${conc}%` : '·'}
                            </div>
                          </td>
                        );
                      })}
                      <td className="col-goal"></td>
                      <td className="col-achieved"></td>
                    </tr>
                    {/* Depression tracker row (% precision, high = bad) */}
                    <tr className="energy-row">
                      <td className="col-drag-handle"></td>
                      <td className="col-habits">
                        <span className="mood-label energy-label">🌧️ Dépression</span>
                      </td>
                      {dayHeaders.map((h) => {
                        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
                        const dep = monthDepressions.get(h.day);
                        const isToday = isCurrentMonth && h.day === todayDay;
                        const color = dep === undefined ? undefined : dep >= 70 ? '#ef4444' : dep >= 40 ? '#f59e0b' : '#10b981';
                        return (
                          <td
                            key={h.day}
                            className={`col-day mood-cell energy-cell ${isToday ? 'today' : ''}`}
                            onClick={() => {
                              const cur = getDepression(dateKey);
                              setDepPicker({ dateKey, label: `Jour ${h.day}`, value: cur ?? 20 });
                              setDepPickerInput(String(cur ?? 20));
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              const cur = getDepression(dateKey);
                              setDepression(dateKey, cur === undefined || cur <= 10 ? null : cur - 10);
                              setMonthDepressions(getMonthDepressions(year, month));
                            }}
                            title={dep !== undefined ? `Dépression : ${dep}% (clic = saisie précise, clic droit -10)` : 'Définir la dépression (clic = saisie précise, clic droit -10)'}
                          >
                            <div className="day-cell energy-display" style={color ? { background: color + '22', color } : {}}>
                              {dep !== undefined ? `${dep}%` : '·'}
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
            </>
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

            {/* Life Aspect Ratings (Capacities) — v0.3.2 */}
            <CapacitiesSummary habits={habits} allCheckIns={allCheckIns} />
          </div>
        </>
      ) : view === 'history' ? (
        <HistoryView checkIns={allCheckIns} habits={habits} />
      ) : view === 'year' ? (
        <YearView habits={habits} checkIns={allCheckIns} />
      ) : view === 'challenge' ? (
        <ChallengeView habits={habits} checkIns={allCheckIns} />
      ) : view === 'stacks' ? (
        <StacksView
          checkIns={allCheckIns}
          habits={habits}
          onSetParent={(childId, parentId, when) => {
            if (parentId) linkHabitToParentStore(childId, parentId, when ?? 'after');
            else unlinkHabitFromParentStore(childId);
          }}
        />
      ) : view === 'insights' ? (
        <InsightsView habits={habits} checkIns={allCheckIns} deepInsights={deepInsights} onLink={(childId, parentId) => {
          if (parentId) linkHabitToParentStore(childId, parentId);
          else void unlinkHabitFromParentStore(childId);
        }} onView={(newView) => setView(newView)} />
      ) : view === 'mantras' ? (
        <MantraView />
      ) : view === 'achievements' ? (
        <AchievementsView />
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
      ) : view === 'journal' ? (
        <JournalView />
      ) : view === 'psycho' ? (
        <div className="psycho-window">
          <div className="psycho-window-header">
            <h2>🧠 Psychoanalyse</h2>
            <p className="journal-subtitle">
              Vos mécanismes psychologiques vus à travers plusieurs écoles, et ce qui fonctionne pour vous.
            </p>
          </div>
          <PsychoanalysisView />
          <LeversView />
        </div>
      ) : view === 'projects' ? (
        <ProjectsView />
      ) : view === 'knowledge' ? (
        <KnowledgeView />
      ) : view === 'obsidian' ? (
        <ObsidianView />
      ) : view === 'missions' ? (
        <MissionsView />
      ) : view === 'correlations' ? (
        <CorrelationsView />
      ) : view === 'gains' ? (
        <GainsView />
      ) : (
        <ChaosView />
      )}
      </div>

      {/* Energy precision picker modal */}
      {energyPicker && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 300, padding: '1rem' }}
          onClick={() => setEnergyPicker(null)}
        >
          <div
            className="energy-picker-modal"
            style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: '14px', maxWidth: '380px', width: '100%', padding: '1.25rem 1.5rem', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Saisie précise de l'énergie"
          >
            <button
              onClick={() => setEnergyPicker(null)}
              style={{ position: 'absolute', top: '0.75rem', right: '0.9rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer' }}
              aria-label="Fermer"
            >✕</button>
            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem' }}>⚡ Énergie — {energyPicker.label}</h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Niveau d’énergie précis (0-100 %)
            </p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={energyPicker.value}
              onChange={(e) => {
                const v = Number(e.target.value);
                setEnergyPicker({ ...energyPicker, value: v });
                setEnergyPickerInput(String(v));
              }}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
              aria-label="Slider énergie"
            />
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
              <input
                type="number"
                min={0}
                max={100}
                value={energyPickerInput}
                onChange={(e) => {
                  setEnergyPickerInput(e.target.value);
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setEnergyPicker({ ...energyPicker, value: Math.max(0, Math.min(100, v)) });
                }}
                style={{ width: '80px', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '1rem', fontWeight: 700, textAlign: 'center' }}
                aria-label="Valeur exacte en pourcent"
              />
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>{energyPicker.value}%</span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setEnergy(energyPicker.dateKey, null);
                  setMonthEnergies(getMonthEnergies(year, month));
                  setEnergyPicker(null);
                }}
                style={{ marginLeft: 'auto' }}
              >Effacer</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEnergy(energyPicker.dateKey, energyPicker.value);
                  setMonthEnergies(getMonthEnergies(year, month));
                  setEnergyPicker(null);
                }}
              >Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Concentration precision picker modal */}
      {concPicker && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 300, padding: '1rem' }}
          onClick={() => setConcPicker(null)}
        >
          <div
            className="energy-picker-modal"
            style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: '14px', maxWidth: '380px', width: '100%', padding: '1.25rem 1.5rem', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Saisie précise de la concentration"
          >
            <button
              onClick={() => setConcPicker(null)}
              style={{ position: 'absolute', top: '0.75rem', right: '0.9rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer' }}
              aria-label="Fermer"
            >✕</button>
            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem' }}>🎯 Concentration — {concPicker.label}</h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Niveau de concentration précis (0-100 %)
            </p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={concPicker.value}
              onChange={(e) => {
                const v = Number(e.target.value);
                setConcPicker({ ...concPicker, value: v });
                setConcPickerInput(String(v));
              }}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
              aria-label="Slider concentration"
            />
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
              <input
                type="number"
                min={0}
                max={100}
                value={concPickerInput}
                onChange={(e) => {
                  setConcPickerInput(e.target.value);
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setConcPicker({ ...concPicker, value: Math.max(0, Math.min(100, v)) });
                }}
                style={{ width: '80px', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '1rem', fontWeight: 700, textAlign: 'center' }}
                aria-label="Valeur exacte en pourcent"
              />
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>{concPicker.value}%</span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setConcentration(concPicker.dateKey, null);
                  setMonthConcentrations(getMonthConcentrations(year, month));
                  setConcPicker(null);
                }}
                style={{ marginLeft: 'auto' }}
              >Effacer</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConcentration(concPicker.dateKey, concPicker.value);
                  setMonthConcentrations(getMonthConcentrations(year, month));
                  setConcPicker(null);
                }}
              >Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Depression precision picker modal + alert threshold */}
      {depPicker && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 300, padding: '1rem' }}
          onClick={() => setDepPicker(null)}
        >
          <div
            className="energy-picker-modal"
            style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: '14px', maxWidth: '380px', width: '100%', padding: '1.25rem 1.5rem', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Saisie précise de la dépression"
          >
            <button
              onClick={() => setDepPicker(null)}
              style={{ position: 'absolute', top: '0.75rem', right: '0.9rem', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer' }}
              aria-label="Fermer"
            >✕</button>
            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem' }}>🌧️ Dépression — {depPicker.label}</h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Niveau de dépression perçu (0-100 %) — élevé = vigilance.
            </p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={depPicker.value}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDepPicker({ ...depPicker, value: v });
                setDepPickerInput(String(v));
              }}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
              aria-label="Slider dépression"
            />
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
              <input
                type="number"
                min={0}
                max={100}
                value={depPickerInput}
                onChange={(e) => {
                  setDepPickerInput(e.target.value);
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setDepPicker({ ...depPicker, value: Math.max(0, Math.min(100, v)) });
                }}
                style={{ width: '80px', padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '1rem', fontWeight: 700, textAlign: 'center' }}
                aria-label="Valeur exacte en pourcent"
              />
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ef4444' }}>{depPicker.value}%</span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setDepression(depPicker.dateKey, null);
                  setMonthDepressions(getMonthDepressions(year, month));
                  setDepPicker(null);
                }}
                style={{ marginLeft: 'auto' }}
              >Effacer</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.7rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Alerte si la dépression du jour ≥
              <input
                type="number"
                min={0}
                max={100}
                value={depThreshold}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const clamped = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
                  setDepThreshold(clamped);
                  updatePreferences({ depressionAlertThreshold: clamped });
                }}
                style={{ width: '64px', padding: '0.3rem 0.5rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontWeight: 700, textAlign: 'center' }}
                aria-label="Seuil d'alerte dépression"
              />
              %
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setDepression(depPicker.dateKey, depPicker.value);
                  setMonthDepressions(getMonthDepressions(year, month));
                  setDepPicker(null);
                }}
              >Enregistrer</button>
            </div>
          </div>
        </div>
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
                    <option value="energy">Energy</option>
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
                if (e.key === 'Escape') { setShowNewNoteInput(false); setNewNoteContent(''); setNewNoteCategory(''); }
              }}
            />
            <div className="add-note-row">
              <select
                className="note-category-select"
                value={newNoteCategory}
                onChange={(e) => setNewNoteCategory(e.target.value)}
                title="Tag this note as an achievement"
              >
                <option value="">— Not an achievement —</option>
                {getAchievementCategories().map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                ))}
              </select>
              <button className="btn btn-sm btn-primary" onClick={handleAddNote}>Save</button>
            </div>
          </div>
          {notes.length > 0 && (
            <ul className="notes-list">
              {notes.map((note) => {
                const catId = note.achievementCategory;
                const cat = catId ? getAchievementCategories().find((c) => c.id === catId) : undefined;
                return (
                  <li key={note.id} className="notes-item">
                    <span className="notes-content">{note.content}</span>
                    <select
                      className={`note-category-badge ${cat ? 'tagged' : ''}`}
                      value={catId ?? ''}
                      onChange={(e) => tagNoteAchievement(note.id, e.target.value || null)}
                      title={cat ? `Achievement: ${cat.name}` : 'Tag as achievement'}
                      aria-label="Achievement category"
                      style={cat ? { background: cat.color } : undefined}
                    >
                      <option value="">Tag…</option>
                      {getAchievementCategories().map((c) => (
                        <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                      ))}
                    </select>
                    <span className="notes-date">
                      {new Date(note.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </span>
                    <button className="notes-delete" onClick={() => handleDeleteNote(note.id)} title="Delete">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </li>
                );
              })}
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
  deepInsights,
}: {
  habits: Habit[];
  checkIns: CheckIn[];
  onLink: (childId: string, parentId: string | null) => void;
  onView: (_v: 'grid' | 'stats' | 'correlations' | 'history' | 'stacks' | 'chaos' | 'insights' | 'mantras' | 'settings' | 'today' | 'year' | 'challenge' | 'experiments' | 'skills' | 'urges' | 'journal' | 'knowledge') => void;
  deepInsights: DeepInsight[];
}) {
// Data change tick: urges/moods/levers/capacities are read via exportAllData()
  // inside the memos below, so the deps alone (habits, checkIns) never recompute
  // when those change. Subscribing to the store refreshes everything.
  const [storeTick, setStoreTick] = useState(0);
  useEffect(() => subscribe(() => setStoreTick((t) => t + 1)), []);

  const { recommendations, generatedAt } = useMemo(
    () => {
      try {
        const allData = exportAllData();
        return generateInsights(habits, checkIns, new Date(), allData.moods ?? {}, {
          urges: allData.urges ?? [],
          capacities: allData.capacities ?? [],
          capacityRatings: allData.capacityRatings ?? [],
          experiments: allData.experiments ?? [],
          notes: allData.notes ?? [],
          journalEntries: allData.journalEntries ?? [],
          reflections: allData.reflections ?? [],
        });
      } catch { return generateInsights(habits, checkIns); }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habits, checkIns, storeTick],
  );

  // Recommendation freshness: drop set-aside recs, rotate by day, cap the burst
  // so the same headline doesn't loop forever (v0.6.1).
  const dismissed = useMemo(() => {
    try { return getDismissedRecs(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTick]);
  const visibleRecs = useMemo(
    () => rotateRecommendations(recommendations, dismissed, new Date(), 10),
    [recommendations, dismissed],
  );
  const dismissAll = recommendations.length > 0 && visibleRecs.length === 0;

  // Compute correlations from available data
  const correlations = useMemo(() => {
    try {
      const allData = exportAllData();
      const caps = (allData.capacities ?? []).map(c => ({ id: c.id, name: c.name }));
      return computeCorrelations(habits, checkIns, allData.moods ?? {}, caps, allData.capacityRatings ?? [], allData.energies ?? {}, allData.concentrations ?? {});
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits, checkIns, storeTick]);

  const habitById = useMemo(() => {
    const m = new Map<string, Habit>();
    for (const h of habits) m.set(h.id, h);
    return m;
  }, [habits]);

  // --- Ollama Deep Analysis (auto-runs on mount, debounced) ---
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiStructured, setAiStructured] = useState<AiAnalysis | null>(null);
  // v0.6.4: the AI's structured analysis becomes insight cards shown first,
  // so Insights are also "based on the AI engine" — not just heuristics.
  const aiInsights = useMemo(
    () => (aiStructured ? aiAnalysisToInsights(aiStructured) : []),
    [aiStructured],
  );
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLastRun, setAiLastRun] = useState<number>(0);
  // Conversational coach (v0.3.4): keeps a short chat history so the AI
  // "remembers" the last analysis and can answer follow-up questions.
  const [chatHistory, setChatHistory] = useState<AiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const aiRanRef = useRef(false);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runDeepAnalysis = useCallback(async (force = false) => {
    // Debounce: don't re-run within 5 minutes unless forced
    const now = Date.now();
    if (!force && aiLastRun > 0 && now - aiLastRun < 5 * 60 * 1000) return;

    setAiLoading(true);
    setAiError(null);
    if (force) { setAiResponse(null); setAiStructured(null); }
    try {
      // Build a comprehensive report from ALL data (every note, every domain)
      // so the AI can analyze correlations and give life-level recommendations.
      const summary = buildAiContext(exportAllData());
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setAiResponse('Deep Analysis requires the desktop app. Ollama is not available in the browser.');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const response = await invoke<string>('analyze_habits', {
        summaryJson: summary,
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      setAiResponse(response);
      setAiStructured(parseAiAnalysis(response));
      setAiLastRun(Date.now());
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  }, [aiLastRun]);

  // Ask the coach a follow-up question (memory: includes last analysis).
  const askCoach = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || chatLoading) return;
    setChatHistory((h) => [...h, { role: 'user', content: question }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const summary = buildAiContext(exportAllData());
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setChatHistory((h) => [...h, { role: 'coach', content: 'Chat requires the desktop app (Ollama).' }]);
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const answer = await invoke<string>('ask_coach', {
        question,
        summaryJson: summary,
        lastAnalysis: aiResponse ?? '',
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      setChatHistory((h) => [...h, { role: 'coach', content: answer }]);
    } catch (e) {
      setChatHistory((h) => [...h, {
        role: 'coach',
        content: e instanceof Error ? `⚠️ ${e.message}` : '⚠️ Something went wrong while asking the coach.',
      }]);
    } finally {
      setChatLoading(false);
    }
  }, [aiResponse, chatLoading]);

  // Auto-run on first mount (after a short delay to let UI render)
  useEffect(() => {
    if (aiRanRef.current) return;
    aiRanRef.current = true;
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    aiDebounceRef.current = setTimeout(() => runDeepAnalysis(false), 1500);
    return () => {
      if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    };
  }, [runDeepAnalysis]);

  // Background auto-refresh: keep the AI analysis fresh without any button,
  // polling every minute. runDeepAnalysis's internal 5-minute debounce throttles
  // real (potentially slow) model calls, so this never hammers the provider.
  const deepRunRef = useRef(runDeepAnalysis);
  deepRunRef.current = runDeepAnalysis;
  useEffect(() => {
    const id = setInterval(() => deepRunRef.current(false), 60_000);
    return () => clearInterval(id);
  }, []);

  const kindIcon: Record<RecKind, string> = {
    MISS_PATTERN: '📉',
    STACK_SUGGESTION: '🔗',
    RECORD_APPROACH: '🔥',
    CHAOS_CORRELATION: '🌀',
    NEGLECTED: '⏰',
    PRIME_TIME: '⭐',
    CORRELATION: '🤝',
    WEEKLY_SUMMARY: '📋',
    STREAK_MILESTONE: '🎯',
    MANTRA_MATCH: '🧘',
    BURNOUT_RISK: '🫀',
    URGE_TRIGGER: '🎯',
    EXPERIMENT_RESULT: '🔬',
    NOTE_THEME: '📝',
    PERFECT_DAY: '🌟',
    WEEKLY_LETTER: '✉️',
    JOURNAL_THEME: '📓',
    REFLECTION_DUE: '💭',
    REFLECTION_REVIEW: '🔄',
    AI_PRIORITY: '🎯',
    AI_TREND: '📈',
    AI_RISK: '⚠️',
  };

  const kindAction: Record<RecKind, (r: Recommendation) => void> = {
    MISS_PATTERN: () => onView('history'),
    STACK_SUGGESTION: (rec) => {
      if (rec.habitIds.length >= 2) onLink(rec.habitIds[0], rec.habitIds[1]);
    },
    RECORD_APPROACH: () => onView('stats'),
    CHAOS_CORRELATION: () => onView('chaos'),
    NEGLECTED: () => onView('grid'),
    PRIME_TIME: () => onView('stats'),
    CORRELATION: (rec) => {
      if (rec.habitIds.length >= 2) onLink(rec.habitIds[0], rec.habitIds[1]);
    },
    WEEKLY_SUMMARY: () => onView('history'),
    STREAK_MILESTONE: () => onView('stats'),
    MANTRA_MATCH: () => onView('mantras'),
    BURNOUT_RISK: () => onView('history'),
    URGE_TRIGGER: () => onView('urges'),
    EXPERIMENT_RESULT: () => onView('experiments'),
    NOTE_THEME: () => onView('history'),
    PERFECT_DAY: () => onView('stats'),
    WEEKLY_LETTER: () => onView('history'),
    JOURNAL_THEME: () => onView('journal'),
    REFLECTION_DUE: () => onView('journal'),
    REFLECTION_REVIEW: () => onView('journal'),
    AI_PRIORITY: () => onView('journal'),
    AI_TREND: () => onView('journal'),
    AI_RISK: () => onView('journal'),
  };

  /** Mini month calendar with planned days highlighted — makes a plan visible. */
function MiniPlanCalendar({ dates, label }: { dates: string[]; label: string }) {
  const planned = useMemo(() => new Set(dates), [dates]);
  const todayStr = new Date().toISOString().slice(0, 10);
  // Grid spans from the first to the last planned date (padded to full weeks),
  // so the calendar is compact and always centered on the action days.
  const sorted = [...dates].sort();
  const start = sorted[0] ?? todayStr;
  const end = sorted[sorted.length - 1] ?? todayStr;
  const cells: { iso: string; day: number }[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  const padStart = (startDate.getUTCDay() + 6) % 7; // Monday-first offset
  for (let i = 0; i < padStart; i++) cells.push({ iso: '', day: 0 });
  const endDate = new Date(`${end}T00:00:00Z`);
  for (const cur = new Date(startDate); cur <= endDate; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const iso = cur.toISOString().slice(0, 10);
    cells.push({ iso, day: cur.getUTCDate() });
    if (cells.length > 62) break; // safety cap
  }
  return (
    <div className="mini-cal">
      <div className="mini-cal-label">{label}</div>
      <div className="mini-cal-grid">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <span key={`h${i}`} className="mini-cal-head">{d}</span>
        ))}
        {cells.map((c, i) =>
          c.iso === '' ? (
            <span key={`e${i}`} className="mini-cal-day empty" />
          ) : (
            <span
              key={c.iso}
              className={[
                'mini-cal-day',
                planned.has(c.iso) ? 'planned' : '',
                c.iso === todayStr ? 'today' : '',
                c.iso < todayStr ? 'past' : '',
              ].filter(Boolean).join(' ')}
              title={planned.has(c.iso) ? 'Jour planifié' : ''}
            >
              {c.day}
            </span>
          ),
        )}
      </div>
      <div className="mini-cal-legend">
        <span className="mini-cal-dot planned" /> jours à cocher · {dates.length} jours planifiés
      </div>
    </div>
  );
}

/** 8-week completion heatmap (Mon-first columns), clickable → grid. */
function EightWeekHeatmap({ checkIns }: { checkIns: CheckIn[] }) {
  const weeks = useMemo(() => {
    const byDay = new Map<string, { k: number; n: number }>();
    for (const ci of checkIns) {
      const e = byDay.get(ci.date) ?? { k: 0, n: 0 };
      e.n++;
      if (ci.completed) e.k++;
      byDay.set(ci.date, e);
    }
    const today = new Date();
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) + 6); // Sunday of current week
    const cols: { iso: string; rate: number | null; future: boolean }[][] = [];
    for (let w = 7; w >= 0; w--) {
      const col: { iso: string; rate: number | null; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(end);
        dt.setUTCDate(end.getUTCDate() - w * 7 + d - 6);
        void d;
        const iso = dt.toISOString().slice(0, 10);
        const e = byDay.get(iso);
        col.push({ iso, rate: e && e.n > 0 ? e.k / e.n : null, future: iso > today.toISOString().slice(0, 10) });
      }
      cols.push(col);
    }
    return cols;
  }, [checkIns]);
  return (
    <div className="heatmap8">
      <div className="heatmap8-title">🗓️ 8 dernières semaines — intensité de complétion</div>
      <div className="heatmap8-grid" role="img" aria-label="Heatmap des 8 dernières semaines">
        {weeks.map((col, i) => (
          <div key={i} className="heatmap8-col">
            {col.map((c) => (
              <span
                key={c.iso}
                className={`heatmap8-cell ${c.future ? 'future' : c.rate === null ? 'none' : c.rate >= 0.75 ? 'l4' : c.rate >= 0.5 ? 'l3' : c.rate >= 0.25 ? 'l2' : c.rate > 0 ? 'l1' : 'l0'}`}
                title={`${c.iso}${c.rate !== null ? ` — ${Math.round(c.rate * 100)}%` : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Weekly review: one compiled panel, computed from the last 14 days ---
  const weeklyReview = useMemo(() => {
    try {
      const today = new Date();
      const t = today.toISOString().slice(0, 10);
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
      const s0 = monday.toISOString().slice(0, 10);
      const prevStart = new Date(monday);
      prevStart.setUTCDate(monday.getUTCDate() - 7);
      const doneByDay = new Map<string, number>();
      for (const ci of checkIns) {
        if (!ci.completed) continue;
        doneByDay.set(ci.date, (doneByDay.get(ci.date) ?? 0) + (ci.count ?? 1));
      }
      let cur = 0; let daysCur = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + i);
        const iso = d.toISOString().slice(0, 10);
        if (iso > t) break;
        cur += doneByDay.get(iso) ?? 0;
        daysCur++;
      }
      let prev = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(prevStart);
        d.setUTCDate(prevStart.getUTCDate() + i);
        prev += doneByDay.get(d.toISOString().slice(0, 10)) ?? 0;
      }
      // Plan adherence (circled days already past)
      let plannedPast = 0; let planHit = 0;
      for (const c of deepInsights) {
        if (!c.plan) continue;
        const hid = c.id.split('|')[1];
        for (const d of c.plan.dates) {
          if (d > t || !hid) continue;
          plannedPast++;
          if (checkIns.some((x) => x.habitId === hid && x.date === d && x.completed)) planHit++;
        }
      }
      const perDay = daysCur > 0 ? (cur / daysCur).toFixed(1) : '0';
      const deltaTxt = prev > 0 ? ` (${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)}%)` : '';
      return (
        <div className="deep-card weekly-review">
          <div className="deep-icon">📋</div>
          <div className="deep-body">
            <div className="deep-title">Revue — semaine du {s0}</div>
            <div className="deep-text">
              {cur} coches en {daysCur} j (~{perDay}/jour){deltaTxt} vs semaine passée ({prev}).
              {plannedPast > 0 && <> Adhérence au plan : <strong>{planHit}/{plannedPast}</strong> jours cerclés cochés.</>}
              {' '}Objectif simple : battre ~{perDay}/jour la semaine prochaine.
            </div>
            <div className="heatmap8-wrap"><EightWeekHeatmap checkIns={checkIns} /></div>
          </div>
        </div>
      );
    } catch { return null; }
  }, [checkIns, deepInsights]);

  // --- ONE directive: the single highest-leverage action for TODAY ---
  const todayDirective = useMemo((): { icon: string; text: string } | null => {
    const t = new Date().toISOString().slice(0, 10);
    // 1. A planned day for today? → check it.
    for (const c of deepInsights) {
      if (!c.plan) continue;
      const hid = c.id.split('|')[1];
      if (!hid || !c.plan.dates.includes(t)) continue;
      const name = habits.find((h) => h.id === hid)?.name ?? 'ton habitude';
      return { icon: '🎯', text: `Aujourd'hui = jour planifié : coche « ${name} ». C'est LE geste du plan.` };
    }
    // 2. Streak at risk? → its mitigation.
    const risk = deepInsights.find((c) => c.id.startsWith('streakrisk'));
    if (risk) return { icon: risk.icon, text: risk.body.split('. ').slice(0, 2).join('.') + '.' };
    // 3. Interference? → avoid the cannibal pair today.
    const inter = deepInsights.find((c) => c.id.startsWith('cannibal'));
    if (inter) return { icon: inter.icon, text: inter.title.replace('Interférence : ', '') + ' — décale la seconde aujourd\'hui.' };
    // 4. Fallback: weakest habit micro-check (2-minute version).
    return null;
  }, [deepInsights, habits]);

  // --- Deep analysis cards (data hoisted from App so Grid can circle plan days) ---
  const deepSection = deepInsights.length > 0 && (
    <div className="deep-section">
      <h3 className="deep-section-title">🔬 Analyse en profondeur</h3>
      {todayDirective && (
        <div className="today-directive">
          <span className="td-icon">{todayDirective.icon}</span>
          <span className="td-text"><strong>Action du jour :</strong> {todayDirective.text}</span>
        </div>
      )}
      {weeklyReview}
      <div className="deep-list">
        {deepInsights.map((card) => (
          <div key={card.id} className="deep-card">
            <div className="deep-icon">{card.icon}</div>
            <div className="deep-body">
              <div className="deep-title">{card.title}</div>
              <div className="deep-text">{card.body}</div>
              {card.plan && card.plan.dates.length > 0 && (
                <>
                  <MiniPlanCalendar dates={card.plan.dates} label={card.plan.label} />
                  <button
                    className="btn btn-sm btn-ghost plan-ics-btn"
                    onClick={() => {
                      const hid = card.id.split('|')[1];
                      const name = habitById.get(hid)?.name ?? 'habitude';
                      downloadPlanIcs(`lifetrack-plan-${name}`, `LifeTrack — ${name}`, card.plan!.label, card.plan!.dates);
                    }}
                    title="Importer les jours planifiés dans Google Calendar / Outlook"
                  >
                    ⬇ Exporter le plan (.ics)
                  </button>
                </>
              )}
              <div className="deep-stat">{card.stat}</div>
            </div>
            {card.action && (
              <button
                className="btn btn-sm btn-primary deep-action"
                onClick={() => onView(card.action!.view)}
              >
                {card.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="deep-note">
        Chaque carte porte son échantillon et sa significativité — si c'est écrit, c'est mesuré sur TES données.
      </p>
    </div>
  );

  // AI Section — collapsible, sits BELOW the local deep analysis. The local
  // engine is the source of truth; the AI coach is a bonus lens, not the hero.
  const [aiCollapsed, setAiCollapsed] = useState(true);
  const aiSection = (
    <div className={`ai-section ${aiCollapsed ? 'ai-collapsed' : ''}`}>
      <div className="ai-section-header">
        <button className="ai-collapse-toggle" onClick={() => setAiCollapsed((v) => !v)} aria-expanded={!aiCollapsed}>
          {aiCollapsed ? '▸' : '▾'} <span className="ai-section-title">🤖 Coach IA</span>
        </button>
        <span className="ai-section-status">
          {aiLoading ? (
            <span className="ai-loading">Analyse en cours…</span>
          ) : aiResponse ? (
            <span className="ai-fresh">maj {new Date(aiLastRun).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          ) : aiError ? (
            <span className="ai-error-text">{aiError}</span>
          ) : (
            <span className="ai-pending">en attente…</span>
          )}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => runDeepAnalysis(true)}
          disabled={aiLoading}
          title="Refresh AI analysis"
        >
          {aiLoading ? '⏳' : '🔄'}
        </button>
      </div>
      {!aiCollapsed && (<>
      {aiResponse ? (
        aiStructured ? (
          <div className="ai-analysis">
            {aiStructured.summary && (
              <div className="ai-summary">{aiStructured.summary}</div>
            )}
            {aiStructured.next_step && (
              <div className="ai-block ai-block-next">
                <div className="ai-block-title">💡 Next step</div>
                <div className="ai-item">
                  <div className="ai-item-detail">{aiStructured.next_step}</div>
                </div>
              </div>
            )}
            {(!aiStructured.summary && !aiStructured.next_step) && (
              <div className="ai-item-detail">
                Les priorités, tendances et risques de l'IA sont affichés dans la liste Insights ci-dessous.
              </div>
            )}
          </div>
        ) : (
          <div className="ai-response-card">
            <div className="ai-response-body">{aiResponse}</div>
          </div>
        )
      ) : aiLoading ? (
        <div className="ai-response-card ai-placeholder">
          <div className="ai-response-body" style={{ color: 'var(--text-muted)' }}>
            ⏳ Connecting to Ollama... (first load may take 1-3 min while a local model loads)
          </div>
        </div>
      ) : aiError ? (
        <div className="ai-response-card ai-placeholder">
          <div className="ai-response-body" style={{ color: 'var(--text-muted)' }}>
            ❌ {aiError}
            <br /><br />
            <strong>Troubleshooting:</strong>
            <ol style={{textAlign:'left', display:'inline-block', marginTop:8}}>
              <li>Make sure Ollama is running: <code>ollama serve</code></li>
              <li>Test it: <code>curl http://localhost:11434/api/tags</code></li>
              <li>Click the 🔄 button to retry</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="ai-response-card ai-placeholder">
          <div className="ai-response-body" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            AI analysis will appear here automatically. Make sure Ollama is running (<code>ollama serve</code>).
          </div>
        </div>
      )}
      {/* --- Conversational coach (v0.3.4): follow-up questions with memory --- */}
      {aiResponse && (
        <div className="ai-chat">
          <div className="ai-chat-history">
            {chatHistory.length === 0 && (
              <div className="ai-chat-empty">
                💬 Ask a follow-up about your analysis — e.g. "Why is my energy habit slipping?" or "What should I focus on today?"
              </div>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} className={`ai-chat-msg ai-chat-${m.role}`}>
                <span className="ai-chat-who">{m.role === 'user' ? 'You' : 'Coach'}</span>
                <span className="ai-chat-content">{m.content}</span>
              </div>
            ))}
            {chatLoading && (
              <div className="ai-chat-msg ai-chat-coach">
                <span className="ai-chat-who">Coach</span>
                <span className="ai-chat-content ai-chat-thinking">thinking…</span>
              </div>
            )}
          </div>
          <form
            className="ai-chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatInput.trim()) askCoach(chatInput);
            }}
          >
            <input
              className="ai-chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask your coach a question…"
              disabled={chatLoading}
            />
            <button className="btn btn-sm btn-primary" type="submit" disabled={chatLoading || !chatInput.trim()}>
              {chatLoading ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
      </>)}
    </div>
  );

  if (recommendations.length === 0 && deepInsights.length === 0) {
    return (
      <div className="insights-view">
        {aiSection}
        <div className="insights-empty">
          <span style={{ fontSize: 40, display: 'block', marginBottom: 16 }}>💡</span>
          <h3>Not enough data yet</h3>
          <p>
            Track your habits consistently for a week, and I'll start surfacing
            personalized insights — no cloud, no AI API, all local.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => onView('grid')}>
              Go to Grid
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="insights-view">
      {/* --- Deep analysis FIRST: local, measured, visual --- */}
      {deepSection}

      {/* --- Local Recommendations --- */}
      <div className="insights-header">
        <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:6}}><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>Insights</h2>
        <span className="insights-subtitle">
          {visibleRecs.length + aiInsights.length} recommendation{visibleRecs.length + aiInsights.length > 1 ? 's' : ''}{aiInsights.length > 0 ? ` — ${aiInsights.length} IA + ${visibleRecs.length} local` : ' — 100% local'}
          <span className="insights-generated" title="Recomputed when your data changes">
            · {new Date(generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </span>
        </span>
      </div>

      <div className="insights-list">
        {aiInsights.length > 0 && (
          <div className="insights-ai-banner">
            🤖 Recommandations de l'IA coach
          </div>
        )}
        {aiInsights.map((rec, i) => (
          <div key={`ai-${i}`} className={`insight-card insight-ai insight-${rec.kind.toLowerCase()}`}>
            <div className="insight-icon">{kindIcon[rec.kind]}</div>
            <div className="insight-body">
              <div className="insight-title">{rec.title}</div>
              <div className="insight-detail">{rec.detail}</div>
              <div className="insight-meta">
                <span className="insight-strength" style={{ '--pct': `${rec.strength}%` } as Record<string, string>}>
                  Relevance {rec.strength}%
                </span>
              </div>
            </div>
          </div>
        ))}
        {dismissAll ? (
          <div className="insights-empty">
            <span style={{ fontSize: 40, display: 'block', marginBottom: 12 }}>✅</span>
            <h3>Recommandations mises de côté</h3>
            <p>
              Tu as écarté toutes les suggestions actuelles — elles ne réapparaîtront pas en boucle.
              Réaffiche-les à tout moment, ou laisse la rotation quotidienne te présenter d'autres reco.
            </p>
            <button className="btn btn-primary" onClick={resetDismissedRecs}>
              ↺ Réafficher les recommandations
            </button>
          </div>
        ) : visibleRecs.map((rec, i) => {
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
                  <button
                    className="btn btn-sm btn-ghost insight-dismiss"
                    onClick={() => dismissRec(recKey(rec))}
                    title="Ne plus me montrer celle-ci"
                    aria-label="Mettre de côté"
                  >
                    ✕ Pas maintenant
                  </button>
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

      {/* Correlations live in the dedicated tab — just point to it */}
      {correlations.filter((c) => c.significant).length > 0 && (
        <p className="correlations-note" style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          🔗 {correlations.filter((c) => c.significant).length} corrélation(s) significative(s) — matrice, lag, scatter dans l'onglet{' '}
          <button className="btn btn-sm btn-ghost" onClick={() => onView('correlations')}>Corrélations →</button>
        </p>
      )}

      {/* --- AI Coach LAST (collapsible): bonus lens, not the hero --- */}
      {aiSection}

      </div>
  );
}
