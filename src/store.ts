import type { AppData, Habit, CheckIn, Note, ChaosDimension, ChaosTrigger, Mantra, MantraSettings, Skill, SkillLink, Capacity, CapacityRating, Experiment, UrgeEntry, CustomUrgeType, UserPreferences, AchievementCategory } from './types';
import { computeStreakStats } from './stats';
import {
  linkHabitToParentInPlace,
  unlinkHabitInPlace,
  clearDanglingStackParentsInPlace,
  computeStacks,
  getNextStackSuggestion,
  type StackStatus,
} from './stacks';
import { createDefaultMantras, DEFAULT_MANTRA_SETTINGS } from './mantras';
import { bindUrgeStore } from './urgeSurfing';

export function createDefaultSkills(): Skill[] {
  return [
    {
      id: 'default-mindfulness',
      name: 'Mindfulness',
      description: 'Training the mind to be present, note thoughts, and recognize mental patterns.',
      emoji: '🧠',
      color: '#EDE9FE',
      createdAt: new Date().toISOString(),
      links: [],
      isDefault: true,
    },
    {
      id: 'default-fitness',
      name: 'Physical Fitness',
      description: 'Building physical capacity, endurance, and strength through body movement.',
      emoji: '💪',
      color: '#D1FAE5',
      createdAt: new Date().toISOString(),
      links: [],
      isDefault: true,
    },
    {
      id: 'default-focus',
      name: 'Deep Work & Focus',
      description: 'Developing cognitive stamina to focus intensely on complex tasks without distraction.',
      emoji: '⚡',
      color: '#DBEAFE',
      createdAt: new Date().toISOString(),
      links: [],
      isDefault: true,
    },
    {
      id: 'default-learning',
      name: 'Knowledge Acquisition',
      description: 'Expanding mental models, reading, and learning new concepts and tools.',
      emoji: '📚',
      color: '#FEF3C7',
      createdAt: new Date().toISOString(),
      links: [],
      isDefault: true,
    },
    {
      id: 'default-resilience',
      name: 'Mental Resilience',
      description: 'Strengthening emotional regulation, gratitude, and stress management.',
      emoji: '🌱',
      color: '#FCE7F3',
      createdAt: new Date().toISOString(),
      links: [],
      isDefault: true,
    },
  ];
}

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
const RAW_JSON_KEY = 'lifetrack-raw'; // emergency plain JSON (no envelope, survives corruption)
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

// --- Runtime validators for Capacity types (used by sanitizeData AND mergeImportedData) ---
// Capacity: a sub-ability under a Skill with a user-defined unit and scale.
// `baseline` and `target` are clamped on import/save so a poisoned payload
// can't make the timeline explode visually.
function isValidCapacity(x: unknown): x is Capacity {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.skillId !== 'string' || typeof c.name !== 'string') return false;
  if (typeof c.description !== 'string') return false;
  if (typeof c.unit !== 'string') return false;
  if (typeof c.createdAt !== 'string') return false;
  if (typeof c.baseline !== 'number' || !Number.isFinite(c.baseline)) return false;
  if (typeof c.target !== 'number' || !Number.isFinite(c.target)) return false;
  return true;
}
// CapacityRating: one observation on one day. Either rating or note is
// set on every entry — both are validated, but at least one must exist.
function isValidCapacityRating(x: unknown): x is CapacityRating {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.capacityId !== 'string') return false;
  if (typeof r.date !== 'string' || !isValidDateKey(r.date)) return false;
  if (r.rating !== undefined && (typeof r.rating !== 'number' || !Number.isFinite(r.rating))) return false;
  if (r.note !== undefined && typeof r.note !== 'string') return false;
  if (r.note === undefined && r.rating === undefined) return false;
  if (r.habitId !== undefined && typeof r.habitId !== 'string') return false;
  return true;
}

// --- Sanitize: filter out malformed entries from parsed data ---
function sanitizeData(raw: unknown): AppData {
  const empty: AppData = {
    habits: [],
    checkIns: [],
    notes: [],
    chaosDimensions: [],
    achievementCategories: [],
    mantras: createDefaultMantras(),
    mantraSettings: { ...DEFAULT_MANTRA_SETTINGS },
    skills: createDefaultSkills(),
    capacities: [],
    capacityRatings: [],
    moods: {},
    experiments: [],
    urges: [],
    customUrgeTypes: [],
    preferences: { darkMode: false, theme: '' },
  };
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
  function isValidMantra(x: unknown): x is Mantra {
    if (!x || typeof x !== 'object') return false;
    const m = x as Record<string, unknown>;
    return typeof m.id === 'string'
      && typeof m.text === 'string'
      && typeof m.domain === 'string'
      && typeof m.isDefault === 'boolean';
  }
  function isValidMantraSettings(x: unknown): x is MantraSettings {
    if (!x || typeof x !== 'object') return false;
    const s = x as Record<string, unknown>;
    return typeof s.morningEnabled === 'boolean'
      && typeof s.eveningEnabled === 'boolean'
      && typeof s.showOnEntry === 'boolean';
  }
  function isValidSkill(x: unknown): x is Skill {
    if (!x || typeof x !== 'object') return false;
    const s = x as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.description !== 'string') return false;
    if (typeof s.emoji !== 'string' || typeof s.color !== 'string' || typeof s.createdAt !== 'string') return false;
    if (!Array.isArray(s.links)) return false;
    for (const link of s.links) {
      if (!link || typeof link !== 'object') return false;
      const l = link as Record<string, unknown>;
      if (typeof l.habitId !== 'string' || typeof l.xpPerCompletion !== 'number' || !Number.isFinite(l.xpPerCompletion)) {
        return false;
      }
    }
    return true;
  }

  // Merge stored mantras with defaults: keep user mantras + built-in defaults.
  // This way we can add new default mantras over time without losing user data.
  const storedMantras: Mantra[] = Array.isArray(obj.mantras)
    ? obj.mantras.filter(isValidMantra)
    : [];
  const defaultMantras = createDefaultMantras();
  const userMantras = storedMantras.filter((m) => !m.isDefault);
  // Keep user mantras + latest defaults (ensures new default mantras appear)
  const mergedMantras = [...defaultMantras, ...userMantras];
  
  const storedSettings = obj.mantraSettings;
  const mantraSettings: MantraSettings = isValidMantraSettings(storedSettings)
    ? { ...DEFAULT_MANTRA_SETTINGS, ...storedSettings as Partial<MantraSettings> }
    : { ...DEFAULT_MANTRA_SETTINGS };

  // Merge stored skills with defaults
  const storedSkills: Skill[] = Array.isArray(obj.skills)
    ? obj.skills.filter(isValidSkill)
    : [];
  const defaultSkills = createDefaultSkills();
  const mergedSkills = [...storedSkills];
  for (const defS of defaultSkills) {
    if (!mergedSkills.some((s) => s.id === defS.id)) {
      mergedSkills.push(defS);
    }
  }

  // Capacities: filter malformed, then drop any capacity whose parent skill
  // no longer exists (orphaned capacities would be unreachable from the UI
  // and clutter the storage). Ratings referring to dropped capacities are
  // also dropped to keep the storage envelope clean.
  const storedCapacities: Capacity[] = Array.isArray(obj.capacities)
    ? obj.capacities.filter(isValidCapacity)
    : [];
  const knownSkillIds = new Set(mergedSkills.map((s) => s.id));
  const validCapacities = storedCapacities.filter((c) => knownSkillIds.has(c.skillId));
  const validCapacityIds = new Set(validCapacities.map((c) => c.id));
  const storedRatings: CapacityRating[] = Array.isArray(obj.capacityRatings)
    ? obj.capacityRatings.filter(isValidCapacityRating)
    : [];
  const validRatings = storedRatings.filter((r) => validCapacityIds.has(r.capacityId));

  return {
    habits: Array.isArray(obj.habits) ? obj.habits.filter(isValidHabit) : [],
    checkIns: Array.isArray(obj.checkIns) ? obj.checkIns.filter(isValidCheckIn) : [],
    notes: Array.isArray(obj.notes) ? obj.notes.filter(isValidNote) : [],
    // Merge stored chaos dimensions with the current defaults so that new
    // dimensions (e.g. 'emotional') appear in data saved by older versions,
    // while preserving any user-customised labels or manual triggers.
    chaosDimensions: mergeChaosDimensions(
      Array.isArray(obj.chaosDimensions) ? obj.chaosDimensions as ChaosDimension[] : []
    ),
    achievementCategories: mergeAchievementCategories(
      Array.isArray(obj.achievementCategories) ? obj.achievementCategories as AchievementCategory[] : []
    ),
    mantras: mergedMantras,
    mantraSettings,
    skills: mergedSkills,
    capacities: validCapacities,
    capacityRatings: validRatings,
    moods: (obj.moods && typeof obj.moods === 'object' && !Array.isArray(obj.moods)) ? obj.moods as Record<string, string> : {},
    experiments: Array.isArray(obj.experiments) ? obj.experiments.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'title' in (e as object)) as Experiment[] : [],
    urges: Array.isArray(obj.urges) ? obj.urges.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'type' in (e as object)) as UrgeEntry[] : [],
    customUrgeTypes: Array.isArray(obj.customUrgeTypes) ? obj.customUrgeTypes.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'name' in (e as object)) as CustomUrgeType[] : [],
    preferences: sanitizePreferences(obj.preferences),
  };
}

