import type { AppData, Habit, CheckIn, Note, ChaosDimension, ChaosTrigger } from './types';
import { computeStreakStats } from './stats';
import {
  linkHabitToParentInPlace,
  unlinkHabitInPlace,
  clearDanglingStackParentsInPlace,
  computeStacks,
  getNextStackSuggestion,
  type StackStatus,
} from './stacks';

// --- Storage envelope ---
// Wraps app data with versioning and an integrity checksum.
// On load: hash mismatch → try backup → backup also bad → start fresh.
// On save: primary → backup, with debouncing to avoid thrashing.

interface StorageEnvelope {
  v: 1;          // schema version (for future migrations)
  d: AppData;    // payload
  h: string;     // FNV-1a 32-bit hex checksum of JSON.stringify(d)
}

const STORAGE_KEY = 'lifetrack-data';
const BACKUP_KEY = 'lifetrack-data-backup';
const FILE_BACKUP_NAME = 'lifetrack-persistent.json'; // filesystem fallback (Tauri)
const HABIT_COLORS = ['#FEF3C7', '#D1FAE5', '#DBEAFE', '#FCE7F3', '#E0E7FF', '#FEE2E2', '#EDE9FE', '#FEF9C3'];

// --- FNV-1a hash (32-bit) for data integrity, not security ---
function fnv1a(str: string): string {
  let hash = 2166136261 >>> 0; // offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // prime
  }
  return hash.toString(16).padStart(8, '0');
}

// --- localStorage availability guard ---
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__lifetrack_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

// --- Sanitize: filter out malformed entries from parsed data ---
function sanitizeData(raw: unknown): AppData {
  const empty: AppData = { habits: [], checkIns: [], notes: [], chaosDimensions: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const obj = raw as Record<string, unknown>;
  function isValidHabit(x: unknown): x is Habit {
    if (!x || typeof x !== 'object') return false;
    const h = x as Record<string, unknown>;
    if (typeof h.id !== 'string' || typeof h.name !== 'string') return false;
    // Validate chaos fields if present
    if (h.chaosDimension !== undefined && h.chaosDimension !== null && typeof h.chaosDimension !== 'string') return false;
    if (h.chaosDimension === '' || h.chaosDimension === null) {
      // Unlinked habit — clear other chaos fields
      delete h.chaosImpact;
      delete h.chaosThresholdDays;
    }
    if (h.chaosImpact !== undefined && (typeof h.chaosImpact !== 'number' || !Number.isFinite(h.chaosImpact))) return false;
    if (h.chaosThresholdDays !== undefined && (typeof h.chaosThresholdDays !== 'number' || h.chaosThresholdDays < 1 || !Number.isFinite(h.chaosThresholdDays))) return false;
    // Validate why/intentions: if present, must be an array of strings, max 5
    if (h.why !== undefined) {
      if (!Array.isArray(h.why)) return false;
      if (h.why.length > 5) return false;
      if (h.why.some((s: unknown) => typeof s !== 'string')) return false;
    }
    return true;
  }
  function isValidCheckIn(x: unknown): x is CheckIn {
    if (!x || typeof x !== 'object') return false;
    const c = x as Record<string, unknown>;
    return typeof c.habitId === 'string'
      && typeof c.date === 'string'
      && isValidDateKey(c.date)
      && typeof c.completed === 'boolean';
  }
  function isValidNote(x: unknown): x is Note {
    return !!(x && typeof x === 'object' && 'id' in (x as object) && 'content' in (x as object));
  }
  return {
    habits: Array.isArray(obj.habits) ? obj.habits.filter(isValidHabit) : [],
    checkIns: Array.isArray(obj.checkIns) ? obj.checkIns.filter(isValidCheckIn) : [],
    notes: Array.isArray(obj.notes) ? obj.notes.filter(isValidNote) : [],
    chaosDimensions: Array.isArray(obj.chaosDimensions) ? obj.chaosDimensions as ChaosDimension[] : getDefaultChaosDimensions(),
  };
}

// --- Deduplicate habits in place ---
// Defensive cleanup for data that may have been corrupted by older versions
// of the import flow that did not deduplicate by name. Groups habits by
// normalized name, keeps the primary (first by order) for each group, and
// remaps all check-ins and notes from duplicate IDs to the primary. Orphan
// check-ins (referencing deleted/missing habits) are kept but logged so the
// data is not silently destroyed.
export function deduplicateDataInPlace(d: AppData): { removed: number; remappedCheckIns: number; remappedNotes: number; orphanCheckIns: number; orphanNotes: number } {
  const result = { removed: 0, remappedCheckIns: 0, remappedNotes: 0, orphanCheckIns: 0, orphanNotes: 0 };
  if (!d.habits || d.habits.length === 0) return result;

  // Group habits by normalized name, preserving insertion order
  const groups = new Map<string, Habit[]>();
  for (const habit of d.habits) {
    const key = normalizeHabitName(habit.name);
    const list = groups.get(key);
    if (list) list.push(habit);
    else groups.set(key, [habit]);
  }

  // Build id -> primary id map for duplicates
  const idRemap = new Map<string, string>();
  const survivors: Habit[] = [];
  for (const [, list] of groups) {
    if (list.length === 1) {
      survivors.push(list[0]);
      continue;
    }
    // Primary = first by order, tiebreak by createdAt ascending
    const sorted = [...list].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    const primary = sorted[0];
    survivors.push(primary);
    for (const dup of sorted.slice(1)) {
      idRemap.set(dup.id, primary.id);
      result.removed++;
    }
  }

  d.habits = survivors;

  // Remap check-ins: known duplicates -> primary; orphans stay but are logged
  if (d.checkIns) {
    for (const ci of d.checkIns) {
      const remapped = idRemap.get(ci.habitId);
      if (remapped) {
        ci.habitId = remapped;
        result.remappedCheckIns++;
      } else if (!survivors.find((h) => h.id === ci.habitId)) {
        result.orphanCheckIns++;
      }
    }
  }

  // Remap notes similarly
  if (d.notes) {
    for (const note of d.notes) {
      if (!note.habitId) continue;
      const remapped = idRemap.get(note.habitId);
      if (remapped) {
        note.habitId = remapped;
        result.remappedNotes++;
      } else if (!survivors.find((h) => h.id === note.habitId)) {
        result.orphanNotes++;
      }
    }
  }

  if (result.removed > 0 || result.orphanCheckIns > 0 || result.orphanNotes > 0) {
    console.info(
      `[LifeTrack] Dedupe: removed ${result.removed} duplicate habits, remapped ${result.remappedCheckIns} check-ins, ${result.remappedNotes} notes. Orphaned: ${result.orphanCheckIns} check-ins, ${result.orphanNotes} notes.`
    );
  }
  return result;
}

// --- Read envelope from a key, verifying checksum ---
function readEnvelope(key: string): AppData | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Handle storage envelope format {v, d, h}
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 'd' in parsed && 'h' in parsed) {
      const envelope = parsed as StorageEnvelope;
      if (envelope.v !== 1) return null;
      const expectedHash = fnv1a(JSON.stringify(envelope.d));
      if (expectedHash !== envelope.h) {
        console.warn(`Checksum mismatch on key "${key}" — data may be corrupted`);
        return null;
      }
      return sanitizeData(envelope.d);
    }
    // Legacy fallback: raw AppData without envelope (pre-v1 storage)
    // Migrate it to envelope format on next save
    console.info(`Migrating legacy data from key "${key}"`);
    return sanitizeData(parsed);
  } catch {
    return null;
  }
}

