import type { AppData, Habit, CheckIn, Note, ChaosDimension, ChaosTrigger, ChaosLink, Mantra, MantraSettings, Skill, SkillLink, Capacity, CapacityRating, Experiment, UrgeEntry, CustomUrgeType, UserPreferences, AchievementCategory, JournalEntry, JournalThread, JournalPersonality, Challenge, Persona, Lever, PatternTrack, ReflectionEntry, ReflectionKind, Project, Protocol, IngestedSource, Task, FeedConfig, PsychoMessage, ObsidianNote, Mission, MissionWindow, Routine, EmotionalEvent, EmotionalCheck, SubHabit, IfThenPlan } from './types';
import { MAX_SUB_HABITS, MAX_SUB_HABIT_LABEL, MAX_IF_THEN, MAX_IF_THEN_TEXT, isPartialCheckIn, cleanEmotionTags } from './types';
import { computeStreakStats } from './stats';
import { computeChallengeProgress } from './challenges';
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
import { SEED_PROTOCOLS, isJunkyHabitName } from './protocols';
import { mergeProtocols } from './ingest';
import { DEFAULT_FEEDS } from './autoIngest';
import type { FeedCycleOutcome } from './autoIngest';

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
// Bulk knowledge-library key. protocols + ingestedSources (~1.5MB of auto-ingested
// reference data) used to ride inside EVERY envelope/snapshot write, choking the
// ~5MB localStorage quota until ALL writes failed silently and recent user data
// stopped persisting. The critical path (envelopes, snapshots) now carries only
// the ~100KB core; bulk lives here (best-effort) + in full-fidelity file backups.
const BULK_KEY = 'lifetrack-bulk';
interface BulkData {
  protocols?: Protocol[];
  ingestedSources?: IngestedSource[];
}
/** Split live data into quota-safe core (envelopes/snapshots) + bulk (own key + files). */
function stripBulk(d: AppData): { core: AppData; bulk: BulkData } {
  const { protocols, ingestedSources, ...rest } = d as AppData & { protocols?: Protocol[]; ingestedSources?: IngestedSource[] };
  return {
    core: rest as AppData,
    bulk: { protocols: protocols ?? [], ingestedSources: ingestedSources ?? [] },
  };
}
let lastBulkHash = '';
/** Best-effort bulk write. Failure only degrades the knowledge library cache
 *  (recoverable from files/seeds) — it must NEVER block or fail the save.
 *  Skipped when unchanged (avoids re-serializing ~1.5MB on every keystroke). */
function writeBulkData(bulk: BulkData): boolean {
  if (!isLocalStorageAvailable()) return false;
  try {
    const json = JSON.stringify(bulk);
    const h = fnv1a(json);
    // Skip the ~1.5MB rewrite when unchanged — but only if the key actually
    // exists (a wipe/new profile with identical content must still be written).
    if (h === lastBulkHash) {
      try {
        if (localStorage.getItem(BULK_KEY) !== null) return true;
      } catch { /* fall through and rewrite */ }
    }
    localStorage.setItem(BULK_KEY, JSON.stringify({ v: 1, d: bulk, h }));
    lastBulkHash = h;
    return true;
  } catch {
    return false;
  }
}
/** Read + verify the bulk companion key. Null on any problem (evidence, not data). */
function readBulkData(): BulkData | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(BULK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) return null;
    const d = (parsed as { d?: unknown }).d;
    if (!d || typeof d !== 'object') return null;
    const envelope = parsed as { h?: unknown };
    if (typeof envelope.h === 'string' && envelope.h !== fnv1a(JSON.stringify(d))) return null;
    return d as BulkData;
  } catch {
    return null;
  }
}
/**
 * Union file/bulk-library entries into live data (by id). Used at load and
 * after core-only restores. Union (not replace): bulk is append-mostly
 * reference data, and both sides may have advanced independently.
 */
function attachBulkData(d: AppData): void {
  let bulk: BulkData | null = null;
  try { bulk = readBulkData(); } catch { /* ignore */ }
  if (!bulk) return;
  if (Array.isArray(bulk.protocols) && bulk.protocols.length > 0) {
    const have = new Set((d.protocols ?? []).map((p) => p.id));
    const clean = sanitizeProtocols(bulk.protocols);
    for (const p of clean) {
      if (!have.has(p.id)) {
        (d.protocols ??= []).push(p);
        have.add(p.id);
      }
    }
  }
  if (Array.isArray(bulk.ingestedSources) && bulk.ingestedSources.length > 0) {
    const have = new Set((d.ingestedSources ?? []).map((s) => s.id));
    for (const s of bulk.ingestedSources) {
      if (!s || typeof s !== 'object') continue;
      const r = s as unknown as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id || typeof r.rawText !== 'string' || have.has(r.id)) continue;
      (d.ingestedSources ??= []).push({
        id: r.id,
        title: typeof r.title === 'string' ? r.title : r.id,
        rawText: r.rawText,
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
        ingested: r.ingested === true,
      });
      have.add(r.id);
    }
  }
}
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

// Challenge (v0.5.0): a persistent adaptive challenge attached to a habit.
// The dailyGoal must be a positive integer; days a positive integer; status
// must be one of the three known states.
function isValidChallenge(x: unknown): x is Challenge {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.habitId !== 'string' || typeof c.name !== 'string') return false;
  if (typeof c.days !== 'number' || !Number.isFinite(c.days) || c.days < 1) return false;
  if (typeof c.dailyGoal !== 'number' || !Number.isFinite(c.dailyGoal) || c.dailyGoal < 1) return false;
  if (typeof c.startDate !== 'string' || !isValidDateKey(c.startDate)) return false;
  if (c.status !== 'active' && c.status !== 'completed' && c.status !== 'failed') return false;
  if (typeof c.createdAt !== 'string') return false;
  if (c.completedAt !== undefined && typeof c.completedAt !== 'string') return false;
  return true;
}

// Persona (v0.5.0): the "person you want to become", linked to a set of habits.
function isValidPersona(x: unknown): x is Persona {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.createdAt !== 'string') return false;
  if (typeof p.emoji !== 'string') return false;
  if (p.description !== undefined && typeof p.description !== 'string') return false;
  if (!Array.isArray(p.habitIds)) return false;
  if (p.habitIds.some((id: unknown) => typeof id !== 'string')) return false;
  return true;
}

// Lever (v0.5.0): "what works for me" — an intervention + observed effect.
function isValidLever(x: unknown): x is Lever {
  if (!x || typeof x !== 'object') return false;
  const l = x as Record<string, unknown>;
  if (typeof l.id !== 'string' || typeof l.content !== 'string' || typeof l.createdAt !== 'string') return false;
  if (l.effect !== undefined && typeof l.effect !== 'string') return false;
  if (l.notes !== undefined && typeof l.notes !== 'string') return false;
  return true;
}

// --- Shared cleaners (sanitize + import agree on one implementation) ---
// Repair sub-habit lists in place semantics: trim labels, drop dup ids and
// empties, cap length. Returns undefined when nothing usable remains.
// A corrupt sub must never delete the habit it serves.
function cleanSubHabitList(raw: unknown): SubHabit[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const clean: SubHabit[] = [];
  for (const s of raw as unknown[]) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.length === 0 || seen.has(o.id)) continue;
    if (typeof o.label !== 'string') continue;
    const label = o.label.trim().slice(0, MAX_SUB_HABIT_LABEL);
    if (!label) continue;
    seen.add(o.id);
    clean.push({ id: o.id, label, order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : clean.length });
    if (clean.length >= MAX_SUB_HABITS) break;
  }
  clean.sort((a, b) => a.order - b.order);
  return clean.length > 0 ? clean : undefined;
}

