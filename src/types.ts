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
  note?: string; // optional note for this check-in
  count?: number; // number of completions today (1 by default, up to goal)
}

export interface Note {
  id: string;
  habitId: string;
  content: string;
  createdAt: string;
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

export interface AppData {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
  chaosDimensions: ChaosDimension[];
  mantras: Mantra[];
  mantraSettings: MantraSettings;
  skills: Skill[];
  capacities: Capacity[];
  capacityRatings: CapacityRating[];
}