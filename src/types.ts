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
  // Projects: optional link to a project/task this check-in contributed to,
  // so a habit click becomes evidence of a real deliverable (v0.6.0).
  projectId?: string;
  taskId?: string;
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
  coefficient: number;      // r (Pearson) or rho (Spearman), -1 to 1
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  direction: 'positive' | 'negative';
  sampleSize: number;       // number of data points (pairwise-valid days)
  method: 'pearson' | 'spearman';
  pValue: number;           // two-tailed
  qValue: number;           // Benjamini–Hochberg FDR-adjusted (≤ pValue)
  significant: boolean;     // true when qValue < 0.05
  ciLow: number;            // 95% CI lower bound
  ciHigh: number;           // 95% CI upper bound
  requiredN: number;        // pairs needed to detect this effect at 80% power (∞ = unreliable)
  /** When > 0: X on day t is compared against Y on day t+lag (temporal lead). */
  lag?: number;
  /** When set: the correlation was computed only over weekdays or weekend days. */
  window?: 'weekday' | 'weekend';
  /** Grounding note explaining what a correlation of this shape may or may not mean. */
  caveat?: string;
  /** Unique comparison key used to dedupe same pair across windows. */
  pairKey?: string;
}

/** One cell of the full correlation matrix (heatmap). */
export interface CorrelationCell {
  row: string;              // metric label (row)
  col: string;              // metric label (column)
  coefficient: number | null; // null = not enough paired data
  sampleSize: number;
  significant: boolean;
  qValue: number;
}

/** Full correlation analysis across windows and lags. */
export interface CorrelationAnalysis {
  sameDay: CorrelationResult[];          // contemporaneous, all days
  lag1: CorrelationResult[];             // X(t) → Y(t+1)
  weekday: CorrelationResult[];          // Mon–Fri only
  weekend: CorrelationResult[];          // Sat–Sun only
  matrix: CorrelationCell[];             // heatmap over all metric pairs
  metrics: string[];                     // ordered metric labels (row/col headers)
  caveats: string[];                     // "corrélation ≠ causation" interpretive rules
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
  /** Optional id of the thread this entry belongs to (see JournalThread). */
  threadId?: string;
  /** Optional projects this entry is linked to (Savoir cross-linking). */
  projectIds?: string[];
  /** Optional protocols this entry is linked to (Knowledge base). */
  protocolIds?: string[];
  /** Optional habits this entry references (for AI + interactivity). */
  habitIds?: string[];
  /** True when the response was generated locally (no AI provider available). */
  local?: boolean;
}

/** A persistent discussion thread started from a prompt / question. */
export interface JournalThread {
  id: string;
  /** The question that opened the thread (the first prompt used). */
  question: string;
  /** Optional pattern id when the thread came from a pattern-track question. */
  patternId?: string;
  /** Optional pattern track step when started from a track question. */
  step?: number;
  /** Optional emoji/kind marker (e.g. the source prompt emoji). */
  emoji?: string;
  createdAt: string;
  updatedAt: string;
}

/** Progressive healing state of a single psychoanalysis pattern (persisted). */
export interface PatternTrack {
  patternId: string;
  /** Station of healing, 0..MAX_STEP (see patternProgress.STEPS). */
  step: number;
  /** Total number of distinct days re-written about. */
  seenCount: number;
  /** Local day (YYYY-MM-DD) it was last written about. */
  lastSeen: string;
  createdAt: string;
}

// --- Reflections (v0.5.2) ---
// The self-improvement loop. LifeTrack derives observations from the user's
// own data, poses a sharp open question, and stores the answer. Unless the
// answer is persisted, LifeTrack can't learn; everything here is persisted.
export type ReflectionKind =
  | 'stale-win'         // a past victory is fading
  | 'recurring-leak'    // a habit keeps being missed repeatedly
  | 'neglect'           // a habit is quietly ignored
  | 'pattern-progress'  // a psycho pattern is improving → keep going
  | 'repetition'        // the same temptation keeps repeating
  | 'recovery'          // a stack/dependency dropped and never resumed
  | 'momentum'          // several things moving → find the keystone
  | 'confidence';       // also doubtful: a newly strong habit can be deepened

/** A candidate open question produced by the engine (not yet persisted). */
export interface DetectedReflection {
  kind: ReflectionKind;
  title: string;          // the observation — what the data says
  question: string;       // the penetrating question posed to the user
  context: string;        // data grounding (short, human)
  habitIds: string[];
  /** Stable dedupe handle so the same observation isn't re-asked daily. */
  dedupeKey: string;
}

/** A persisted reflection: the question + the user's answer (the learning). */
export interface ReflectionEntry extends DetectedReflection {
  id: string;
  createdAt: string;
  status: 'open' | 'answered';
  answer?: string;
  /** When set, the question is hidden from the journal until this ISO date. */
  snoozedUntil?: string;
  /** How many distinct days this question has been surfaced (for rotation). */
  timesAsked?: number;
  /** ISO timestamp of the last time this question was surfaced. */
  lastAskedAt?: string;
}

/** One persisted exchange in the psychoanalysis chat (v0.6.4). */
export interface PsychoMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Which theoretical frame answered (e.g. 'cognitive', 'jungian'). */
  frame: string;
  /** Optional pattern id the exchange is working on. */
  patternId?: string;
  createdAt: string;
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