// --- Load: try primary, then backup, then legacy migration, then empty ---
function loadData(): AppData {
  if (!isLocalStorageAvailable()) {
    // localStorage unavailable (private browsing, storage full).
    // The file backup at %APPDATA%/LifeTrack/ can be imported manually
    // via the Import JSON button in the export menu.
    return freshData();
  }
  const primary = readEnvelope(STORAGE_KEY);
  if (primary) {
    deduplicateDataInPlace(primary);
    return primary;
  }
  const backup = readEnvelope(BACKUP_KEY);
  if (backup) {
    console.warn('Primary storage corrupted or missing — recovered from backup');
    deduplicateDataInPlace(backup);
    return backup;
  }
  // Last resort: try to read raw legacy JSON and migrate it
  const migrated = migrateLegacyPrimaryData();
  if (migrated) return migrated;
  // If we got here, all localStorage is empty or corrupt.
  // The file backup at %APPDATA%/LifeTrack/ may have data from a
  // previous install or browser session. Schedule an async check.
  scheduleFileRecoveryAttempt();
  return freshData();
}

// Signal that a file recovery should be attempted on next Tauri startup.
let fileRecoveryNeeded = false;

function scheduleFileRecoveryAttempt(): void {
  fileRecoveryNeeded = true;
}

export function isFileRecoveryNeeded(): boolean {
  return fileRecoveryNeeded;
}

export function clearFileRecoveryFlag(): void {
  fileRecoveryNeeded = false;
}

function freshData(): AppData {
  return { habits: [], checkIns: [], notes: [], chaosDimensions: [] };
}

// --- Write envelope to a key ---
function writeEnvelope(key: string, data: AppData): boolean {
  if (!isLocalStorageAvailable()) return false;
  try {
    const json = JSON.stringify(data);
    const envelope: StorageEnvelope = {
      v: 1,
      d: data,
      h: fnv1a(json),
    };
    localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch (e) {
    console.warn(`Failed to write to "${key}"`, e);
    return false;
  }
}

// --- Filesystem persistence (Tauri) ---
// Writes a raw JSON copy to disk as a tertiary backup layer.
// On desktop, survives localStorage wipes (browser cache clearing).
// On Android, writes to app-specific storage.
// Non-blocking — failures are logged but never crash the save.
let fileBackupTimer: ReturnType<typeof setTimeout> | null = null;
const FILE_BACKUP_DEBOUNCE_MS = 5000; // throttle disk writes (one every 5s max)

function scheduleFileBackup(d: AppData): void {
  if (fileBackupTimer !== null) return;
  fileBackupTimer = setTimeout(async () => {
    fileBackupTimer = null;
    try {
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) return;
      const [{ appDataDir }, { writeTextFile, exists, mkdir }] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-fs'),
      ]);
      const dir = await appDataDir();
      const fullDir = `${dir}LifeTrack`;
      const fullPath = `${fullDir}/${FILE_BACKUP_NAME}`;
      const dirExists = await exists(fullDir).catch(() => false);
      if (!dirExists) {
        await mkdir(fullDir, { recursive: true });
      }
      const json = JSON.stringify(d, null, 2);
      await writeTextFile(fullPath, json);
    } catch {
      // File backup is best-effort — localStorage is primary.
      // Failures (permissions, disk full) are silent.
    }
  }, FILE_BACKUP_DEBOUNCE_MS);
}

// --- Periodic auto-backup (every 15 min) ---
// Guarantees a disk copy even if the user is idle and no saves are triggered.
// Only active in Tauri (desktop); no-op in browser.
const PERIODIC_BACKUP_MS = 15 * 60 * 1000; // 15 minutes
let periodicBackupTimer: ReturnType<typeof setInterval> | null = null;

function startPeriodicBackup(): void {
  if (periodicBackupTimer !== null) return;
  const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauriEnv) return;
  periodicBackupTimer = setInterval(() => {
    try {
      // Only write if data has changed since last save.
      // We reuse scheduleFileBackup which has its own debounce.
      scheduleFileBackup(data);
    } catch {
      // Best-effort — silent failure.
    }
  }, PERIODIC_BACKUP_MS);
}

