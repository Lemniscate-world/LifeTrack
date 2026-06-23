import type { AppData, Habit, CheckIn, Note } from './types';

const STORAGE_KEY = 'lifetrack-data';

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

function loadData(): AppData {
  if (!isLocalStorageAvailable()) {
    return { habits: [], checkIns: [], notes: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load data', e);
  }
  return { habits: [], checkIns: [], notes: [] };
}

function saveData(data: AppData): void {
  if (!isLocalStorageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save data', e);
  }
}

let data: AppData = loadData();
const listeners = new Set<() => void>();

// Reset in-memory state and re-read from storage.
// Exported for test isolation; not needed in production.
export function resetStore(): void {
  data = loadData();
}

function notify() {
  saveData(data);
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
    existing.completed = !existing.completed;
    notify();
    return existing;
  }
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