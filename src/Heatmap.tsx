// src/Heatmap.tsx
// GitHub-style 365-day heatmap for a single habit. Pure SVG, no dependencies.
// Each cell is one day; intensity scales with completion (full vs partial).
//
// API:
//   <Heatmap habit={h} checkIns={allCheckIns} />
//
// Visual:
//   - 53 weeks × 7 days grid (365 days, plus a trailing partial week)
//   - Past 365 days, ending at today
//   - Past days outside the habit's tracking start are rendered as "absent"
//     (very pale background) so the user knows we have no data, not "missed"
//   - Today is highlighted with a ring
//
// The component is intentionally data-only — no click handler. The parent
// decides how to wire interactions.

import { useMemo } from 'react';
import type { Habit, CheckIn } from './types';
import { toDateKey, addDays, trackingStart } from './stats';

const CELL_SIZE = 11;     // px
const CELL_GAP = 2;       // px
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  habit: Habit;
  checkIns: CheckIn[];
  /** Reference "today". Defaults to new Date(). Useful for tests. */
  today?: Date;
  /** Override the base cell color (defaults to habit.color). */
  color?: string;
}

/**
 * Lighten a hex color toward white by `amount` (0..1).
 * Returns a CSS rgb() string.
 */
function lighten(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function Heatmap({ habit, checkIns, today = new Date(), color }: Props) {
  const { grid, monthLabels, weekCount } = useMemo(() => {
    const baseColor = color || habit.color || '#22c55e';
    // Map of date key → completion (true = completed, false = explicit miss).
    // Days with no entry are "untracked" (rendered as a very pale background).
    const cm = new Map<string, boolean>();
    for (const c of checkIns) {
      if (c.habitId === habit.id) cm.set(c.date, c.completed);
    }

    const start = trackingStart(habit, checkIns);
    const days = 365;
    const endDay = today; // last column = today
    const firstDay = addDays(endDay, -(days - 1));
    // Align grid columns by Sunday so weeks look consistent.
    const firstDow = firstDay.getDay(); // 0 = Sunday

    const totalDays = days + firstDow;
    const cols = Math.ceil(totalDays / 7);

    const cells: { key: string; fill: string; opacity: number; isToday: boolean; isFuture: boolean; isUntracked: boolean; col: number; row: number }[] = [];
    const monthLabelPositions: { col: number; label: string }[] = [];
    let lastMonth = -1;

    for (let i = 0; i < days; i++) {
      const d = addDays(firstDay, i);
      const key = toDateKey(d);
      const isFuture = d > today;
      const isToday = key === toDateKey(today);
      const dow = d.getDay();
      const col = Math.floor((i + firstDow) / 7);
      const row = dow;
      const v = cm.get(key);
      const isUntracked = (start && d < start) || (v === undefined && !isFuture && !isToday);

      let fill: string;
      let opacity: number;
      if (isFuture) {
        fill = 'transparent';
        opacity = 0;
      } else if (isUntracked) {
        // outside tracking window: very pale neutral
        fill = 'rgba(120,120,120,0.10)';
        opacity = 1;
      } else if (v === true) {
        fill = baseColor;
        opacity = 1;
      } else {
        // explicit miss (v === false) — outline only
        fill = 'transparent';
        opacity = 1;
      }
      cells.push({ key, fill, opacity, isToday, isFuture, isUntracked, col, row });

      // Track month transitions for the header label
      if (d.getDate() <= 7 && d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth();
        monthLabelPositions.push({ col, label: MONTH_LABELS[d.getMonth()] });
      }
    }

    return { grid: cells, monthLabels: monthLabelPositions, weekCount: cols };
  }, [habit, checkIns, today, color]);

  const totalWidth = weekCount * (CELL_SIZE + CELL_GAP);
  const totalHeight = 7 * (CELL_SIZE + CELL_GAP) + 18; // +18 for month header
  const cellPixel = CELL_SIZE + CELL_GAP;

  return (
    <div className="heatmap-wrapper">
      <svg
        className="heatmap-svg"
        width={totalWidth + 28} // +28 for day-of-week labels
        height={totalHeight}
        role="img"
        aria-label={`365-day heatmap for ${habit.name}`}
      >
        {/* Month labels along the top */}
        <g transform="translate(28, 10)">
          {monthLabels.map((m, i) => (
            <text
              key={i}
              x={m.col * cellPixel}
              y={0}
              className="heatmap-month-label"
            >
              {m.label}
            </text>
          ))}
        </g>

        {/* Day-of-week labels (Mon / Wed / Fri) */}
        <g transform="translate(0, 22)">
          {DAY_LABELS.map((label, i) =>
            label ? (
              <text
                key={i}
                x={0}
                y={i * cellPixel + CELL_SIZE - 1}
                className="heatmap-dow-label"
              >
                {label}
              </text>
            ) : null,
          )}
        </g>

        {/* Cells */}
        <g transform="translate(28, 22)">
          {grid.map((c) => {
            if (c.isFuture) return null;
            return (
              <rect
                key={c.key}
                x={c.col * cellPixel}
                y={c.row * cellPixel}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                ry={2}
                fill={c.fill}
                opacity={c.opacity}
                stroke={c.isToday ? 'var(--primary)' : c.fill === 'transparent' ? 'rgba(120,120,120,0.25)' : 'none'}
                strokeWidth={c.isToday ? 1.5 : c.fill === 'transparent' ? 1 : 0}
                className={`heatmap-cell ${c.isUntracked ? 'untracked' : ''} ${c.isToday ? 'today' : ''}`}
              >
                <title>{`${c.key}${c.isUntracked ? ' (before tracking start)' : ''}`}</title>
              </rect>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/**
 * Tiny line chart of a habit's completion rate over the last N days.
 * Pure SVG, no axes labels — this is a sparkline, not a chart.
 */
interface SparklineProps {
  habit: Habit;
  checkIns: CheckIn[];
  days?: number;
  today?: Date;
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({
  habit,
  checkIns,
  days = 30,
  today = new Date(),
  color,
  width = 120,
  height = 28,
}: SparklineProps) {
  const points = useMemo(() => {
    const cm = new Map<string, boolean>();
    for (const c of checkIns) {
      if (c.habitId === habit.id) cm.set(c.date, c.completed);
    }
    const out: { x: number; y: number; pct: number }[] = [];
    // Compute rolling 7-day completion rate ending at each day
    for (let i = days - 1; i >= 0; i--) {
      const end = addDays(today, -i);
      let done = 0;
      let possible = 0;
      for (let j = 6; j >= 0; j--) {
        const d = addDays(end, -j);
        if (d > today) continue;
        possible++;
        if (cm.get(toDateKey(d)) === true) done++;
      }
      const pct = possible > 0 ? done / possible : 0;
      const x = ((days - 1 - i) / Math.max(1, days - 1)) * width;
      const y = height - pct * height;
      out.push({ x, y, pct });
    }
    return out;
  }, [habit, checkIns, days, today, width, height]);

  const baseColor = color || habit.color || '#22c55e';
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      className="sparkline-svg"
      width={width}
      height={height}
      role="img"
      aria-label={`${days}-day rolling completion sparkline for ${habit.name}`}
    >
      <path d={fillPath} fill={lighten(baseColor, 0.7)} opacity={0.5} />
      <path d={path} stroke={baseColor} strokeWidth={1.5} fill="none" />
    </svg>
  );
}