function stopPeriodicBackup(): void {
  if (periodicBackupTimer !== null) {
    clearInterval(periodicBackupTimer);
    periodicBackupTimer = null;
  }
}

// Start periodic backup at module init; clean up on page unload.
if (typeof window !== 'undefined') {
  startPeriodicBackup();
  window.addEventListener('beforeunload', () => {
    stopPeriodicBackup();
  });
}

// --- Debounced save ---
const SAVE_DEBOUNCE_MS = 100; // fast save to minimize data loss window
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;
let lastSavedAt: number = 0; // 0 = no save yet; set on first successful write
let saveInFlight = false; // prevent concurrent writes
let pendingData: AppData | null = null; // data to re-save once current save finishes

function doSave(d: AppData): void {
  if (saveInFlight) {
    // Queue the latest snapshot — will be picked up after the current save finishes.
    pendingData = d;
    return;
  }
  // Safety net: never overwrite existing data with empty data silently.
  // This protects against accidental data loss from migration bugs.
  if (d.habits.length === 0 && d.checkIns.length === 0 && d.notes.length === 0) {
    const existing = readEnvelope(STORAGE_KEY) || readEnvelope(BACKUP_KEY);
    // Also try reading raw legacy format
    if (!existing) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(BACKUP_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Check if raw data has content (legacy format)
          const hasContent = (Array.isArray(parsed.habits) && parsed.habits.length > 0) ||
                            (Array.isArray(parsed) && parsed.length > 0);
          if (hasContent) {
            console.error('SAFETY: refusing to overwrite non-empty data with empty data. Run migration first.');
            return;
          }
        }
      } catch { /* can't parse, proceed with save */ }
    }
    // Also protect note-only data: if any notes exist in storage, refuse overwrite.
    if (existing && (existing.habits.length > 0 || existing.checkIns.length > 0 || existing.notes.length > 0)) {
      console.error('SAFETY: refusing to overwrite existing data with empty data.');
      return;
    }
  }
  saveInFlight = true;
  try {
    const primaryOk = writeEnvelope(STORAGE_KEY, d);
    if (primaryOk) {
      const backupOk = writeEnvelope(BACKUP_KEY, d);
      if (!backupOk) {
        // Backup failed — surface the warning (was previously silent).
        console.warn('Backup write failed; primary is persisted but backup may be stale.');
      }
      lastSavedAt = Date.now();
      // Also schedule a file backup (best-effort, non-blocking).
      scheduleFileBackup(d);
    } else {
      // Primary failed — try backup as last resort
      const backupOk = writeEnvelope(BACKUP_KEY, d);
      if (backupOk) {
        lastSavedAt = Date.now();
      } else {
        console.error('Critical: both primary and backup storage failed. Data may be lost on reload.');
      }
    }
  } finally {
    saveInFlight = false;
    // If another save was requested while we were writing, run it now.
    if (pendingData !== null) {
      const next = pendingData;
      pendingData = null;
      doSave(next);
    }
  }
}

function scheduleSave(d: AppData): void {
  pendingSave = true;
  if (saveTimer !== null) return; // already scheduled
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!pendingSave) return;
    pendingSave = false;
    doSave(d);
  }, SAVE_DEBOUNCE_MS);
}

// Force immediate flush (useful before export, app close, or page unload).
// If a save is already in flight, the latest snapshot is queued and will be
// written as soon as the current save completes (no writes are lost).
export function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingSave) {
    pendingSave = false;
    doSave(data);
  } else if (saveInFlight) {
    // No new pending write, but a save is running — record the latest data so
    // the running save picks it up via its `pendingData` slot when it finishes.
    pendingData = data;
  }
}

// Auto-flush on page unload to prevent data loss
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushSave());
  // Periodic save every 15s as safety net for long sessions
  const _flushInterval = setInterval(() => { if (pendingSave) flushSave(); }, 15000);
  window.addEventListener('beforeunload', () => { clearInterval(_flushInterval); flushSave(); });
}

// --- Last saved timestamp (for UI feedback) ---
export function getLastSaved(): number {
  return lastSavedAt;
}

// --- Undo / Redo ---
interface UndoEntry {
  habitId: string;
  date: string;
  previousState: boolean; // was it checked before the toggle?
}
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX_UNDO = 50;

