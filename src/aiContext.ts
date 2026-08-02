/**
 * AI Context Builder — aggregates ALL LifeTrack data into a structured,
 * analysis-friendly report sent to the local AI (Ollama).
 *
 * Privacy: everything stays on-device. Only statistical summaries + the
 * user's own notes are assembled; nothing is uploaded to any cloud.
 *
 * The report covers every data domain the app tracks so the AI can:
 *   - spot habit/mood/capacity correlations,
 *   - read every note the user ever wrote,
 *   - analyze urges, experiments, chaos pressure and skill progress,
 *   - give personalized life recommendations.
 */

import type { AppData, Habit, CheckIn, CapacityRating, Experiment, UrgeEntry } from './types';
import { computeChaosReport, getAchievementCategories, MOODS } from './store';
import { computeCorrelations } from './correlations';

const MOOD_LABEL: Record<string, string> = Object.fromEntries(MOODS.map((m) => [m.id, m.label]));

interface HabitSummary {
  h: Habit;
  total: number;
  completed: number;
  rate: number;
  currentStreak: number;
  lastCheckIn?: string;
  notes: string[]; // all notes, oldest first
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtRate(completed: number, total: number): string {
  return total > 0 ? `${Math.round((completed / total) * 100)}%` : '—';
}

function buildHabitSummaries(data: AppData): HabitSummary[] {
  const allCheckIns = Array.isArray(data.checkIns) ? data.checkIns : [];
  const allHabits = Array.isArray(data.habits) ? data.habits : [];
  const byHabit = new Map<string, CheckIn[]>();
  for (const ci of allCheckIns) {
    if (!ci || typeof ci !== 'object' || typeof ci.habitId !== 'string') continue;
    if (!byHabit.has(ci.habitId)) byHabit.set(ci.habitId, []);
    byHabit.get(ci.habitId)!.push(ci);
  }

  return allHabits
    .filter((h) => !h.archived)
    .map((h) => {
      const checkIns = byHabit.get(h.id) ?? [];
      const completed = checkIns.filter((c) => c.completed).length;
      const total = checkIns.length;
      const notes: string[] = [];
      for (const ci of checkIns) {
        for (const n of ci.notes ?? []) if (n && n.trim()) notes.push(n.trim());
        const legacy = (ci as unknown as Record<string, unknown>).note;
        if (typeof legacy === 'string' && legacy.trim()) notes.push(legacy.trim());
      }
      const dates = checkIns.filter((c) => c.completed).map((c) => c.date).sort();
      let currentStreak = 0;
      if (dates.length > 0) {
        const last = dates[dates.length - 1];
        if (last >= todayStr()) {
          const set = new Set(dates);
          let d = new Date();
          while (set.has(d.toISOString().slice(0, 10))) {
            currentStreak++;
            d.setDate(d.getDate() - 1);
          }
        }
      }
      return {
        h,
        total,
        completed,
        rate: total > 0 ? (completed / total) * 100 : 0,
        currentStreak,
        lastCheckIn: dates[dates.length - 1],
        notes,
      };
    })
    .sort((a, b) => b.completed - a.completed);
}

function summarizeMoods(data: AppData): string {
  const moods = data.moods && typeof data.moods === 'object' ? data.moods : {};
  const entries = Object.entries(moods).sort();
  if (entries.length === 0) return '  (no moods logged)';
  const counts: Record<string, number> = {};
  for (const [, moodId] of entries) counts[moodId] = (counts[moodId] ?? 0) + 1;
  const top = Object.entries(counts)
    .map(([id, c]) => `${MOOD_LABEL[id] ?? id}: ${c}`)
    .join(', ');
  const last = entries.slice(-14)
    .map(([date, id]) => `${date}=${MOOD_LABEL[id] ?? id}`)
    .join(', ');
  return `  total moods: ${entries.length} (${top})\n  last 14 days: ${last}`;
}

function summarizeSkills(data: AppData): string {
  if (!data.skills || data.skills.length === 0) return '  (no skills)';
  const lines: string[] = [];
  for (const s of data.skills) {
    const xp = (s.links ?? []).reduce((acc, l) => acc + l.xpPerCompletion, 0);
    const caps = (data.capacities ?? []).filter((c) => c.skillId === s.id);
    let capLine = '';
    if (caps.length > 0) {
      capLine = caps.map((c) => {
        const ratings = (data.capacityRatings ?? []).filter((r) => r.capacityId === c.id).sort((a, b) => a.date.localeCompare(b.date));
        const latest = ratings[ratings.length - 1];
        const trend = ratings.length >= 2
          ? (latest && latest.rating !== undefined ? ` → last ${latest.rating}/${c.target}` : '')
          : '';
        return `${c.name} (base ${c.baseline}, target ${c.target}${trend})`;
      }).join('; ');
    }
    lines.push(`  ${s.emoji} ${s.name} — XP/habit ${xp}${capLine ? ' | capacities: ' + capLine : ''}`);
  }
  return lines.join('\n');
}

function summarizeExperiments(data: AppData): string {
  const exps = (data.experiments ?? []).filter((e) => e.status !== 'cancelled');
  if (exps.length === 0) return '  (no experiments)';
  return exps.map((e: Experiment) => {
    const habits = e.linkedHabits.map((id) => data.habits.find((h) => h.id === id)?.name ?? '?').join(', ');
    return `  ${e.status === 'active' ? '▶' : '✓'} ${e.title}: ${e.hypothesis}${habits ? ` (habits: ${habits})` : ''}${e.conclusion ? ` → conclusion: ${e.conclusion}` : ''}`;
  }).join('\n');
}

function summarizeUrges(data: AppData): string {
  const urges = data.urges ?? [];
  if (urges.length === 0) return '  (no urges logged)';
  const surfed = urges.filter((u) => u.outcome === 'surfed').length;
  const gaveIn = urges.filter((u) => u.outcome === 'gave_in').length;
  const byType: Record<string, number> = {};
  for (const u of urges) byType[u.type] = (byType[u.type] ?? 0) + 1;
  const typeLine = Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ');
  const recent = urges.slice(-10).map((u: UrgeEntry) => {
    const trig = u.trigger ? ` trig:${u.trigger}` : '';
    return `${u.intensity}/10 ${u.outcome}${trig}`;
  }).join(' | ');
  return `  total: ${urges.length} — surfed ${surfed}, gave in ${gaveIn}${typeLine ? ` | types: ${typeLine}` : ''}\n  recent: ${recent}`;
}

function summarizeCapacityTrends(data: AppData): string {
  const ratings = (data.capacityRatings ?? []) as CapacityRating[];
  if (ratings.length === 0) return '  (no capacity ratings)';
  const byCap = new Map<string, CapacityRating[]>();
  for (const r of ratings) {
    if (!byCap.has(r.capacityId)) byCap.set(r.capacityId, []);
    byCap.get(r.capacityId)!.push(r);
  }
  const lines: string[] = [];
  for (const [capId, list] of byCap) {
    const cap = (data.capacities ?? []).find((c) => c.id === capId);
    const label = cap ? `${cap.name} (target ${cap.target})` : capId;
    const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
    const series = sorted.map((r) => `${r.date}:${r.rating ?? 'note'}${r.note ? ` (${r.note})` : ''}`).join(' → ');
    lines.push(`  ${label}: ${series}`);
  }
  return lines.join('\n');
}

function summarizeChaos(): string {
  try {
    const report = computeChaosReport();
    const dims = report.dimensions
      .map((d) => `${d.name}: ${d.pct}%${d.habits.length > 0 ? ` (${d.habits.filter((h) => h.triggered).length}/${d.habits.length} habits in chaos)` : ''}`)
      .join(', ');
    return `  overall ${report.overallPct}% | ${dims}`;
  } catch {
    return '  (unavailable)';
  }
}

function summarizeMantras(data: AppData): string {
  const userMantras = (data.mantras ?? []).filter((m) => !m.isDefault);
  if (userMantras.length === 0) return '  (no custom mantras)';
  return userMantras.map((m) => `  “${m.text}”`).join('\n');
}

function summarizeAchievements(data: AppData): string {
  const tagged = (data.notes ?? []).filter((n) => n.achievementCategory);
  if (tagged.length === 0) return '  (no achievements yet)';
  const byCat = new Map<string, string[]>();
  for (const n of tagged) {
    const key = n.achievementCategory ?? 'other';
    const list = byCat.get(key) ?? [];
    list.push(`[${n.createdAt.slice(0, 10)}] ${n.content}`);
    byCat.set(key, list);
  }
  const catName = (id: string) => getAchievementCategories().find((c) => c.id === id)?.name ?? id;
  const lines: string[] = [];
  for (const [catId, list] of byCat) {
    lines.push(`  ${catName(catId)} (${list.length}): ${list.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Build the complete AI report from a snapshot of the entire app data.
 * Resilient to corrupt inputs: any malformed section falls back gracefully.
 */
export function buildAiContext(data: AppData): string {
  const sections: string[] = [];

  const habits = buildHabitSummaries(data);
  const habitLines = habits.map((s) => {
    const h = s.h;
    const cat = h.category ? ` cat:${h.category}` : '';
    const goal = h.goal > 1 ? ` goal:${h.goal}x/day` : '';
    const best = h.bestStreak ? ` best:${h.bestStreak}d` : '';
    const gap = h.longestGap ? ` gap:${h.longestGap}d` : '';
    const chaos = h.chaosDimension ? ` chaos:${h.chaosDimension}+${h.chaosImpact}% (if missed ${h.chaosThresholdDays}d)` : '';
    const stack = h.stackParent
      ? ` stack: after ${data.habits.find((p) => p.id === h.stackParent)?.name ?? '?'}${h.stackWhen ? ` (${h.stackWhen})` : ''}`
      : '';
    const why = h.why && h.why.length > 0 ? ` why: ${h.why.join('; ')}` : '';
    const last = s.lastCheckIn ? ` last:${s.lastCheckIn}` : ' never';
    const streak = s.currentStreak > 0 ? ` current:${s.currentStreak}d` : '';

    let line = `- ${h.name}${cat}${goal}: ${s.completed}/${s.total} done (${fmtRate(s.completed, s.total)})${streak}${best}${gap}${last}${chaos}${stack}${why}`;
    if (s.notes.length > 0) {
      line += `\n    notes: ${s.notes.join(' | ')}`;
    }
    return line;
  });

  sections.push(`## HABITS (${habits.length} active)\n${habitLines.join('\n')}`);

  sections.push(`## MOODS\n${summarizeMoods(data)}`);

  const correlations = (() => {
    try {
      const caps = (data.capacities ?? []).map((c) => ({ id: c.id, name: c.name }));
      return computeCorrelations(data.habits, data.checkIns, data.moods ?? {}, caps, data.capacityRatings ?? []);
    } catch { return []; }
  })();
  if (correlations.length > 0) {
    sections.push(`## CORRELATIONS (computed on-device)\n${correlations.slice(0, 10).map((c) => `  ${c.metricA} ↔ ${c.metricB}: r=${c.coefficient.toFixed(2)} (${c.direction}, ${c.strength}, n=${c.sampleSize})`).join('\n')}`);
  } else {
    sections.push('## CORRELATIONS\n  (not enough data yet)');
  }

  sections.push(`## SKILLS & CAPACITIES\n${summarizeSkills(data)}`);
  sections.push(`## CAPACITY TRENDS\n${summarizeCapacityTrends(data)}`);
  sections.push(`## EXPERIMENTS\n${summarizeExperiments(data)}`);
  sections.push(`## URGES (urge surfing)\n${summarizeUrges(data)}`);
  sections.push(`## CHAOS PRESSURE\n${summarizeChaos()}`);
  sections.push(`## CUSTOM MANTRAS (user values)\n${summarizeMantras(data)}`);
  sections.push(`## ACHIEVEMENTS (tagged notes by category)\n${summarizeAchievements(data)}`);

  const standaloneNotes = (data.notes ?? []).map((n) => {
    const tag = n.achievementCategory ? ` (achievement:${n.achievementCategory})` : '';
    return `  [${n.createdAt.slice(0, 10)}] ${n.content}${tag}`;
  }).join('\n');
  sections.push(`## ALL STANDALONE NOTES\n${standaloneNotes || '  (none)'}`);

  const totalCheckIns = Array.isArray(data.checkIns) ? data.checkIns.length : 0;
  const allCheckIns = Array.isArray(data.checkIns) ? data.checkIns : [];
  const completedCheckIns = allCheckIns.filter((c) => c.completed).length;
  const withNotes = allCheckIns.filter((c) => c.notes?.length).length;
  sections.push(`## OVERVIEW\n  ${data.habits.length} habits (${habits.length} active), ${totalCheckIns} check-ins (${completedCheckIns} completed), ${(data.notes ?? []).length} standalone notes, ${withNotes} check-ins with notes.`);

  return sections.join('\n\n');
}