/** Sanitize user preferences from stored data. */
function sanitizePreferences(raw: unknown): UserPreferences {
  const defaults: UserPreferences = { darkMode: false, theme: '' };
  if (!raw || typeof raw !== 'object') return defaults;
  const p = raw as Record<string, unknown>;
  return {
    darkMode: p.darkMode === true,
    theme: typeof p.theme === 'string' ? p.theme : '',
  };
}

/** Experiment CRUD */
export function getExperiments(): Experiment[] {
  return [...data.experiments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addExperiment(exp: Omit<Experiment, 'id' | 'createdAt' | 'status' | 'conclusion' | 'completedAt'>): Experiment {
  const experiment: Experiment = {
    ...exp,
    id: crypto.randomUUID(),
    status: 'active',
    conclusion: '',
    createdAt: new Date().toISOString(),
  };
  data.experiments.push(experiment);
  notify();
  return experiment;
}

export function updateExperiment(id: string, updates: Partial<Experiment>): void {
  const idx = data.experiments.findIndex(e => e.id === id);
  if (idx !== -1) {
    Object.assign(data.experiments[idx], updates);
    notify();
  }
}

export function completeExperiment(id: string, conclusion: string): void {
  const exp = data.experiments.find(e => e.id === id);
  if (exp) {
    exp.status = 'completed';
    exp.conclusion = conclusion;
    exp.completedAt = new Date().toISOString();
    notify();
  }
}

export function deleteExperiment(id: string): void {
  data.experiments = data.experiments.filter(e => e.id !== id);
  notify();
}

// --- Urge Surfing re-exports (store lives in urgeSurfing.ts) ---
export {
  addUrgeEntry,
  updateUrgeEntry,
  deleteUrgeEntry,
  getUrgeEntries,
  getActiveUrge,
  surfUrge,
  giveInUrge,
  computeUrgeStats,
  formatUrgeElapsed,
  URGE_TYPES,
  getAllUrgeTypes,
  getDefaultCounterHabits,
  addCustomUrgeType,
  updateCustomUrgeType,
  deleteCustomUrgeType,
} from './urgeSurfing';
export type { UrgeStats, UrgeTypeInfo } from './urgeSurfing';

/** Mood tracking */
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
    scheduleFileBackup(primary); // ensure disk backup exists at startup
    return primary;
  }
  const backup = readEnvelope(BACKUP_KEY);
  if (backup) {
    console.warn('Primary storage corrupted or missing — recovered from backup');
    deduplicateDataInPlace(backup);
    scheduleFileBackup(backup); // ensure disk backup exists at startup
    return backup;
  }
  // Desperate: try raw JSON emergency backup (no envelope, no checksum)
  try {
    const rawJson = localStorage.getItem(RAW_JSON_KEY);
    if (rawJson) {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string,unknown>).habits)) {
        const recovered = sanitizeData(parsed);
        if (recovered.habits.length > 0 || recovered.checkIns.length > 0) {
          console.warn('Recovered from raw JSON emergency backup — re-saving as envelope');
          writeEnvelope(STORAGE_KEY, recovered);
          writeEnvelope(BACKUP_KEY, recovered);
          scheduleFileBackup(recovered);
          return recovered;
        }
      }
    }
  } catch { /* raw backup also corrupt */ }
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

export const MOODS = [
  { id: 'great', emoji: '😊', label: 'Great', color: '#10B981' },
  { id: 'okay', emoji: '😐', label: 'Okay', color: '#6B7280' },
  { id: 'bad', emoji: '😢', label: 'Bad', color: '#EF4444' },
  { id: 'amazing', emoji: '🤩', label: 'Amazing', color: '#F59E0B' },
  { id: 'tired', emoji: '😴', label: 'Tired', color: '#8B5CF6' },
  { id: 'angry', emoji: '😡', label: 'Angry', color: '#DC2626' },
  { id: 'sick', emoji: '🤒', label: 'Sick', color: '#F97316' },
  { id: 'calm', emoji: '🧘', label: 'Calm', color: '#6366F1' },
];

function freshData(): AppData {
  return {
    habits: [],
    checkIns: [],
    notes: [],
    chaosDimensions: [],
    achievementCategories: [],
    mantras: createDefaultMantras(),
    mantraSettings: { ...DEFAULT_MANTRA_SETTINGS },
    skills: createDefaultSkills(),
    capacities: [],
    capacityRatings: [],
    moods: {},
    experiments: [],
    urges: [],
    customUrgeTypes: [],
    preferences: { darkMode: false, theme: '' },
  };
}

// --- Pre-upgrade safety backup ---
// Creates a timestamped, immutable snapshot of all data BEFORE a code update.
// Stored with a unique key so it survives normal save/load cycles. The user
// can restore it via the "Restore from Backup" menu or by importing the JSON.
const UPGRADE_BACKUP_PREFIX = 'lifetrack-upgrade-backup-';

export function createUpgradeBackup(): string | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `${UPGRADE_BACKUP_PREFIX}${timestamp}`;
    const existing = readEnvelope(STORAGE_KEY);
    const dataToBackup = existing ?? data; // fallback to in-memory if localStorage read fails
    if (!dataToBackup || dataToBackup.habits.length === 0) {
      console.info('[LifeTrack] Skipping upgrade backup — no data to save');
      return null;
    }
    const json = JSON.stringify(dataToBackup);
    const envelope: StorageEnvelope = {
      v: 1,
      d: dataToBackup,
      h: fnv1a(json),
    };
    localStorage.setItem(key, JSON.stringify(envelope));
    console.info(`[LifeTrack] ✅ Pre-upgrade backup created: ${key} (${dataToBackup.habits.length} habits, ${dataToBackup.checkIns.length} check-ins)`);
    return key;
  } catch (e) {
    console.warn('[LifeTrack] Failed to create upgrade backup', e);
    return null;
  }
}

/** List all available upgrade backups, newest first. */
export function listUpgradeBackups(): string[] {
  if (!isLocalStorageAvailable()) return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(UPGRADE_BACKUP_PREFIX)) {
      keys.push(key);
    }
  }
  return keys.sort().reverse(); // newest first (ISO dates sort lexicographically)
}

/** Restore from a specific upgrade backup key. Returns true on success. */
export function restoreUpgradeBackup(backupKey: string): boolean {
  if (!isLocalStorageAvailable()) return false;
  try {
    const raw = localStorage.getItem(backupKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('d' in parsed)) return false;
    const envelope = parsed as StorageEnvelope;
    const data = sanitizeData(envelope.d);
    writeEnvelope(STORAGE_KEY, data);
    writeEnvelope(BACKUP_KEY, data);
    console.info(`[LifeTrack] ✅ Restored from upgrade backup: ${backupKey}`);
    return true;
  } catch {
    return false;
  }
}