export function pushUndo(habitId: string, date: string, previousState: boolean): void {
  undoStack.push({ habitId, date, previousState });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

export function undoLastToggle(): UndoEntry | null {
  const entry = undoStack.pop();
  if (!entry) return null;
  redoStack.push({ ...entry, previousState: !entry.previousState });
  // Guard: if the habit was deleted in the meantime, the undo is a no-op.
  // We still keep the entry on the redo stack so the user can redo if they
  // re-create the habit later. But we must not reinsert ghost check-ins.
  if (!data.habits.some((h) => h.id === entry.habitId)) {
    notify();
    return entry;
  }
  // Reverse the toggle
  const existing = getCheckIn(entry.habitId, entry.date);
  if (existing) {
    existing.completed = entry.previousState;
  } else if (entry.previousState) {
    data.checkIns.push({ habitId: entry.habitId, date: entry.date, completed: true });
  }
  notify();
  return entry;
}

export function redoLastUndo(): UndoEntry | null {
  const entry = redoStack.pop();
  if (!entry) return null;
  undoStack.push({ ...entry, previousState: !entry.previousState });
  if (!data.habits.some((h) => h.id === entry.habitId)) {
    notify();
    return entry;
  }
  const existing = getCheckIn(entry.habitId, entry.date);
  if (existing) {
    existing.completed = entry.previousState;
  } else if (entry.previousState) {
    data.checkIns.push({ habitId: entry.habitId, date: entry.date, completed: true });
  }
  notify();
  return entry;
}

// --- Storage health ---
export type StorageStatus = 'ok' | 'degraded' | 'unavailable';

export function getStorageStatus(): StorageStatus {
  if (!isLocalStorageAvailable()) return 'unavailable';
  // Check if both keys are readable
  const primary = readEnvelope(STORAGE_KEY);
  const backup = readEnvelope(BACKUP_KEY);
  if (primary && backup) return 'ok';
  if (primary || backup) return 'degraded';
  // Both missing but localStorage works — this is normal for first run
  return 'ok';
}

let data: AppData = loadData();

/**
 * Backfill personal records on habits loaded from older storage versions
 * that don't yet have bestStreak/longestGap persisted. Idempotent: only
 * touches habits where the record is missing. Cheap (one pass over habits).
 */
function backfillHabitRecords(): void {
  const today = new Date();
  for (const habit of data.habits) {
    if (habit.archived) continue;
    if (habit.bestStreak === undefined || habit.longestGap === undefined || habit.totalCompleted === undefined) {
      const stats = computeStreakStats(habit, data.checkIns, today);
      habit.bestStreak = stats.best;
      habit.bestStreakAt = stats.bestAt || undefined;
      habit.longestGap = stats.longestGap;
      habit.longestGapAt = stats.longestGapAt || undefined;
      habit.totalCompleted = stats.totalCompleted;
    }
  }
}

// Run once at startup so legacy data shows records immediately.
backfillHabitRecords();
const listeners = new Set<() => void>();

// Reset in-memory state and re-read from storage.
// Exported for test isolation; not needed in production.
export function resetStore(): void {
  // Flush any pending debounced save before resetting
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = false;
  // Clear undo/redo stacks
  undoStack.length = 0;
  redoStack.length = 0;
  data = loadData();
  backfillHabitRecords();
}

function notify() {
  recalculateHabitRecords();
  scheduleSave(data);
  listeners.forEach((fn) => fn());
}

/**
 * Recalculate persistent personal records (best streak, longest gap, total)
 * for every non-archived habit. Cheap: O(habits × tracked_days) and runs
 * synchronously after every mutation. The records are written back into
 * the Habit object so they survive a streak break — see the gap analysis
 * in docs/research/series_historique_benchmarks.md.
 */
function recalculateHabitRecords(): void {
  const today = new Date();
  for (const habit of data.habits) {
    if (habit.archived) continue;
    const stats = computeStreakStats(habit, data.checkIns, today);
    habit.bestStreak = stats.best;
    habit.bestStreakAt = stats.bestAt || undefined;
    habit.longestGap = stats.longestGap;
    habit.longestGapAt = stats.longestGapAt || undefined;
    habit.totalCompleted = stats.totalCompleted;
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getHabits(): Habit[] {
  return data.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
}

// --- Habits ---
export function addHabit(
  name: string,
  chaosOpts?: { chaosDimension?: string; chaosImpact?: number; chaosThresholdDays?: number },
): Habit {
  const maxOrder = data.habits.reduce((max, h) => Math.max(max, h.order), -1);
  const habit: Habit = {
    id: crypto.randomUUID(),
    name,
    color: '',
    goal: 0,
    createdAt: new Date().toISOString(),
    archived: false,
    order: maxOrder + 1,
    ...(chaosOpts?.chaosDimension ? { chaosDimension: chaosOpts.chaosDimension } : {}),
    ...(chaosOpts?.chaosImpact !== undefined ? { chaosImpact: chaosOpts.chaosImpact } : {}),
    ...(chaosOpts?.chaosThresholdDays !== undefined ? { chaosThresholdDays: chaosOpts.chaosThresholdDays } : {}),
  };
  // assign pastel color
  const usedColors = data.habits.map((h) => h.color).filter(Boolean);
  const available = HABIT_COLORS.find((c) => !usedColors.includes(c));
  habit.color = available || HABIT_COLORS[data.habits.length % HABIT_COLORS.length];

  data.habits.push(habit);
  notify();
  return habit;
}

export function updateHabit(id: string, updates: Partial<Habit>): void {
  const idx = data.habits.findIndex((h) => h.id === id);
  if (idx !== -1) {
    const cleaned = { ...updates };
    if ('chaosImpact' in cleaned) {
      const v = cleaned.chaosImpact;
      cleaned.chaosImpact = (typeof v === 'number' && Number.isFinite(v))
        ? Math.max(0, Math.min(100, v))
        : undefined;
    }
    if ('chaosThresholdDays' in cleaned) {
      const v = cleaned.chaosThresholdDays;
      cleaned.chaosThresholdDays = (typeof v === 'number' && Number.isFinite(v))
        ? Math.max(1, Math.min(90, Math.floor(v)))
        : undefined;
    }
    // If dimension is empty string or null, treat as unlinked
    if ('chaosDimension' in cleaned && (cleaned.chaosDimension === '' || cleaned.chaosDimension === null)) {
      cleaned.chaosDimension = undefined;
      cleaned.chaosImpact = undefined;
      cleaned.chaosThresholdDays = undefined;
    }
    // Validate why/intentions: trim, remove empty, cap at 5
    if ('why' in cleaned) {
      if (Array.isArray(cleaned.why)) {
        cleaned.why = cleaned.why
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter((s) => s.length > 0)
          .slice(0, 5);
        if (cleaned.why.length === 0) cleaned.why = undefined;
      } else {
        // Non-array value — discard it to avoid corrupting the habit
        delete cleaned.why;
      }
    }
    data.habits[idx] = { ...data.habits[idx], ...cleaned };
    notify();
  }
}

export function archiveHabit(id: string): void {
  updateHabit(id, { archived: true });
}

export function unarchiveHabit(id: string): void {
  updateHabit(id, { archived: false });
}

export function deleteHabit(id: string): void {
  // Clear any habits that reference this one as their stack parent BEFORE removal.
  clearDanglingStackParentsInPlace(data.habits, id);
  data.habits = data.habits.filter((h) => h.id !== id);
  data.checkIns = data.checkIns.filter((c) => c.habitId !== id);
  data.notes = data.notes.filter((n) => n.habitId !== id);
  notify();
}

// --- Stack API ---
// Thin wrappers around the pure helpers in `src/stacks.ts` so the UI has one
// stable import surface (`./store`) without leaking module split.

export function linkHabitToParent(habitId: string, parentId: string): boolean {
  const result = linkHabitToParentInPlace(data.habits, habitId, parentId);
  if (!result.ok) {
    if (result.reason === 'cycle') {
      console.warn('linkHabitToParent: cycle detected — refusing', { habitId, parentId });
    } else if (result.reason === 'self') {
      console.warn('linkHabitToParent: cannot link habit to itself', habitId);
    } else if (result.reason === 'missing') {
      console.warn('linkHabitToParent: habit or parent not found', { habitId, parentId });
    }
    return false;
  }
  notify();
  return true;
}

export function unlinkHabitFromParent(habitId: string): void {
  unlinkHabitInPlace(data.habits, habitId);
  notify();
}

export function getStacks(today: Date = new Date()): StackStatus[] {
  return computeStacks(data.habits, data.checkIns, today);
}

export function getNextStackSuggestionForToday(): {
  habitId: string; habitName: string; habitColor: string; rootName: string;
} | null {
  return getNextStackSuggestion(data.habits, data.checkIns, new Date());
}

export function getNextStackSuggestionFor(today: Date): {
  habitId: string; habitName: string; habitColor: string; rootName: string;
} | null {
  return getNextStackSuggestion(data.habits, data.checkIns, today);
}

/**
 * Reorder habits after a drag-and-drop. Reassigns `order` sequentially so we
 * never accumulate fractional-order gaps (which would still sort correctly
 * but create sparse integers over time as items are inserted/removed).
 *
 * `sourceIndex` and `destIndex` follow the `@hello-pangea/dnd` convention:
 * `destIndex` is the target position in the array AFTER the source has been
 * removed (i.e. if you drag item from index 0 to the bottom of 5 items, you
 * pass destination.index = 5, which becomes index 4 after removal).
 *
 * Only non-archived habits participate — archived habits keep their existing
 * order and are reinserted at the end if they were caught in the array.
 */
export function reorderHabits(sourceIndex: number, destIndex: number): void {
  // Operate on the non-archived list (what the UI shows), preserving order.
  const visible = data.habits.filter((h) => !h.archived);
  if (sourceIndex < 0 || sourceIndex >= visible.length) return;
  const clampedDest = Math.max(0, Math.min(destIndex, visible.length));
  if (sourceIndex === clampedDest) return;

  const [moved] = visible.splice(sourceIndex, 1);
  visible.splice(clampedDest, 0, moved);

  // Renumber sequentially starting at 0 — archived habits get the highest
  // orders so they sort last if someone ever unarchives them.
  let next = 0;
  for (const h of visible) {
    h.order = next++;
  }
  // Archived habits keep existing order; bump to next available space.
  const archived = data.habits.filter((h) => h.archived);
  for (const h of archived) {
    h.order = next++;
  }

  notify();
}

// --- Check-ins ---
export function getCheckIn(habitId: string, date: string): CheckIn | undefined {
  return data.checkIns.find((c) => c.habitId === habitId && c.date === date);
}

export function toggleCheckIn(habitId: string, date: string): CheckIn {
  const existing = getCheckIn(habitId, date);
  if (existing) {
    pushUndo(habitId, date, existing.completed);
    existing.completed = !existing.completed;
    notify();
    return existing;
  }
  pushUndo(habitId, date, false);
  const checkIn: CheckIn = { habitId, date, completed: true };
  data.checkIns.push(checkIn);
  notify();
  return checkIn;
}

export function getCheckInsForHabit(habitId: string): CheckIn[] {
  return data.checkIns.filter((c) => c.habitId === habitId);
}

export function getMonthCheckIns(habitId: string, year: number, month: number): Map<number, boolean> {
  const map = new Map<number, boolean>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const checks = data.checkIns.filter((c) => c.habitId === habitId && c.date.startsWith(prefix));
  for (const c of checks) {
    const day = parseInt(c.date.split('-')[2], 10);
    map.set(day, c.completed);
  }
  return map;
}

// --- Scoring ---
export function getCompletionForMonth(habitId: string, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const checks = getMonthCheckIns(habitId, year, month);
  let completed = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (checks.get(d)) completed++;
  }
  const goal = data.habits.find((h) => h.id === habitId)?.goal || daysInMonth;
  return Math.min(Math.round((completed / Math.max(goal, 1)) * 100), 100);
}

// --- Notes ---
export function getNotes(): Note[] {
  return [...data.notes].sort((a, b) => {
    const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    // Stable sort: fall back to id comparison when timestamps are equal
    return b.id.localeCompare(a.id);
  });
}

export function addNote(content: string): Note {
  const note: Note = {
    id: crypto.randomUUID(),
    habitId: '',
    content,
    createdAt: new Date().toISOString(),
  };
  data.notes.push(note);
  notify();
  return note;
}

export function deleteNote(id: string): void {
  data.notes = data.notes.filter((n) => n.id !== id);
  notify();
}

// --- Diagnostic: peek at raw storage content for debugging ---
export function diagnoseStorage(): { primaryRaw: string | null; backupRaw: string | null; primaryParsed: unknown; backupParsed: unknown } {
  const primaryRaw = localStorage.getItem(STORAGE_KEY);
  const backupRaw = localStorage.getItem(BACKUP_KEY);
  let primaryParsed: unknown = null;
  let backupParsed: unknown = null;
  try { if (primaryRaw) primaryParsed = JSON.parse(primaryRaw); } catch { /* ignore */ }
  try { if (backupRaw) backupParsed = JSON.parse(backupRaw); } catch { /* ignore */ }
  return { primaryRaw, backupRaw, primaryParsed, backupParsed };
}

interface ImportedHabit {
  id: string;
  name: string;
  goal?: number;
  archived?: boolean;
  chaosDimension?: string;
  chaosImpact?: number;
  chaosThresholdDays?: number;
}

interface ImportedCheckIn {
  habitId: string;
  date: string;
  completed: boolean;
}

interface ImportedNote {
  habitId?: string;
  content: string;
  createdAt?: string;
}

export interface ImportMergeResult {
  habitsCreated: number;
  habitsMapped: number;
  checkInsRestored: number;
  notesCreated: number;
  skippedCheckIns: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHabitName(name: string): string {
  return name.trim().toLowerCase();
}

function isValidDateKey(date: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function readArray(raw: unknown, key: 'habits' | 'checkIns' | 'notes'): unknown[] {
  if (!isRecord(raw)) return [];
  const value = raw[key];
  return Array.isArray(value) ? value : [];
}

function parseImportedHabit(raw: unknown): ImportedHabit | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const name = raw.name.trim();
  if (!name) return null;
  // Clamp chaos fields on import to prevent poison data
  const dim = typeof raw.chaosDimension === 'string' && raw.chaosDimension.length > 0
    ? raw.chaosDimension : undefined;
  const impact = typeof raw.chaosImpact === 'number' && Number.isFinite(raw.chaosImpact)
    ? Math.max(0, Math.min(100, raw.chaosImpact)) : undefined;
  const threshold = typeof raw.chaosThresholdDays === 'number' && Number.isFinite(raw.chaosThresholdDays)
    ? Math.max(1, Math.min(90, Math.floor(raw.chaosThresholdDays))) : undefined;
  return {
    id: raw.id,
    name,
    goal: typeof raw.goal === 'number' ? raw.goal : undefined,
    archived: typeof raw.archived === 'boolean' ? raw.archived : undefined,
    chaosDimension: dim,
    chaosImpact: impact,
    chaosThresholdDays: threshold,
  };
}

function parseImportedCheckIn(raw: unknown): ImportedCheckIn | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.habitId !== 'string' || typeof raw.date !== 'string') return null;
  if (!isValidDateKey(raw.date)) return null;
  return {
    habitId: raw.habitId,
    date: raw.date,
    completed: raw.completed === true,
  };
}

function parseImportedNote(raw: unknown): ImportedNote | null {
  if (!isRecord(raw) || typeof raw.content !== 'string') return null;
  const content = raw.content.trim();
  if (!content) return null;
  return {
    habitId: typeof raw.habitId === 'string' ? raw.habitId : undefined,
    content,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  };
}

function nextHabitColor(): string {
  const usedColors = data.habits.map((habit) => habit.color).filter(Boolean);
  return HABIT_COLORS.find((color) => !usedColors.includes(color)) || HABIT_COLORS[data.habits.length % HABIT_COLORS.length];
}

function createImportedHabit(source: ImportedHabit): Habit {
  const maxOrder = data.habits.reduce((max, habit) => Math.max(max, habit.order), -1);
  return {
    id: crypto.randomUUID(),
    name: source.name,
    color: nextHabitColor(),
    goal: source.goal ?? 0,
    createdAt: new Date().toISOString(),
    archived: source.archived ?? false,
    order: maxOrder + 1,
    ...(source.chaosDimension ? { chaosDimension: source.chaosDimension } : {}),
    ...(source.chaosImpact !== undefined ? { chaosImpact: source.chaosImpact } : {}),
    ...(source.chaosThresholdDays !== undefined ? { chaosThresholdDays: source.chaosThresholdDays } : {}),
  };
}

function applyImportedHabitMetadata(target: Habit, source: ImportedHabit): boolean {
  let changed = false;
  if (target.goal === 0 && source.goal !== undefined) {
    target.goal = source.goal;
    changed = true;
  }
  if (target.archived && source.archived === false) {
    target.archived = false;
    changed = true;
  }
  if (!target.chaosDimension && source.chaosDimension) {
    target.chaosDimension = source.chaosDimension;
    changed = true;
  }
  if (target.chaosImpact === undefined && source.chaosImpact !== undefined) {
    target.chaosImpact = source.chaosImpact;
    changed = true;
  }
  if (target.chaosThresholdDays === undefined && source.chaosThresholdDays !== undefined) {
    target.chaosThresholdDays = source.chaosThresholdDays;
    changed = true;
  }
  return changed;
}

export function mergeImportedData(raw: unknown): ImportMergeResult {
  const result: ImportMergeResult = {
    habitsCreated: 0,
    habitsMapped: 0,
    checkInsRestored: 0,
    notesCreated: 0,
    skippedCheckIns: 0,
  };
  const idMap = new Map<string, string>();
  const habitsByName = new Map(data.habits.map((habit) => [normalizeHabitName(habit.name), habit]));
  const seenImportIds = new Set<string>();
  let metadataChanged = false;

  for (const rawHabit of readArray(raw, 'habits')) {
    const imported = parseImportedHabit(rawHabit);
    if (!imported) continue;
    // Defensive: track every imported id we've seen, but DO NOT skip duplicates
    // that have a different name (they may legitimately be new habits that
    // collide on id only by importer mistake). The first-seen id wins for the
    // idMap (subsequent duplicates are mapped to the same target), which is
    // consistent with the "first write wins" semantics for unrelated fields.
    const firstSeen = !seenImportIds.has(imported.id);
    seenImportIds.add(imported.id);

    const key = normalizeHabitName(imported.name);
    let target = habitsByName.get(key);
    if (!target) {
      target = createImportedHabit(imported);
      data.habits.push(target);
      habitsByName.set(key, target);
      result.habitsCreated++;
    } else {
      metadataChanged = applyImportedHabitMetadata(target, imported) || metadataChanged;
    }
    // Map imported.id to target.id. Only set on the FIRST occurrence — for
    // duplicates with different names, later check-ins/notes still attach
    // to the FIRST target (consistent with how duplicate-IDs used to behave,
    // but now explicit and logged).
    if (firstSeen) {
      idMap.set(imported.id, target.id);
    } else {
      console.warn('mergeImportedData: duplicate imported id', imported.id, '— first target wins for subsequent mappings');
    }
    result.habitsMapped++;
  }

  for (const rawCheckIn of readArray(raw, 'checkIns')) {
    const imported = parseImportedCheckIn(rawCheckIn);
    const habitId = imported ? idMap.get(imported.habitId) : undefined;
    if (!imported || !habitId) {
      result.skippedCheckIns++;
      continue;
    }

    const existing = getCheckIn(habitId, imported.date);
    if (!existing) {
      data.checkIns.push({ habitId, date: imported.date, completed: imported.completed ?? false });
      result.checkInsRestored++;
    } else if (!existing.completed) {
      existing.completed = true;
      result.checkInsRestored++;
    }
  }

  for (const rawNote of readArray(raw, 'notes')) {
    const imported = parseImportedNote(rawNote);
    if (!imported) continue;
    data.notes.push({
      id: crypto.randomUUID(),
      habitId: imported.habitId ? idMap.get(imported.habitId) ?? '' : '',
      content: imported.content,
      createdAt: imported.createdAt ?? new Date().toISOString(),
    });
    result.notesCreated++;
  }

  if (metadataChanged || result.habitsCreated > 0 || result.checkInsRestored > 0 || result.notesCreated > 0) {
    notify();
  }
  return result;
}

function migrateLegacyPrimaryData(): AppData | null {
  // Try to read legacy format directly and save as envelope
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // If it's already an envelope, nothing to do
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 'd' in parsed && 'h' in parsed) {
      return null;
    }
    // Legacy format detected — migrate
    const sanitized = sanitizeData(parsed);
    if (sanitized.habits.length === 0 && sanitized.checkIns.length === 0) {
      console.warn('No valid data found in legacy format');
      return null;
    }
    writeEnvelope(STORAGE_KEY, sanitized);
    writeEnvelope(BACKUP_KEY, sanitized);
    console.info(`Migrated ${sanitized.habits.length} habits, ${sanitized.checkIns.length} check-ins, ${sanitized.notes.length} notes`);
    return sanitized;
  } catch {
    return null;
  }
}