// Repair implementation-intention lists: trim cue/action, drop empties and
// dupes, cap. Same "never delete the habit" contract as sub-habits.
function cleanIfThenList(raw: unknown): IfThenPlan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const clean: IfThenPlan[] = [];
  for (const p of raw as unknown[]) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    if (typeof o.cue !== 'string' || typeof o.action !== 'string') continue;
    const cue = o.cue.trim().slice(0, MAX_IF_THEN_TEXT);
    const action = o.action.trim().slice(0, MAX_IF_THEN_TEXT);
    if (!cue || !action) continue;
    const key = `${cue.toLocaleLowerCase()}→${action.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ cue, action });
    if (clean.length >= MAX_IF_THEN) break;
  }
  return clean.length > 0 ? clean : undefined;
}

// Normalize a sub-state triple (subIds + total subs + completed) into a
// consistent { subIds?, partial? }. Used by sanitize and the import merge so
// a "doux" day round-trips byte-identically through backups and reinstalls.
function normalizeSubState(
  subIds: unknown,
  totalSubs: number,
  completed: boolean,
): { subIds?: string[]; partial?: boolean } {
  const ids = Array.isArray(subIds) ? (subIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  if (!completed || ids.length === 0 || totalSubs === 0) return {};
  if (ids.length >= totalSubs) return { subIds: ids };
  return { subIds: ids, partial: true };
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
    energies: {},
    concentrations: {},
    experiments: [],
    urges: [],
    customUrgeTypes: [],
    journalEntries: [],
    journalThreads: [],
    challenges: [],
    personas: [],
    levers: [],
    patternTracks: [],
    reflections: [],
    psychoHistory: [],
    projects: [],
    protocols: [],
    ingestedSources: [],
    feeds: [],
    obsidianNotes: [],
    missions: [],
    routines: [],
    emotionalEvents: [],
    emotionalChecks: [],
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
    if (h.chaosLinks !== undefined && h.chaosLinks !== null) {
      if (!Array.isArray(h.chaosLinks)) return false;
      for (const l of h.chaosLinks as unknown[]) {
        if (!l || typeof l !== 'object') return false;
        const o = l as Record<string, unknown>;
        if (typeof o.dimension !== 'string' || o.dimension.length === 0) return false;
        if (typeof o.impact !== 'number' || !Number.isFinite(o.impact)) return false;
      }
    }
    if (h.chaosImpact !== undefined && (typeof h.chaosImpact !== 'number' || !Number.isFinite(h.chaosImpact))) return false;
    if (h.chaosThresholdDays !== undefined && (typeof h.chaosThresholdDays !== 'number' || h.chaosThresholdDays < 1 || !Number.isFinite(h.chaosThresholdDays))) return false;
    // Frequency: repair (clamp 1-7), never drop the habit over it.
    if (h.chaosPerWeek !== undefined) {
      if (typeof h.chaosPerWeek !== 'number' || !Number.isFinite(h.chaosPerWeek)) delete h.chaosPerWeek;
      else h.chaosPerWeek = Math.min(7, Math.max(1, Math.round(h.chaosPerWeek)));
    }
    // Validate why/intentions: if present, must be an array of strings, max 5
    if (h.why !== undefined) {
      if (!Array.isArray(h.why)) return false;
      if (h.why.length > 5) return false;
      if (h.why.some((s: unknown) => typeof s !== 'string')) return false;
    }
    // Repair implementation intentions and sub-habits in place via the shared
    // cleaners — a corrupt plan or sub must never delete the habit it serves.
    if (h.ifThen !== undefined) {
      if (!Array.isArray(h.ifThen)) return false;
      const clean = cleanIfThenList(h.ifThen);
      if (clean) h.ifThen = clean;
      else delete h.ifThen;
    }
    if (h.subHabits !== undefined) {
      if (!Array.isArray(h.subHabits)) return false;
      const clean = cleanSubHabitList(h.subHabits);
      if (clean) h.subHabits = clean;
      else delete h.subHabits;
    }
    if (h.intent !== undefined && h.intent !== 'do' && h.intent !== 'avoid') return false;
    return true;
  }
  function isValidCheckIn(x: unknown): x is CheckIn {
    if (!x || typeof x !== 'object') return false;
    const c = x as Record<string, unknown>;
    if (typeof c.habitId !== 'string'
      || typeof c.date !== 'string'
      || !isValidDateKey(c.date)
      || typeof c.completed !== 'boolean') return false;
    // Validate sub-habit fields: subIds must be string ids, partial boolean.
    // Unknown sub ids are filtered later (habit must be known first).
    if (c.subIds !== undefined) {
      if (!Array.isArray(c.subIds)) return false;
      if ((c.subIds as unknown[]).some((s: unknown) => typeof s !== 'string')) return false;
    }
    if (c.partial !== undefined && typeof c.partial !== 'boolean') return false;
    return true;
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

  // Habits first so personas can drop references to habits that no longer exist.
  const habits = Array.isArray(obj.habits) ? obj.habits.filter(isValidHabit) : [];
  const validHabitIds = new Set(habits.map((h) => h.id));
  const storedPersonas: Persona[] = Array.isArray(obj.personas)
    ? obj.personas.filter(isValidPersona)
    : [];
  const validPersonas: Persona[] = [];
  for (const p of storedPersonas) {
    const habitIds = p.habitIds.filter((id) => validHabitIds.has(id));
    // Reflective personas (self-observation, e.g. accepted suggestions with no
    // habits) survive with zero habits; habit-linked personas are dropped when
    // all of their habits are deleted.
    if (habitIds.length === 0 && p.kind !== 'reflective') continue;
    validPersonas.push({ ...p, habitIds });
  }

  // Sub-habit cross-repair: drop subIds pointing at unknown habits or at
  // sub-habits that no longer exist, then recompute `partial` so it can
  // never contradict the actual sub state (partial ⟺ completed AND some —
  // but not all — known subs done; a direct full check has no subIds).
  const subIdsByHabit = new Map(habits.map((h) => [h.id, new Set((h.subHabits ?? []).map((s) => s.id))]));
  const validCheckIns: CheckIn[] = [];
  if (Array.isArray(obj.checkIns)) {
    for (const raw of obj.checkIns.filter(isValidCheckIn)) {
      const known = subIdsByHabit.get(raw.habitId) ?? new Set<string>();
      const filtered = (raw.subIds ?? []).filter((id) => known.has(id));
      // Drop orphan subIds first, then normalize via the shared helper so a
      // "doux" day round-trips byte-identically through every restore path.
      const kept = filtered.length === (raw.subIds ?? []).length ? raw.subIds : filtered;
      const norm = normalizeSubState(kept, known.size, raw.completed);
      raw.subIds = norm.subIds;
      raw.partial = norm.partial;
      validCheckIns.push(raw);
    }
  }

  return {
    habits,
    checkIns: validCheckIns,
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
    energies: sanitizeEnergies((obj as Record<string, unknown>).energies),
    concentrations: sanitizeEnergies((obj as Record<string, unknown>).concentrations),
    experiments: Array.isArray(obj.experiments) ? obj.experiments.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'title' in (e as object)) as Experiment[] : [],
    urges: Array.isArray(obj.urges) ? obj.urges.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'type' in (e as object)) as UrgeEntry[] : [],
    customUrgeTypes: Array.isArray(obj.customUrgeTypes) ? obj.customUrgeTypes.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'name' in (e as object)) as CustomUrgeType[] : [],
    journalEntries: Array.isArray(obj.journalEntries) ? obj.journalEntries.filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'content' in (e as object) && 'personality' in (e as object)) as JournalEntry[] : [],
    journalThreads: Array.isArray(obj.journalThreads) ? obj.journalThreads.filter((t: unknown) => t && typeof t === 'object' && 'id' in (t as object) && 'question' in (t as object)) as JournalThread[] : [],
    challenges: Array.isArray(obj.challenges) ? obj.challenges.filter(isValidChallenge) as Challenge[] : [],
    personas: validPersonas,
    levers: Array.isArray(obj.levers) ? obj.levers.filter(isValidLever) as Lever[] : [],
    patternTracks: Array.isArray(obj.patternTracks) ? obj.patternTracks.filter((e: unknown) => e && typeof e === 'object' && 'patternId' in (e as object)) as PatternTrack[] : [],
    reflections: Array.isArray(obj.reflections) ? obj.reflections.filter((r: unknown) => r && typeof r === 'object' && 'kind' in (r as object) && 'question' in (r as object) && 'dedupeKey' in (r as object)) as ReflectionEntry[] : [],
    psychoHistory: Array.isArray(obj.psychoHistory) ? obj.psychoHistory.filter((m: unknown) => m && typeof m === 'object' && 'content' in (m as object) && 'role' in (m as object)) as PsychoMessage[] : [],
    dismissedRecs: Array.isArray(obj.dismissedRecs) ? obj.dismissedRecs.filter((x: unknown): x is string => typeof x === 'string') : [],
    projects: sanitizeProjects(obj.projects),
    protocols: sanitizeProtocols(obj.protocols),
    ingestedSources: Array.isArray(obj.ingestedSources) ? obj.ingestedSources.filter((s: unknown) => s && typeof s === 'object' && 'id' in (s as object) && 'rawText' in (s as object)) as IngestedSource[] : [],
    feeds: sanitizeFeeds(obj.feeds),
    obsidianNotes: sanitizeObsidianNotes(obj.obsidianNotes),
    missions: sanitizeMissions(obj.missions),
    routines: sanitizeRoutines(obj.routines),
    emotionalEvents: sanitizeEmotionalEvents(obj.emotionalEvents),
    emotionalChecks: sanitizeEmotionalChecks(obj.emotionalChecks),
    preferences: sanitizePreferences(obj.preferences),
  };
}

/** Sanitize routines — keep well-formed entries, drop the rest. */
function sanitizeRoutines(raw: unknown): Routine[] {
  if (!Array.isArray(raw)) return [];
  const out: Routine[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.triggerId !== 'string' || !r.triggerId) continue;
    if (typeof r.name !== 'string' || !r.name) continue;
    if (!Array.isArray(r.steps)) continue;
    // Repair steps individually (drop the bad step, keep the routine):
    // one corrupt step must never delete the whole protocol.
    const steps: Routine['steps'] = [];
    const seenStepIds = new Set<string>();
    for (const s of r.steps) {
      if (!s || typeof s !== 'object') continue;
      const st = s as Record<string, unknown>;
      if (typeof st.id !== 'string' || !st.id || seenStepIds.has(st.id)) continue;
      if (typeof st.label !== 'string' || !st.label.trim()) continue;
      seenStepIds.add(st.id);
      steps.push({
        id: st.id,
        label: st.label.trim().slice(0, 120),
        habitId: typeof st.habitId === 'string' && st.habitId ? st.habitId : undefined,
        order: typeof st.order === 'number' && Number.isFinite(st.order) ? st.order : steps.length,
      });
    }
    steps.sort((a, b) => a.order - b.order);
    if (typeof r.createdAt !== 'string') continue;
    // Preserve kind + progress (phase tracking must survive reloads).
    const progress = r.progress && typeof r.progress === 'object' && !Array.isArray(r.progress)
      ? (() => {
          const pr = r.progress as Record<string, unknown>;
          if (!Array.isArray(pr.doneStepIds)) return undefined;
          const ids = (pr.doneStepIds as unknown[]).filter((id): id is string => typeof id === 'string');
          const known = new Set(steps.map((s) => s.id));
          const kept = ids.filter((id) => known.has(id));
          return {
            doneStepIds: kept,
            updatedAt: typeof pr.updatedAt === 'string' ? pr.updatedAt : new Date().toISOString(),
          };
        })()
      : undefined;
    out.push({
      id: r.id,
      triggerId: r.triggerId,
      name: r.name,
      steps,
      createdAt: r.createdAt,
      ...(typeof r.kind === 'string' && r.kind ? { kind: r.kind.slice(0, 40) } : {}),
      ...(progress ? { progress } : {}),
    });
  }
  return out;
}

/** Sanitize emotional events — keep well-formed entries, drop the rest. */
function sanitizeEmotionalEvents(raw: unknown): EmotionalEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: EmotionalEvent[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const e = x as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id) continue;
    if (typeof e.title !== 'string') continue;
    if (typeof e.situation !== 'string') continue;
    if (!Array.isArray(e.emotions) || e.emotions.some((m: unknown) => typeof m !== 'string')) continue;
    if (typeof e.createdAt !== 'string') continue;
    if (e.notes !== undefined && typeof e.notes !== 'string') continue;
    if (e.archived !== undefined && typeof e.archived !== 'boolean') continue;
    const closure = typeof e.closureNote === 'string' ? e.closureNote.trim().slice(0, 500) : '';
    out.push({
      id: e.id,
      title: e.title,
      situation: e.situation,
      emotions: e.emotions as EmotionalEvent['emotions'],
      createdAt: e.createdAt,
      notes: typeof e.notes === 'string' ? e.notes : undefined,
      archived: e.archived === true,
      plans: sanitizeEmotionalPlans(e.plans),
      closureNote: closure ? closure : undefined,
    });
  }
  return out;
}

/** Sanitize emotional action plans — keep well-formed entries, drop the rest. */
function sanitizeEmotionalPlans(raw: unknown): import('./types').EmotionalActionPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: import('./types').EmotionalActionPlan[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const p = x as Record<string, unknown>;
    if (typeof p.id !== 'string' || !p.id) continue;
    if (typeof p.title !== 'string' || !p.title) continue;
    if (!Array.isArray(p.steps)) continue;
    if (typeof p.createdAt !== 'string') continue;
    const steps: import('./types').EmotionalPlanStep[] = [];
    let valid = true;
    for (const s of p.steps) {
      if (!s || typeof s !== 'object') { valid = false; break; }
      const st = s as Record<string, unknown>;
      if (typeof st.id !== 'string' || typeof st.label !== 'string') { valid = false; break; }
      steps.push({ id: st.id, label: st.label, done: st.done === true });
    }
    if (!valid) continue;
    out.push({
      id: p.id,
      title: p.title,
      sourceNote: typeof p.sourceNote === 'string' ? p.sourceNote : undefined,
      steps,
      createdAt: p.createdAt,
      emotions: cleanEmotionTags(p.emotions),
    });
  }
  return out;
}

/** Sanitize emotional checks — keep well-formed entries, drop the rest. */
function sanitizeEmotionalChecks(raw: unknown): EmotionalCheck[] {
  if (!Array.isArray(raw)) return [];
  const out: EmotionalCheck[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const c = x as Record<string, unknown>;
    if (typeof c.id !== 'string' || !c.id) continue;
    if (typeof c.eventId !== 'string' || !c.eventId) continue;
    if (typeof c.date !== 'string' || !isValidDateKey(c.date)) continue;
    if (typeof c.intensity !== 'number' || !Number.isFinite(c.intensity) || c.intensity < 1 || c.intensity > 10) continue;
    if (c.note !== undefined && typeof c.note !== 'string') continue;
    if (c.createdAt !== undefined && typeof c.createdAt !== 'string') continue;
    out.push({
      id: c.id,
      eventId: c.eventId,
      date: c.date,
      intensity: c.intensity,
      note: typeof c.note === 'string' ? c.note : undefined,
      intensities: sanitizeIntensityMap(c.intensities),
      noteEmotions: cleanEmotionTags(c.noteEmotions),
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : undefined,
    });
  }
  return out;
}

/** Sanitize missions (v0.7.0) — keep well-formed entries, drop the rest. */
function sanitizeMissions(raw: unknown): Mission[] {
  if (!Array.isArray(raw)) return [];
  const out: Mission[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const m = x as Record<string, unknown>;
    if (typeof m.id !== 'string' || !m.id) continue;
    if (typeof m.name !== 'string' || !m.name) continue;
    if (!Array.isArray(m.habitIds)) continue;
    if (!m.window || typeof m.window !== 'object') continue;
    const w = m.window as Record<string, unknown>;
    if (w.kind === 'fixed') {
      if (typeof w.startDate !== 'string' || typeof w.endDate !== 'string') continue;
    } else if (w.kind === 'transit') {
      if (typeof w.body !== 'string' || typeof w.signIndex !== 'number' ||
          typeof w.startDate !== 'string' || typeof w.endDate !== 'string') continue;
    } else {
      continue;
    }
    if (typeof m.createdAt !== 'string') continue;
    out.push({
      id: m.id,
      name: m.name,
      objective: typeof m.objective === 'string' ? m.objective : undefined,
      habitIds: (m.habitIds as unknown[]).filter((h): h is string => typeof h === 'string'),
      window: w as unknown as MissionWindow,
      quota: typeof m.quota === 'number' && Number.isFinite(m.quota) ? m.quota : undefined,
      milestoneDate: typeof m.milestoneDate === 'string' ? m.milestoneDate : undefined,
      milestoneLabel: typeof m.milestoneLabel === 'string' ? m.milestoneLabel : undefined,
      createdAt: m.createdAt,
      archived: m.archived === true ? true : undefined,
    });
    if (out.length >= 200) break;
  }
  return out;
}

/** Sanitize imported Obsidian notes (v0.6.5) — keep well-formed, cap size. */
function sanitizeObsidianNotes(raw: unknown): ObsidianNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ObsidianNote[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const n = x as Record<string, unknown>;
    if (typeof n.id !== 'string' || !n.id) continue;
    if (typeof n.fileName !== 'string' || !n.fileName) continue;
    if (typeof n.content !== 'string') continue;
    if (typeof n.importedAt !== 'string') continue;
    out.push({
      id: n.id,
      fileName: n.fileName,
      content: n.content.slice(0, 200_000), // 200 KB per note max
      importedAt: n.importedAt,
    });
    if (out.length >= 500) break; // 500 notes max
  }
  return out;
}

/** Sanitize projects (v0.6.0) — keep well-formed entries, repair the rest. */
function sanitizeProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Project => {
    if (!x || typeof x !== 'object') return false;
    const p = x as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return false;
    if (typeof p.createdAt !== 'string') return false;
    if (typeof p.status !== 'string') return false;
    if (!Array.isArray(p.habitIds)) return false;
    if (!Array.isArray(p.tasks)) return false;
    return true;
  });
}

/** Sanitize a per-day percentage map (date YYYY-MM-DD → 0-100). Values out of
 * range or non-numeric are dropped; dates must be valid calendar keys. */
function sanitizeEnergies(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [date, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < 0 || v > 100) continue;
    if (!isValidDateKey(date)) continue;
    out[date] = Math.round(v);
  }
  return out;
}

/** Sanitize protocols (v0.6.0). */
function sanitizeProtocols(raw: unknown): Protocol[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Protocol => {
    if (!x || typeof x !== 'object') return false;
    const p = x as Record<string, unknown>;
    return typeof p.id === 'string'
      && typeof p.title === 'string'
      && typeof p.claim === 'string'
      && typeof p.source === 'string'
      && typeof p.domain === 'string';
  });
}

/** Sanitize feed configs (v0.6.1). */
function sanitizeFeeds(raw: unknown): FeedConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is FeedConfig => {
      if (!x || typeof x !== 'object') return false;
      const f = x as Record<string, unknown>;
      return typeof f.id === 'string'
        && typeof f.url === 'string'
        && typeof f.title === 'string'
        && typeof f.createdAt === 'string'
        && typeof f.enabled === 'boolean';
    })
    .map((f) => ({
      ...f,
      lastGuids: Array.isArray(f.lastGuids)
        ? f.lastGuids.filter((g: unknown): g is string => typeof g === 'string').slice(-120)
        : [],
    }));
}

/** Sanitize user preferences from stored data. */
function sanitizePreferences(raw: unknown): UserPreferences {
  const defaults: UserPreferences = { darkMode: false, theme: '' };
  if (!raw || typeof raw !== 'object') return defaults;
  const p = raw as Record<string, unknown>;
  const provider = p.aiProvider === 'openrouter' || p.aiProvider === 'deepseek' || p.aiProvider === 'ollama' ? p.aiProvider : 'auto';
  return {
    darkMode: p.darkMode === true,
    theme: typeof p.theme === 'string' ? p.theme : '',
    aiProvider: provider,
    aiModel: typeof p.aiModel === 'string' ? p.aiModel : 'deepseek/deepseek-v4-flash',
    aiApiKey: typeof p.aiApiKey === 'string' ? p.aiApiKey : '',
    knowledgeAutoSuggest: p.knowledgeAutoSuggest === false ? false : true,
    stickyMax: typeof p.stickyMax === 'number' && p.stickyMax >= 1 && p.stickyMax <= 8 ? p.stickyMax : 3,
    ingestAiEnabled: p.ingestAiEnabled === false ? false : true,
    knowledgeAutoAdopt: p.knowledgeAutoAdopt === true, // opt-in: never auto-create habits from feeds by default
    autoIngestEnabled: p.autoIngestEnabled === false ? false : true,
    autoIngestIntervalHours: typeof p.autoIngestIntervalHours === 'number' && p.autoIngestIntervalHours >= 1 && p.autoIngestIntervalHours <= 72 ? p.autoIngestIntervalHours : 6,
    autostartEnabled: p.autostartEnabled === false ? false : true,
    missionAutoEnabled: p.missionAutoEnabled === false ? false : true,
    obsidianVaultPath: typeof p.obsidianVaultPath === 'string' ? p.obsidianVaultPath : '',
    obsidianAutoSync: p.obsidianAutoSync === true,
    obsidianExcludeFolders: typeof p.obsidianExcludeFolders === 'string' ? p.obsidianExcludeFolders : '',
    obsidianMirrorDeletions: p.obsidianMirrorDeletions === true,
    compactGrid: p.compactGrid === true,
    autoCompact: p.autoCompact === false ? false : true,
    compactThreshold: typeof p.compactThreshold === 'number' && p.compactThreshold >= 10 && p.compactThreshold <= 100 ? p.compactThreshold : 30,
    compactLevel: p.compactLevel === 1 || p.compactLevel === 2 ? p.compactLevel : 0,
    emotionalBackfillDone: p.emotionalBackfillDone === true,
    emotionalCheckReminder: p.emotionalCheckReminder === false ? false : true,
    lastEmotionalReminderDate: typeof p.lastEmotionalReminderDate === 'string' ? p.lastEmotionalReminderDate : '',
    // Preserve the rest of the type — dropping them on every load silently
    // reset user settings (e.g. a custom depression threshold back to 70).
    soundEnabled: p.soundEnabled !== false,
    memoryReminderEnabled: p.memoryReminderEnabled === true,
    memoryReminderTime: typeof p.memoryReminderTime === 'string' ? p.memoryReminderTime : '20:00',
    lastMemoryReminderDate: typeof p.lastMemoryReminderDate === 'string' ? p.lastMemoryReminderDate : '',
    birthDate: typeof p.birthDate === 'string' ? p.birthDate : undefined,
    birthTime: typeof p.birthTime === 'string' ? p.birthTime : undefined,
    birthLat: typeof p.birthLat === 'number' && Number.isFinite(p.birthLat) ? p.birthLat : undefined,
    birthLon: typeof p.birthLon === 'number' && Number.isFinite(p.birthLon) ? p.birthLon : undefined,
    depressionAlertThreshold: typeof p.depressionAlertThreshold === 'number' && Number.isFinite(p.depressionAlertThreshold)
      ? Math.max(0, Math.min(100, p.depressionAlertThreshold)) : 70,
    outingGuardSeeded: p.outingGuardSeeded === true,
    depressionProtocolSeeded: p.depressionProtocolSeeded === true,
    wellbeingNewSeen: p.wellbeingNewSeen === true,
  };
}

// --- Projects (v0.6.0) CRUD ---
export function getProjects(): Project[] {
  return [...(data.projects ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addProject(input: { name: string; emoji?: string; description?: string; deadline?: string; habitIds?: string[] }): Project {
  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    emoji: input.emoji,
    description: input.description,
    deadline: input.deadline,
    status: 'active',
    habitIds: input.habitIds ?? [],
    tasks: [],
    createdAt: new Date().toISOString(),
  };
  data.projects = [...(data.projects ?? []), project];
  notify();
  return project;
}

export function updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): void {
  const p = (data.projects ?? []).find((x) => x.id === id);
  if (!p) return;
  Object.assign(p, updates);
  notify();
}

export function deleteProject(id: string): void {
  data.projects = (data.projects ?? []).filter((x) => x.id !== id);
  // Detach orphaned check-in links.
  for (const ci of data.checkIns) {
    if (ci.projectId === id) { delete ci.projectId; delete ci.taskId; }
  }
  notify();
}

export function addProjectTask(projectId: string, title: string): Task | null {
  const idx = (data.projects ?? []).findIndex((x) => x.id === projectId);
  if (idx < 0) return null;
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  const projects = [...(data.projects ?? [])];
  projects[idx] = { ...projects[idx], tasks: [...(projects[idx].tasks ?? []), task] };
  data.projects = projects;
  notify();
  return task;
}

export function toggleProjectTask(projectId: string, taskId: string, done: boolean): void {
  const p = (data.projects ?? []).find((x) => x.id === projectId);
  if (!p) return;
  p.tasks = (p.tasks ?? []).map((t) => (t.id === taskId ? { ...t, done, completedAt: done ? new Date().toISOString() : undefined } : t));
  notify();
}

export function linkHabitToProject(projectId: string, habitId: string): void {
  const p = (data.projects ?? []).find((x) => x.id === projectId);
  if (!p || (p.habitIds ?? []).includes(habitId)) return;
  p.habitIds = [...(p.habitIds ?? []), habitId];
  notify();
}

export function unlinkHabitFromProject(projectId: string, habitId: string): void {
  const p = (data.projects ?? []).find((x) => x.id === projectId);
  if (!p) return;
  p.habitIds = (p.habitIds ?? []).filter((h) => h !== habitId);
  notify();
}

/** Attach a project/task to an existing check-in (evidence of a deliverable). */
export function setCheckInProject(habitId: string, date: string, projectId?: string, taskId?: string): void {
  const ci = getCheckIn(habitId, date);
  if (ci) {
    if (projectId === undefined) { delete ci.projectId; delete ci.taskId; }
    else {
      ci.projectId = projectId;
      if (taskId) ci.taskId = taskId; else delete ci.taskId;
    }
    notify();
  }
}

// --- Protocols & ingestion (v0.6.0) ---
export function getProtocols(): Protocol[] {
  return data.protocols ?? [];
}

export function setProtocols(protocols: Protocol[]): void {
  data.protocols = protocols;
  notify();
}

export function addIngestedSource(title: string, rawText: string): IngestedSource {
  const src: IngestedSource = {
    id: crypto.randomUUID(),
    title,
    rawText,
    createdAt: new Date().toISOString(),
    ingested: false,
  };
  data.ingestedSources = [...(data.ingestedSources ?? []), src];
  notify();
  return src;
}

export function getIngestedSources(): IngestedSource[] {
  return [...(data.ingestedSources ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Marks an ingested source as processed. */
export function markIngestedSource(id: string): void {
  const s = (data.ingestedSources ?? []).find((x) => x.id === id);
  if (s) { s.ingested = true; notify(); }
}

// --- Recommendation dismissal (v0.6.1) ---
/** Recommendation keys the user set aside (persisted, survives restarts). */
export function getDismissedRecs(): string[] {
  return data.dismissedRecs ?? [];
}

export function dismissRec(key: string): void {
  const arr = data.dismissedRecs ?? [];
  if (!arr.includes(key)) {
    data.dismissedRecs = [...arr, key];
    notify();
  }
}

export function resetDismissedRecs(): void {
  if ((data.dismissedRecs ?? []).length > 0) {
    data.dismissedRecs = [];
    notify();
  }
}

export function deleteIngestedSource(id: string): void {
  data.ingestedSources = (data.ingestedSources ?? []).filter((x) => x.id !== id);
  notify();
}

// --- Permanent automated feeds (v0.6.1) ---
export function getFeeds(): FeedConfig[] {
  return data.feeds ?? [];
}

export function addFeed(url: string, title?: string): FeedConfig {
  const feed: FeedConfig = {
    id: crypto.randomUUID(),
    url: url.trim(),
    title: title?.trim() || url.trim(),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastGuids: [],
  };
  data.feeds = [...(data.feeds ?? []), feed];
  notify();
  return feed;
}

export function updateFeed(id: string, updates: Partial<Omit<FeedConfig, 'id' | 'createdAt'>>): void {
  const f = (data.feeds ?? []).find((x) => x.id === id);
  if (!f) return;
  Object.assign(f, updates);
  notify();
}

export function deleteFeed(id: string): void {
  data.feeds = (data.feeds ?? []).filter((x) => x.id !== id);
  notify();
}

/** Persist the new feed state after a cycle (guids + lastFetchAt). */
export function saveFeeds(feeds: FeedConfig[]): void {
  data.feeds = feeds;
  notify();
}

/**
 * Apply one full auto-ingest cycle in a single save: feeds (updated dedupe
 * state), merged protocol library, and the newly recorded source entries.
 */
export function applyFeedIngest(outcome: FeedCycleOutcome): void {
  data.feeds = outcome.feeds;
  data.protocols = outcome.protocols;
  data.ingestedSources = [...(data.ingestedSources ?? []), ...outcome.sources];
  notify();
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

  // Remap + clear orphaned stack links. A habit whose `stackParent` points to
  // a habit that no longer exists (deleted, never imported, or dedupe-merged
  // away) would silently vanish from the Stacks view because roots are only
  // existing habits with children. Remap to the merged primary, else unlink.
  let stackCleared = 0;
  let stackRemapped = 0;
  for (const habit of survivors) {
    if (!habit.stackParent) continue;
    const remapped = idRemap.get(habit.stackParent);
    if (remapped) {
      habit.stackParent = remapped;
      stackRemapped++;
    } else if (!survivors.find((h) => h.id === habit.stackParent)) {
      delete habit.stackParent;
      delete habit.stackWhen;
      stackCleared++;
    }
  }
  result.removed += stackCleared; // count as cleaned

  if (result.removed > 0 || result.orphanCheckIns > 0 || result.orphanNotes > 0 || stackCleared > 0 || stackRemapped > 0) {
    console.info(
      `[LifeTrack] Dedupe: removed ${result.removed} duplicate habits, remapped ${result.remappedCheckIns} check-ins, ${result.remappedNotes} notes. Orphaned: ${result.orphanCheckIns} check-ins, ${result.orphanNotes} notes. Stack links: cleared ${stackCleared}, remapped ${stackRemapped}.`
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
    attachBulkData(primary);
    scheduleFileBackup(primary); // ensure disk backup exists at startup
    return primary;
  }
  const backup = readEnvelope(BACKUP_KEY);
  if (backup) {
    console.warn('Primary storage corrupted or missing — recovered from backup');
    deduplicateDataInPlace(backup);
    attachBulkData(backup);
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
          attachBulkData(recovered);
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
  if (migrated) {
    attachBulkData(migrated);
    return migrated;
  }
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

/**
 * Append a line to the recovery audit trail at <appData>/recovery-debug.log.
 * Best-effort: keeps a growing in-memory buffer and overwrites the file with
 * the full history on each call (no read-modify-write race between the
 * parallel recovery attempts).
 */
let recoveryLogBuffer = '';
async function recoveryDebugLog(line: string): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const [{ appDataDir }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const dir = await appDataDir();
    const ts = new Date().toISOString();
    const last = recoveryLogBuffer.split('\n').filter((l) => l.trim()).slice(-200);
    last.push(`${ts} ${line}`);
    recoveryLogBuffer = last.join('\n') + '\n';
    await writeTextFile(`${dir}/recovery-debug.log`, recoveryLogBuffer);
  } catch { /* best-effort */ }
}

/**
 * Filesystem recovery: after a rebuild or reinstall the app may start with
 * empty localStorage even though full JSON copies of the user's data exist on
 * disk. Two writers produce files:
 *   - Rust backend:  Documents/LifeTrack-Backups/lifetrack-backup-*.json
 *   - TS frontend:   %APPDATA%/LifeTrack-Backups | Desktop/LifeTrack-Backups | Documents/LifeTrack-Backups/lifetrack-persistent.json
 * This scans all of those locations and restores the MOST COMPLETE copy
 * (highest habit+check-in count), sanitizing it and re-saving as primary.
 * Returns true if data was recovered. No-op in the browser or when none exists.
 */
/**
 * Boot storage diagnostics, persisted to recovery-debug.log (the only
 * durable channel — console output is lost). Answers definitively whether
 * localStorage writes are failing (quota) and what each layer holds.
 */
async function logStorageDiagnostics(): Promise<void> {
  try {
    const kb = (n: number): string => `${Math.round(n / 1024)}kb`;
    const sizes: Record<string, number> = {};
    let upgradeKeys = 0;
    let totalKeys = 0;
    let totalBytes = 0;
    const biggest: { k: string; n: number }[] = [];
    try {
      totalKeys = localStorage.length;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        let n = 0;
        try { n = (localStorage.getItem(k) ?? '').length; } catch { /* ignore */ }
        totalBytes += n;
        if (k.startsWith(UPGRADE_BACKUP_PREFIX)) upgradeKeys++;
        if (k === STORAGE_KEY || k === BACKUP_KEY || k === RAW_JSON_KEY) {
          sizes[k] = n;
        }
        biggest.push({ k: k.slice(0, 48), n });
      }
    } catch { /* unreadable storage */ }
    biggest.sort((a, b) => b.n - a.n);
    const topKeys = biggest.slice(0, 8).map((x) => `${x.k}=${Math.round(x.n / 1024)}kb`).join(' ');
    // Graduated quota probe: 1MB then 5MB. Removed immediately after.
    let probe = 'unavailable';
    try {
      const blob = 'x'.repeat(1024 * 1024);
      localStorage.setItem('__lifetrack_quota_probe__', blob);
      probe = '1mb-ok';
      localStorage.removeItem('__lifetrack_quota_probe__');
      const blob5 = 'x'.repeat(5 * 1024 * 1024);
      localStorage.setItem('__lifetrack_quota_probe__', blob5);
      probe = '5mb-ok';
      localStorage.removeItem('__lifetrack_quota_probe__');
    } catch {
      probe = probe === 'unavailable' ? 'unavailable' : 'QUOTA_FAIL';
      try { localStorage.removeItem('__lifetrack_quota_probe__'); } catch { /* ignore */ }
    }
    const memEv = (data.emotionalEvents ?? []).length;
    const memCh = (data.emotionalChecks ?? []).length;
    let memBytes = 0;
    try { memBytes = JSON.stringify(data).length; } catch { /* ignore */ }
    // Parsed envelope census: what did localStorage ACTUALLY persist?
    let envCensus = 'env=unreadable';
    try {
      const rawEnv = localStorage.getItem(STORAGE_KEY);
      if (rawEnv) {
        const parsed = JSON.parse(rawEnv);
        const d = parsed && typeof parsed === 'object' && 'd' in parsed
          ? (parsed as Record<string, unknown>).d as Record<string, unknown>
          : (parsed as Record<string, unknown>);
        const len = (k: string): number => (Array.isArray(d[k]) ? (d[k] as unknown[]).length : -1);
        const bytes = (k: string): string => {
          try { return kb(JSON.stringify(d[k] ?? null).length); } catch { return '?'; }
        };
        envCensus =
          `envHabits=${len('habits')} envCheckins=${len('checkIns')} envEvents=${len('emotionalEvents')} ` +
          `envEmoChecks=${len('emotionalChecks')} envProtocols=${bytes('protocols')} envSources=${bytes('ingestedSources')}`;
      } else {
        envCensus = 'env=missing';
      }
    } catch { /* ignore */ }
    const err = lastStorageError ? `lastErr=${lastStorageError.message.slice(0, 60)}` : 'lastErr=none';
    await recoveryDebugLog(
      `storage: primary=${kb(sizes[STORAGE_KEY] ?? 0)} backup=${kb(sizes[BACKUP_KEY] ?? 0)} ` +
      `raw=${kb(sizes[RAW_JSON_KEY] ?? 0)} upgrades=${upgradeKeys} quotaProbe=${probe} ` +
      `totalKeys=${totalKeys} totalBytes=${kb(totalBytes)} top=[${topKeys}] ` +
      `memBytes=${kb(memBytes)} memEvents=${memEv} memChecks=${memCh} ${envCensus} ${err}`,
    );
  } catch { /* diagnostics must never break boot */ }
}

export async function attemptFileRecovery(): Promise<boolean> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
  await recoveryDebugLog('attemptFileRecovery: start');
  await logStorageDiagnostics();
  try {
    const [{ appDataDir, documentDir, desktopDir, join }, { readTextFile, exists, readDir }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);

    // Directories where a backup could live. `join` inserts the OS separator —
    // appDataDir()/documentDir()/desktopDir() do NOT end with a slash on Windows.
    const dirs: { dir: string; prefix: string }[] = [];
    const one = async (p: string | undefined, sub: string, prefix: string) => {
      if (p) dirs.push({ dir: await join(p, sub), prefix });
    };
    await one(await documentDir().catch(() => undefined), 'LifeTrack-Backups', 'lifetrack-backup-');
    await one(await desktopDir().catch(() => undefined), 'LifeTrack-Backups', 'lifetrack-backup-');
    // NOTE: %APPDATA%/LifeTrack-Backups was removed: nothing ever writes
    // timestamped backups there (Rust → %APPDATA%/backups, TS → persistent
    // files), it only produced a "dir missing" log line every boot.
    await one(await appDataDir().catch(() => undefined), 'backups', 'lifetrack-backup-');
    await one(await appDataDir().catch(() => undefined), 'LifeTrack', 'lifetrack-persistent.');
    await one(await documentDir().catch(() => undefined), 'LifeTrack-Backups', 'lifetrack-persistent.');
    await one(await desktopDir().catch(() => undefined), 'LifeTrack-Backups', 'lifetrack-persistent.');

    let best: AppData = null as unknown as AppData;
    let bestWeight = -1;
    // Richest backup in emotional data (for one-time backfill repair).
    let bestEmotional: AppData = null as unknown as AppData;
    let bestEmotionalCount = 0;
    // Every per-zone `cause` ever seen, keyed by normalizedHabit::dimension.
    // Past import-restores stripped causes (Gym/selfesteem incident) — the
    // gap-fill below resurrects them from any scanned backup that still has
    // them. First cause seen wins (they are user-written and stable).
    const causesByHabitDim = new Map<string, string>();

    const consider = (data: unknown): void => {
      try {
        const sanitized = sanitizeData(data);
        for (const h of sanitized.habits) {
          const key = normalizeHabitName(h.name);
          for (const l of h.chaosLinks ?? []) {
            if (!l.cause) continue;
            const k = `${key}::${l.dimension}`;
            if (!causesByHabitDim.has(k)) causesByHabitDim.set(k, l.cause);
          }
        }
        // Weight = amount of real user data; biases toward richer backups.
        const weight = sanitized.habits.length * 10 + sanitized.checkIns.length
          + sanitized.notes.length + sanitized.urges.length + sanitized.personas.length
          + sanitized.levers.length + sanitized.journalEntries.length + sanitized.challenges.length
          + (sanitized.emotionalEvents ?? []).length * 5 + (sanitized.emotionalChecks ?? []).length
          + (sanitized.routines ?? []).length * 2;
        if (weight > bestWeight) { best = sanitized; bestWeight = weight; }
        const emoCount = (sanitized.emotionalEvents ?? []).length + (sanitized.emotionalChecks ?? []).length;
        if (emoCount > bestEmotionalCount) { bestEmotional = sanitized; bestEmotionalCount = emoCount; }
      } catch { /* skip unparseable */ }
    };

    for (const { dir, prefix } of dirs) {
      // Direct file (persistent JSON).
      try {
        const directPath = `${dir}/${prefix === 'lifetrack-backup-' ? FILE_BACKUP_NAME : prefix}json`;
        const directExists = await exists(directPath).catch((e: unknown) => { recoveryDebugLog(`direct exists err ${String(e).slice(0, 80)}`); return false; });
        if (directExists) {
          const raw = await readTextFile(directPath);
          consider(JSON.parse(raw));
        }
      } catch { /* best-effort */ }

      // Scan directory for matching files (Rust timestamps lifetrack-backup-*).
      if (prefix.startsWith('lifetrack-backup-')) {
        const dirExists = await exists(dir).catch((e: unknown) => { recoveryDebugLog(`dir exists err ${String(e).slice(0, 80)}`); return false; });
        if (!dirExists) {
          await recoveryDebugLog(`dir missing: ${dir}`);
          continue;
        }
        try {
          const entries = await readDir(dir);
          let parsed = 0;
          for (const entry of entries) {
            if (!entry.name || !entry.name.startsWith('lifetrack-backup-') || !entry.name.endsWith('.json')) continue;
            try {
              const raw = await readTextFile(`${dir}/${entry.name}`);
              consider(JSON.parse(raw));
              parsed++;
            } catch { /* skip corrupt file */ }
          }
          await recoveryDebugLog(`scanned ${dir} (${entries.length} entries, ${parsed} parsed)`);
        } catch (e) {
          await recoveryDebugLog(`scan failed for ${dir}: ${String(e).slice(0, 160)}`);
        }
      }
    }

    if (!best || bestWeight <= 0) {
      console.warn('[LifeTrack] No usable filesystem backup found for recovery.');
      await recoveryDebugLog('attemptFileRecovery: no usable backup found');
      return false;
    }

    const current = readEnvelope(STORAGE_KEY);
    const sizeOf = (d: AppData): number => d.habits.length + d.checkIns.length
      + (d.emotionalEvents ?? []).length + (d.emotionalChecks ?? []).length + (d.routines ?? []).length;
    const currentSize = current ? sizeOf(current) : 0;
    const bestSize = sizeOf(best);
    await recoveryDebugLog(`attemptFileRecovery: best=${bestSize} (weight ${bestWeight}), current=${currentSize}`);
    // Gap-fill missing chaos `cause` notes on the LIVE store from any scanned
    // backup (repairs past import-restore stripping). Only fills blanks —
    // never overwrites — and saves only when something actually healed.
    // Placed FIRST (before the emotional backfill's early return) so it runs
    // on every boot with a usable current store, restore or not.
    try {
      let healedCauses = 0;
      for (const h of data.habits) {
        if (h.archived || !h.chaosLinks) continue;
        const key = normalizeHabitName(h.name);
        for (const l of h.chaosLinks) {
          if (l.cause) continue;
          const rescued = causesByHabitDim.get(`${key}::${l.dimension}`);
          if (rescued) {
            l.cause = rescued;
            healedCauses++;
          }
        }
      }
      if (healedCauses > 0) {
        const healed = exportAllData();
        writeEnvelope(STORAGE_KEY, healed);
        writeEnvelope(BACKUP_KEY, healed);
        try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(healed)); } catch { /* best-effort */ }
        scheduleFileBackup(healed);
        notify();
        await recoveryDebugLog(`attemptFileRecovery: HEALED ${healedCauses} chaos cause(s) from scanned backups`);
      }
    } catch { /* best-effort: a failed heal must never block boot */ }
    // One-time repair: if the live state has no emotional data at all but a
    // scanned backup does (e.g. after the v0.6.2 sanitize-drop incident),
    // Continuous repair: union any emotional entries present in file backups
    // but missing locally (by id). Idempotent and cheap — runs every boot.
    // The old zero-gate (only when current had NO events) left partial
    // divergence to rot; the flag is still set for backward compatibility.
    // Merges into the LIVE `data` (never `data = current`): replacing the
    // live store would discard fresher in-memory state, including repairs
    // applied earlier in this same boot (e.g. healed chaos causes).
    if (bestEmotionalCount > 0 && (bestEmotional.emotionalEvents ?? []).length + (bestEmotional.emotionalChecks ?? []).length > 0) {
      const knownEventIds = new Set((data.emotionalEvents ?? []).map((e) => e.id));
      const knownCheckIds = new Set((data.emotionalChecks ?? []).map((c) => c.id));
      const missingEvents = (bestEmotional.emotionalEvents ?? []).filter((e) => !knownEventIds.has(e.id));
      const missingChecks = (bestEmotional.emotionalChecks ?? []).filter((c) => !knownCheckIds.has(c.id));
      if (missingEvents.length > 0 || missingChecks.length > 0) {
        data.emotionalEvents = [...(data.emotionalEvents ?? []), ...missingEvents];
        data.emotionalChecks = [...(data.emotionalChecks ?? []), ...missingChecks];
        data.preferences = { ...getPreferences(), emotionalBackfillDone: true };
        const snap = exportAllData();
        writeEnvelope(STORAGE_KEY, snap);
        writeEnvelope(BACKUP_KEY, snap);
        try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(snap)); } catch { /* best-effort */ }
        backfillHabitRecords();
        scheduleFileBackup(snap);
        notify();
        await recoveryDebugLog(`attemptFileRecovery: BACKFILLED ${missingEvents.length} emotional events, ${missingChecks.length} checks`);
        return true;
      }
    }
    if (currentSize >= bestSize) return false; // current data is at least as complete

    console.info(`[LifeTrack] Filesystem recovery: restoring ${best.habits.length} habits, ${best.checkIns.length} check-ins, ${best.notes.length} notes.`);
    deduplicateDataInPlace(best);
    quarantineJunkInto(best);
    writeEnvelope(STORAGE_KEY, best);
    writeEnvelope(BACKUP_KEY, best);
    try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(best)); } catch { /* best-effort */ }
    data = best;
    backfillHabitRecords();
    scheduleFileBackup(best);
    notify();
    await recoveryDebugLog('attemptFileRecovery: RESTORED ' + best.habits.length + ' habits');
    return true;
  } catch (e) {
    await recoveryDebugLog(`attemptFileRecovery: ERROR ${String(e).slice(0, 300)}`);
    return false;
  }
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
    energies: {},
    concentrations: {},
    experiments: [],
    urges: [],
    customUrgeTypes: [],
    journalEntries: [],
    journalThreads: [],
    challenges: [],
    personas: [],
    levers: [],
    patternTracks: [],
    reflections: [],
    psychoHistory: [],
    routines: [],
    emotionalEvents: [],
    emotionalChecks: [],
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
    const restored = sanitizeData(envelope.d);
    // Rollback restores CORE; the knowledge library (bulk) stays at latest —
    // reattach it so a core rollback never wipes reference data as a side effect.
    attachBulkData(restored);
    writeEnvelope(STORAGE_KEY, restored);
    writeEnvelope(BACKUP_KEY, restored);
    data = restored;
    backfillHabitRecords();
    notify();
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
    // Core-only: the ~1.5MB knowledge-library bulk lives in BULK_KEY + files.
    // Writing it inside every envelope choked the ~5MB localStorage quota
    // until ALL writes failed silently and recent user data stopped persisting.
    const { core } = stripBulk(data);
    const json = JSON.stringify(core);
    const envelope: StorageEnvelope = {
      v: 1,
      d: core,
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
    const [{ appDataDir, documentDir, desktopDir, homeDir, join }, { writeTextFile, exists, mkdir }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const json = JSON.stringify(d, null, 2);

    const writeBackup = async (dir: string, subdir: string) => {
      const fullDir = await join(dir, subdir);
      const dirExists = await exists(fullDir).catch(() => false);
      if (!dirExists) await mkdir(fullDir, { recursive: true });
      await writeTextFile(await join(fullDir, FILE_BACKUP_NAME), json);
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
let lastRawJsonAt = 0; // throttle the heavy full-JSON emergency copy
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
    // Self-healing quarantine: whatever path mutated data (restore, import,
    // legacy migration), junk entries never survive a save.
    if (quarantineJunkInto(d) > 0) console.info('[LifeTrack] quarantined feed-junk habit(s) during save');
    const primaryOk = writeEnvelope(STORAGE_KEY, d);
    if (primaryOk) {
      const backupOk = writeEnvelope(BACKUP_KEY, d);
      if (!backupOk) {
        // Backup failed — surface the warning (was previously silent).
        console.warn('Backup write failed; primary is persisted but backup may be stale.');
      }
      // Bulk library rides separately (best-effort): core must never wait on it.
      writeBulkData(stripBulk(d).bulk);
      lastSavedAt = Date.now();
      // Emergency raw JSON backup — bypasses envelope entirely.
      // Throttled to 5s: it's a full JSON.stringify of the whole dataset and
      // was firing on EVERY keystroke-adjacent mutation.
      try {
        const nowMs = Date.now();
        if (nowMs - lastRawJsonAt > 5000) { lastRawJsonAt = nowMs; localStorage.setItem(RAW_JSON_KEY, JSON.stringify(d)); }
      } catch { /* best-effort */ }
      // Also schedule a file backup (best-effort, non-blocking).
      scheduleFileBackup(d);
    } else {
      // Primary failed — try backup as last resort
      const backupOk = writeEnvelope(BACKUP_KEY, d);
      if (backupOk) {
        lastSavedAt = Date.now();
        try { localStorage.setItem(RAW_JSON_KEY, JSON.stringify(d)); } catch { /* best-effort */ }
      } else {
        // Both failed — most likely quota: drop the heavy emergency copies
        // (raw JSON + old upgrade snapshots) and retry once before giving up.
        // Purging secondary copies to save PRIMARY data is the right trade.
        try { localStorage.removeItem(RAW_JSON_KEY); } catch { /* ignore */ }
        try { pruneOldBackups(2); } catch { /* ignore */ }
        if (writeEnvelope(STORAGE_KEY, d)) {
          lastSavedAt = Date.now();
          writeEnvelope(BACKUP_KEY, d);
          scheduleFileBackup(d);
          lastStorageError = null;
          console.info('[LifeTrack] Storage recovered after emergency purge.');
        } else {
          noteStorageError('Sauvegarde locale impossible (stockage plein ?). Tes coches sont en mémoire : exporte un JSON maintenant, rien ne sera perdu au prochain démarrage.');
          console.error('Critical: both primary and backup storage failed. Data may be lost on reload.');
          // The file layer may still work — keep feeding it, and re-render
          // so the UI can shout (silent loss is the worst outcome).
          scheduleFileBackup(d);
          notify();
        }
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

// Force an immediate full save now (used by the storage-error "Réessayer"
// button). Unlike flushSave (which only flushes a pending write), this
// always writes the live store — then surfaces success or a fresh error.
export function forceSaveNow(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = false;
  doSave(data);
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
  previousSubIds?: string[]; // sub-coches done before the toggle
  previousPartial?: boolean; // doux flag before the toggle
}
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const MAX_UNDO = 50;

function snapshotSubs(c: CheckIn | undefined): Pick<UndoEntry, 'previousSubIds' | 'previousPartial'> {
  return {
    previousSubIds: c?.subIds ? [...c.subIds] : undefined,
    previousPartial: c?.partial,
  };
}

export function pushUndo(habitId: string, date: string, previousState: boolean, previousCount?: number): void {
  const existing = getCheckIn(habitId, date);
  undoStack.push({ habitId, date, previousState, previousCount, ...snapshotSubs(existing) });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

function applyUndoEntry(entry: UndoEntry): void {
  const existing = getCheckIn(entry.habitId, entry.date);
  if (existing) {
    existing.completed = entry.previousState;
    existing.count = entry.previousCount ?? (entry.previousState ? 1 : 0);
    existing.subIds = entry.previousSubIds ? [...entry.previousSubIds] : undefined;
    existing.partial = entry.previousPartial;
  } else if (entry.previousState) {
    data.checkIns.push({
      habitId: entry.habitId, date: entry.date, completed: true,
      count: entry.previousCount ?? 1,
      ...(entry.previousSubIds ? { subIds: [...entry.previousSubIds] } : {}),
      ...(entry.previousPartial ? { partial: true } : {}),
    });
  }
}

function currentEntry(habitId: string, date: string, previousState: boolean, previousCount?: number): UndoEntry {
  const existing = getCheckIn(habitId, date);
  return {
    habitId, date, previousState,
    previousCount: previousCount ?? (existing ? (existing.count ?? (existing.completed ? 1 : 0)) : 0),
    ...snapshotSubs(existing),
  };
}

export function undoLastToggle(): UndoEntry | null {
  const entry = undoStack.pop();
  if (!entry) return null;
  const existing = getCheckIn(entry.habitId, entry.date);
  const currentCompleted = existing ? existing.completed : false;
  const currentCount = existing ? (existing.count ?? (existing.completed ? 1 : 0)) : 0;

  redoStack.push(currentEntry(entry.habitId, entry.date, currentCompleted, currentCount));

  // Guard: if the habit was deleted in the meantime, the undo is a no-op.
  if (!data.habits.some((h) => h.id === entry.habitId)) {
    notify();
    return entry;
  }
  // Reverse the toggle (completed + count + sub-coches together)
  applyUndoEntry(entry);
  notify();
  return entry;
}

export function redoLastUndo(): UndoEntry | null {
  const entry = redoStack.pop();
  if (!entry) return null;
  const existing = getCheckIn(entry.habitId, entry.date);
  const currentCompleted = existing ? existing.completed : false;
  const currentCount = existing ? (existing.count ?? (existing.completed ? 1 : 0)) : 0;

  undoStack.push(currentEntry(entry.habitId, entry.date, currentCompleted, currentCount));

  if (!data.habits.some((h) => h.id === entry.habitId)) {
    notify();
    return entry;
  }
  applyUndoEntry(entry);
  notify();
  return entry;
}

// --- Storage health ---
// --- Storage failure surfacing ---
// A failed save used to be a console line nobody reads — while the user kept
// checking habits into memory that would never persist (Emotional checks,
// Sept 8 incident: on disk via the file layer, gone from localStorage).
// The last failure is now queryable so the UI can shout before data is lost.
let lastStorageError: { at: number; message: string } | null = null;
export function getLastStorageError(): { at: number; message: string } | null {
  return lastStorageError;
}
export function clearStorageError(): void {
  lastStorageError = null;
}
function noteStorageError(message: string): void {
  lastStorageError = { at: Date.now(), message };
}

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

// Seed the knowledge library on first load so the preference engine always has
// curated, evidence-graded protocols to recommend (idempotent, local-only).
if (Array.isArray(data.protocols) && data.protocols.length === 0) {
  data.protocols = mergeProtocols([], SEED_PROTOCOLS);
}

// Seed the permanent auto-ingest feeds on first load (idempotent).
// Covers BOTH fresh installs (feeds undefined) and legacy data where the key
// exists as an empty array — otherwise auto-ingestion silently never runs and
// feels "manual".
if (!Array.isArray(data.feeds) || data.feeds.length === 0) {
  data.feeds = DEFAULT_FEEDS.map((f) => ({ ...f, lastGuids: [] }));
}

// One-time quarantine: habits auto-created from raw feed items (arXiv announce
// blocks, DOIs, paper titles) are archived, not deleted — non-destructive.
// Idempotent: already-archived entries are left alone. Runs on module load AND
// after every restore path (backup/file recovery), which otherwise would
// resurrect un-quarantined copies.
function quarantineJunkInto(d: AppData): number {
  let n = 0;
  for (const h of d.habits ?? []) {
    if (!h.archived && isJunkyHabitName(h.name)) {
      h.archived = true;
      h.category = 'auto-cleanup';
      n++;
    }
  }
  return n;
}
quarantineJunkInto(data);

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
  quarantineJunkInto(backup);
  attachBulkData(backup);
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
  chaosOpts?: { chaosLinks?: ChaosLink[]; chaosDimension?: string; chaosImpact?: number; chaosThresholdDays?: number; chaosPerWeek?: number },
): Habit {
  const maxOrder = data.habits.reduce((max, h) => Math.max(max, h.order), -1);
  const links = chaosOpts?.chaosLinks?.filter((l) => l.dimension && l.impact > 0) ?? [];
  const habit: Habit = {
    id: crypto.randomUUID(),
    name,
    color: '',
    goal: 0,
    createdAt: new Date().toISOString(),
    archived: false,
    order: maxOrder + 1,
    multiClick: false, // v0.3.2: OFF by default, user opts IN per habit
    ...(links.length > 0
      ? { chaosLinks: links }
      : chaosOpts?.chaosDimension
        ? { chaosDimension: chaosOpts.chaosDimension, ...(chaosOpts.chaosImpact !== undefined ? { chaosImpact: chaosOpts.chaosImpact } : {}) }
        : {}),
    ...(chaosOpts?.chaosThresholdDays !== undefined ? { chaosThresholdDays: chaosOpts.chaosThresholdDays } : {}),
    ...(chaosOpts?.chaosPerWeek !== undefined ? { chaosPerWeek: Math.max(1, Math.min(7, Math.round(chaosOpts.chaosPerWeek))) } : {}),
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
    if ('chaosPerWeek' in cleaned) {
      const v = cleaned.chaosPerWeek;
      cleaned.chaosPerWeek = (typeof v === 'number' && Number.isFinite(v))
        ? Math.max(1, Math.min(7, Math.round(v)))
        : undefined;
    }
    // If dimension is empty string or null, treat as unlinked
    if ('chaosDimension' in cleaned && (cleaned.chaosDimension === '' || cleaned.chaosDimension === null)) {
      cleaned.chaosDimension = undefined;
      cleaned.chaosImpact = undefined;
      cleaned.chaosThresholdDays = undefined;
    }
    if ('chaosLinks' in cleaned) {
      if (Array.isArray(cleaned.chaosLinks)) {
        cleaned.chaosLinks = cleaned.chaosLinks
          .filter((l) => l && typeof l.dimension === 'string' && l.dimension.length > 0)
          .map((l) => ({
            dimension: l.dimension,
            impact: typeof l.impact === 'number' && Number.isFinite(l.impact)
              ? Math.max(0, Math.min(100, Math.round(l.impact)))
              : 0,
            cause: typeof l.cause === 'string' && l.cause.trim().length > 0 ? l.cause.trim() : undefined,
          }))
          .filter((l) => l.impact > 0);
        if (cleaned.chaosLinks.length === 0) cleaned.chaosLinks = undefined;
      } else {
        delete cleaned.chaosLinks;
      }
      // Multi-zone list is canonical: drop the legacy single fields to avoid drift.
      if (cleaned.chaosLinks) {
        delete cleaned.chaosDimension;
        delete cleaned.chaosImpact;
      }
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
    // Validate implementation intentions: trim, drop empties/dupes, cap at 3
    if ('ifThen' in cleaned) {
      if (Array.isArray(cleaned.ifThen)) {
        const seen = new Set<string>();
        const clean: IfThenPlan[] = [];
        for (const p of cleaned.ifThen) {
          if (!p || typeof p !== 'object') continue;
          const cue = typeof p.cue === 'string' ? p.cue.trim().slice(0, MAX_IF_THEN_TEXT) : '';
          const action = typeof p.action === 'string' ? p.action.trim().slice(0, MAX_IF_THEN_TEXT) : '';
          if (!cue || !action) continue;
          const key = `${cue.toLocaleLowerCase()}→${action.toLocaleLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          clean.push({ cue, action });
          if (clean.length >= MAX_IF_THEN) break;
        }
        cleaned.ifThen = clean.length > 0 ? clean : undefined;
      } else {
        delete cleaned.ifThen;
      }
    }
    data.habits[idx] = { ...data.habits[idx], ...cleaned };
    notify();
  }
}

