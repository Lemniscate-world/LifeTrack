// src/dates.ts
// Canonical date helpers for the whole app.
//
// Conventions:
//   - "date key" = a local civil date as a "YYYY-MM-DD" string.
//   - All conversions are UTC-naive (local timezone) so a key always matches
//     the calendar the user actually lives in — never UTC.
//   - A malformed key (e.g. "2026-02-30") is never silently normalized.
//
// These helpers used to be copy-pasted in ~20 modules (stats, summary, wins,
// weeklySummary, gamification, evolution, correlations, …). Keep them in this
// single place: import from here, don't redefine a local variant.

/** Format a local Date as a "YYYY-MM-DD" key. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build a "YYYY-MM-DD" key from its parts (1-based month/day). */
export function dateKeyFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse a "YYYY-MM-DD" key as a local Date (no time component). */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "YYYY-MM-DD" key for today (or the provided `now`). */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/** Days between two local Dates (calendar-day arithmetic, not 24h blocks). */
export function daysBetween(a: Date, b: Date): number {
  const ms = 24 * 60 * 60 * 1000;
  const ad = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bd = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bd - ad) / ms);
}

/** Days between two "YYYY-MM-DD" keys (b - a). */
export function daysBetweenKeys(a: string, b: string): number {
  return daysBetween(fromDateKey(a), fromDateKey(b));
}

/** Add `n` calendar days to a local Date. */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Shift a "YYYY-MM-DD" key by ±days, keeping a valid key. */
export function shiftDateKey(key: string, days: number): string {
  const dt = fromDateKey(key);
  dt.setDate(dt.getDate() + days);
  return toDateKey(dt);
}

/** Extract the "YYYY-MM-DD" prefix of an ISO timestamp/key. null when absent. */
export function isoToDateKey(iso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** True when `key` is a well-formed "YYYY-MM-DD" string (range not checked). */
export function isDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/** Weekday number for a "YYYY-MM-DD" key: 0=Sun … 6=Sat. */
export function weekdayOf(key: string): number {
  return fromDateKey(key).getDay();
}

/** Shift a "YYYY-MM-DD" key forward/backward `back` days from `base`. */
export function daysAgoKey(back: number, base: Date = new Date()): string {
  return shiftDateKey(toDateKey(base), -back);
}