export function forceMigrateLegacyData(): boolean {
  const migrated = migrateLegacyPrimaryData();
  if (!migrated) return false;
  data = migrated;
  notify();
  return true;
}

/**
 * Recalculate persistent records for a single habit. Exported primarily for
 * tests; production code path is the automatic recalculation inside notify().
 */
export function recomputeHabitRecords(habitId: string): void {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit || habit.archived) return;
  const today = new Date();
  const stats = computeStreakStats(habit, data.checkIns, today);
  habit.bestStreak = stats.best;
  habit.bestStreakAt = stats.bestAt || undefined;
  habit.longestGap = stats.longestGap;
  habit.longestGapAt = stats.longestGapAt || undefined;
  habit.totalCompleted = stats.totalCompleted;
  scheduleSave(data);
}
export function exportAllData(): AppData {
  // Return a deep clone so callers cannot mutate internal state
  return JSON.parse(JSON.stringify(data));
}

// --- Chaos ---
// Chaos is 100% auto-driven from habits. Dimensions are categories only — no manual triggers.
const DEFAULT_CHAOS: ChaosDimension[] = [
  { id: 'social', name: 'Social', triggers: [] },
  { id: 'financial', name: 'Financial', triggers: [] },
  { id: 'physical', name: 'Physical', triggers: [] },
  { id: 'structural', name: 'Structural', triggers: [] },
  { id: 'spiritual', name: 'Spiritual', triggers: [] },
];