// --- Sub-habits ("sous-coches") ---
// Embedded facets of a parent habit (e.g. Work → "working while depressed").
// Checking ≥1 sub validates the day as PARTIAL ("doux", streak survives);
// checking ALL subs — or the parent directly — validates it as FULL.

export function addSubHabit(habitId: string, label: string): SubHabit | null {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return null;
  const clean = label.trim().slice(0, MAX_SUB_HABIT_LABEL);
  if (!clean) return null;
  const subs = habit.subHabits ?? [];
  if (subs.length >= MAX_SUB_HABITS) return null;
  if (subs.some((s) => s.label.toLocaleLowerCase() === clean.toLocaleLowerCase())) return null;
  const sub: SubHabit = {
    id: crypto.randomUUID(),
    label: clean,
    order: subs.reduce((m, s) => Math.max(m, s.order), -1) + 1,
  };
  habit.subHabits = [...subs, sub];
  notify();
  return sub;
}

export function renameSubHabit(habitId: string, subId: string, label: string): boolean {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit?.subHabits) return false;
  const clean = label.trim().slice(0, MAX_SUB_HABIT_LABEL);
  if (!clean) return false;
  const idx = habit.subHabits.findIndex((s) => s.id === subId);
  if (idx === -1) return false;
  habit.subHabits[idx] = { ...habit.subHabits[idx], label: clean };
  notify();
  return true;
}

