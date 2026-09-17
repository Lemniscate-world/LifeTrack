/**
 * Lightweight SVG charts (no dependencies): weekly bars + 30-day completion
 * curve. Pure math (unit-tested) + thin presentational components that inherit
 * CSS variables, so every theme — including the new `theme-graph` — styles
 * them without code changes.
 */
import type { Habit, CheckIn } from './types';
import { toDateKey } from './dates';

export interface DayPoint {
  /** YYYY-MM-DD (local civil date). */
  date: string;
  /** Short weekday label (lun. … dim.). */
  dayLabel: string;
  /** Distinct active habits completed that day. */
  done: number;
  /** Active habits tracked that day (denominator). */
  total: number;
  /** 0..1 completion rate (0 when total is 0 — honest gap, not zero). */
  rate: number;
  hasData: boolean;
}

const DAY_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/**
 * Trailing `days` calendar days ending today (inclusive). A day counts as
 * tracked when at least one active habit existed; completion = distinct
 * completed habits / active habits.
 */
export function daySeries(habits: Habit[], checkIns: CheckIn[], now: Date, days: number): DayPoint[] {
  const active = habits.filter((h) => !h.archived);
  const activeIds = new Set(active.map((h) => h.id));
  const doneByDate = new Map<string, Set<string>>();
  for (const c of checkIns) {
    if (!c.completed || !activeIds.has(c.habitId)) continue;
    let s = doneByDate.get(c.date);
    if (!s) {
      s = new Set();
      doneByDate.set(c.date, s);
    }
    s.add(c.habitId);
  }
  const out: DayPoint[] = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const date = toDateKey(d);
    const done = doneByDate.get(date)?.size ?? 0;
    const total = active.length;
    out.push({
      date,
      dayLabel: DAY_SHORT[d.getDay()]!,
      done,
      total,
      rate: total > 0 ? done / total : 0,
      hasData: total > 0,
    });
  }
  return out;
}

/** Last 7 days (inclusive today) as bar-chart data. */
export function weekSeries(habits: Habit[], checkIns: CheckIn[], now: Date): DayPoint[] {
  return daySeries(habits, checkIns, now, 7);
}

/** Last 30 days (inclusive today) as curve data. */
export function monthSeries(habits: Habit[], checkIns: CheckIn[], now: Date): DayPoint[] {
  return daySeries(habits, checkIns, now, 30);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Weekly bars: one rounded bar per day, today ringed. */
export function WeekBars({ days, height = 96 }: { days: DayPoint[]; height?: number }) {
  const W = 280;
  const H = height;
  const padBottom = 18;
  const padTop = 8;
  const n = Math.max(1, days.length);
  const slot = W / n;
  const barW = Math.min(26, slot * 0.55);
  const maxH = H - padBottom - padTop;
  const todayKey = days.length > 0 ? days[days.length - 1]!.date : '';
  return (
    <svg
      className="chart week-bars"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Barres de complétion des 7 derniers jours"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {days.map((d, i) => {
        const h = Math.max(3, clamp01(d.rate) * maxH);
        const x = slot * i + (slot - barW) / 2;
        const y = padTop + (maxH - h);
        const isToday = d.date === todayKey;
        return (
          <g key={d.date}>
            <title>{`${d.date} · ${d.done}/${d.total} (${Math.round(d.rate * 100)}%)`}</title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={Math.min(5, barW / 2)}
              className={`chart-bar${isToday ? ' is-today' : ''}${d.rate >= 1 ? ' is-full' : ''}`}
            />
            <text x={slot * i + slot / 2} y={H - 5} textAnchor="middle" className="chart-tick">
              {d.dayLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 30-day completion curve: soft area + line + gridlines + today dot. */
export function MonthCurve({ days, height = 110 }: { days: DayPoint[]; height?: number }) {
  const W = 300;
  const H = height;
  const padL = 26;
  const padR = 6;
  const padT = 8;
  const padB = 16;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const n = days.length;
  const x = (i: number): number => (n <= 1 ? padL : padL + (i / (n - 1)) * iw);
  const y = (r: number): number => padT + (1 - clamp01(r)) * ih;
  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.rate).toFixed(1)}`).join(' ');
  const area = n > 0
    ? `${line} L${x(n - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z`
    : '';
  const last = days[n - 1];
  return (
    <svg
      className="chart month-curve"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Courbe de complétion des 30 derniers jours"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="chart-grid" />
      ))}
      <text x={2} y={y(0.5) + 3} className="chart-tick">50%</text>
      {area && <path d={area} className="chart-area" />}
      {line && <path d={line} className="chart-line" fill="none" />}
      {last && (
        <g>
          <title>{`${last.date} · ${Math.round(last.rate * 100)}%`}</title>
          <circle cx={x(n - 1)} cy={y(last.rate)} r={3.5} className="chart-dot" />
        </g>
      )}
      {n > 0 && (
        <text x={x(0)} y={H - 3} className="chart-tick">
          {days[0]!.date.slice(5)}
        </text>
      )}
      {n > 0 && (
        <text x={x(n - 1)} y={H - 3} textAnchor="end" className="chart-tick">
          {days[n - 1]!.date.slice(5)}
        </text>
      )}
    </svg>
  );
}