/** Prune old upgrade backups, keeping only the most recent `keepCount`. */
export function pruneOldBackups(keepCount: number = 7): number {
  if (!isLocalStorageAvailable()) return 0;
  const backups = listUpgradeBackups();
  let removed = 0;
  for (let i = keepCount; i < backups.length; i++) {
    try {
      localStorage.removeItem(backups[i]);
      removed++;
    } catch { /* ignore */ }
  }
  if (removed > 0) {
    console.info(`[LifeTrack] Pruned ${removed} old backup(s), kept ${Math.min(keepCount, backups.length)}`);
  }
  return removed;
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
let firstFileBackupDone = false; // ensure first backup after startup is NOT debounced
const FILE_BACKUP_DEBOUNCE_MS = 1000; // throttle disk writes (one every 1s max)

function scheduleFileBackup(d: AppData): void {
  // First backup after startup: write immediately (no debounce)
  if (!firstFileBackupDone) {
    firstFileBackupDone = true;
    if (fileBackupTimer !== null) clearTimeout(fileBackupTimer);
    fileBackupTimer = null;
    // Fire immediately in the next microtask
    setTimeout(() => {
      fileBackupTimer = null;
      doFileBackup(d);
    }, 0);
    return;
  }
  if (fileBackupTimer !== null) return;
  fileBackupTimer = setTimeout(() => {
    fileBackupTimer = null;
    doFileBackup(d);
  }, FILE_BACKUP_DEBOUNCE_MS);
}

async function doFileBackup(d: AppData): Promise<void> {
  try {
    const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauriEnv) return;
    const [{ appDataDir, documentDir, desktopDir, homeDir }, { writeTextFile, exists, mkdir }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const json = JSON.stringify(d, null, 2);

    const writeBackup = async (dir: string, subdir: string) => {
      const fullDir = `${dir}${subdir}`;
      const dirExists = await exists(fullDir).catch(() => false);
      if (!dirExists) await mkdir(fullDir, { recursive: true });
      await writeTextFile(`${fullDir}/${FILE_BACKUP_NAME}`, json);
    };

    // 1. AppData
    const appDir = await appDataDir();
    await writeBackup(appDir, 'LifeTrack');

    // 2. Documents
    const docDir = await documentDir();
    await writeBackup(docDir, 'LifeTrack-Backups');

    // 3. Desktop
    const deskDir = await desktopDir();
    await writeBackup(deskDir, 'LifeTrack-Backups');

      // 4. Dropbox (if installed)
      const home = await homeDir();
      const dropboxDir = `${home}/Dropbox`;
      if (await exists(dropboxDir).catch(() => false)) {
        await writeBackup(dropboxDir, 'Apps/LifeTrack');
      }

      // 5. OneDrive (if installed)
      try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(home);
        for (const entry of entries) {
          if (entry.name?.startsWith('OneDrive') && entry.isDirectory) {
            await writeBackup(`${home}/${entry.name}`, 'Apps/LifeTrack');
            break;
          }
        }
      } catch { /* best-effort */ }

      // 6. Google Drive (if installed)
      // Try common paths: ~/Google Drive, ~/GoogleDrive, ~/Google Drive/My Drive
      const gDrivePaths = [
        `${home}/Google Drive`,
        `${home}/GoogleDrive`,
        `${home}/Google Drive/My Drive`,
      ];
      for (const gd of gDrivePaths) {
        if (await exists(gd).catch(() => false)) {
          await writeBackup(gd, 'Apps/LifeTrack');
          break;
        }
      }

      // Also try reading home dir for any folder containing "Google Drive"
      try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(home);
        for (const entry of entries) {
          if (entry.name && /google.?drive/i.test(entry.name) && entry.isDirectory) {
            // Check if we already wrote to it above
            const alreadyCovered = gDrivePaths.some(p => p === `${home}/${entry.name}`);
            if (!alreadyCovered) {
              await writeBackup(`${home}/${entry.name}`, 'Apps/LifeTrack');
            }
            break;
          }
        }
      } catch { /* best-effort */ }
  } catch {
    // File backup is best-effort — localStorage is primary.
    // Failures (permissions, disk full) are silent.
  }
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
  // v0.3.2: expanded to check ALL data types (moods, urges, experiments, etc.)
  const hasData = d.habits.length > 0 || d.checkIns.length > 0 || d.notes.length > 0
    || (d.urges && d.urges.length > 0) || (d.experiments && d.experiments.length > 0)
    || (d.moods && Object.keys(d.moods).length > 0)
    || (d.capacities && d.capacities.length > 0);
  if (!hasData) {
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
      // Emergency raw JSON backup — bypasses envelope entirely
      try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(d)); } catch { /* best-effort */ }
      // Also schedule a file backup (best-effort, non-blocking).
      scheduleFileBackup(d);
    } else {
      // Primary failed — try backup as last resort
      const backupOk = writeEnvelope(BACKUP_KEY, d);
      if (backupOk) {
        lastSavedAt = Date.now();
        try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(d)); } catch { /* best-effort */ }
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
  window.addEventListener('beforeunload', () => {
    flushSave();
    // Emergency: force immediate file backup (bypass debounce)
    if (fileBackupTimer !== null) {
      clearTimeout(fileBackupTimer);
      fileBackupTimer = null;
    }
    // Trigger synchronous-style backup via the auto_backup Tauri command
    const isTauriEnv = '__TAURI_INTERNALS__' in window;
    if (isTauriEnv) {
      try {
        // Use sendBeacon-like approach: fire and forget the auto_backup
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('auto_backup', { jsonData: JSON.stringify(exportAllData(), null, 2) });
        }).catch(() => {});
      } catch { /* best-effort */ }
    }
  });
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
  previousCount?: number; // what was the count before?
}
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX_UNDO = 50;

export function pushUndo(habitId: string, date: string, previousState: boolean, previousCount?: number): void {
  undoStack.push({ habitId, date, previousState, previousCount });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

export function undoLastToggle(): UndoEntry | null {
  const entry = undoStack.pop();
  if (!entry) return null;
  const existing = getCheckIn(entry.habitId, entry.date);
  const currentCompleted = existing ? existing.completed : false;
  const currentCount = existing ? (existing.count ?? (existing.completed ? 1 : 0)) : 0;

  redoStack.push({ habitId: entry.habitId, date: entry.date, previousState: currentCompleted, previousCount: currentCount });

  // Guard: if the habit was deleted in the meantime, the undo is a no-op.
  if (!data.habits.some((h) => h.id === entry.habitId)) {
    notify();
    return entry;
  }
  // Reverse the toggle
  if (existing) {
    existing.completed = entry.previousState;
    existing.count = entry.previousCount ?? (entry.previousState ? 1 : 0);
  } else if (entry.previousState) {
    data.checkIns.push({ habitId: entry.habitId, date: entry.date, completed: true, count: entry.previousCount ?? 1 });
  }
  notify();
  return entry;
}

export function redoLastUndo(): UndoEntry | null {
  const entry = redoStack.pop();
  if (!entry) return null;
  const existing = getCheckIn(entry.habitId, entry.date);
  const currentCompleted = existing ? existing.completed : false;
  const currentCount = existing ? (existing.count ?? (existing.completed ? 1 : 0)) : 0;

  undoStack.push({ habitId: entry.habitId, date: entry.date, previousState: currentCompleted, previousCount: currentCount });

  if (!data.habits.some((h) => h.id === entry.habitId)) {
    notify();
    return entry;
  }
  if (existing) {
    existing.completed = entry.previousState;
    existing.count = entry.previousCount ?? (entry.previousState ? 1 : 0);
  } else if (entry.previousState) {
    data.checkIns.push({ habitId: entry.habitId, date: entry.date, completed: true, count: entry.previousCount ?? 1 });
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

// Bind the urge surfing store so it can access the global data and notify.
bindUrgeStore(
  () => data,
  () => notify(),
);

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

// Note: diagnoseStorage() and restoreFromBackupIfNewer() are called by
// the App component at mount time (not here) to avoid side-effects in tests.
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

/**
 * Emergency recovery: read the backup key and if it has MORE habits than
 * the current primary, restore from backup. Returns true if recovery was
 * performed. Idempotent — safe to call multiple times.
 */
export function restoreFromBackupIfNewer(): boolean {
  // Try envelope backup first
  let backup = readEnvelope(BACKUP_KEY);
  // If envelope backup fails, try raw JSON emergency key
  if (!backup || backup.habits.length === 0) {
    try {
      const rawJson = localStorage.getItem(RAW_JSON_KEY);
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed === 'object') {
          backup = sanitizeData(parsed);
        }
      }
    } catch { /* ignore */ }
  }
  if (!backup || backup.habits.length === 0) return false;
  const primary = readEnvelope(STORAGE_KEY);
  if (primary && primary.habits.length >= backup.habits.length) return false;
  // Backup has more data — restore it as primary
  console.warn(`Restoring from backup: ${backup.habits.length} habits, ${backup.checkIns.length} check-ins, ${backup.skills?.length || 0} skills`);
  deduplicateDataInPlace(backup);
  writeEnvelope(STORAGE_KEY, backup);
  writeEnvelope(BACKUP_KEY, backup);
  try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(backup)); } catch { /* ignore */ }
  scheduleFileBackup(backup);
  data = backup;
  backfillHabitRecords();
  notify();
  return true;
}

// --- User Preferences (backed up with all other data) ---

export function getPreferences(): UserPreferences {
  return data.preferences ?? { darkMode: false, theme: '' };
}

export function updatePreferences(updates: Partial<UserPreferences>): void {
  data.preferences = { ...getPreferences(), ...updates };
  notify();
}

/**
 * Diagnostic: dump storage status to console. Press F12 to see.
 */