export function deleteSubHabit(habitId: string, subId: string): boolean {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit?.subHabits) return false;
  if (!habit.subHabits.some((s) => s.id === subId)) return false;
  const remaining = habit.subHabits.filter((s) => s.id !== subId);
  habit.subHabits = remaining.length > 0 ? remaining : undefined;
  // Purge the deleted sub from every check-in, then recompute partial flags.
  for (const c of data.checkIns) {
    if (c.habitId !== habitId || !c.subIds?.includes(subId)) continue;
    const kept = c.subIds.filter((id) => id !== subId);
    c.subIds = kept.length > 0 ? kept : undefined;
    if (!c.completed || !c.subIds) {
      if (!c.completed) { c.subIds = undefined; c.partial = undefined; }
      else c.partial = undefined; // direct full check, no subs left
    } else {
      const total = remaining.length;
      c.partial = (c.subIds.length < total) || undefined;
    }
  }
  notify();
  return true;
}

/**
 * Toggle one sub-habit for a day. Returns the resulting CheckIn, or null
 * when the habit/sub doesn't exist.
 *
 * Semantics: ≥1 sub done → completed=true; partial=true unless ALL subs
 * are done (then the day counts as FULL). Unchecking the last sub clears
 * the day (completed=false). A direct parent check always wins as FULL.
 */