export function getDefaultChaosDimensions(): ChaosDimension[] {
  return JSON.parse(JSON.stringify(DEFAULT_CHAOS));
}

export function getChaosDimensions(): ChaosDimension[] {
  if (!data.chaosDimensions || data.chaosDimensions.length === 0) {
    data.chaosDimensions = getDefaultChaosDimensions();
  }
  return data.chaosDimensions;
}

export function toggleChaosTrigger(dimId: string, triggerId: string): void {
  const dim = data.chaosDimensions.find((d) => d.id === dimId);
  if (!dim) return;
  const trigger = dim.triggers.find((t) => t.id === triggerId);
  if (trigger) {
    trigger.active = !trigger.active;
    notify();
  }
}

export function resetChaos(): void {
  data.chaosDimensions = getDefaultChaosDimensions();
  notify();
}

/**
 * Compute automatic chaos pressure per dimension by analyzing missed check-ins.
 *
 * Algorithm (semantics: "missed N consecutive days ago"):
 *   - Start from YESTERDAY (today is still in progress — not counted as missed).
 *   - Walk backward, counting consecutive missed days.
 *   - Break on the first completed check-in.
 *   - Stop at 90 days (max window).
 *   - Skip days before the habit was created.
 *   - If streak >= chaosThresholdDays → emit auto trigger with chaosImpact %.
 */
