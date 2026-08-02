export interface Habit {
  id: string;
  name: string;
  color: string; // pastel color for checked cells
  goal: number;
  createdAt: string;
  archived: boolean;
  order: number;
  category?: string; // optional grouping: 'health', 'work', 'personal', 'learning', 'finance'
  // Chaos linkage: if the user misses this habit for `thresholdDays` consecutive days,
  // it contributes `chaosImpact` percentage points to the linked chaos dimension.
  chaosImpact?: number;        // 0-100, percent added when triggered
  chaosDimension?: string;     // dimension id: 'physical' | 'financial' | 'social' | 'structural' | 'spiritual'
  chaosThresholdDays?: number; // consecutive missed days that triggers chaos (e.g. 2 for gym > 2)
  // Persistent personal records (recalculated from check-ins). Surviving a streak
  // break is the whole point — see computeStreakStats() in stats.ts.
  bestStreak?: number;        // longest completed-days run ever recorded
  bestStreakAt?: string;      // YYYY-MM-DD ending date of that best streak
  longestGap?: number;        // longest missed-days run ever recorded
  longestGapAt?: string;      // YYYY-MM-DD ending date of that gap
  totalCompleted?: number;    // lifetime count of completed check-ins
  // Habit stacking: if set, this habit is a "downstream" of the given parent.
  // Used to build routines like "after coffee → meditate". See computeStacks().
  stackParent?: string;       // id of the triggering habit, or undefined
  // When in the parent's flow: before the parent, after it, or with it.
  stackWhen?: 'before' | 'after' | 'with'; // defaults to 'after' when unset
  // Intentions: 0-5 short reminders of WHY this habit matters.
  // Displayed when checking in, to reinforce motivation.
  // "Start with Why" — Simon Sinek / BJ Fogg "Tiny Habits" motivation anchor.
  why?: string[];             // list of intention strings, max 5
  // Multi-click: when true (default), click increments count. When false, simple toggle on/off.
  multiClick?: boolean;
  // Monthly focus: YYYY-MM when this habit was set as focus of the month
  focusMonth?: string;
}

export interface CheckIn {
  date: string; // YYYY-MM-DD
  habitId: string;
  completed: boolean;
  notes?: string[]; // optional notes for this check-in (multiple per day)
  count?: number; // number of completions today (1 by default, up to goal)
}

export interface Note {
  id: string;
  habitId: string;
  content: string;
  createdAt: string;
  achievementCategory?: string; // when set, this note is an achievement in that category
}

// --- Chaos Tracker ---
export interface ChaosTrigger {
  id: string;
  label: string;
  weight: number; // percentage points added when active (e.g. 50 = +50%)
  active: boolean;
}

export interface ChaosDimension {
  id: string;
  name: string; // Social, Financial, Physical, Structural, Spiritual
  triggers: ChaosTrigger[];
}