export function toggleSubCheck(habitId: string, subId: string, date: string): CheckIn | null {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return null;
  const subs = habit.subHabits ?? [];
  if (!subs.some((s) => s.id === subId)) return null;
  const existing = getCheckIn(habitId, date);
  if (existing) {
    const current = existing.count ?? (existing.completed ? 1 : 0);
    pushUndo(habitId, date, existing.completed, current);
    const set = new Set(existing.subIds ?? []);
    if (set.has(subId)) set.delete(subId);
    else set.add(subId);
    const done = [...set].filter((id) => subs.some((s) => s.id === id));
    if (done.length === 0) {
      existing.subIds = undefined;
      existing.partial = undefined;
      existing.completed = false;
      existing.count = 0;
    } else {
      existing.subIds = done;
      existing.completed = true;
      if (!existing.count) existing.count = 1;
      if (!existing.checkedAt) existing.checkedAt = new Date().toISOString();
      existing.partial = (done.length < subs.length) || undefined;
    }
    notify();
    return existing;
  }
  pushUndo(habitId, date, false, 0);
  const checkIn: CheckIn = {
    habitId, date, completed: true, count: 1,
    checkedAt: new Date().toISOString(),
    subIds: [subId],
    ...(subs.length > 1 ? { partial: true } : {}),
  };
  data.checkIns.push(checkIn);
  notify();
  return checkIn;
}

/** Full CheckIn records for one habit + month (drives partial + sub grids). */
export function getMonthCheckInRecords(habitId: string, year: number, month: number): Map<number, CheckIn> {
  const out = new Map<number, CheckIn>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  for (const c of data.checkIns) {
    if (c.habitId !== habitId || !c.date.startsWith(prefix)) continue;
    const day = parseInt(c.date.slice(8, 10), 10);
    if (Number.isFinite(day)) out.set(day, c);
  }
  return out;
}

/** Distinct "doux" count: partial-validation days for a habit (any window). */
export function countPartialDays(habitId: string, checkIns: CheckIn[] = data.checkIns): number {
  let n = 0;
  for (const c of checkIns) {
    if (c.habitId === habitId && isPartialCheckIn(c)) n++;
  }
  return n;
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
  // Operate on the non-archived list (what the UI shows), sorted by current order.
  const visible = data.habits.filter((h) => !h.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    // A direct parent toggle always resolves to FULL or cleared — never doux.
    existing.subIds = undefined;
    existing.partial = undefined;
    if (!existing.completed) existing.count = 0;
    else {
      if (!existing.count) existing.count = 1;
      if (!existing.checkedAt) existing.checkedAt = new Date().toISOString();
    }
    notify();
    return existing;
  }
  pushUndo(habitId, date, false);
  const checkIn: CheckIn = { habitId, date, completed: true, count: 1, checkedAt: new Date().toISOString() };
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
    // Direct parent action = FULL validation (clears any doux sub-state).
    existing.subIds = undefined;
    existing.partial = undefined;
    if (!existing.checkedAt) existing.checkedAt = new Date().toISOString();
    notify();
    return existing;
  }
  pushUndo(habitId, date, false, 0);
  const checkIn: CheckIn = { habitId, date, completed: true, count: 1, checkedAt: new Date().toISOString() };
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
    existing.subIds = undefined;
    existing.partial = undefined;
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
    existing.subIds = undefined;
    existing.partial = undefined;
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

// --- Journal (v0.4.0) ---
export function getJournalEntries(): JournalEntry[] {
  return [...data.journalEntries].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function addJournalEntry(
  content: string,
  personality: JournalPersonality,
  response: string,
  links?: { projectIds?: string[]; protocolIds?: string[]; habitIds?: string[] },
  opts?: { local?: boolean },
): JournalEntry {
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    content,
    personality,
    response,
    createdAt: new Date().toISOString(),
  };
  if (links) {
    if (links.projectIds?.length) entry.projectIds = links.projectIds;
    if (links.protocolIds?.length) entry.protocolIds = links.protocolIds;
    if (links.habitIds?.length) entry.habitIds = links.habitIds;
  }
  if (opts?.local) entry.local = true;
  data.journalEntries.push(entry);
  notify();
  return entry;
}

/** Update the project / protocol / habit links attached to a journal entry. */
export function updateJournalEntryLinks(
  id: string,
  links: { projectIds?: string[]; protocolIds?: string[]; habitIds?: string[] },
): void {
  const entry = data.journalEntries.find((e) => e.id === id);
  if (!entry) return;
  if (links.projectIds) entry.projectIds = links.projectIds.length > 0 ? links.projectIds : undefined;
  if (links.protocolIds) entry.protocolIds = links.protocolIds.length > 0 ? links.protocolIds : undefined;
  if (links.habitIds) entry.habitIds = links.habitIds.length > 0 ? links.habitIds : undefined;
  notify();
}

/**
 * Overwrite an entry's reflection (used by "régénérer avec l'IA" after an
 * offline entry was recorded with only a local reflection).
 */
export function updateJournalEntryResponse(id: string, response: string, opts?: { local?: boolean }): void {
  const entry = data.journalEntries.find((e) => e.id === id);
  if (!entry) return;
  entry.response = response;
  if (opts?.local !== undefined) entry.local = opts.local;
  notify();
}

export function deleteJournalEntry(id: string): void {
  data.journalEntries = data.journalEntries.filter((e) => e.id !== id);
  notify();
}

