export interface WeekCell {
  dateKey: string;
  label: string;
  isToday: boolean;
}

const WEEK_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Monday … Sunday of the ISO week containing `today`. */
export function currentWeekCells(today: Date): WeekCell[] {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dowMondayIndex = (day.getDay() + 6) % 7; // 0 = Monday
  day.setDate(day.getDate() - dowMondayIndex);
  const cells: WeekCell[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i);
    cells.push({
      dateKey: dateKey(d.getFullYear(), d.getMonth(), d.getDate()),
      label: WEEK_LABELS[i],
      isToday:
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate(),
    });
  }
  return cells;
}

/** Number of days in the week whose dateKey is in `doneKeys`. */
export function countWeekDone(cells: WeekCell[], doneKeys: ReadonlySet<string>): number {
  return cells.filter((c) => doneKeys.has(c.dateKey)).length;
}