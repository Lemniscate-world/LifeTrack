export interface Habit {
  id: string;
  name: string;
  color: string; // pastel color for checked cells
  goal: number;
  createdAt: string;
  archived: boolean;
  order: number;
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
}

export interface CheckIn {
  date: string; // YYYY-MM-DD
  habitId: string;
  completed: boolean;
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

export interface AppData {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
  chaosDimensions: ChaosDimension[];
}