// --- Journal threads (v0.5.2): a question opens a persistent discussion ---
// Clicking a "rien à écrire" prompt (or a psycho track question) starts a
// thread. Every subsequent journal entry made from that thread is tagged with
// its threadId, so the conversation is stored as data and can be reopened.
export function getJournalThreads(): JournalThread[] {
  return [...(data.journalThreads ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJournalThread(id: string): JournalThread | undefined {
  return (data.journalThreads ?? []).find((t) => t.id === id);
}

export function startJournalThread(opts: { question: string; patternId?: string; step?: number; emoji?: string }): JournalThread {
  const thread: JournalThread = {
    id: crypto.randomUUID(),
    question: opts.question,
    patternId: opts.patternId,
    step: opts.step,
    emoji: opts.emoji,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!data.journalThreads) data.journalThreads = [];
  data.journalThreads.push(thread);
  notify();
  return thread;
}

export function deleteJournalThread(id: string): void {
  if (!data.journalThreads) return;
  data.journalThreads = data.journalThreads.filter((t) => t.id !== id);
  // Keep the journal entries themselves; just remove the grouping.
  notify();
}

/** Tag a journal entry with its source thread (and bump the thread's recency). */
export function tagJournalEntryThread(entryId: string, threadId: string | undefined): void {
  const entry = data.journalEntries.find((e) => e.id === entryId);
  if (!entry) return;
  entry.threadId = threadId;
  if (threadId && data.journalThreads) {
    const thread = data.journalThreads.find((t) => t.id === threadId);
    if (thread) thread.updatedAt = new Date().toISOString();
  }
  notify();
}

// --- Psychoanalysis history (v0.6.4): the chat is persisted, not volatile ---
export function getPsychoHistory(): PsychoMessage[] {
  return [...(data.psychoHistory ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function appendPsychoMessage(msg: Omit<PsychoMessage, 'createdAt'>): void {
  if (!data.psychoHistory) data.psychoHistory = [];
  data.psychoHistory.push({ ...msg, createdAt: new Date().toISOString() });
  notify();
}

export function clearPsychoHistory(): void {
  if (data.psychoHistory) data.psychoHistory = [];
  notify();
}

// --- Reflections (v0.5.2): the self-improvement loop ---
// LifeTrack detects observations in the user's own data, poses them as open
// questions, and persists the answers. Persisting is what makes the loop real:
// the same insight is not re-asked (filterNewReflections), and the answer
// becomes part of the data the AI reasons over.

export function getReflections(): ReflectionEntry[] {
  return [...(data.reflections ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOpenReflections(): ReflectionEntry[] {
  return getReflections().filter((r) => r.status === 'open');
}

export function addReflection(d: { kind: ReflectionKind; title: string; question: string; context: string; habitIds: string[]; dedupeKey: string }): ReflectionEntry {
  const entry: ReflectionEntry = { ...d, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'open' };
  if (!data.reflections) data.reflections = [];
  data.reflections.push(entry);
  notify();
  return entry;
}

/**
 * Mark a detected reflection as "asked" so the engine does not re-ask the same
 * question for a while. Persists the open question (the user can answer later)
 * and bumps timesAsked. Idempotent: re-asking the same dedupeKey only bumps
 * the counter, it does not create duplicates.
 */
export function markReflectionAsked(d: { kind: ReflectionKind; title: string; question: string; context: string; habitIds: string[]; dedupeKey: string }): ReflectionEntry {
  if (!data.reflections) data.reflections = [];
  const existing = data.reflections.find((r) => r.dedupeKey === d.dedupeKey);
  if (existing) {
    existing.timesAsked = (existing.timesAsked ?? 0) + 1;
    existing.lastAskedAt = new Date().toISOString();
    notify();
    return existing;
  }
  const entry: ReflectionEntry = {
    ...d,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'open',
    timesAsked: 1,
    lastAskedAt: new Date().toISOString(),
  };
  data.reflections.push(entry);
  notify();
  return entry;
}

/** Hide an open reflection from the journal until `days` from now. */
export function snoozeReflection(id: string, days: number): void {
  const r = (data.reflections ?? []).find((x) => x.id === id);
  if (!r) return;
  r.snoozedUntil = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  notify();
}

/** Clear a snooze so the question can be asked again. */
export function unsnoozeReflection(id: string): void {
  const r = (data.reflections ?? []).find((x) => x.id === id);
  if (!r) return;
  r.snoozedUntil = undefined;
  notify();
}

export function answerReflection(id: string, answer: string): void {
  const r = (data.reflections ?? []).find((x) => x.id === id);
  if (!r) return;
  r.status = 'answered';
  r.answer = answer;
  notify();
}

export function reopenReflection(id: string): void {
  const r = (data.reflections ?? []).find((x) => x.id === id);
  if (!r) return;
  r.status = 'open';
  r.answer = undefined;
  notify();
}

export function deleteReflection(id: string): void {
  if (!data.reflections) return;
  data.reflections = data.reflections.filter((x) => x.id !== id);
  notify();
}

// --- Challenges (v0.5.0) ---
// Persistent, adaptive challenges. Status is auto-resolved on read: an active
// challenge whose window has fully elapsed is marked 'completed' when the
// goal was met, otherwise 'failed' (unless the user already set a status).

export function getChallenges(): Challenge[] {
  return [...data.challenges].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getActiveChallenges(): Challenge[] {
  return data.challenges.filter((c) => c.status === 'active');
}

export function addChallenge(
  habitId: string,
  name: string,
  days: number,
  dailyGoal: number,
  adaptive = false,
): Challenge {
  const challenge: Challenge = {
    id: crypto.randomUUID(),
    habitId,
    name,
    days: Math.max(1, Math.floor(days)),
    dailyGoal: Math.max(1, Math.floor(dailyGoal)),
    startDate: toLocalDateKey(new Date()),
    status: 'active',
    createdAt: new Date().toISOString(),
    ...(adaptive ? { adaptive: true } : {}),
  };
  data.challenges.push(challenge);
  notify();
  return challenge;
}

export function updateChallenge(id: string, updates: Partial<Challenge>): void {
  const idx = data.challenges.findIndex((c) => c.id === id);
  if (idx !== -1) {
    data.challenges[idx] = { ...data.challenges[idx], ...updates };
    notify();
  }
}

export function deleteChallenge(id: string): void {
  data.challenges = data.challenges.filter((c) => c.id !== id);
  notify();
}

/**
 * Auto-resolve stale active challenges based on the current date and check-ins.
 * A challenge is resolved once its window (startDate → startDate + days - 1)
 * is fully in the past. It is 'completed' if the daily goal was met on at
 * least 80% of the window days, otherwise 'failed'. Returns the number of
 * challenges whose status changed.
 */
export function resolveChallengeStatuses(now: Date = new Date()): number {
  const today = toLocalDateKey(now);
  let changed = 0;
  for (const c of data.challenges) {
    if (c.status !== 'active') continue;
    const end = endDateOf(c.startDate, c.days);
    if (end >= today) continue; // window still open
    const progress = computeChallengeProgress(c.habitId, c.startDate, c.days, c.dailyGoal, data.checkIns, today);
    const completed = progress.completedDays / c.days >= 0.8;
    c.status = completed ? 'completed' : 'failed';
    if (completed) c.completedAt = now.toISOString();
    changed++;
  }
  if (changed > 0) notify();
  return changed;
}

export function endDateOf(startDate: string, days: number): string {
  const [y, m, d] = startDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days - 1);
  return toLocalDateKey(dt);
}

// --- Personas (v0.5.0) ---
// "Who you want to become" — a named goal tied to a set of habits. Progress
// (average completion of the linked habits over 14 days) is computed by the
// gamification engine, not stored.

export function getPersonas(): Persona[] {
  return [...data.personas].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addPersona(
  name: string,
  emoji: string,
  habitIds: string[],
  description?: string,
  kind?: 'habit' | 'reflective',
): Persona {
  const persona: Persona = {
    id: crypto.randomUUID(),
    name: name.trim(),
    emoji: emoji || '⭐',
    habitIds: [...new Set(habitIds.filter((id) => data.habits.some((h) => h.id === id)))],
    ...(kind ? { kind } : {}),
    ...(description?.trim() ? { description: description.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  data.personas.push(persona);
  notify();
  return persona;
}

export function updatePersona(id: string, updates: Partial<Persona>): void {
  const idx = data.personas.findIndex((p) => p.id === id);
  if (idx !== -1) {
    const next = { ...data.personas[idx], ...updates };
    if (updates.habitIds) {
      next.habitIds = [...new Set(updates.habitIds.filter((hid) => data.habits.some((h) => h.id === hid)))];
    }
    data.personas[idx] = next;
    notify();
  }
}

export function deletePersona(id: string): void {
  data.personas = data.personas.filter((p) => p.id !== id);
  notify();
}

// --- Levers (v0.5.0): "what works for me" ---
export function getLevers(): Lever[] {
  return [...data.levers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addLever(content: string, effect?: string, notes?: string): Lever {
  const lever: Lever = {
    id: crypto.randomUUID(),
    content: content.trim(),
    ...(effect?.trim() ? { effect: effect.trim() } : {}),
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  if (lever.content === '') throw new Error('Lever content cannot be empty');
  data.levers.push(lever);
  notify();
  return lever;
}

export function deleteLever(id: string): void {
  data.levers = data.levers.filter((l) => l.id !== id);
  notify();
}

// --- Pattern progress (v0.5.2): progressive healing of psychoanalysis patterns ---
export function getPatternTracks(): PatternTrack[] {
  return [...(data.patternTracks ?? [])];
}

export function replacePatternTracks(tracks: PatternTrack[]): void {
  data.patternTracks = tracks;
  notify();
}

interface ImportedHabit {
  id: string;
  name: string;
  goal?: number;
  archived?: boolean;
  chaosLinks?: ChaosLink[];
  chaosDimension?: string;
  chaosImpact?: number;
  chaosThresholdDays?: number;
  chaosPerWeek?: number;
  focusMonth?: string;
  category?: string;
  multiClick?: boolean;
  stackParent?: string;
  stackWhen?: 'before' | 'after' | 'with';
  why?: string[];
  subHabits?: SubHabit[];
  ifThen?: IfThenPlan[];
  intent?: 'do' | 'avoid';
}

interface ImportedCheckIn {
  habitId: string;
  date: string;
  completed: boolean;
  count?: number;
  note?: string;
  notes?: string[];
  subIds?: string[];
  partial?: boolean;
  checkedAt?: string;
  projectId?: string;
  taskId?: string;
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
  energiesRestored: number;
  concentrationsRestored: number;
  experimentsRestored: number;
  urgesRestored: number;
  mantrasRestored: number;
  chaosDimensionsRestored: number;
  leversImported: number;
  routinesRestored: number;
  emotionsRestored: number;
  journalRestored: number;
  miscRestored: number;
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

function readArray(raw: unknown, key: 'habits' | 'checkIns' | 'notes' | 'skills' | 'routines'): unknown[] {
  if (!isRecord(raw)) return [];
  const value = raw[key];
  return Array.isArray(value) ? value : [];
}

function parseImportedHabit(raw: unknown): ImportedHabit | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const name = raw.name.trim();
  if (!name) return null;
  // Clamp chaos fields on import to prevent poison data. The per-zone `cause`
  // ("why this habit destabilises this dimension") MUST survive the import —
  // dropping it on reinstall deletes user meaning (Gym/selfesteem incident).
  const links = Array.isArray(raw.chaosLinks)
    ? (raw.chaosLinks as unknown[])
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => {
          const cause = typeof l.cause === 'string' ? l.cause.trim() : '';
          return {
            dimension: typeof l.dimension === 'string' ? l.dimension : '',
            impact: typeof l.impact === 'number' && Number.isFinite(l.impact)
              ? Math.max(0, Math.min(100, Math.round(l.impact)))
              : 0,
            ...(cause ? { cause } : {}),
          };
        })
        .filter((l) => l.dimension.length > 0 && l.impact > 0)
    : [];
  const dim = typeof raw.chaosDimension === 'string' && raw.chaosDimension.length > 0
    ? raw.chaosDimension : undefined;
  const impact = typeof raw.chaosImpact === 'number' && Number.isFinite(raw.chaosImpact)
    ? Math.max(0, Math.min(100, raw.chaosImpact)) : undefined;
  const threshold = typeof raw.chaosThresholdDays === 'number' && Number.isFinite(raw.chaosThresholdDays)
    ? Math.max(1, Math.min(90, Math.floor(raw.chaosThresholdDays))) : undefined;
  const perWeek = typeof raw.chaosPerWeek === 'number' && Number.isFinite(raw.chaosPerWeek)
    ? Math.max(1, Math.min(7, Math.round(raw.chaosPerWeek))) : undefined;
  return {
    id: raw.id,
    name,
    goal: typeof raw.goal === 'number' ? raw.goal : undefined,
    archived: typeof raw.archived === 'boolean' ? raw.archived : undefined,
    chaosLinks: links.length > 0 ? links : undefined,
    chaosDimension: links.length > 0 ? undefined : dim,
    chaosImpact: links.length > 0 ? undefined : impact,
    chaosThresholdDays: threshold,
    chaosPerWeek: perWeek,
    focusMonth: typeof raw.focusMonth === 'string' && /^\d{4}-\d{2}$/.test(raw.focusMonth) ? raw.focusMonth : undefined,
    category: typeof raw.category === 'string' && raw.category.length > 0 ? raw.category : undefined,
    multiClick: typeof raw.multiClick === 'boolean' ? raw.multiClick : undefined,
    stackParent: typeof raw.stackParent === 'string' ? raw.stackParent : undefined,
    stackWhen: (raw.stackWhen === 'before' || raw.stackWhen === 'after' || raw.stackWhen === 'with') ? raw.stackWhen : undefined,
    why: Array.isArray(raw.why) ? (raw.why as unknown[]).filter((w): w is string => typeof w === 'string' && w.trim().length > 0).slice(0, 5) : undefined,
    subHabits: cleanSubHabitList(raw.subHabits),
    ifThen: cleanIfThenList(raw.ifThen),
    intent: raw.intent === 'do' || raw.intent === 'avoid' ? raw.intent : undefined,
  };
}

function parseImportedCheckIn(raw: unknown): ImportedCheckIn | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.habitId !== 'string' || typeof raw.date !== 'string') return null;
  if (!isValidDateKey(raw.date)) return null;
  const checkedAt = typeof raw.checkedAt === 'string' && raw.checkedAt.length > 0 ? raw.checkedAt : undefined;
  const projectId = typeof raw.projectId === 'string' && raw.projectId.length > 0 ? raw.projectId : undefined;
  const taskId = typeof raw.taskId === 'string' && raw.taskId.length > 0 ? raw.taskId : undefined;
  return {
    habitId: raw.habitId,
    date: raw.date,
    completed: raw.completed === true,
    count: typeof raw.count === 'number' && raw.count > 0 && Number.isFinite(raw.count) ? raw.count : undefined,
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : undefined,
    notes: Array.isArray(raw.notes)
      ? (raw.notes as unknown[]).filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0).map((n: string) => n.trim())
      : (typeof raw.note === 'string' && raw.note.trim() ? [raw.note.trim()] : undefined),
    subIds: Array.isArray(raw.subIds)
      ? (raw.subIds as unknown[]).filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
      : undefined,
    partial: raw.partial === true ? true : undefined,
    checkedAt,
    projectId,
    taskId,
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
    ...(source.chaosLinks && source.chaosLinks.length > 0 ? { chaosLinks: source.chaosLinks } : {}),
    ...(source.chaosDimension ? { chaosDimension: source.chaosDimension } : {}),
    ...(source.chaosImpact !== undefined ? { chaosImpact: source.chaosImpact } : {}),
    ...(source.chaosThresholdDays !== undefined ? { chaosThresholdDays: source.chaosThresholdDays } : {}),
    ...(source.chaosPerWeek !== undefined ? { chaosPerWeek: source.chaosPerWeek } : {}),
    ...(source.focusMonth ? { focusMonth: source.focusMonth } : {}),
    ...(source.category ? { category: source.category } : {}),
    ...(source.multiClick !== undefined ? { multiClick: source.multiClick } : {}),
    ...(source.stackParent ? { stackParent: source.stackParent } : {}),
    ...(source.stackWhen ? { stackWhen: source.stackWhen } : {}),
    ...(source.why && source.why.length > 0 ? { why: source.why } : {}),
    ...(source.subHabits && source.subHabits.length > 0 ? { subHabits: source.subHabits } : {}),
    ...(source.ifThen && source.ifThen.length > 0 ? { ifThen: source.ifThen } : {}),
    ...(source.intent ? { intent: source.intent } : {}),
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
  if (target.chaosLinks === undefined && source.chaosLinks && source.chaosLinks.length > 0) {
    target.chaosLinks = source.chaosLinks;
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
  if (target.chaosPerWeek === undefined && source.chaosPerWeek !== undefined) {
    target.chaosPerWeek = source.chaosPerWeek;
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
  // Gap-fill per-zone causes: a matched habit keeps its own links, but a
  // missing `cause` is restored from the import instead of staying blank.
  // (Reinstall-restore used to strip every cause note — never again.)
  if (source.chaosLinks && source.chaosLinks.length > 0 && target.chaosLinks && target.chaosLinks.length > 0) {
    for (const s of source.chaosLinks) {
      if (!s.cause) continue;
      const t = target.chaosLinks.find((l) => l.dimension === s.dimension);
      if (t && !t.cause) {
        t.cause = s.cause;
        changed = true;
      }
    }
  }
  if ((!target.subHabits || target.subHabits.length === 0) && source.subHabits && source.subHabits.length > 0) {
    target.subHabits = source.subHabits;
    changed = true;
  }
  if ((!target.ifThen || target.ifThen.length === 0) && source.ifThen && source.ifThen.length > 0) {
    target.ifThen = source.ifThen;
    changed = true;
  }
  if (!target.intent && source.intent) {
    target.intent = source.intent;
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
    energiesRestored: 0,
    concentrationsRestored: 0,
    experimentsRestored: 0,
    urgesRestored: 0,
    mantrasRestored: 0,
    chaosDimensionsRestored: 0,
    leversImported: 0,
    routinesRestored: 0,
    emotionsRestored: 0,
    journalRestored: 0,
    miscRestored: 0,
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
    // Sub-state of the TARGET habit (limits which imported subIds are valid).
    const targetHabit = data.habits.find((h) => h.id === habitId);
    const totalSubs = targetHabit?.subHabits?.length ?? 0;
    const adoptSubState = (): { subIds?: string[]; partial?: boolean } | null => {
      if (!imported.subIds || imported.subIds.length === 0) return null;
      const known = new Set((targetHabit?.subHabits ?? []).map((s) => s.id));
      const filtered = imported.subIds.filter((id) => known.size === 0 || known.has(id));
      if (filtered.length === 0) return null;
      return normalizeSubState(filtered, totalSubs, imported.completed);
    };
    if (!existing) {
      data.checkIns.push({
        habitId,
        date: imported.date,
        completed: imported.completed ?? false,
        count: imported.count,
        notes: imported.notes,
        ...adoptSubState(),
        ...(imported.checkedAt ? { checkedAt: imported.checkedAt } : {}),
        ...(imported.projectId ? { projectId: imported.projectId } : {}),
        ...(imported.taskId ? { taskId: imported.taskId } : {}),
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
      // Gap-fill doux state + provenance: never overwrite a fuller record.
      if (existing.subIds === undefined) {
        const adopted = adoptSubState();
        if (adopted?.subIds) {
          existing.subIds = adopted.subIds;
          existing.partial = adopted.partial;
          restored = true;
        }
      }
      if (!existing.checkedAt && imported.checkedAt) {
        existing.checkedAt = imported.checkedAt;
        restored = true;
      }
      if (!existing.projectId && imported.projectId) {
        existing.projectId = imported.projectId;
        restored = true;
      }
      if (!existing.taskId && imported.taskId) {
        existing.taskId = imported.taskId;
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

  // Routines (incl. depression protocol + step progress): match by id, create
  // when missing, otherwise gap-fill steps (by step id) and union done ids.
  // Routines used to vanish on reinstall-restore — never again.
  for (const rawRoutine of readArray(raw, 'routines')) {
    if (!isRecord(rawRoutine)) continue;
    const r = rawRoutine as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.triggerId !== 'string' || !r.triggerId) continue;
    if (typeof r.name !== 'string' || !r.name) continue;
    if (!Array.isArray(r.steps)) continue;
    const target = (data.routines ?? []).find((x) => x.id === r.id);
    if (!target) {
      const cleaned = sanitizeRoutines([rawRoutine]);
      if (cleaned.length > 0) {
        data.routines = [...(data.routines ?? []), ...cleaned];
        result.routinesRestored++;
      }
      continue;
    }
    // Gap-fill steps missing locally (matched by step id).
    const localIds = new Set(target.steps.map((s) => s.id));
    const cleaned = sanitizeRoutines([{ ...r, steps: r.steps }]);
    const incoming = cleaned.length > 0 ? cleaned[0].steps : [];
    let touched = false;
    for (const s of incoming) {
      if (!localIds.has(s.id)) {
        target.steps.push(s);
        touched = true;
      }
    }
    if (touched) target.steps.sort((a, b) => a.order - b.order);
    // Union done-step ids (both sides may have advanced independently).
    const pr = r.progress && typeof r.progress === 'object' && !Array.isArray(r.progress)
      ? (r.progress as Record<string, unknown>) : null;
    const incomingDone = Array.isArray(pr?.doneStepIds)
      ? (pr!.doneStepIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    if (incomingDone.length > 0) {
      const known = new Set(target.steps.map((s) => s.id));
      const union = new Set([...(target.progress?.doneStepIds ?? []), ...incomingDone.filter((id) => known.has(id))]);
      const before = target.progress?.doneStepIds.length ?? 0;
      if (union.size > before) {
        target.progress = { doneStepIds: [...union], updatedAt: new Date().toISOString() };
        touched = true;
      }
    }
    if (!target.kind && typeof r.kind === 'string' && r.kind) {
      target.kind = r.kind.slice(0, 40);
      touched = true;
    }
    if (touched) result.routinesRestored++;
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

  // --- v0.6.1: Import energies (YYYY-MM-DD → 0-100 %) ---
  let energiesRestored = 0;
  if (!data.energies) data.energies = {};
  const rawEnergies = (raw as Record<string, unknown>).energies;
  if (rawEnergies && typeof rawEnergies === 'object' && !Array.isArray(rawEnergies)) {
    for (const [date, v] of Object.entries(rawEnergies as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) continue;
      if (!isValidDateKey(date) || data.energies[date] !== undefined) continue;
      data.energies[date] = Math.round(v);
      energiesRestored++;
    }
  }
  result.energiesRestored = energiesRestored;

  // --- v0.6.2: Import concentrations (YYYY-MM-DD → 0-100 %) ---
  let concentrationsRestored = 0;
  if (!data.concentrations) data.concentrations = {};
  const rawConcs = (raw as Record<string, unknown>).concentrations;
  if (rawConcs && typeof rawConcs === 'object' && !Array.isArray(rawConcs)) {
    for (const [date, v] of Object.entries(rawConcs as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) continue;
      if (!isValidDateKey(date) || data.concentrations[date] !== undefined) continue;
      data.concentrations[date] = Math.round(v);
      concentrationsRestored++;
    }
  }
  result.concentrationsRestored = concentrationsRestored;

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
  // Les backups anciens contiennent des doublons de label (ids régénérés) : on nettoie.
  for (const dim of data.chaosDimensions) {
    dim.triggers = dedupeChaosTriggers(dim.triggers ?? []);
  }

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

  // --- v0.5.0: Import challenges (remapped through idMap) ---
  if (!data.challenges) data.challenges = [];
  const rawChallenges = Array.isArray((raw as Record<string, unknown>).challenges)
    ? (raw as Record<string, unknown>).challenges as unknown[]
    : [];
  for (const rawC of rawChallenges) {
    if (!isValidChallenge(rawC)) continue;
    const habitId = idMap.get(rawC.habitId) ?? rawC.habitId;
    if (!data.habits.some((h) => h.id === habitId)) continue; // orphan challenge → drop
    if (data.challenges.some((c) => c.id === rawC.id)) continue;
    data.challenges.push({
      id: rawC.id,
      habitId,
      name: rawC.name,
      days: Math.max(1, Math.floor(rawC.days)),
      dailyGoal: Math.max(1, Math.floor(rawC.dailyGoal)),
      startDate: rawC.startDate,
      status: rawC.status,
      createdAt: rawC.createdAt,
      completedAt: rawC.completedAt,
      adaptive: rawC.adaptive === true,
    });
  }

  // --- v0.5.0: Import personas (remapped through idMap) ---
  if (!data.personas) data.personas = [];
  const rawPersonas = Array.isArray((raw as Record<string, unknown>).personas)
    ? (raw as Record<string, unknown>).personas as unknown[]
    : [];
  for (const rawP of rawPersonas) {
    if (!isValidPersona(rawP)) continue;
    const habitIds = rawP.habitIds
      .map((id) => idMap.get(id) ?? id)
      .filter((id) => data.habits.some((h) => h.id === id));
    if (habitIds.length === 0 && rawP.kind !== 'reflective') continue; // persona without any matching habit → drop
    if (data.personas.some((p) => p.id === rawP.id)) continue;
    data.personas.push({
      id: rawP.id,
      name: rawP.name,
      emoji: rawP.emoji,
      description: rawP.description,
      habitIds,
      kind: rawP.kind,
      createdAt: rawP.createdAt,
    });
  }

  // --- Reinstall gap fix: import emotional events + checks + journal entries.
  // mergeImportedData historically skipped these types entirely, so every
  // reinstall wiped them from the live store (only the file-backfill rescued
  // emotions, and nothing rescued the journal). Append-if-missing by id.
  let emotionsRestored = 0;
  if (!data.emotionalEvents) data.emotionalEvents = [];
  if (!data.emotionalChecks) data.emotionalChecks = [];
  for (const ev of sanitizeEmotionalEvents((raw as Record<string, unknown>).emotionalEvents)) {
    if (data.emotionalEvents.some((x) => x.id === ev.id)) continue;
    data.emotionalEvents.push(ev);
    emotionsRestored++;
  }
  for (const c of sanitizeEmotionalChecks((raw as Record<string, unknown>).emotionalChecks)) {
    if (data.emotionalChecks.some((x) => x.id === c.id)) continue;
    data.emotionalChecks.push(c);
    emotionsRestored++;
  }
  result.emotionsRestored = emotionsRestored;
  let journalRestored = 0;
  if (!data.journalEntries) data.journalEntries = [];
  {
    const rawJournal = (raw as Record<string, unknown>).journalEntries;
    if (Array.isArray(rawJournal)) {
      for (const x of rawJournal) {
        if (!x || typeof x !== 'object') continue;
        const j = x as Record<string, unknown>;
        if (typeof j.id !== 'string' || !j.id) continue;
        if (typeof j.content !== 'string') continue;
        if (typeof j.personality !== 'string') continue;
        if (data.journalEntries.some((e) => e.id === j.id)) continue;
        const strArr = (v: unknown): string[] | undefined =>
          Array.isArray(v) ? (v as unknown[]).filter((h): h is string => typeof h === 'string') : undefined;
        data.journalEntries.push({
          id: j.id,
          content: j.content,
          personality: j.personality as JournalEntry['personality'],
          response: typeof j.response === 'string' ? j.response : '',
          createdAt: typeof j.createdAt === 'string' ? j.createdAt : new Date().toISOString(),
          habitIds: strArr(j.habitIds),
          projectIds: strArr(j.projectIds),
          protocolIds: strArr(j.protocolIds),
          threadId: typeof j.threadId === 'string' ? j.threadId : undefined,
          local: j.local === true ? true : undefined,
        });
        journalRestored++;
      }
    }
  }
  result.journalRestored = journalRestored;

  // --- Complete the merge: every remaining collection type, append-if-missing.
  // Historically mergeImportedData only covered habits + a few satellites, so
  // each reinstall silently dropped projects, missions, reflections, depressions,
  // feeds, the knowledge library, etc. from the live store. This block closes
  // the gap generically: validated entries, matched by stable id (or natural
  // key), never overwritten, never dropped when valid.
  let miscRestored = 0;
  {
    const R = raw as Record<string, unknown>;
    const arrOf = (k: string): unknown[] => (Array.isArray(R[k]) ? (R[k] as unknown[]) : []);
    // depressions: same 0-100 date-map shape as energies.
    if (!data.depressions) data.depressions = {};
    for (const [date, v] of Object.entries(R.depressions && typeof R.depressions === 'object' && !Array.isArray(R.depressions) ? (R.depressions as Record<string, unknown>) : {})) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) continue;
      if (!isValidDateKey(date) || data.depressions[date] !== undefined) continue;
      data.depressions[date] = Math.round(v);
      miscRestored++;
    }
    // projects / protocols / ingestedSources / feeds / obsidianNotes / missions /
    // journalThreads: sanitized, append-if-missing by id.
    const idLists: [string, (x: unknown) => { id: string }[]][] = [
      ['projects', (x) => sanitizeProjects([x]) as { id: string }[]],
      ['protocols', (x) => sanitizeProtocols([x]) as { id: string }[]],
      ['ingestedSources', (x) => (Array.isArray([x]) ? [x] : []).filter((e: unknown) => e && typeof e === 'object' && 'id' in (e as object) && 'rawText' in (e as object)) as { id: string }[]],
      ['feeds', (x) => sanitizeFeeds([x]) as { id: string }[]],
      ['obsidianNotes', (x) => sanitizeObsidianNotes([x]) as { id: string }[]],
      ['missions', (x) => sanitizeMissions([x]) as { id: string }[]],
      ['journalThreads', (x) => (Array.isArray([x]) ? [x] : []).filter((t: unknown) => t && typeof t === 'object' && 'id' in (t as object) && 'question' in (t as object)) as { id: string }[]],
    ];
    for (const [key, cleanOne] of idLists) {
      const cur = (data as unknown as Record<string, { id: string }[] | undefined>)[key] ?? [];
      const have = new Set(cur.map((e) => e.id));
      let wrote = false;
      for (const x of arrOf(key)) {
        let cleaned: { id: string }[];
        try { cleaned = cleanOne(x); } catch { continue; }
        for (const e of cleaned) {
          if (!e.id || have.has(e.id)) continue;
          // Remap habit references through idMap where the shape carries them.
          const rec = e as unknown as Record<string, unknown>;
          if (Array.isArray(rec.habitIds)) {
            rec.habitIds = (rec.habitIds as unknown[])
              .map((hid) => (typeof hid === 'string' ? (idMap.get(hid) ?? hid) : hid))
              .filter((hid): hid is string => typeof hid === 'string');
          }
          cur.push(e);
          have.add(e.id);
          miscRestored++;
          wrote = true;
        }
      }
      if (wrote) (data as unknown as Record<string, unknown>)[key] = cur;
    }
    // patternTracks: natural key = patternId (keep the furthest progress).
    if (!data.patternTracks) data.patternTracks = [];
    for (const x of arrOf('patternTracks')) {
      if (!x || typeof x !== 'object' || !('patternId' in (x as object))) continue;
      const p = x as Record<string, unknown>;
      if (typeof p.patternId !== 'string' || !p.patternId) continue;
      const ex = data.patternTracks.find((e) => e.patternId === p.patternId);
      const step = typeof p.step === 'number' && Number.isFinite(p.step) ? Math.max(0, Math.floor(p.step)) : 0;
      if (!ex) {
        data.patternTracks.push({
          patternId: p.patternId, step,
          seenCount: typeof p.seenCount === 'number' && Number.isFinite(p.seenCount) ? Math.max(0, Math.floor(p.seenCount)) : 0,
          lastSeen: typeof p.lastSeen === 'string' ? p.lastSeen : '',
          createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        });
        miscRestored++;
      } else if (step > ex.step) {
        ex.step = step;
        if (typeof p.lastSeen === 'string' && p.lastSeen > ex.lastSeen) ex.lastSeen = p.lastSeen;
        if (typeof p.seenCount === 'number' && Number.isFinite(p.seenCount)) ex.seenCount = Math.max(ex.seenCount, Math.floor(p.seenCount));
        miscRestored++;
      }
    }
    // reflections: dedupe by id, fallback to dedupeKey.
    if (!data.reflections) data.reflections = [];
    for (const x of arrOf('reflections')) {
      if (!x || typeof x !== 'object') continue;
      const r = x as Record<string, unknown>;
      if (typeof r.kind !== 'string' || typeof r.question !== 'string' || typeof r.dedupeKey !== 'string') continue;
      if (typeof r.id === 'string' && r.id && data.reflections.some((e) => e.id === r.id)) continue;
      if (data.reflections.some((e) => e.dedupeKey === r.dedupeKey)) continue;
      data.reflections.push({
        id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
        kind: r.kind as ReflectionEntry['kind'],
        title: typeof r.title === 'string' ? r.title : '',
        question: r.question,
        context: typeof r.context === 'string' ? r.context : '',
        habitIds: Array.isArray(r.habitIds) ? (r.habitIds as unknown[]).filter((h): h is string => typeof h === 'string') : [],
        dedupeKey: r.dedupeKey,
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
        status: r.status === 'answered' ? 'answered' : 'open',
        answer: typeof r.answer === 'string' ? r.answer : undefined,
        snoozedUntil: typeof r.snoozedUntil === 'string' ? r.snoozedUntil : undefined,
        timesAsked: typeof r.timesAsked === 'number' && Number.isFinite(r.timesAsked) ? Math.max(0, Math.floor(r.timesAsked)) : undefined,
        lastAskedAt: typeof r.lastAskedAt === 'string' ? r.lastAskedAt : undefined,
      });
      miscRestored++;
    }
    // psychoHistory: append entries not already present (role+content+createdAt).
    if (!data.psychoHistory) data.psychoHistory = [];
    for (const x of arrOf('psychoHistory')) {
      if (!x || typeof x !== 'object') continue;
      const m = x as Record<string, unknown>;
      if (typeof m.content !== 'string' || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const createdAt = typeof m.createdAt === 'string' ? m.createdAt : '';
      if (data.psychoHistory.some((e) => e.role === m.role && e.content === m.content && (e.createdAt ?? '') === createdAt)) continue;
      data.psychoHistory.push({
        role: m.role, content: m.content,
        frame: typeof m.frame === 'string' ? m.frame : 'general',
        patternId: typeof m.patternId === 'string' ? m.patternId : undefined,
        createdAt: createdAt || new Date().toISOString(),
      });
      miscRestored++;
    }
    // dismissedRecs: plain string union.
    {
      const have = new Set(data.dismissedRecs ?? []);
      for (const x of arrOf('dismissedRecs')) {
        if (typeof x !== 'string' || !x || have.has(x)) continue;
        have.add(x);
        miscRestored++;
      }
      data.dismissedRecs = [...have];
    }
  }
  result.miscRestored = miscRestored;

  // --- v0.5.0: Import levers (no habit references → no id remapping) ---
  if (!data.levers) data.levers = [];
  const rawLevers = Array.isArray((raw as Record<string, unknown>).levers)
    ? (raw as Record<string, unknown>).levers as unknown[]
    : [];
  for (const rawL of rawLevers) {
    if (!isValidLever(rawL)) continue;
    if (data.levers.some((l) => l.id === rawL.id)) continue;
    data.levers.push({
      id: rawL.id,
      content: rawL.content,
      effect: rawL.effect,
      notes: rawL.notes,
      createdAt: rawL.createdAt,
    });
    result.leversImported += 1;
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
    + moodsRestored + energiesRestored + concentrationsRestored + experimentsRestored + urgesRestored + mantrasRestored + chaosDimensionsRestored
    + emotionsRestored + journalRestored + result.routinesRestored + result.miscRestored;
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
  // Immutable append (new array reference): subscribers comparing by
  // reference (React state) must re-render, otherwise the new mantra is
  // saved but never SHOWN — the "mantras don't save" incident.
  data.mantras = [...(data.mantras ?? []), mantra];
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

// --- Energy tracking (% 0-100 per day, precision beyond the mood emoji) ---
// Stored as a per-day map (date → 0-100). Surfaced in the grid energy row and
// usable as a continuous series for correlations.

export function setEnergy(date: string, value: number | null): void {
  if (!data.energies) data.energies = {};
  if (value === null) {
    delete data.energies[date];
  } else {
    data.energies[date] = Math.max(0, Math.min(100, Math.round(value)));
  }
  notify();
}
export function getEnergy(date: string): number | undefined {
  return data.energies?.[date];
}
export function getMonthEnergies(year: number, month: number): Map<number, number> {
  const map = new Map<number, number>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  for (const [date, v] of Object.entries(data.energies ?? {})) {
    if (date.startsWith(prefix)) {
      const day = parseInt(date.split('-')[2], 10);
      map.set(day, v);
    }
  }
  return map;
}
export function getAverageEnergy(days: string[] = []): number | null {
  const values = days.length > 0
    ? days.map((d) => data.energies?.[d]).filter((v): v is number => v !== undefined)
    : Object.values(data.energies ?? {});
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

// --- Concentration tracking (% 0-100 per day) ---
// Same per-day map pattern as energy: surfaced in the grid concentration row,
// used as a continuous series for correlations (the "focus" axis of the day).

export function setConcentration(date: string, value: number | null): void {
  if (!data.concentrations) data.concentrations = {};
  if (value === null) {
    delete data.concentrations[date];
  } else {
    data.concentrations[date] = Math.max(0, Math.min(100, Math.round(value)));
  }
  notify();
}
export function getConcentration(date: string): number | undefined {
  return data.concentrations?.[date];
}
export function getMonthConcentrations(year: number, month: number): Map<number, number> {
  const map = new Map<number, number>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  for (const [date, v] of Object.entries(data.concentrations ?? {})) {
    if (date.startsWith(prefix)) {
      const day = parseInt(date.split('-')[2], 10);
      map.set(day, v);
    }
  }
  return map;
}
export function getAverageConcentration(days: string[] = []): number | null {
  const values = days.length > 0
    ? days.map((d) => data.concentrations?.[d]).filter((v): v is number => v !== undefined)
    : Object.values(data.concentrations ?? {});
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

// --- Depression tracking (% 0-100 per day, high = bad) ---
// Same per-day map pattern as energy/concentration: surfaced in the grid
// depression row, usable as a continuous series for correlations, and able to
// trigger a configurable alert when the day's value crosses the threshold.

export function setDepression(date: string, value: number | null): void {
  if (!data.depressions) data.depressions = {};
  if (value === null) {
    delete data.depressions[date];
  } else {
    data.depressions[date] = Math.max(0, Math.min(100, Math.round(value)));
  }
  notify();
}
export function getDepression(date: string): number | undefined {
  return data.depressions?.[date];
}
export function getMonthDepressions(year: number, month: number): Map<number, number> {
  const map = new Map<number, number>();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  for (const [date, v] of Object.entries(data.depressions ?? {})) {
    if (date.startsWith(prefix)) {
      const day = parseInt(date.split('-')[2], 10);
      map.set(day, v);
    }
  }
  return map;
}
export function getAverageDepression(days: string[] = []): number | null {
  const values = days.length > 0
    ? days.map((d) => data.depressions?.[d]).filter((v): v is number => v !== undefined)
    : Object.values(data.depressions ?? {});
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

// --- Obsidian notes ---
export function getObsidianNotes(): ObsidianNote[] {
  return data.obsidianNotes ?? [];
}

/** Import notes from a vault export. Replaces duplicates by fileName+content. */
export function importObsidianNotes(notes: Omit<ObsidianNote, 'id'>[]): { added: number; replaced: number } {
  const existing = [...(data.obsidianNotes ?? [])];
  let added = 0;
  let replaced = 0;
  for (const n of notes) {
    const idx = existing.findIndex((e) => e.fileName === n.fileName);
    if (idx >= 0) {
      if (existing[idx].content === n.content && existing[idx].vaultModifiedAt === n.vaultModifiedAt && !existing[idx].vaultMissing) continue;
      existing[idx] = {
        ...existing[idx],
        content: n.content,
        importedAt: n.importedAt,
        ...(n.vaultModifiedAt !== undefined ? { vaultModifiedAt: n.vaultModifiedAt } : {}),
        vaultMissing: false,
      };
      replaced++;
    } else {
      existing.push({ id: crypto.randomUUID(), ...n });
      added++;
    }
    if (existing.length >= 500) break;
  }
  data.obsidianNotes = existing;
  scheduleSave(data);
  return { added, replaced };
}

export function removeObsidianNote(id: string): void {
  data.obsidianNotes = (data.obsidianNotes ?? []).filter((n) => n.id !== id);
  scheduleSave(data);
}

export function clearObsidianNotes(): void {
  data.obsidianNotes = [];
  scheduleSave(data);
}

/**
 * Mirror mode (opt-in): flag notes that no longer exist in the vault.
 * NEVER deletes anything — LifeTrack keeps the last known content and the UI
 * shows it as "supprimée du coffre". Unflags notes that reappeared.
 */
export function applyVaultMirror(missingFileNames: string[]): void {
  const missing = new Set(missingFileNames);
  data.obsidianNotes = (data.obsidianNotes ?? []).map((n) => {
    if (missing.has(n.fileName)) return n.vaultMissing ? n : { ...n, vaultMissing: true };
    return n.vaultMissing ? { ...n, vaultMissing: false } : n;
  });
  scheduleSave(data);
}

// --- Missions ---
export function getMissions(): Mission[] {
  return data.missions ?? [];
}

export function addMission(m: Omit<Mission, 'id' | 'createdAt'>): Mission {
  const mission: Mission = { ...m, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  data.missions = [...(data.missions ?? []), mission];
  scheduleSave(data);
  return mission;
}

export function updateMission(id: string, patch: Partial<Mission>): void {
  data.missions = (data.missions ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
  scheduleSave(data);
}

export function deleteMission(id: string): void {
  data.missions = (data.missions ?? []).filter((m) => m.id !== id);
  scheduleSave(data);
}

export function archiveMission(id: string): void {
  data.missions = (data.missions ?? []).map((m) => (m.id === id ? { ...m, archived: !m.archived } : m));
  scheduleSave(data);
}

// --- Emotional Processing ---
export function getEmotionalEvents(): import('./types').EmotionalEvent[] {
  return data.emotionalEvents ?? [];
}
export function getEmotionalChecks(eventId?: string): import('./types').EmotionalCheck[] {
  const all = data.emotionalChecks ?? [];
  return eventId ? all.filter((c) => c.eventId === eventId) : all;
}
export function addEmotionalEvent(ev: Omit<import('./types').EmotionalEvent, 'id' | 'createdAt'>): import('./types').EmotionalEvent {
  const e: import('./types').EmotionalEvent = { ...ev, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  data.emotionalEvents = [...(data.emotionalEvents ?? []), e];
  scheduleSave(data);
  return e;
}
export function updateEmotionalEvent(id: string, patch: Partial<import('./types').EmotionalEvent>): void {
  data.emotionalEvents = (data.emotionalEvents ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e));
  scheduleSave(data);
}
export function deleteEmotionalEvent(id: string): void {
  data.emotionalEvents = (data.emotionalEvents ?? []).filter((e) => e.id !== id);
  data.emotionalChecks = (data.emotionalChecks ?? []).filter((c) => c.eventId !== id);
  scheduleSave(data);
}
export function upsertEmotionalCheck(eventId: string, date: string, intensity: number, note?: string, intensities?: Record<string, number>, noteEmotions?: string[]): import('./types').EmotionalCheck {
  const cleanIntensities = intensities !== undefined ? sanitizeIntensityMap(intensities) : undefined;
  const cleanNoteEmotions = noteEmotions !== undefined ? cleanEmotionTags(noteEmotions) : undefined;
  const all = data.emotionalChecks ?? [];
  const existing = all.find((c) => c.eventId === eventId && c.date === date);
  if (existing) {
    existing.intensity = intensity;
    if (note !== undefined) existing.note = note;
    if (cleanIntensities !== undefined) existing.intensities = cleanIntensities;
    if (noteEmotions !== undefined) existing.noteEmotions = cleanNoteEmotions;
    if (!existing.createdAt) existing.createdAt = new Date().toISOString();
    // notify (not just scheduleSave): the detail view must re-render
    // immediately so the user SEES the check — otherwise it looks lost.
    notify();
    return existing;
  }
  const c: import('./types').EmotionalCheck = { id: crypto.randomUUID(), eventId, date, intensity, note, intensities: cleanIntensities, noteEmotions: cleanNoteEmotions, createdAt: new Date().toISOString() };
  data.emotionalChecks = [...all, c];
  notify();
  return c;
}

/** Keep only finite 1-10 values; returns undefined when nothing valid remains. */
function sanitizeIntensityMap(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && k.length > 0 && k.length <= 40 && typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.min(10, Math.max(1, Math.round(v)));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
export function deleteEmotionalCheck(id: string): void {
  data.emotionalChecks = (data.emotionalChecks ?? []).filter((c) => c.id !== id);
  scheduleSave(data);
}

export function getRoutines(): import('./types').Routine[] {
  return data.routines ?? [];
}

export function addRoutine(routine: Omit<import('./types').Routine, 'id' | 'createdAt'>): import('./types').Routine {
  const newRoutine: import('./types').Routine = {
    ...routine,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  data.routines = [...(data.routines ?? []), newRoutine];
  scheduleSave(data);
  return newRoutine;
}

export function updateRoutine(id: string, patch: Partial<import('./types').Routine>): void {
  data.routines = (data.routines ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  scheduleSave(data);
}

export function deleteRoutine(id: string): void {
  data.routines = (data.routines ?? []).filter((r) => r.id !== id);
  scheduleSave(data);
}

export function getRoutinesForTrigger(triggerId: string): import('./types').Routine[] {
  return (data.routines ?? []).filter((r) => r.triggerId === triggerId);
}

export interface RoutineProgress {
  done: number;
  total: number;
  /** 0..1 (1 when total is 0 — nothing to do). */
  pct: number;
  /** First undone step in order (null when all done) — "reprendre ici". */
  next: import('./types').RoutineStep | null;
}

/** Progress snapshot of a routine (pure, works on any routine object). */
export function routineProgress(routine: Pick<import('./types').Routine, 'steps' | 'progress'>): RoutineProgress {
  const steps = [...(routine.steps ?? [])].sort((a, b) => a.order - b.order);
  const doneSet = new Set(routine.progress?.doneStepIds ?? []);
  const done = steps.filter((s) => doneSet.has(s.id)).length;
  return {
    done,
    total: steps.length,
    pct: steps.length === 0 ? 1 : done / steps.length,
    next: steps.find((s) => !doneSet.has(s.id)) ?? null,
  };
}

/**
 * Toggle one routine step done/undone. Persists + notifies (the UI must
 * re-render immediately — same lesson as upsertEmotionalCheck: no silent state).
 */
export function toggleRoutineStep(routineId: string, stepId: string): import('./types').Routine | null {
  const routine = (data.routines ?? []).find((r) => r.id === routineId);
  if (!routine || !routine.steps.some((s) => s.id === stepId)) return null;
  const done = new Set(routine.progress?.doneStepIds ?? []);
  if (done.has(stepId)) done.delete(stepId);
  else done.add(stepId);
  // Keep only ids of steps that still exist (rename-safe, delete-safe).
  const known = new Set(routine.steps.map((s) => s.id));
  routine.progress = { doneStepIds: [...done].filter((id) => known.has(id)), updatedAt: new Date().toISOString() };
  notify();
  return routine;
}

/** Reset a routine's progress (start the day over). */
export function resetRoutineProgress(routineId: string): boolean {
  const routine = (data.routines ?? []).find((r) => r.id === routineId);
  if (!routine) return false;
  routine.progress = undefined;
  notify();
  return true;
}

/** Rename one routine step (phases are user-editable). */
export function updateRoutineStep(routineId: string, stepId: string, label: string): boolean {
  const routine = (data.routines ?? []).find((r) => r.id === routineId);
  const clean = label.trim().slice(0, 120);
  if (!routine || !clean) return false;
  const step = routine.steps.find((s) => s.id === stepId);
  if (!step) return false;
  step.label = clean;
  notify();
  return true;
}

/** Delete one routine step (progress ids are purged with it). */
export function deleteRoutineStep(routineId: string, stepId: string): boolean {
  const routine = (data.routines ?? []).find((r) => r.id === routineId);
  if (!routine || !routine.steps.some((s) => s.id === stepId)) return false;
  routine.steps = routine.steps.filter((s) => s.id !== stepId);
  if (routine.progress) {
    const kept = routine.progress.doneStepIds.filter((id) => id !== stepId);
    routine.progress = { doneStepIds: kept, updatedAt: new Date().toISOString() };
  }
  notify();
  return true;
}

/** The depression-day protocol routine, if the user kept it. */
export function getDepressionProtocol(): import('./types').Routine | undefined {
  return (data.routines ?? []).find((r) => r.kind === 'depression-day');
}

// --- One-shot wellbeing seeds (user-approved) ---
const OUTING_GUARD_LABEL = 'Sortie sociale impromptue (heures non libres / non programmée)';
const OUTING_GUARD_WEIGHT = 25;
const OUTING_GUARD_DIMENSION = 'structural';
const DEPRESSION_PROTOCOL_NAME = 'Protocole jour dépression';
const DEPRESSION_PROTOCOL_PHASES = [
  'Ancrage — lumière du jour, douche, lit fait (remettre le corps dans la journée)',
  'Corps — marche 20 à 30 minutes dehors, sans téléphone',
  'Nourrir — un vrai repas assis, pas debout ni sucré seul',
  'Lien — un contact humain (message, appel, voisin), même bref',
  'Minuscule — une seule micro-tâche de 10 minutes, puis stop',
  'Apaiser — soirée douce, écrans coupés 1h avant le coucher',
];

/**
 * One-shot seeds approved by the user: the unplanned-outing guard principle
 * (Structural +25%) and the depression-day protocol routine (6 editable
 * phases). Idempotent via preference flags — a user deletion is respected
 * and never re-seeded.
 */
export function seedWellbeingDefaults(): { outingGuard: boolean; protocol: boolean } {
  // Ensure default dimensions exist first (self-healing getter).
  getChaosDimensions();
  const prefs = getPreferences();
  let outingGuard = false;
  let protocol = false;
  if (!prefs.outingGuardSeeded) {
    const dim = data.chaosDimensions.find((d) => d.id === OUTING_GUARD_DIMENSION);
    const already = dim?.triggers.some(
      (t) => t.label.trim().toLocaleLowerCase() === OUTING_GUARD_LABEL.toLocaleLowerCase(),
    );
    if (dim && !already) {
      dim.triggers.push({ id: crypto.randomUUID(), label: OUTING_GUARD_LABEL, weight: OUTING_GUARD_WEIGHT, active: false });
      outingGuard = true;
    }
    updatePreferences({ outingGuardSeeded: true });
  }
  if (!prefs.depressionProtocolSeeded) {
    const already = (data.routines ?? []).some((r) => r.kind === 'depression-day');
    if (!already) {
      let anchor = data.chaosDimensions
        .find((d) => d.id === 'emotional')
        ?.triggers.find((t) => t.label === '🌧️ Protocole dépression');
      if (!anchor) {
        const emo = data.chaosDimensions.find((d) => d.id === 'emotional');
        if (emo) {
          anchor = { id: crypto.randomUUID(), label: '🌧️ Protocole dépression', weight: 0, active: false };
          emo.triggers.push(anchor);
        }
      }
      if (anchor) {
        const now = new Date().toISOString();
        data.routines = [...(data.routines ?? []), {
          id: crypto.randomUUID(),
          triggerId: anchor.id,
          name: DEPRESSION_PROTOCOL_NAME,
          kind: 'depression-day',
          steps: DEPRESSION_PROTOCOL_PHASES.map((label, i) => ({ id: crypto.randomUUID(), label, order: i })),
          createdAt: now,
        }];
        protocol = true;
      }
    }
    updatePreferences({ depressionProtocolSeeded: true });
  }
  if (outingGuard || protocol) notify();
  return { outingGuard, protocol };
}

export function addChaosTrigger(dimensionId: string, label: string, weight: number): import('./types').ChaosTrigger | null {
  const dim = data.chaosDimensions.find((d) => d.id === dimensionId);
  if (!dim) return null;
  // Anti-doublon : un label déjà présent (casse/espaces ignorés) est retourné tel quel.
  const wanted = normalizeTriggerLabel(label);
  const existing = dim.triggers.find((t) => normalizeTriggerLabel(t.label) === wanted);
  if (existing) return existing;
  const trigger: import('./types').ChaosTrigger = {
    id: crypto.randomUUID(),
    label: label.trim(),
    weight: Math.max(0, Math.min(100, weight)),
    active: false,
  };
  dim.triggers.push(trigger);
  scheduleSave(data);
  return trigger;
}

export function exportAllData(): AppData {
  // Return a deep clone so callers cannot mutate internal state
  return JSON.parse(JSON.stringify(data));
}

// --- Chaos ---
const DEFAULT_CHAOS: ChaosDimension[] = [
  { id: 'social', name: 'Social', triggers: [] },
  { id: 'financial', name: 'Financial', triggers: [] },
  { id: 'physical', name: 'Physical', triggers: [] },
  { id: 'structural', name: 'Structural', triggers: [] },
  { id: 'spiritual', name: 'Spiritual', triggers: [] },
  { id: 'emotional', name: 'Emotional', triggers: [] },
  { id: 'energy', name: 'Energy', triggers: [] },
  { id: 'startup', name: 'Startup', triggers: [] },
  // Self-esteem: habits that protect how you see yourself (shame resilience,
  // humiliation recovery, self-compassion). A missing self-care habit heats
  // this dimension — distinct from Emotional (passing states) : this is the
  // slow background evaluation of self-worth (Rosenberg; Neff).
  { id: 'selfesteem', name: 'Estime de soi', triggers: [] },
];

export function getDefaultChaosDimensions(): ChaosDimension[] {
  return JSON.parse(JSON.stringify(DEFAULT_CHAOS));
}

// Normalise un label pour la déduplication (casse/espaces insignifiants).
export function normalizeTriggerLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Supprime les triggers en double (même label normalisé) en gardant le premier.
// Les doublons naissent des réimports : la migration ci-dessous régénérait un
// nouvel id aléatoire à chaque fois, invisible à la déduplication par id.
export function dedupeChaosTriggers<T extends { id: string; label: string }>(triggers: T[]): T[] {
  const seen = new Set<string>();
  return triggers.filter((t) => {
    const key = normalizeTriggerLabel(t.label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Merge stored dimensions with the current defaults. New defaults (e.g.
// 'emotional', 'startup') are appended for users whose data was saved by an older
// version that didn't include them. User customisations on existing
// dimensions are preserved by id. Custom dimensions not in defaults are kept.
export function mergeChaosDimensions(stored: ChaosDimension[]): ChaosDimension[] {
  const defaults = getDefaultChaosDimensions();
  const storedById = new Map(stored.filter((d) => d && d.id).map((d) => [d.id, d]));
  const merged = defaults.map((d) => {
    const prior = storedById.get(d.id);
    return prior ? { ...d, triggers: prior.triggers ?? [] } : d;
  });
  // Preserve custom dimensions (e.g. user-created startup variants)
  for (const [id, dim] of storedById) {
    if (!defaults.some((d) => d.id === id)) merged.push(dim);
  }
  return merged;
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
  // Migration: restore lost Startup principle "No LLM or models with 55+ Intelligence" +75% daily (manual check)
  // Idempotente : id fixe + garde par label (l'ancien randomUUID recréait un
  // doublon invisible à chaque passage et à chaque réimport de backup).
  const STARTUP_NO_LLM_ID = 'startup-no-llm-55';
  const STARTUP_NO_LLM_LABEL = 'No LLM or models with 55+ Intelligence';
  const startup = data.chaosDimensions.find((d) => d.id === 'startup');
  if (startup) {
    startup.triggers = dedupeChaosTriggers(startup.triggers);
    const wanted = normalizeTriggerLabel(STARTUP_NO_LLM_LABEL);
    if (!startup.triggers.some((t) => normalizeTriggerLabel(t.label) === wanted)) {
      startup.triggers.push({ id: STARTUP_NO_LLM_ID, label: STARTUP_NO_LLM_LABEL, weight: 75, active: false });
      scheduleSave(data);
    }
  }
  return data.chaosDimensions;
}

/**
 * Canonical chaos links for a habit. Prefers the multi-zone `chaosLinks` list;
 * falls back to the legacy single `chaosDimension`+`chaosImpact` fields so old
 * data keeps working unchanged.
 */
export function getHabitChaosLinks(habit: Habit): ChaosLink[] {
  if (Array.isArray(habit.chaosLinks) && habit.chaosLinks.length > 0) {
    return habit.chaosLinks
      .filter((l) => l && typeof l.dimension === 'string' && l.dimension.length > 0)
      .map((l) => ({
        dimension: l.dimension,
        impact: typeof l.impact === 'number' && Number.isFinite(l.impact)
          ? Math.max(0, Math.min(100, l.impact))
          : 0,
        cause: typeof l.cause === 'string' && l.cause.trim().length > 0 ? l.cause.trim() : undefined,
      }))
      .filter((l) => l.impact > 0);
  }
  if (habit.chaosDimension && habit.chaosImpact) {
    return [{ dimension: habit.chaosDimension, impact: Math.max(0, Math.min(100, habit.chaosImpact)) }];
  }
  return [];
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
export function computeMissedStreak(habit: Habit, today: Date): number {
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

/** Expected chaos sessions per week (1-7). Undefined/7 = daily (legacy behavior). */
export function chaosPerWeekOf(habit: Pick<Habit, 'chaosPerWeek'>): number {
  const v = habit.chaosPerWeek;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(7, Math.max(1, Math.round(v))) : 7;
}

export interface MissedSessions {
  /** Expected sessions in the trailing window. */
  expected: number;
  /** Distinct completed days in the window (one day = one session at most). */
  done: number;
  /** Missed = max(0, expected − done). May be fractional for non-daily habits. */
  missed: number;
  /** Trailing window length in days, anchored yesterday (today isn't over). */
  windowDays: number;
  /** Sessions per week of the habit. */
  perWeek: number;
}

/**
 * Occurrence-based miss counting — the cry-wolf guard for non-daily habits.
 * A 3×/week habit must NOT heat chaos after 2 calendar days off.
 *
 * Window = ceil(threshold × 7 / perWeek) trailing days ending yesterday;
 * expected = perWeek × countedDays / 7 (prorated when the habit is newer
 * than the window — no penalty before the tool existed); missed = expected − done.
 *
 * For daily habits (perWeek 7): window = threshold, expected = threshold
 * (integer), missed ⟺ the last `threshold` days are ALL missed — IDENTICAL
 * to the consecutive-day streak. One code path, zero behavior change daily.
 */
export function computeMissedSessions(habit: Habit, thresholdDays: number, today: Date): MissedSessions {
  const perWeek = chaosPerWeekOf(habit);
  const fullWindow = Math.max(1, Math.ceil((thresholdDays * 7) / perWeek));
  const startBoundary = trackingStart(habit);
  const pad = (n: number) => String(n).padStart(2, '0');
  const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let countedDays = 0;
  const doneDates = new Set<string>();
  for (let i = 1; i <= fullWindow; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (startBoundary) {
      const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (dStart < startBoundary) break;
    }
    countedDays++;
    const key = keyOf(d);
    const ci = data.checkIns.find((c) => c.habitId === habit.id && c.date === key);
    if (ci && ci.completed) doneDates.add(key);
  }
  const expected = (perWeek * countedDays) / 7;
  const missed = Math.max(0, expected - doneDates.size);
  return { expected, done: doneDates.size, missed, windowDays: countedDays, perWeek };
}

export function computeAutoChaos(asOf?: Date): Map<string, { trigger: ChaosTrigger; habitName: string }[]> {
  const autoTriggerMap = new Map<string, { trigger: ChaosTrigger; habitName: string }[]>();
  const today = asOf ?? new Date();

  for (const habit of data.habits) {
    if (habit.archived) continue;
    if (!habit.chaosDimension || !habit.chaosImpact || !habit.chaosThresholdDays) continue;

    const streak = computeMissedStreak(habit, today);
    const sess = computeMissedSessions(habit, habit.chaosThresholdDays, today);

    if (sess.missed >= habit.chaosThresholdDays) {
      const triggerId = `auto_${habit.id}`;
      const label = sess.perWeek < 7
        ? `"${habit.name}" missed ${Math.round(sess.missed * 10) / 10} sessions (threshold ${habit.chaosThresholdDays})`
        : `"${habit.name}" missed ${streak}d (threshold ${habit.chaosThresholdDays}d)`;
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
  impact: number;        // chaos Impact %
  thresholdDays: number; // missed sessions needed to trigger (days when daily)
  missedStreak: number;  // missed sessions (consecutive missed days when daily)
  triggered: boolean;    // missedStreak >= thresholdDays
  /** Expected sessions per week (7 = daily). Drives "séances" vs "jours" labels. */
  perWeek: number;
  /** 0..1 how close the habit is to triggering (missedStreak/thresholdDays). */
  progress: number;
  /** Optional user note explaining WHY this habit destabilises this dimension. */
  cause?: string;
  /** The habit's intentions ("why I do this") — surfaced in Chaos so the
   * reason is visible exactly where the pressure is felt. */
  why?: string[];
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
    const links = getHabitChaosLinks(habit);
    if (links.length === 0 || !habit.chaosThresholdDays) continue;

    // Display streak stays calendar-based (unbounded, e.g. "manqué 35j") for
    // daily habits; for non-daily habits it shows missed SESSIONS (a 35-day
    // calendar streak is normal life for 1×/week, not chaos). The TRIGGER
    // always uses the occurrence model (cry-wolf guard).
    const streak = computeMissedStreak(habit, today);
    const sess = computeMissedSessions(habit, habit.chaosThresholdDays, today);
    const missedStreak = sess.perWeek < 7 ? Math.round(sess.missed * 10) / 10 : streak;
    const triggered = sess.missed >= habit.chaosThresholdDays;
    for (const link of links) {
      const status: ChaosHabitStatus = {
        habitId: habit.id,
        habitName: habit.name,
        impact: link.impact,
        thresholdDays: habit.chaosThresholdDays,
        missedStreak,
        triggered,
        perWeek: sess.perWeek,
        progress: habit.chaosThresholdDays > 0 ? Math.min(1, sess.missed / habit.chaosThresholdDays) : 0,
        cause: link.cause,
        why: habit.why && habit.why.length > 0 ? [...habit.why] : undefined,
      };
      if (!linkedByDim.has(link.dimension)) linkedByDim.set(link.dimension, []);
      linkedByDim.get(link.dimension)!.push(status);
    }
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

// --- Chaos history: evolution of overall pressure over the last N days ---
// Returns an array ordered oldest → newest, one entry per day. The pressure for
// a past day is the average of triggered impacts across dimensions that had
// linked habits on that day (habits that don't yet exist are skipped).
export interface ChaosDayPoint {
  date: string;   // YYYY-MM-DD
  pct: number;    // overall pressure 0..100
}

export function computeChaosHistory(days: number, asOf?: Date): ChaosDayPoint[] {
  const now = asOf ?? new Date();
  const dims = getChaosDimensions();
  const points: ChaosDayPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

    let totalImpact = 0;
    let dimsWithHabits = 0;
    for (const dim of dims) {
      let dimPct = 0;
      let hasHabit = false;
      // Scan habits forward from this day only (they must have started by then).
      for (const habit of data.habits) {
        if (habit.archived) continue;
        const links = getHabitChaosLinks(habit);
        if (!habit.chaosThresholdDays || !links.some((l) => l.dimension === dim.id)) continue;
        const startBoundary = trackingStart(habit);
        const dayOf = new Date(day.getFullYear(), day.getMonth(), day.getDate());
        if (startBoundary && dayOf < startBoundary) continue;
        hasHabit = true;
        // Recompute missed streak ending the day AFTER `day` (i.e. viewed on `day`'s evening).
        const then = new Date(day);
        then.setDate(then.getDate() + 1);
        const missed = computeMissedStreak(habit, then);
        if (missed >= habit.chaosThresholdDays) {
          const link = links.find((l) => l.dimension === dim.id);
          if (link) dimPct += link.impact;
        }
      }
      if (hasHabit) { dimsWithHabits++; totalImpact += Math.min(100, dimPct); }
    }
    const pct = dimsWithHabits > 0 ? Math.round(totalImpact / dimsWithHabits) : 0;
    points.push({ date: dateKey, pct });
  }
  return points;
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