export function diagnoseStorage(): { primaryRaw: string | null; backupRaw: string | null; primaryParsed: unknown; backupParsed: unknown } {
  const primaryRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const backupRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(BACKUP_KEY) : null;
  let primaryParsed: unknown = null;
  let backupParsed: unknown = null;
  try { if (primaryRaw) primaryParsed = JSON.parse(primaryRaw); } catch { /* ignore */ }
  try { if (backupRaw) backupParsed = JSON.parse(backupRaw); } catch { /* ignore */ }
  const ph = primaryParsed && typeof primaryParsed === 'object' && 'd' in primaryParsed ? (primaryParsed as Record<string,unknown>).d : null;
  const bh = backupParsed && typeof backupParsed === 'object' && 'd' in backupParsed ? (backupParsed as Record<string,unknown>).d : null;
  console.group('🔍 LifeTrack Storage Diagnostic');
  console.log('Primary key exists:', !!primaryRaw, primaryRaw ? `(${primaryRaw.length} chars)` : '');
  console.log('Backup key exists:', !!backupRaw, backupRaw ? `(${backupRaw.length} chars)` : '');
  const rawRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(RAW_JSON_KEY) : null;
  console.log('Raw JSON key exists:', !!rawRaw, rawRaw ? `(${rawRaw.length} chars)` : '');
  if (ph && typeof ph === 'object') {
    const p = ph as Record<string,unknown>;
    console.log('Primary habits:', (p.habits as Array<unknown>)?.length || 0);
    console.log('Primary checkIns:', (p.checkIns as Array<unknown>)?.length || 0);
    console.log('Primary skills:', (p.skills as Array<unknown>)?.length || 0);
  }
  if (bh && typeof bh === 'object') {
    const b = bh as Record<string,unknown>;
    console.log('Backup habits:', (b.habits as Array<unknown>)?.length || 0);
    console.log('Backup checkIns:', (b.checkIns as Array<unknown>)?.length || 0);
    console.log('Backup skills:', (b.skills as Array<unknown>)?.length || 0);
  }
  console.log('In-memory habits:', data.habits.length);
  console.log('In-memory skills:', data.skills?.length || 0);
  console.groupEnd();
  return { primaryRaw, backupRaw, primaryParsed, backupParsed };
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
    multiClick: false, // v0.3.2: OFF by default, user opts IN per habit
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
  // Capacity ratings that referenced this habit are kept (the rating entry
  // is meaningful on its own) but their habitId is cleared so it doesn't
  // show a dangling link in the UI.
  if (data.capacityRatings) {
    for (const r of data.capacityRatings) {
      if (r.habitId === id) r.habitId = undefined;
    }
  }
  notify();
}

// --- Stack API ---
// Thin wrappers around the pure helpers in `src/stacks.ts` so the UI has one
// stable import surface (`./store`) without leaking module split.

export function linkHabitToParent(habitId: string, parentId: string, when: 'before' | 'after' | 'with' = 'after'): boolean {
  const result = linkHabitToParentInPlace(data.habits, habitId, parentId, when);
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
    if (!existing.completed) existing.count = 0;
    else if (!existing.count) existing.count = 1;
    notify();
    return existing;
  }
  pushUndo(habitId, date, false);
  const checkIn: CheckIn = { habitId, date, completed: true, count: 1 };
  data.checkIns.push(checkIn);
  notify();
  return checkIn;
}

/** Increment the completion count for a habit on a given day by 1. */
export function incrementCheckInCount(habitId: string, date: string): CheckIn {
  const existing = getCheckIn(habitId, date);
  if (existing) {
    const current = existing.count ?? (existing.completed ? 1 : 0);
    pushUndo(habitId, date, existing.completed, current);
    existing.count = current + 1;
    existing.completed = true;
    notify();
    return existing;
  }
  pushUndo(habitId, date, false, 0);
  const checkIn: CheckIn = { habitId, date, completed: true, count: 1 };
  data.checkIns.push(checkIn);
  notify();
  return checkIn;
}

/** Reset the completion count for a habit on a given day to 0 (unchecked). */
export function resetCheckInCount(habitId: string, date: string): void {
  const existing = getCheckIn(habitId, date);
  if (existing) {
    const current = existing.count ?? (existing.completed ? 1 : 0);
    pushUndo(habitId, date, existing.completed, current);
    existing.count = 0;
    existing.completed = false;
    notify();
  }
}

/** Decrement the completion count by 1. If count reaches 0, unchecks. */
export function decrementCheckInCount(habitId: string, date: string): void {
  const existing = getCheckIn(habitId, date);
  if (!existing) return;
  const current = existing.count ?? (existing.completed ? 1 : 0);
  pushUndo(habitId, date, existing.completed, current);
  if (current <= 1) {
    existing.count = 0;
    existing.completed = false;
  } else {
    existing.count = current - 1;
    existing.completed = true;
  }
  notify();
}

/** Get the completion count for a habit on a given day (0 if not checked). */
export function getCheckInCount(habitId: string, date: string): number {
  const ci = getCheckIn(habitId, date);
  if (!ci || !ci.completed) return 0;
  return ci.count ?? 1;
}

/** Set notes (replaces ALL notes) for a check-in on a specific habit+day. */
export function setCheckInNotes(habitId: string, date: string, notes: string[] | null): void {
  const existing = getCheckIn(habitId, date);
  if (existing) {
    if (!notes || notes.length === 0) {
      delete existing.notes;
    } else {
      existing.notes = notes;
    }
    notify();
    return;
  }
  if (notes && notes.length > 0) {
    const checkIn: CheckIn = { habitId, date, completed: false, notes };
    data.checkIns.push(checkIn);
    notify();
  }
}

/** Add a single note to a check-in (appends, does not replace). */
export function addCheckInNote(habitId: string, date: string, note: string): void {
  const existing = getCheckIn(habitId, date);
  if (existing) {
    if (!existing.notes) existing.notes = [];
    existing.notes.push(note);
    notify();
    return;
  }
  const checkIn: CheckIn = { habitId, date, completed: false, notes: [note] };
  data.checkIns.push(checkIn);
  notify();
}

/** Remove a note at a specific index from a check-in. */
export function removeCheckInNote(habitId: string, date: string, index: number): void {
  const existing = getCheckIn(habitId, date);
  if (existing?.notes) {
    existing.notes.splice(index, 1);
    if (existing.notes.length === 0) delete existing.notes;
    notify();
  }
}

/** Get all notes for a check-in on a specific habit+day. */
export function getCheckInNotes(habitId: string, date: string): string[] {
  const ci = getCheckIn(habitId, date);
  return ci?.notes ?? [];
}

/** Get all check-in notes for a month (habitId -> day -> notes). */
export function getMonthCheckInNotes(habitId: string, year: number, month: number): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const checks = data.checkIns.filter((c) => c.habitId === habitId && c.date.startsWith(prefix));
  for (const c of checks) {
    if (c.notes && c.notes.length > 0) {
      const day = parseInt(c.date.split('-')[2], 10);
      map.set(day, c.notes);
    }
  }
  return map;
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