// --- Gamification (v0.5.0) ---
// A "persona" is the person you want to become (e.g. "Early riser", "Calm under
// pressure"). Progress is the average completion rate of the habits linked to
// this persona over the last 14 days — a visual, goal-oriented way to track
// becoming a specific version of yourself.
export interface Persona {
  id: string;
  name: string;
  emoji: string;
  description?: string;   // the version of you this persona represents
  habitIds: string[];     // habits that build this persona
  /** 'habit' = tied to habits (drop if they're deleted); 'reflective' = self-observation, survives with zero habits */
  kind?: 'habit' | 'reflective';
  createdAt: string;
}

// --- Levers (v0.5.0) ---
// "What works for me": a reusable record of an intervention and its observed
// effect (e.g. "Magnesium B2 le matin" → "+10 d'énergie"). Captured so a
// discovery is never forgotten and can be re-applied deliberately — and
// converted into a habit (with a WHY and an optional stack trigger).
export interface Lever {
  id: string;
  content: string;        // the action / intervention
  effect?: string;        // observed result ("+15 d'énergie")
  notes?: string;         // conditions or context
  createdAt: string;
}

// --- Projects (v0.6.0) ---
// A Project is a structured container of work attached to habits. Linking a
// habit (e.g. "coding") to one or many projects turns a generic click count
// into evidence of REAL deliverables — so skills stop being "detected from a
// large database" and become measured by your own outputs.
export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  status: 'active' | 'done' | 'paused' | 'archived';
  deadline?: string;                  // YYYY-MM-DD
  habitIds: string[];                 // linked habits that push this project forward
  tasks: Task[];
  createdAt: string;
}

// --- Knowledge base & automated ingestion (v0.6.0) ---
// The knowledge library: curated behavioral / biohacking / research protocols
// (Huberman Lab, Modern Wisdom / Chris Williamson, PubMed…). Evidence levels
// are honest (RULE 81): an anecdote must never be presented as a fact.
export type EvidenceLevel = 'A' | 'B' | 'C';   // A=causal/peer-reviewed, B=protocol/expert, C=correlational/anecdote
export type ProtocolDomain =
  | 'sleep' | 'focus' | 'energy' | 'mood' | 'training'
  | 'nutrition' | 'stress' | 'social' | 'cognitive';

export interface Protocol {
  id: string;
  title: string;
  source: string;          // "Huberman Lab #42" | "Modern Wisdom #710" | "DOI 10.…"
  host?: string;           // 'Huberman' | 'Chris Williamson' | 'PubMed' | …
  claim: string;           // the actionable claim, in one sentence
  evidenceLevel: EvidenceLevel;
  mechanism?: string;      // dopamine, circadian, microbiota…
  domain: ProtocolDomain;
  protocol: string;        // exact dosage: "3×11 min de froid / semaine"
  metric?: string;         // what to measure: "énergie matinale 1-10"
  habitSuggestions?: string[]; // habit names to create
  keywords: string[];      // used to match the user's notes/habits
  citation?: string;       // verifiable reference
  risky?: boolean;         // mark for caution in UI
}

/** Raw material deposited by the user for automated ingestion. */
export interface IngestedSource {
  id: string;
  title: string;
  rawText: string;
  createdAt: string;
  ingested: boolean;
}

// --- Automated feeds (v0.6.1) ---
// Permanent, self-running ingestion: RSS/Atom feeds are fetched periodically,
// new items are extracted into structured protocols and merged into the local
// library — no pasting, no manual step, ever.
export interface FeedConfig {
  id: string;
  url: string;
  title: string;              // display label
  enabled: boolean;
  createdAt: string;
  lastFetchAt?: string;       // ISO timestamp of the last successful fetch
  lastGuids: string[];        // dedupe: guids already seen (capped)
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
  journalThreads?: JournalThread[];
  challenges: Challenge[];
  personas: Persona[];
  levers: Lever[];
  patternTracks?: PatternTrack[];
  reflections?: ReflectionEntry[];
  /** v0.6.4: persisted psychoanalysis chat — survives navigation (was volatile). */
  psychoHistory?: PsychoMessage[];
  dismissedRecs?: string[];      // recommendation keys the user set aside
  projects?: Project[];
  protocols?: Protocol[];
  ingestedSources?: IngestedSource[];
  feeds?: FeedConfig[];
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
  // v0.5.2: daily "remember the past" system reminder.
  memoryReminderEnabled?: boolean;
  memoryReminderTime?: string; // "HH:MM"
  lastMemoryReminderDate?: string; // YYYY-MM-DD when it was last shown
  // v0.6.0: knowledge pipeline preferences.
  knowledgeAutoSuggest?: boolean;  // auto-surface protocols matched to your data
  stickyMax?: number;              // max protocols pushed at once (anti-overwhelm, default 3)
  ingestAiEnabled?: boolean;       // allow the local AI to structure ingested sources
  // v0.6.1: permanent automated ingestion.
  autoIngestEnabled?: boolean;     // default true — feeds refresh by themselves
  autoIngestIntervalHours?: number; // default 6
  autostartEnabled?: boolean;      // launch LifeTrack at Windows logon
  // v0.7.0: audio feedback
  soundEnabled?: boolean;          // web audio chime feedback on check-in
}