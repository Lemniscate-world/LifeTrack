import type { AppData, Habit, CheckIn, Note } from './types';

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
  const empty: AppData = { habits: [], checkIns: [], notes: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const obj = raw as Record<string, unknown>;
  function isValidHabit(x: unknown): x is Habit {
    return !!(x && typeof x === 'object' && 'id' in (x as object) && 'name' in (x as object));
  }
  function isValidCheckIn(x: unknown): x is CheckIn {
    return !!(x && typeof x === 'object' && 'habitId' in (x as object) && 'date' in (x as object));
  }
  function isValidNote(x: unknown): x is Note {
    return !!(x && typeof x === 'object' && 'id' in (x as object) && 'content' in (x as object));
  }
  return {
    habits: Array.isArray(obj.habits) ? obj.habits.filter(isValidHabit) : [],
    checkIns: Array.isArray(obj.checkIns) ? obj.checkIns.filter(isValidCheckIn) : [],
    notes: Array.isArray(obj.notes) ? obj.notes.filter(isValidNote) : [],
  };
}

// --- Read envelope from a key, verifying checksum ---
function readEnvelope(key: string): AppData | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const envelope: StorageEnvelope = JSON.parse(raw);
    if (!envelope || envelope.v !== 1 || !envelope.d || !envelope.h) return null;
    // Verify checksum
    const expectedHash = fnv1a(JSON.stringify(envelope.d));
    if (expectedHash !== envelope.h) {
      console.warn(`Checksum mismatch on key "${key}" — data may be corrupted`);
      return null;
    }
    return sanitizeData(envelope.d);
  } catch {
    return null;
  }
}

// --- Load: try primary, then backup, then empty ---
function loadData(): AppData {
  if (!isLocalStorageAvailable()) {
    return { habits: [], checkIns: [], notes: [] };
  }
  const primary = readEnvelope(STORAGE_KEY);
  if (primary) return primary;
  const backup = readEnvelope(BACKUP_KEY);
  if (backup) {
    console.warn('Primary storage corrupted or missing — recovered from backup');
    return backup;
  }
  return { habits: [], checkIns: [], notes: [] };
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

// --- Debounced save ---
const SAVE_DEBOUNCE_MS = 100; // fast save to minimize data loss window
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;
let lastSavedAt: number = 0; // 0 = no save yet; set on first successful write
let saveInFlight = false; // prevent concurrent writes

function doSave(d: AppData): void {
  if (saveInFlight) return; // skip if a save is already writing
  saveInFlight = true;
  try {
    const primaryOk = writeEnvelope(STORAGE_KEY, d);
    if (primaryOk) {
      writeEnvelope(BACKUP_KEY, d); // best-effort backup
      lastSavedAt = Date.now();
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

// Force immediate flush (useful before export, app close, or page unload)
export function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingSave) {
    pendingSave = false;
    doSave(data);
  }
}

// Auto-flush on page unload to prevent data loss
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushSave());
  // Periodic save every 15s as safety net for long sessions
  setInterval(() => { if (pendingSave) flushSave(); }, 15000);
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
}

function notify() {
  scheduleSave(data);
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getHabits(): Habit[] {
  return data.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
}

// --- Habits ---
export function addHabit(name: string): Habit {
  const maxOrder = data.habits.reduce((max, h) => Math.max(max, h.order), -1);
  const habit: Habit = {
    id: crypto.randomUUID(),
    name,
    color: '',
    goal: 0,
    createdAt: new Date().toISOString(),
    archived: false,
    order: maxOrder + 1,
  };
  // assign pastel color
  const pastels = ['#FEF3C7', '#D1FAE5', '#DBEAFE', '#FCE7F3', '#E0E7FF', '#FEE2E2', '#EDE9FE', '#FEF9C3'];
  const usedColors = data.habits.map((h) => h.color).filter(Boolean);
  const available = pastels.find((c) => !usedColors.includes(c));
  habit.color = available || pastels[data.habits.length % pastels.length];

  data.habits.push(habit);
  notify();
  return habit;
}

export function updateHabit(id: string, updates: Partial<Habit>): void {
  const idx = data.habits.findIndex((h) => h.id === id);
  if (idx !== -1) {
    data.habits[idx] = { ...data.habits[idx], ...updates };
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
  data.habits = data.habits.filter((h) => h.id !== id);
  data.checkIns = data.checkIns.filter((c) => c.habitId !== id);
  data.notes = data.notes.filter((n) => n.habitId !== id);
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
  return data.notes.sort((a, b) => {
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

// --- Export ---
export function exportAllData(): AppData {
  // Return a deep clone so callers cannot mutate internal state
  return JSON.parse(JSON.stringify(data));
}