/** Get completion counts per day for a month (for multi-goal sub-cell rendering). */
export function getMonthCheckInCounts(habitId: string, year: number, month: number): Map<number, number> {
  const map = new Map<number, number>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const checks = data.checkIns.filter((c) => c.habitId === habitId && c.date.startsWith(prefix));
  for (const c of checks) {
    const day = parseInt(c.date.split('-')[2], 10);
    const prev = map.get(day) ?? 0;
    map.set(day, Math.max(prev, c.completed ? (c.count ?? 1) : 0));
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

export function addNote(content: string, achievementCategory?: string): Note {
  const note: Note = {
    id: crypto.randomUUID(),
    habitId: '',
    content,
    createdAt: new Date().toISOString(),
    ...(achievementCategory ? { achievementCategory } : {}),
  };
  data.notes.push(note);
  notify();
  return note;
}

export function deleteNote(id: string): void {
  data.notes = data.notes.filter((n) => n.id !== id);
  notify();
}

interface ImportedHabit {
  id: string;
  name: string;
  goal?: number;
  archived?: boolean;
  chaosDimension?: string;
  chaosImpact?: number;
  chaosThresholdDays?: number;
  focusMonth?: string;
  category?: string;
  multiClick?: boolean;
  stackParent?: string;
  stackWhen?: 'before' | 'after' | 'with';
  why?: string[];
}

interface ImportedCheckIn {
  habitId: string;
  date: string;
  completed: boolean;
  count?: number;
  note?: string;
  notes?: string[];
}

interface ImportedNote {
  habitId?: string;
  content: string;
  createdAt?: string;
  achievementCategory?: string;
}

export interface ImportMergeResult {
  habitsCreated: number;
  habitsMapped: number;
  checkInsRestored: number;
  notesCreated: number;
  skippedCheckIns: number;
  // New v0.3.2 — ALL data types are now preserved on import
  moodsRestored: number;
  experimentsRestored: number;
  urgesRestored: number;
  mantrasRestored: number;
  chaosDimensionsRestored: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHabitName(name: string): string {
  return name.trim().toLowerCase();
}

/** Local-civil-date key (YYYY-MM-DD). Use this instead of toISOString() so
 *  "today" doesn't shift at 18:00 UTC for the French user (UTC+1/+2). */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidDateKey(date: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function readArray(raw: unknown, key: 'habits' | 'checkIns' | 'notes' | 'skills'): unknown[] {
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
    focusMonth: typeof raw.focusMonth === 'string' && /^\d{4}-\d{2}$/.test(raw.focusMonth) ? raw.focusMonth : undefined,
    category: typeof raw.category === 'string' && raw.category.length > 0 ? raw.category : undefined,
    multiClick: typeof raw.multiClick === 'boolean' ? raw.multiClick : undefined,
    stackParent: typeof raw.stackParent === 'string' ? raw.stackParent : undefined,
    stackWhen: (raw.stackWhen === 'before' || raw.stackWhen === 'after' || raw.stackWhen === 'with') ? raw.stackWhen : undefined,
    why: Array.isArray(raw.why) ? (raw.why as unknown[]).filter((w): w is string => typeof w === 'string' && w.trim().length > 0).slice(0, 5) : undefined,
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
    count: typeof raw.count === 'number' && raw.count > 0 && Number.isFinite(raw.count) ? raw.count : undefined,
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined,
    notes: Array.isArray(raw.notes)
      ? (raw.notes as unknown[]).filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0).map((n: string) => n.trim())
      : (typeof raw.note === 'string' && raw.note.trim() ? [raw.note.trim()] : undefined),
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
    achievementCategory: typeof raw.achievementCategory === 'string' && raw.achievementCategory.length > 0
      ? raw.achievementCategory : undefined,
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
    ...(source.focusMonth ? { focusMonth: source.focusMonth } : {}),
    ...(source.category ? { category: source.category } : {}),
    ...(source.multiClick !== undefined ? { multiClick: source.multiClick } : {}),
    ...(source.stackParent ? { stackParent: source.stackParent } : {}),
    ...(source.stackWhen ? { stackWhen: source.stackWhen } : {}),
    ...(source.why && source.why.length > 0 ? { why: source.why } : {}),
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
  // v0.3.2: preserve user-facing metadata that was previously lost on import
  if (!target.focusMonth && source.focusMonth) {
    target.focusMonth = source.focusMonth;
    changed = true;
  }
  if (!target.category && source.category) {
    target.category = source.category;
    changed = true;
  }
  if (target.multiClick === undefined && source.multiClick !== undefined) {
    target.multiClick = source.multiClick;
    changed = true;
  }
  if (!target.stackParent && source.stackParent) {
    target.stackParent = source.stackParent;
    changed = true;
  }
  if (!target.stackWhen && source.stackWhen) {
    target.stackWhen = source.stackWhen;
    changed = true;
  }
  if ((!target.why || target.why.length === 0) && source.why && source.why.length > 0) {
    target.why = source.why;
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
    moodsRestored: 0,
    experimentsRestored: 0,
    urgesRestored: 0,
    mantrasRestored: 0,
    chaosDimensionsRestored: 0,
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
      data.checkIns.push({
        habitId,
        date: imported.date,
        completed: imported.completed ?? false,
        count: imported.count,
        notes: imported.notes,
      });
      result.checkInsRestored++;
    } else {
      let restored = false;
      if (imported.completed && !existing.completed) {
        existing.completed = true;
        restored = true;
      }
      if (imported.count && (!existing.count || imported.count > existing.count)) {
        existing.count = imported.count;
        restored = true;
      }
      if (imported.notes && imported.notes.length > 0) {
        if (!existing.notes) existing.notes = [];
        for (const n of imported.notes) {
          if (!existing.notes.includes(n)) existing.notes.push(n);
        }
        restored = true;
      }
      if (restored) result.checkInsRestored++;
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
      ...(imported.achievementCategory ? { achievementCategory: imported.achievementCategory } : {}),
    });
    result.notesCreated++;
  }

  let skillsMerged = 0;
  for (const rawSkill of readArray(raw, 'skills')) {
    const s = rawSkill as Record<string, unknown>;
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string') continue;
    const links: SkillLink[] = [];
    if (Array.isArray(s.links)) {
      for (const link of s.links) {
        if (!link || typeof link !== 'object') continue;
        const l = link as Record<string, unknown>;
        if (typeof l.habitId === 'string' && typeof l.xpPerCompletion === 'number') {
          const remappedId = idMap.get(l.habitId) ?? l.habitId;
          links.push({ habitId: remappedId, xpPerCompletion: l.xpPerCompletion });
        }
      }
    }
    const existing = data.skills.find(x => x.id === s.id || normalizeHabitName(x.name) === normalizeHabitName(String(s.name)));
    if (existing) {
      for (const link of links) {
        if (!existing.links.some(l => l.habitId === link.habitId)) {
          existing.links.push(link);
          skillsMerged++;
        }
      }
    } else {
      data.skills.push({
        id: s.id,
        name: s.name,
        description: typeof s.description === 'string' ? s.description : '',
        emoji: typeof s.emoji === 'string' ? s.emoji : '💪',
        color: typeof s.color === 'string' ? s.color : '#FEF3C7',
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
        links,
        isDefault: s.isDefault === true,
      });
      skillsMerged++;
    }
  }

  // Import capacities. We use `raw.capacities` (NOT readArray) because that
  // helper is intentionally restricted to the 4 core collections. Capacities
  // and their ratings are an extension surface so we validate ad-hoc with
  // the same isValid* predicates the sanitize path uses. Skill ids are
  // remapped through idMap so a capacity that lived under a habit-renamed
  // skill still points at the merged skill id.
  if (!data.capacities) data.capacities = [];
  if (!data.capacityRatings) data.capacityRatings = [];
  const rawCaps = Array.isArray((raw as Record<string, unknown>).capacities)
    ? (raw as Record<string, unknown>).capacities as unknown[]
    : [];
  let capacitiesImported = 0;
  for (const rawCap of rawCaps) {
    if (!isValidCapacity(rawCap)) continue;
    const remappedSkillId = idMap.get(rawCap.skillId) ?? rawCap.skillId;
    if (!data.skills.some((s) => s.id === remappedSkillId)) continue;
    if (data.capacities.some((c) => c.id === rawCap.id)) continue;
    data.capacities.push({
      ...rawCap,
      skillId: remappedSkillId,
    });
    capacitiesImported++;
  }
  const rawRatings = Array.isArray((raw as Record<string, unknown>).capacityRatings)
    ? (raw as Record<string, unknown>).capacityRatings as unknown[]
    : [];
  let ratingsImported = 0;
  for (const rawRating of rawRatings) {
    if (!isValidCapacityRating(rawRating)) continue;
    if (!data.capacities.some((c) => c.id === rawRating.capacityId)) continue;
    if (data.capacityRatings.some((r) => r.id === rawRating.id)) continue;
    const remappedHabitId = rawRating.habitId ? idMap.get(rawRating.habitId) ?? rawRating.habitId : undefined;
    data.capacityRatings.push({
      ...rawRating,
      habitId: remappedHabitId,
    });
    ratingsImported++;
  }

  // --- v0.3.2: Import moods (YYYY-MM-DD → mood id) ---
  let moodsRestored = 0;
  if (!data.moods) data.moods = {};
  const rawMoods = (raw as Record<string, unknown>).moods;
  if (rawMoods && typeof rawMoods === 'object' && !Array.isArray(rawMoods)) {
    for (const [date, moodId] of Object.entries(rawMoods as Record<string, unknown>)) {
      if (typeof date === 'string' && typeof moodId === 'string' && isValidDateKey(date) && !data.moods[date]) {
        data.moods[date] = moodId;
        moodsRestored++;
      }
    }
  }
  result.moodsRestored = moodsRestored;

  // --- v0.3.2: Import experiments ---
  let experimentsRestored = 0;
  if (!data.experiments) data.experiments = [];
  const rawExps = Array.isArray((raw as Record<string, unknown>).experiments)
    ? (raw as Record<string, unknown>).experiments as unknown[]
    : [];
  for (const rawExp of rawExps) {
    if (!rawExp || typeof rawExp !== 'object') continue;
    const e = rawExp as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.title !== 'string') continue;
    if (data.experiments.some(x => x.id === e.id)) continue;
    data.experiments.push({
      id: e.id, title: e.title,
      hypothesis: typeof e.hypothesis === 'string' ? e.hypothesis : '',
      startDate: typeof e.startDate === 'string' ? e.startDate : '',
      endDate: typeof e.endDate === 'string' ? e.endDate : '',
      linkedHabits: Array.isArray(e.linkedHabits) ? (e.linkedHabits as string[]).map(hid => idMap.get(hid) ?? hid) : [],
      linkedMetrics: Array.isArray(e.linkedMetrics) ? e.linkedMetrics as string[] : [],
      status: (e.status === 'active' || e.status === 'completed' || e.status === 'cancelled') ? e.status : 'active',
      conclusion: typeof e.conclusion === 'string' ? e.conclusion : '',
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date().toISOString(),
      completedAt: typeof e.completedAt === 'string' ? e.completedAt : undefined,
    });
    experimentsRestored++;
  }
  result.experimentsRestored = experimentsRestored;

  // --- v0.3.2: Import urges ---
  let urgesRestored = 0;
  if (!data.urges) data.urges = [];
  const rawUrges = Array.isArray((raw as Record<string, unknown>).urges)
    ? (raw as Record<string, unknown>).urges as unknown[]
    : [];
  for (const rawUrge of rawUrges) {
    if (!rawUrge || typeof rawUrge !== 'object') continue;
    const u = rawUrge as Record<string, unknown>;
    if (typeof u.id !== 'string' || typeof u.type !== 'string') continue;
    if (data.urges.some(x => x.id === u.id)) continue;
    data.urges.push({
      id: u.id, type: u.type,
      intensity: typeof u.intensity === 'number' && Number.isFinite(u.intensity) ? Math.max(1, Math.min(10, u.intensity)) : 5,
      startTime: typeof u.startTime === 'string' ? u.startTime : new Date().toISOString(),
      endTime: typeof u.endTime === 'string' ? u.endTime : undefined,
      outcome: (u.outcome === 'surfed' || u.outcome === 'gave_in' || u.outcome === 'active') ? u.outcome : 'active',
      note: typeof u.note === 'string' ? u.note : undefined,
      trigger: typeof u.trigger === 'string' ? u.trigger : undefined,
      // v0.3.2: preserve counter-habits, remapping through idMap
      counterHabits: Array.isArray(u.counterHabits)
        ? (u.counterHabits as string[]).map(hid => idMap.get(hid) ?? hid).filter(Boolean)
        : undefined,
    });
    urgesRestored++;
  }
  result.urgesRestored = urgesRestored;

  // --- v0.3.2: Import user-created mantras ---
  let mantrasRestored = 0;
  const rawMantras = Array.isArray((raw as Record<string, unknown>).mantras)
    ? (raw as Record<string, unknown>).mantras as unknown[]
    : [];
  for (const rawMantra of rawMantras) {
    if (!rawMantra || typeof rawMantra !== 'object') continue;
    const m = rawMantra as Record<string, unknown>;
    if (typeof m.id !== 'string' || typeof m.text !== 'string') continue;
    if (m.isDefault === true) continue;
    if (data.mantras.some(x => x.id === m.id)) continue;
    data.mantras.push({
      id: m.id, text: m.text,
      domain: typeof m.domain === 'string' ? m.domain : 'life',
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
      isDefault: false,
    });
    mantrasRestored++;
  }
  result.mantrasRestored = mantrasRestored;

  // --- v0.3.2: Import chaos dimensions (merge triggers) ---
  let chaosDimensionsRestored = 0;
  const rawChaos = Array.isArray((raw as Record<string, unknown>).chaosDimensions)
    ? (raw as Record<string, unknown>).chaosDimensions as unknown[]
    : [];
  if (!data.chaosDimensions) data.chaosDimensions = [];
  for (const rawDim of rawChaos) {
    if (!rawDim || typeof rawDim !== 'object') continue;
    const cd = rawDim as Record<string, unknown>;
    if (typeof cd.id !== 'string') continue;
    const existing = data.chaosDimensions.find(d => d.id === cd.id);
    const rawTriggers = Array.isArray(cd.triggers) ? cd.triggers as unknown[] : [];
    if (existing) {
      for (const rt of rawTriggers) {
        if (!rt || typeof rt !== 'object') continue;
        const t = rt as Record<string, unknown>;
        if (typeof t.id === 'string' && !existing.triggers.some(et => et.id === t.id)) {
          existing.triggers.push({ id: t.id, label: typeof t.label === 'string' ? t.label : '', weight: typeof t.weight === 'number' ? t.weight : 0, active: t.active === true });
          chaosDimensionsRestored++;
        }
      }
    } else {
      const triggers: ChaosTrigger[] = [];
      for (const rt of rawTriggers) {
        if (!rt || typeof rt !== 'object') continue;
        const t = rt as Record<string, unknown>;
        if (typeof t.id === 'string') triggers.push({ id: t.id, label: typeof t.label === 'string' ? t.label : '', weight: typeof t.weight === 'number' ? t.weight : 0, active: t.active === true });
      }
      data.chaosDimensions.push({ id: cd.id, name: typeof cd.name === 'string' ? cd.name : cd.id, triggers });
      chaosDimensionsRestored += triggers.length;
    }
  }
  result.chaosDimensionsRestored = chaosDimensionsRestored;

  // Merge imported dims with defaults so newer dimensions (e.g. 'energy')
  // appear even when the imported backup was written by an older version.
  data.chaosDimensions = mergeChaosDimensions(data.chaosDimensions ?? []);

  // --- v0.3.3: Import achievement categories (merge with defaults) ---
  const rawAchievementCats = Array.isArray((raw as Record<string, unknown>).achievementCategories)
    ? (raw as Record<string, unknown>).achievementCategories as unknown[]
    : [];
  if (!data.achievementCategories) data.achievementCategories = [];
  for (const rawCat of rawAchievementCats) {
    if (!rawCat || typeof rawCat !== 'object') continue;
    const cat = rawCat as Record<string, unknown>;
    if (typeof cat.id !== 'string') continue;
    const existing = data.achievementCategories.find(c => c.id === cat.id);
    if (existing) {
      if (typeof cat.name === 'string' && cat.name) existing.name = cat.name;
      if (typeof cat.emoji === 'string' && cat.emoji) existing.emoji = cat.emoji;
      if (typeof cat.color === 'string' && cat.color) existing.color = cat.color;
    } else {
      data.achievementCategories.push({
        id: cat.id,
        name: typeof cat.name === 'string' && cat.name ? cat.name : cat.id,
        emoji: typeof cat.emoji === 'string' && cat.emoji ? cat.emoji : '🏆',
        color: typeof cat.color === 'string' && cat.color ? cat.color : '#FEF3C7',
      });
    }
  }
  // Ensure newer defaults are present after import.
  data.achievementCategories = mergeAchievementCategories(data.achievementCategories ?? []);

  // --- v0.3.2: Import mantra settings (notification preferences) ---
  const rawMantraSettings = (raw as Record<string, unknown>).mantraSettings;
  if (rawMantraSettings && typeof rawMantraSettings === 'object') {
    const ms = rawMantraSettings as Record<string, unknown>;
    // Only import if the current settings are still defaults (never customized)
    const current = data.mantraSettings;
    if (current.morningTime === DEFAULT_MANTRA_SETTINGS.morningTime
      && current.eveningTime === DEFAULT_MANTRA_SETTINGS.eveningTime
      && current.showOnEntry === DEFAULT_MANTRA_SETTINGS.showOnEntry) {
      if (typeof ms.morningEnabled === 'boolean') current.morningEnabled = ms.morningEnabled;
      if (typeof ms.eveningEnabled === 'boolean') current.eveningEnabled = ms.eveningEnabled;
      if (typeof ms.morningTime === 'string') current.morningTime = ms.morningTime;
      if (typeof ms.eveningTime === 'string') current.eveningTime = ms.eveningTime;
      if (typeof ms.showOnEntry === 'boolean') current.showOnEntry = ms.showOnEntry;
    }
  }

  // --- v0.3.2: Import preferences (darkMode, theme) ---
  const rawPrefs = (raw as Record<string, unknown>).preferences;
  if (rawPrefs && typeof rawPrefs === 'object') {
    const p = rawPrefs as Record<string, unknown>;
    const currentPrefs = data.preferences ?? { darkMode: false, theme: '' };
    if (p.darkMode === true && !currentPrefs.darkMode) currentPrefs.darkMode = true;
    if (typeof p.theme === 'string' && p.theme && !currentPrefs.theme) currentPrefs.theme = p.theme;
    data.preferences = currentPrefs;
  }

  // --- v0.3.2: Import custom urge types ---
  const rawCustomTypes = Array.isArray((raw as Record<string, unknown>).customUrgeTypes)
    ? (raw as Record<string, unknown>).customUrgeTypes as unknown[]
    : [];
  if (!data.customUrgeTypes) data.customUrgeTypes = [];
  for (const rawCT of rawCustomTypes) {
    if (!rawCT || typeof rawCT !== 'object') continue;
    const ct = rawCT as Record<string, unknown>;
    if (typeof ct.id !== 'string' || typeof ct.name !== 'string') continue;
    if (data.customUrgeTypes.some(x => x.id === ct.id)) continue;
    data.customUrgeTypes.push({
      id: ct.id,
      name: ct.name,
      emoji: typeof ct.emoji === 'string' ? ct.emoji : '❓',
      color: typeof ct.color === 'string' ? ct.color : '#6B7280',
      defaultCounterHabits: Array.isArray(ct.defaultCounterHabits)
        ? (ct.defaultCounterHabits as string[]).map(hid => idMap.get(hid) ?? hid).filter(Boolean)
        : undefined,
      createdAt: typeof ct.createdAt === 'string' ? ct.createdAt : new Date().toISOString(),
    });
  }

  const totalRestored = result.habitsCreated + result.checkInsRestored + result.notesCreated
    + skillsMerged + capacitiesImported + ratingsImported
    + moodsRestored + experimentsRestored + urgesRestored + mantrasRestored + chaosDimensionsRestored;
  if (metadataChanged || totalRestored > 0) {
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

// --- Mantras ---

export function getMantras(): Mantra[] {
  return data.mantras ?? [];
}

export function getMantraSettings(): MantraSettings {
  if (!data.mantraSettings) {
    data.mantraSettings = { ...DEFAULT_MANTRA_SETTINGS };
  }
  return data.mantraSettings;
}

export function addMantra(text: string, domain: string): Mantra {
  const mantra: Mantra = {
    id: crypto.randomUUID(),
    text: text.trim(),
    domain,
    createdAt: new Date().toISOString(),
    isDefault: false,
  };
  if (!data.mantras) data.mantras = [];
  data.mantras.push(mantra);
  notify();
  return mantra;
}

export function deleteMantra(id: string): void {
  if (!data.mantras) return;
  const mantra = data.mantras.find((m) => m.id === id);
  if (!mantra) return;
  // Only allow deleting user-created mantras (not built-in defaults)
  if (mantra.isDefault) return;
  data.mantras = data.mantras.filter((m) => m.id !== id);
  notify();
}

export function updateMantraSettings(updates: Partial<MantraSettings>): void {
  if (!data.mantraSettings) {
    data.mantraSettings = { ...DEFAULT_MANTRA_SETTINGS };
  }
  data.mantraSettings = { ...data.mantraSettings, ...updates };
  notify();
}

// --- Mood / Emotional Tracking ---
// Moods are fully active: stored as a per-day map (date → mood id), surfaced in
// the grid mood row, and consumed by insights (mood↔habit correlations, burnout
// watch) and the correlations engine.

export function getMoods() {
  return MOODS;
}
export function setMood(date: string, moodId: string): void {
  data.moods[date] = moodId;
  notify();
}
export function getMood(date: string): string | undefined {
  return data.moods[date];
}
export function getMoodForDate(date: string): string | undefined {
  return data.moods[date];
}
export function getMoodStreak(): { good: number; bad: number } {
  const good = ['great', 'amazing', 'calm'];
  const bad = ['bad', 'angry', 'sick', 'tired'];
  let g = 0, b = 0;
  for (const moodId of Object.values(data.moods)) {
    if (good.includes(moodId)) g++;
    if (bad.includes(moodId)) b++;
  }
  return { good: g, bad: b };
}

export function getMonthMoods(year: number, month: number): Map<number, string> {
  const map = new Map<number, string>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  for (const [date, moodId] of Object.entries(data.moods)) {
    if (date.startsWith(prefix)) {
      const day = parseInt(date.split('-')[2], 10);
      map.set(day, moodId);
    }
  }
  return map;
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
  { id: 'emotional', name: 'Emotional', triggers: [] },
  { id: 'energy', name: 'Energy', triggers: [] },
];

export function getDefaultChaosDimensions(): ChaosDimension[] {
  return JSON.parse(JSON.stringify(DEFAULT_CHAOS));
}

// Merge stored dimensions with the current defaults. New defaults (e.g.
// 'emotional') are appended for users whose data was saved by an older
// version that didn't include them. User customisations on existing
// dimensions are preserved by id.
export function mergeChaosDimensions(stored: ChaosDimension[]): ChaosDimension[] {
  const defaults = getDefaultChaosDimensions();
  const storedById = new Map(stored.filter((d) => d && d.id).map((d) => [d.id, d]));
  return defaults.map((d) => {
    const prior = storedById.get(d.id);
    return prior ? { ...d, triggers: prior.triggers ?? [] } : d;
  });
}

export function getChaosDimensions(): ChaosDimension[] {
  const defaults = getDefaultChaosDimensions();
  if (!data.chaosDimensions || data.chaosDimensions.length === 0) {
    data.chaosDimensions = defaults;
  } else {
    // Self-heal: if any default dimension is missing from persisted data
    // (e.g. 'energy' written by an older build), merge with defaults. When
    // nothing is missing we keep the same array reference to preserve
    // reactivity in components that rely on identity.
    const storedIds = new Set(data.chaosDimensions.map((d) => d.id));
    if (defaults.some((d) => !storedIds.has(d.id))) {
      data.chaosDimensions = mergeChaosDimensions(data.chaosDimensions);
    }
  }
  return data.chaosDimensions;
}

// --- Achievements ---
// Achievements are notes tagged with a category. Defaults reuse the seven
// chaos dimensions plus a dedicated 'Psychological' category so that life
// progress is tracked on the same axes the user already knows.
const DEFAULT_ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  { id: 'physical', name: 'Physical', emoji: '🏃', color: '#D1FAE5' },
  { id: 'financial', name: 'Financial', emoji: '💰', color: '#FEF3C7' },
  { id: 'social', name: 'Social', emoji: '👥', color: '#DBEAFE' },
  { id: 'structural', name: 'Structural', emoji: '🏗️', color: '#E0E7FF' },
  { id: 'spiritual', name: 'Spiritual', emoji: '🧘', color: '#FCE7F3' },
  { id: 'emotional', name: 'Emotional', emoji: '💗', color: '#FEE2E2' },
  { id: 'energy', name: 'Energy', emoji: '⚡', color: '#FEF9C3' },
  { id: 'psychological', name: 'Psychological', emoji: '🧠', color: '#EDE9FE' },
];

export function getDefaultAchievementCategories(): AchievementCategory[] {
  return JSON.parse(JSON.stringify(DEFAULT_ACHIEVEMENT_CATEGORIES));
}

// Merge stored categories with the current defaults (same strategy as chaos
// dimensions): newer defaults are appended, existing ones keep stored data.
export function mergeAchievementCategories(stored: AchievementCategory[]): AchievementCategory[] {
  const defaults = getDefaultAchievementCategories();
  const storedById = new Map(stored.filter((d) => d && d.id).map((d) => [d.id, d]));
  return defaults.map((d) => {
    const prior = storedById.get(d.id);
    return prior ? { ...d, name: prior.name ?? d.name, emoji: prior.emoji ?? d.emoji, color: prior.color ?? d.color } : d;
  });
}

export function getAchievementCategories(): AchievementCategory[] {
  const defaults = getDefaultAchievementCategories();
  if (!data.achievementCategories || data.achievementCategories.length === 0) {
    data.achievementCategories = defaults;
  } else {
    const storedIds = new Set(data.achievementCategories.map((d) => d.id));
    if (defaults.some((d) => !storedIds.has(d.id))) {
      data.achievementCategories = mergeAchievementCategories(data.achievementCategories);
    }
  }
  return data.achievementCategories;
}

// Tag an existing note as an achievement of `categoryId` (or untag with null).
// Returns the updated note, or null if the note doesn't exist.
export function tagNoteAchievement(noteId: string, categoryId: string | null): Note | null {
  const note = data.notes.find((n) => n.id === noteId);
  if (!note) return null;
  if (categoryId === null) {
    delete note.achievementCategory;
  } else {
    note.achievementCategory = categoryId;
  }
  notify();
  return note;
}

// All achievement-tagged notes, newest first.
export function getAchievements(): Note[] {
  return getNotes().filter((n) => n.achievementCategory);
}

export function getAchievementCategoryById(id: string): AchievementCategory | undefined {
  return getAchievementCategories().find((c) => c.id === id);
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

// --- Skills & Capacities Progression math and CRUD ---

export function getLevelFromXp(xp: number): number {
  if (xp <= 0) return 1;
  return Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2);
}

export function getXpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return 50 * (level - 1) * level;
}

