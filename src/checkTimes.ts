// src/checkTimes.ts
// "Quand tu logs" — when do the check-ins actually happen?
//
// Since v0.6.2 every check-in records a `checkedAt` ISO timestamp. Over weeks
// and months that single number reveals real long-term information:
//   - your daily logging rhythm (morning person vs evening logger),
//   - which habits have a rock-solid ritual (stable hour) vs random timing,
//   - the best moment of the day to nudge you (future use).
//
// Everything is derived from data, never stored. Old check-ins without a
// timestamp are simply excluded (no guessing).

import type { CheckIn, Habit } from './types';

export type LogSlot = 'nuit' | 'matin' | 'midi' | 'après-midi' | 'soir';

export interface SlotInfo {
  slot: LogSlot;
  label: string;
  emoji: string;
}

const SLOTS: SlotInfo[] = [
  { slot: 'nuit', label: 'nuit', emoji: '🌙' },
  { slot: 'matin', label: 'matin', emoji: '🌅' },
  { slot: 'midi', label: 'midi', emoji: '☀️' },
  { slot: 'après-midi', label: 'après-midi', emoji: '🌤️' },
  { slot: 'soir', label: 'soir', emoji: '🌆' },
];

/** Hour of the day (0-23) a check-in was recorded, or null when unknown. */
export function hourOfCheckIn(ci: CheckIn): number | null {
  if (!ci.checkedAt) return null;
  const d = new Date(ci.checkedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

/** Coarse time-of-day slot for an hour. */
export function slotOfHour(hour: number): LogSlot {
  if (hour < 5) return 'nuit';
  if (hour < 12) return 'matin';
  if (hour < 15) return 'midi';
  if (hour < 18) return 'après-midi';
  return 'soir';
}

export function slotInfo(slot: LogSlot): SlotInfo {
  return SLOTS.find((s) => s.slot === slot) ?? SLOTS[0];
}

export interface HourEntry {
  hour: number;
  count: number;
}

/** Completed check-ins grouped by hour of day (only those with a timestamp). */
export function loggedHours(
  checkIns: CheckIn[],
  horizonDays = 90,
  now: Date = new Date(),
): HourEntry[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (horizonDays - 1));
  cutoff.setHours(0, 0, 0, 0);

  const counts = new Array(24).fill(0) as number[];
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    const hour = hourOfCheckIn(ci);
    if (hour === null) continue;
    if (new Date(ci.checkedAt!) < cutoff) continue;
    counts[hour]++;
  }
  return counts
    .map((count, hour) => ({ hour, count }))
    .filter((e) => e.count > 0);
}

export interface PreferredSlot {
  slot: LogSlot;
  label: string;
  emoji: string;
  count: number;
  pct: number;
}

/** The time-of-day slot where the user logs the most (needs ≥1 timestamped check-in). */
export function preferredLogSlot(
  checkIns: CheckIn[],
  horizonDays = 90,
  now: Date = new Date(),
): PreferredSlot | null {
  const hours = loggedHours(checkIns, horizonDays, now);
  const total = hours.reduce((s, e) => s + e.count, 0);
  if (total === 0) return null;

  const perSlot = new Map<LogSlot, number>();
  for (const e of hours) {
    const slot = slotOfHour(e.hour);
    perSlot.set(slot, (perSlot.get(slot) ?? 0) + e.count);
  }
  let best: LogSlot | null = null;
  let bestCount = 0;
  for (const [slot, count] of perSlot) {
    if (count > bestCount) {
      bestCount = count;
      best = slot;
    }
  }
  if (!best) return null;
  const info = slotInfo(best);
  return {
    slot: best,
    label: info.label,
    emoji: info.emoji,
    count: bestCount,
    pct: Math.round((bestCount / total) * 100),
  };
}

export interface HabitLogPattern {
  habitId: string;
  name: string;
  n: number;
  modalHour: number | null;
  modalSlot: LogSlot | null;
  /** 0..1 — how stable the logging hour is (1 = always the same hour). */
  stability: number;
}

/** Per-habit logging pattern (modal hour + hour stability), most-logged first. */
export function habitLogPatterns(habits: Habit[], checkIns: CheckIn[]): HabitLogPattern[] {
  const byHabit = new Map<string, number[]>();
  for (const ci of checkIns) {
    if (!ci.completed) continue;
    const h = hourOfCheckIn(ci);
    if (h === null) continue;
    const arr = byHabit.get(ci.habitId) ?? [];
    arr.push(h);
    byHabit.set(ci.habitId, arr);
  }

  const out: HabitLogPattern[] = [];
  for (const habit of habits) {
    const hours = byHabit.get(habit.id);
    if (!hours || hours.length === 0) continue;
    const counts = new Array(24).fill(0) as number[];
    for (const hour of hours) counts[hour]++;
    let modal = 0;
    for (let i = 1; i < 24; i++) if (counts[i] > counts[modal]) modal = i;

    const mean = hours.reduce((s, v) => s + v, 0) / hours.length;
    const variance = hours.reduce((s, v) => s + (v - mean) ** 2, 0) / hours.length;
    const sd = Math.sqrt(variance);
    const stability = Math.max(0, Math.min(1, 1 - sd / 12));

    out.push({
      habitId: habit.id,
      name: habit.name,
      n: hours.length,
      modalHour: modal,
      modalSlot: slotOfHour(modal),
      stability: Math.round(stability * 100) / 100,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Short French insights about the user's logging rhythm (empty when no data yet). */
export function logTimeInsights(
  habits: Habit[],
  checkIns: CheckIn[],
  horizonDays = 90,
  now: Date = new Date(),
): string[] {
  const out: string[] = [];
  const pref = preferredLogSlot(checkIns, horizonDays, now);
  if (pref && pref.count >= 5) {
    out.push(`${pref.emoji} Tu logs surtout le ${pref.label} (${pref.pct} % de tes check-ins sur ${horizonDays} jours).`);
  }
  const patterns = habitLogPatterns(habits, checkIns);
  const stable = patterns
    .filter((p) => p.n >= 5)
    .sort((a, b) => b.stability - a.stability)[0];
  if (stable && stable.modalHour !== null && stable.modalSlot) {
    const info = slotInfo(stable.modalSlot);
    const hourLabel = String(stable.modalHour).padStart(2, '0');
    out.push(`🕐 « ${stable.name} » est loggé à heure quasi constante (${info.emoji} ${info.label}, vers ${hourLabel}h) — rituel bien ancré.`);
  }
  return out;
}