// --- Achievements ---
// A category an achievement (tagged note) belongs to. Defaults reuse the seven
// chaos dimensions plus a dedicated 'Psychological' category.
export interface AchievementCategory {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

// --- Mantras ---

export interface MantraDomain {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface Mantra {
  id: string;
  text: string;
  domain: string;        // domain id, e.g. 'financial', 'life', 'health'
  createdAt: string;
  isDefault: boolean;     // true = built-in, false = user-created
}

export interface MantraSettings {
  morningEnabled: boolean;
  eveningEnabled: boolean;
  morningTime: string;    // HH:MM format, e.g. '08:00'
  eveningTime: string;    // HH:MM format, e.g. '20:00'
  showOnEntry: boolean;   // show daily mantra banner when opening the app
  lastMorningDate: string; // YYYY-MM-DD last time morning notification was shown
  lastEveningDate: string; // YYYY-MM-DD last time evening notification was shown
  lastEntryDate: string;   // YYYY-MM-DD last time the entry banner was shown
}

export interface SkillLink {
  habitId: string;
  xpPerCompletion: number; // XP gained per completion, e.g. 10
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  emoji: string; // e.g. "🧠", "🧘", "🏃"
  color: string; // hex color for UI
  createdAt: string;
  links: SkillLink[];
  isDefault?: boolean; // true if built-in
}

// --- Capacities (sub-skills / micro-abilities) ---
// A Capacity is a measurable sub-ability that lives under a Skill and is
// trained by one or more linked habits. Example: under Skill "Mindfulness",
// a user could create Capacity "Pattern detection" (rating 1-10) and link
// it to the habit "Meditation". This solves the "impact of habits on the
// development of specific abilities" use case that pure XP/level cannot
// capture: XP is anonymous volume, ratings track perceived ability over time.
export interface Capacity {
  id: string;
  skillId: string;          // parent skill id
  name: string;             // e.g. "Pattern detection", "Thought noting"
  description: string;      // what does this capacity mean to you?
  unit: string;             // e.g. "1-10", "minutes", "count", "seconds"
  baseline: number;         // starting value (1-10 by default; user-defined scale)
  target: number;           // goal value to reach
  createdAt: string;
  isDefault?: boolean;
}

// One observation of a Capacity on a given day.
// Either a self-rating (rating) or a note (note) — both are optional but
// at least one is set on every observation so a log entry is never empty.
export interface CapacityRating {
  id: string;
  capacityId: string;       // which capacity
  date: string;             // YYYY-MM-DD
  rating?: number;          // numeric self-rating on the capacity's scale
  note?: string;            // free-form qualitative observation
  // Optional link to a habit that was completed on the same day, for context.
  // We don't enforce habit presence — the capacity can be rated on rest days.
  habitId?: string;
}

// --- N=1 Experiments ---
export interface Experiment {
  id: string;
  title: string;
  hypothesis: string;       // "If I meditate 20min every morning, my focus will improve"
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD (or empty for ongoing)
  linkedHabits: string[];   // habit IDs being tested
  linkedMetrics: string[];  // 'mood' | capacity IDs
  status: 'active' | 'completed' | 'cancelled';
  conclusion: string;       // filled at completion
  createdAt: string;
  completedAt?: string;
}

// --- Urge Surfing ---
// Mindfulness technique: observe urges like waves, watch them peak,
// and let them pass without acting on them. Core of breaking bad habits.
export interface UrgeEntry {
  id: string;
  type: string;       // urge type id, e.g. 'craving', 'procrastination'
  intensity: number;  // 1-10, set at start
  startTime: string;  // ISO timestamp
  endTime?: string;   // ISO timestamp, set when urge passes
  outcome: 'surfed' | 'gave_in' | 'active';
  note?: string;      // free-form reflection
  trigger?: string;   // what triggered the urge
  counterHabits?: string[]; // habit IDs used as counter-measures
}

// --- Custom Urge Types ---
// Users can define their own urge categories with specific counter-habits.
export interface CustomUrgeType {
  id: string;
  name: string;
  emoji: string;       // e.g. "🎮", "💊", "🛒"
  color: string;       // hex color for UI
  defaultCounterHabits?: string[]; // habit IDs suggested as counter-measures
  createdAt: string;
}

// --- Correlation result (computed, not stored) ---
export interface CorrelationResult {
  metricA: string;          // label like "Meditation" or "Mood"
  metricB: string;
  coefficient: number;      // Pearson r, -1 to 1
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  direction: 'positive' | 'negative';
  sampleSize: number;       // number of data points
}

// --- Journal (v0.4.0) ---
// A private reflection tool where the user writes freely and one of four
// AI personas (Coach / Sage / Psychologist / Strategist) reflects back.
export type JournalPersonality = 'coach' | 'sage' | 'psychologist' | 'strategist' | 'robert-greene' | 'huberman';

export interface JournalEntry {
  id: string;
  content: string;            // the user's free-form text
  personality: JournalPersonality; // which persona replied
  response: string;           // the persona's reflection (plain text / markdown)
  createdAt: string;          // ISO timestamp
}

// --- Challenges (v0.5.0) ---
// A persistent, adaptive challenge attached to a habit. Unlike the old static
// 30-day view, challenges are stored, can be customized (duration + daily goal)
// and the daily target is intelligently derived from the habit's recent history.
export interface Challenge {
  id: string;
  habitId: string;          // the habit being challenged
  name: string;             // display label, e.g. "30-day streak: Meditate"
  days: number;             // challenge duration in days (e.g. 14, 21, 30)
  dailyGoal: number;        // completions per day required to "count" (adaptive)
  startDate: string;        // YYYY-MM-DD
  status: 'active' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;     // ISO timestamp when completed
  // True when the dailyGoal was auto-suggested by the adaptive logic rather
  // than chosen manually — shown in the UI so the user knows it was tuned.
  adaptive?: boolean;
}

export interface AppData {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
  chaosDimensions: ChaosDimension[];
  achievementCategories: AchievementCategory[];
  mantras: Mantra[];
  mantraSettings: MantraSettings;
  skills: Skill[];
  capacities: Capacity[];
  capacityRatings: CapacityRating[];
  moods: Record<string, string>; // date YYYY-MM-DD -> mood id
  experiments: Experiment[];
  urges: UrgeEntry[];
  customUrgeTypes: CustomUrgeType[];
  journalEntries: JournalEntry[];
  challenges: Challenge[];
  preferences: UserPreferences;
}

/** User preferences — survives reinstall via the standard backup chain. */
export interface UserPreferences {
  darkMode: boolean;
  theme: string; // CSS class or '' (default)
  // v0.4.0: AI provider selection. `auto` = cloud when an API key is set and
  // reachable, local Ollama otherwise.
  aiProvider?: 'auto' | 'openrouter' | 'ollama';
  aiModel?: string; // e.g. 'openai/gpt-4o-mini' on OpenRouter, '' = default
  aiApiKey?: string; // cloud API key (stored locally, never sent to any server except the chosen provider)
}