export function getSkills(): Skill[] {
  return data.skills;
}

export function addSkill(name: string, description: string, emoji: string, color: string, links: SkillLink[] = []): Skill {
  const newSkill: Skill = {
    id: crypto.randomUUID(),
    name,
    description,
    emoji,
    color,
    createdAt: new Date().toISOString(),
    links,
  };
  data.skills.push(newSkill);
  notify();
  return newSkill;
}

export function updateSkill(id: string, updates: Partial<Skill>): void {
  const idx = data.skills.findIndex(s => s.id === id);
  if (idx !== -1) {
    data.skills[idx] = { ...data.skills[idx], ...updates };
    notify();
  }
}

export function deleteSkill(id: string): void {
  const idx = data.skills.findIndex(s => s.id === id);
  if (idx !== -1) {
    data.skills.splice(idx, 1);
    // Cascade: remove capacities belonging to this skill, then drop their ratings.
    if (data.capacities) {
      const removedCapacityIds = new Set(
        data.capacities.filter((c) => c.skillId === id).map((c) => c.id),
      );
      data.capacities = data.capacities.filter((c) => c.skillId !== id);
      if (data.capacityRatings && removedCapacityIds.size > 0) {
        data.capacityRatings = data.capacityRatings.filter(
          (r) => !removedCapacityIds.has(r.capacityId),
        );
      }
    }
    notify();
  }
}