// The "tracking start" boundary for a habit (date-only): the EARLIER of its
// creation date and its earliest check-in date. Including the earliest check-in
// means that when the user marks past days in the grid — e.g. right after
// creating a habit — those days count as missed instead of being silently
// ignored as "before the habit existed". Without this, a habit created today
// can never accrue a missed streak (yesterday is already before createdAt).
function trackingStart(habit: Habit): Date | null {
  let start: Date | null = null;
  if (habit.createdAt) {
    const c = new Date(habit.createdAt);
    start = new Date(c.getFullYear(), c.getMonth(), c.getDate());
  }
  for (const ci of data.checkIns) {
    if (ci.habitId !== habit.id) continue;
    const [y, m, dd] = ci.date.split('-').map(Number);
    if (!y || !m || !dd) continue;
    const d = new Date(y, m - 1, dd);
    if (!start || d < start) start = d;
  }
  return start;
}

// Count consecutive missed days for a habit, starting from YESTERDAY and walking
// backward. Today is excluded (still in progress). Days before the habit's
// tracking start are not counted, and the window is capped at 90 days.
function computeMissedStreak(habit: Habit, today: Date): number {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let missedStreak = 0;
  const startBoundary = trackingStart(habit);
  const maxDays = 90;

  for (let i = 0; i < maxDays; i++) {
    const d = new Date(yesterday);
    d.setDate(d.getDate() - i);
    // Don't count days before the habit started being tracked
    if (startBoundary) {
      const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (dStart < startBoundary) break;
    }
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ci = data.checkIns.find((c) => c.habitId === habit.id && c.date === key);
    // Considered missed if no entry, or entry marked completed=false
    if (!ci || !ci.completed) {
      missedStreak++;
    } else {
      break;
    }
  }
  return missedStreak;
}

