export interface Habit {
  id: string;
  name: string;
  color: string; // pastel color for checked cells
  goal: number;
  createdAt: string;
  archived: boolean;
  order: number;
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

export interface AppData {
  habits: Habit[];
  checkIns: CheckIn[];
  notes: Note[];
}