export interface HabitXpContribution {
  habitId: string;
  habitName: string;
  habitColor: string;
  completions: number;
  xpContributed: number;
}

export interface DayXpGain {
  date: string;
  xpGained: number;
}

export interface SkillProgress {
  skillId: string;
  totalXp: number;
  level: number;
  minXpForLevel: number;
  nextLevelXp: number;
  progressPct: number;
  contributions: HabitXpContribution[];
  recentHistory: DayXpGain[];
}

export function computeSkillProgress(skillId: string): SkillProgress | undefined {
  const skill = data.skills.find(s => s.id === skillId);
  if (!skill) return undefined;

  const contributions: HabitXpContribution[] = [];
  let totalXp = 0;

  // Cache check-ins by habit
  const habitCheckIns = new Map<string, CheckIn[]>();
  for (const ci of data.checkIns) {
    if (ci.completed) {
      if (!habitCheckIns.has(ci.habitId)) {
        habitCheckIns.set(ci.habitId, []);
      }
      habitCheckIns.get(ci.habitId)!.push(ci);
    }
  }

  // Calculate contributions per habit link
  for (const link of skill.links) {
    const habit = data.habits.find(h => h.id === link.habitId);
    if (!habit) continue;

    const checkIns = habitCheckIns.get(link.habitId) ?? [];
    let completions = 0;
    for (const ci of checkIns) {
      completions += ci.count || 1;
    }
    const xpContributed = completions * link.xpPerCompletion;
    totalXp += xpContributed;

    contributions.push({
      habitId: link.habitId,
      habitName: habit.name,
      habitColor: habit.color,
      completions,
      xpContributed,
    });
  }

  const level = getLevelFromXp(totalXp);
  const minXpForLevel = getXpRequiredForLevel(level);
  const nextLevelXp = getXpRequiredForLevel(level + 1);
  const range = nextLevelXp - minXpForLevel;
  const progressPct = range > 0 ? Math.min(100, Math.max(0, ((totalXp - minXpForLevel) / range) * 100)) : 0;

  // Calculate 30-day history
  const recentHistory: DayXpGain[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = toLocalDateKey(d); // YYYY-MM-DD (local, not UTC)

    let xpGainedOnDay = 0;
    for (const link of skill.links) {
      const checkIns = habitCheckIns.get(link.habitId) ?? [];
      const ciForDay = checkIns.find(ci => ci.date === dateStr);
      if (ciForDay) {
        xpGainedOnDay += (ciForDay.count || 1) * link.xpPerCompletion;
      }
    }
    recentHistory.push({
      date: dateStr,
      xpGained: xpGainedOnDay,
    });
  }

  return {
    skillId,
    totalXp,
    level,
    minXpForLevel,
    nextLevelXp,
    progressPct,
    contributions,
    recentHistory,
  };
}