export function computeAutoChaos(asOf?: Date): Map<string, { trigger: ChaosTrigger; habitName: string }[]> {
  const autoTriggerMap = new Map<string, { trigger: ChaosTrigger; habitName: string }[]>();
  const today = asOf ?? new Date();

  for (const habit of data.habits) {
    if (habit.archived) continue;
    if (!habit.chaosDimension || !habit.chaosImpact || !habit.chaosThresholdDays) continue;

    const missedStreak = computeMissedStreak(habit, today);

    if (missedStreak >= habit.chaosThresholdDays) {
      const triggerId = `auto_${habit.id}`;
      const label = `"${habit.name}" missed ${missedStreak}d (threshold ${habit.chaosThresholdDays}d)`;
      const trigger: ChaosTrigger = {
        id: triggerId,
        label,
        weight: habit.chaosImpact,
        active: true,
      };
      if (!autoTriggerMap.has(habit.chaosDimension)) {
        autoTriggerMap.set(habit.chaosDimension, []);
      }
      autoTriggerMap.get(habit.chaosDimension)!.push({ trigger, habitName: habit.name });
    }
  }

  return autoTriggerMap;
}

/**
 * Get all chaos triggers for a dimension, combining:
 *  - Manual user-toggled triggers
 *  - Auto-generated triggers from missed habits
 */
export function getChaosTriggersForDimension(dimId: string): ChaosTrigger[] {
  const dim = data.chaosDimensions.find((d) => d.id === dimId);
  const manual = dim ? dim.triggers : [];
  const autoMap = computeAutoChaos();
  const auto = autoMap.get(dimId)?.map((e) => e.trigger) ?? [];
  return [...manual, ...auto];
}

/**
 * Total chaos percentage for a dimension (manual + auto, capped at 100).
 */
export function getChaosPercentageForDimension(dimId: string): number {
  const triggers = getChaosTriggersForDimension(dimId);
  return Math.min(100, triggers.reduce((s, t) => s + (t.active ? t.weight : 0), 0));
}

// --- Chaos report (full picture for the dashboard) ---
// Unlike computeAutoChaos (which only surfaces TRIGGERED habits), this returns
// every linked habit per dimension along with its current missed streak, so the
// UI can show habits that are on-track too — not just the ones in chaos.
export interface ChaosHabitStatus {
  habitId: string;
  habitName: string;
  impact: number;        // chaosImpact %
  thresholdDays: number; // consecutive missed days needed to trigger
  missedStreak: number;  // current consecutive missed days (from yesterday)
  triggered: boolean;    // missedStreak >= thresholdDays
}

export interface ChaosDimensionReport {
  id: string;
  name: string;
  habits: ChaosHabitStatus[]; // all linked, non-archived habits in this dimension
  pct: number;                // sum of impacts of triggered habits, capped at 100
}

export interface ChaosReport {
  dimensions: ChaosDimensionReport[];
  linkedHabitCount: number; // total linked habits across all dimensions
  overallPct: number;       // average pct over dimensions that have linked habits
}

export function computeChaosReport(asOf?: Date): ChaosReport {
  const today = asOf ?? new Date();
  const dims = getChaosDimensions();
  const linkedByDim = new Map<string, ChaosHabitStatus[]>();
  let linkedHabitCount = 0;

  for (const habit of data.habits) {
    if (habit.archived) continue;
    if (!habit.chaosDimension || !habit.chaosImpact || !habit.chaosThresholdDays) continue;

    const missedStreak = computeMissedStreak(habit, today);
    const status: ChaosHabitStatus = {
      habitId: habit.id,
      habitName: habit.name,
      impact: habit.chaosImpact,
      thresholdDays: habit.chaosThresholdDays,
      missedStreak,
      triggered: missedStreak >= habit.chaosThresholdDays,
    };
    if (!linkedByDim.has(habit.chaosDimension)) linkedByDim.set(habit.chaosDimension, []);
    linkedByDim.get(habit.chaosDimension)!.push(status);
    linkedHabitCount++;
  }

  const dimensions: ChaosDimensionReport[] = dims.map((dim) => {
    const habits = linkedByDim.get(dim.id) ?? [];
    const pct = Math.min(100, habits.reduce((s, h) => s + (h.triggered ? h.impact : 0), 0));
    return { id: dim.id, name: dim.name, habits, pct };
  });

  const dimsWithHabits = dimensions.filter((d) => d.habits.length > 0);
  const overallPct = dimsWithHabits.length > 0
    ? Math.round(dimsWithHabits.reduce((sum, d) => sum + d.pct, 0) / dimsWithHabits.length)
    : 0;

  return { dimensions, linkedHabitCount, overallPct };
}