// --- Capacities (sub-skills / micro-abilities) ---
// Each Skill can have multiple Capacities: discrete, named sub-abilities
// (e.g. "Pattern detection", "Thought noting" under Mindfulness). A Capacity
// owns a timeline of self-ratings + free-form notes. This module is the
// "API" surface; the underlying array lives on AppData.capacities /
// AppData.capacityRatings and is persisted with the same StorageEnvelope as
// everything else.

export function getCapacities(skillId?: string): Capacity[] {
  if (!data.capacities) return [];
  return skillId ? data.capacities.filter((c) => c.skillId === skillId) : data.capacities;
}

export function getCapacity(capacityId: string): Capacity | undefined {
  return data.capacities?.find((c) => c.id === capacityId);
}

export function addCapacity(
  skillId: string,
  name: string,
  description: string,
  unit: string,
  baseline: number,
  target: number,
): Capacity | null {
  // Parent must exist — refuse orphans (they would be unreachable from the UI).
  if (!data.skills.some((s) => s.id === skillId)) {
    console.warn('addCapacity: skill not found', skillId);
    return null;
  }
  if (!data.capacities) data.capacities = [];
  const capacity: Capacity = {
    id: crypto.randomUUID(),
    skillId,
    name: name.trim(),
    description: description.trim(),
    unit: unit.trim() || '1-10',
    baseline: clampNumber(baseline, 0, 1000),
    target: clampNumber(target, 0, 1000),
    createdAt: new Date().toISOString(),
  };
  if (!capacity.name) return null;
  data.capacities.push(capacity);
  notify();
  return capacity;
}

export function updateCapacity(id: string, updates: Partial<Capacity>): void {
  if (!data.capacities) return;
  const idx = data.capacities.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const cleaned: Partial<Capacity> = { ...updates };
  if ('baseline' in cleaned) cleaned.baseline = clampNumber(cleaned.baseline, 0, 1000);
  if ('target' in cleaned) cleaned.target = clampNumber(cleaned.target, 0, 1000);
  if ('name' in cleaned && typeof cleaned.name === 'string') cleaned.name = cleaned.name.trim();
  if ('description' in cleaned && typeof cleaned.description === 'string') cleaned.description = cleaned.description.trim();
  if ('unit' in cleaned && typeof cleaned.unit === 'string') cleaned.unit = cleaned.unit.trim() || '1-10';
  data.capacities[idx] = { ...data.capacities[idx], ...cleaned };
  notify();
}

export function deleteCapacity(id: string): void {
  if (!data.capacities) return;
  data.capacities = data.capacities.filter((c) => c.id !== id);
  if (data.capacityRatings) {
    data.capacityRatings = data.capacityRatings.filter((r) => r.capacityId !== id);
  }
  notify();
}

export function getCapacityRatings(capacityId: string): CapacityRating[] {
  if (!data.capacityRatings) return [];
  return data.capacityRatings
    .filter((r) => r.capacityId === capacityId)
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

export interface CapacityObservationInput {
  date?: string;       // defaults to today
  rating?: number;
  note?: string;
  habitId?: string;
}

/**
 * Record an observation on a capacity. If an entry already exists for the
 * same capacity + date, the new observation MERGES with the existing one
 * (newer rating wins; notes concatenate). This matches the user mental model
 * of "log today again" without losing prior context.
 */
export function logCapacityObservation(
  capacityId: string,
  input: CapacityObservationInput,
): CapacityRating | null {
  if (!getCapacity(capacityId)) {
    console.warn('logCapacityObservation: capacity not found', capacityId);
    return null;
  }
  if (input.rating === undefined && (!input.note || input.note.trim().length === 0)) {
    // Reject empty observations (R7 — no silent failures / no silent data loss).
    console.warn('logCapacityObservation: refusing empty observation (no rating, no note)');
    return null;
  }
  if (!data.capacityRatings) data.capacityRatings = [];
  const todayStr = toLocalDateKey(new Date());
  const date = input.date ?? todayStr;
  if (!isValidDateKey(date)) {
    console.warn('logCapacityObservation: invalid date', date);
    return null;
  }
  const existing = data.capacityRatings.find(
    (r) => r.capacityId === capacityId && r.date === date,
  );
  if (existing) {
    if (input.rating !== undefined) existing.rating = input.rating;
    if (input.note && input.note.trim().length > 0) {
      existing.note = existing.note
        ? `${existing.note}\n• ${input.note.trim()}`
        : input.note.trim();
    }
    if (input.habitId !== undefined) existing.habitId = input.habitId;
    notify();
    return existing;
  }
  const entry: CapacityRating = {
    id: crypto.randomUUID(),
    capacityId,
    date,
    rating: input.rating,
    note: input.note?.trim() || undefined,
    habitId: input.habitId,
  };
  data.capacityRatings.push(entry);
  notify();
  return entry;
}

export function deleteCapacityRating(ratingId: string): void {
  if (!data.capacityRatings) return;
  data.capacityRatings = data.capacityRatings.filter((r) => r.id !== ratingId);
  notify();
}

export interface CapacityProgress {
  capacityId: string;
  latestRating: number | null;
  latestDate: string | null;
  /** Average of last 5 numeric ratings, or null if no numeric data. */
  recentAverage: number | null;
  /** Total number of observations (rating + note entries). */
  totalObservations: number;
  /** All observations, oldest first. Includes id for delete actions. */
  history: { id: string; date: string; rating: number | null; note?: string }[];
  /** Delta from baseline: latestRating - capacity.baseline (signed). */
  delta: number;
  /** Delta from start: latestRating - first rating in history (signed). */
  deltaSinceStart: number;
  /** % progress toward target (latestRating vs baseline?target range). */
  progressPct: number;
  /** Has the capacity reached its declared target? */
  targetReached: boolean;
}

export function computeCapacityProgress(capacityId: string): CapacityProgress | null {
  const capacity = getCapacity(capacityId);
  if (!capacity) return null;
  const ratings = getCapacityRatings(capacityId).slice().reverse(); // oldest first
  const numeric = ratings.filter((r) => r.rating !== undefined) as Array<CapacityRating & { rating: number }>;
  const latest = numeric.length > 0 ? numeric[numeric.length - 1] : null;
  const latestRating = latest?.rating ?? null;
  const latestDate = latest?.date ?? null;
  const recent5 = numeric.slice(-5);
  const recentAverage = recent5.length > 0
    ? recent5.reduce((s, r) => s + r.rating, 0) / recent5.length
    : null;
  const first = numeric.length > 0 ? numeric[0] : null;
  const delta = latestRating !== null ? latestRating - capacity.baseline : 0;
  const deltaSinceStart = latestRating !== null && first
    ? latestRating - first.rating
    : 0;
  // Progress toward target, clamped 0-100. If baseline == target, the only
  // valid values are 0% (below) and 100% (at or above). We treat baseline as
  // the floor and target as the ceiling.
  const range = capacity.target - capacity.baseline;
  const progressPct = latestRating !== null && range !== 0
    ? Math.max(0, Math.min(100, ((latestRating - capacity.baseline) / range) * 100))
    : (latestRating !== null && range === 0 ? (latestRating >= capacity.target ? 100 : 0) : 0);
  const targetReached = latestRating !== null && latestRating >= capacity.target;
  return {
    capacityId,
    latestRating,
    latestDate,
    recentAverage,
    totalObservations: ratings.length,
    history: ratings.map((r) => ({ id: r.id, date: r.date, rating: r.rating ?? null, note: r.note })),
    delta,
    deltaSinceStart,
    progressPct,
    targetReached,
  };
}

function clampNumber(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
