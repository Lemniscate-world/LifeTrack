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
import { computeHabitTrends, moodTrend, WEEKDAY_LABELS } from './timeseries';
import { computeUrgeInsights } from './urgeInsights';
import { validateLevers, detectRelapses } from './leverInsights';

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

function summarizeJournalMemory(data: AppData): string {
  const entries = Array.isArray(data.journalEntries) ? data.journalEntries : [];
  if (entries.length === 0) return '  (no journal entries yet)';
  const recent = [...entries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
  const lines = recent.map((e) => {
    const date = e.createdAt.slice(0, 10);
    const content = e.content.length > 160 ? e.content.slice(0, 160) + '…' : e.content;
    const resp = e.response && e.response.length > 120 ? e.response.slice(0, 120) + '…' : (e.response ?? '');
    return `  [${date}] (${e.personality}) ${content}${resp ? `\n      → ${resp.replace(/\s+/g, ' ')}` : ''}`;
  });
  return `  ${entries.length} total entries; last ${recent.length}:\n${lines.join('\n')}`;
}

function summarizeJournalLearnings(data: AppData): string {
  const reflections = (data.reflections ?? []).filter((r) => r.status === 'answered' && r.answer);
  if (reflections.length === 0) return '  (no answered reflections yet)';
  return reflections
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 15)
    .map((r) => `  - ${r.title}: ${(r.answer ?? '').slice(0, 160)}`)
    .join('\n');
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

function summarizeTrends(data: AppData): string {
  const trends = computeHabitTrends(data.habits, data.checkIns);
  const mood = moodTrend(data.moods ?? {});
  const shown = trends.filter((t) => t.trend || t.weekday || t.changepoint);
  if (shown.length === 0 && !mood) {
    return '  (need ≥10 logged days per habit to estimate trends)';
  }
  const lines: string[] = [];
  for (const t of shown) {
    let line = `  ${t.name} (${t.days} days logged, ${t.from} → ${t.to})`;
    if (t.trend) {
      const arrow = t.trend.direction === 'up' ? '▲' : t.trend.direction === 'down' ? '▼' : '→';
      line += `: ${arrow} ${t.trend.direction} (tau=${t.trend.tau.toFixed(2)}, slope=${(t.trend.slope >= 0 ? '+' : '') + t.trend.slope.toFixed(3)}/day, p=${t.trend.p.toFixed(3)}${t.trend.significant ? ' ✓ significant' : ' n.s.'})`;
    } else {
      line += ': no trend estimate yet';
    }
    if (t.changepoint && t.changepoint.significant) {
      line += ` | changepoint ~${t.changepointAt ?? '?'} (${t.changepoint.direction === 'up' ? '+' : ''}${Math.round(t.changepoint.delta * 100)}% rate shift, p=${t.changepoint.p.toFixed(3)})`;
    }
    if (t.weekday && t.weekday.significant) {
      line += ` | best day ${WEEKDAY_LABELS[t.weekday.best]} ${Math.round(t.weekday.rates[t.weekday.best])}% (chi2 p=${t.weekday.p.toFixed(3)})`;
    }
    if (t.volatility) line += ` | σ=${t.volatility.stdDev.toFixed(2)}`;
    lines.push(line);
  }
  if (mood) {
    const arrow = mood.direction === 'up' ? '▲' : mood.direction === 'down' ? '▼' : '→';
    lines.push(`  MOOD: ${arrow} ${mood.direction} (tau=${mood.tau.toFixed(2)}, slope=${(mood.slope >= 0 ? '+' : '') + mood.slope.toFixed(3)}/day, p=${mood.p.toFixed(3)}${mood.significant ? ' ✓ significant' : ' n.s.'})`);
  }
  return lines.join('\n');
}

function summarizeUrgeInsights(data: AppData): string {
  try {
    const s = computeUrgeInsights(data.urges ?? [], data.moods ?? {}, data.habits, data.checkIns);
    const lines: string[] = [];
    if (s.survival && s.survival.n > 0) {
      lines.push(`  overall surf rate: ${s.survival.rate.toFixed(0)}% (${s.survival.k}/${s.survival.n}, Wilson 95% CI ${s.survival.low.toFixed(0)}-${s.survival.high.toFixed(0)}%)`);
    }
    if (s.perType.length > 0) {
      lines.push(`  per type: ${s.perType.map((t) => `${t.typeId}: ${t.survival.rate.toFixed(0)}% (${t.survival.k}/${t.survival.n})`).join(', ')}`);
    }
    if (s.nextDayMood) {
      const m = s.nextDayMood;
      lines.push(`  urge intensity → NEXT-DAY mood: rho=${m.rho.toFixed(2)}, n=${m.n}, p=${m.p.toFixed(3)}${m.significant ? ' ✓ significant' : ' n.s.'}`);
    }
    if (s.nextDayCompletion) {
      const m = s.nextDayCompletion;
      lines.push(`  urge intensity → NEXT-DAY completion: rho=${m.rho.toFixed(2)}, n=${m.n}, p=${m.p.toFixed(3)}${m.significant ? ' ✓ significant' : ' n.s.'}`);
    }
    if (s.surfVsGiveIn) {
      const g = s.surfVsGiveIn;
      lines.push(`  next-day mood after surf vs give-in: surfed ${g.surfedNextMood.toFixed(1)} (n=${g.nSurfed}) vs gave-in ${g.gaveInNextMood.toFixed(1)} (n=${g.nGaveIn})`);
    }
    if (s.successTrend) {
      const t = s.successTrend;
      const arrow = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '→';
      lines.push(`  surf-rate trend: ${arrow} ${t.direction} (tau=${t.tau.toFixed(2)}, p=${t.p.toFixed(3)}${t.significant ? ' ✓ significant' : ' n.s.'})`);
    }
    if (s.emotionalVolatility) {
      const v = s.emotionalVolatility;
      lines.push(`  emotional volatility: σ=${v.stdDev.toFixed(2)} (${v.meanAbsChange.toFixed(2)} mood-rank steps/day), ${v.n} days`);
    }
    if (lines.length === 0) return '  (untested — urge analysis needs ≥10 days of resolved urges for a trend, ≥3 surfed + ≥3 gave-in urges for a surf-vs-give-in comparison, and ≥10 mood days for lag/volatility checks)';
    return lines.join('\n');
  } catch {
    return '  (unavailable)';
  }
}

function summarizeLeverInsights(data: AppData): string {
  try {
    const validations = validateLevers(data.levers ?? [], data.habits, data.checkIns, data.moods ?? {});
    const relapses = detectRelapses(data.habits, data.checkIns);
    const lines: string[] = [];
    const tested = validations.filter((v) => !v.needMoreData);
    if (validations.length > 0) {
      lines.push(`  ${tested.length}/${validations.length} levers testable (14-day before/after windows)`);
      for (const v of tested) {
        lines.push(`  ${v.content}: ${v.beforeRate.toFixed(0)}% -> ${v.afterRate.toFixed(0)}% (delta ${v.delta >= 0 ? '+' : ''}${v.delta.toFixed(0)}pt, p=${v.p.toFixed(3)}${v.significant ? ' ✓ significant' : ' n.s.'}, d=${v.d ? v.d.toFixed(2) : '—'})${v.moodN >= 5 ? `; mood ${v.beforeMood.toFixed(1)} -> ${v.afterMood.toFixed(1)} (p=${v.moodP.toFixed(3)}${v.moodSignificant ? ' ✓' : ''})` : ''}`);
      }
      const untested = validations.filter((v) => v.needMoreData);
      if (untested.length > 0) lines.push(`  ${untested.length} lever(s) have <5 days logged on one side — wait before judging`);
    } else {
      lines.push('  (no levers recorded yet)');
    }
    if (relapses.length === 0) {
      lines.push('  (habits need ≥3 weeks of history to check relapse)');
    } else {
      const flagged = relapses.filter((r) => r.relapse);
      if (flagged.length > 0) {
        lines.push(`  RELAPSE: ${flagged.map((r) => `${r.name} (last 7d ${r.recentMean.toFixed(0)}% vs ~4wk ${r.baselineMean.toFixed(0)}%, p=${r.p.toFixed(3)})`).join('; ')}`);
      } else {
        lines.push('  no statistical relapse detected (last 7 days vs previous ~4 weeks)');
      }
    }
    return lines.join('\n');
  } catch {
    return '  (unavailable)';
  }
}

function summarizeDataCoverage(data: AppData): string {
  const all = Array.isArray(data.checkIns) ? data.checkIns : [];
  const active = (data.habits ?? []).filter((h) => !h.archived);
  const dates = new Set<string>();
  for (const c of all) if (c && typeof c.date === 'string') dates.add(c.date);
  const moods = data.moods && typeof data.moods === 'object' ? data.moods : {};
  const moodDays = new Set(Object.keys(moods)).size;
  const urgeDays = new Set((data.urges ?? []).map((u) => (u.startTime || '').slice(0, 10))).size;
  const noteCount = (data.notes ?? []).length;

  // How many active days actually carry a mood (needed for correlations).
  const activeDays = new Set<string>();
  for (const c of all) if (c && c.completed && c.date) activeDays.add(c.date);
  const moodOnActive = [...activeDays].filter((d) => moods[d]).length;

  const lines = [
    `  calendar days with any data: ${dates.size}`,
    `  active habits: ${active.length}; check-ins: ${all.length}`,
    `  mood days: ${moodDays} (mood recorded on ${moodOnActive} of ${activeDays.size} days with completions)`,
    `  urge days: ${urgeDays}; standalone notes: ${noteCount}`,
  ];
  if (activeDays.size > 0 && moodDays < Math.max(6, Math.floor(activeDays.size / 2))) {
    lines.push('  GAP: mood is logged on too few active days — correlations with mood stay untestable until you log a mood on most active days.');
  }
  return lines.join('\n');
}

/**
 * Build the complete AI report from a snapshot of the entire app data.
 * Resilient to corrupt inputs: any malformed section falls back gracefully.
 */
export function buildAiContext(data: AppData): string {
  const sections: string[] = [];

  sections.push(`## DATA COVERAGE\n${summarizeDataCoverage(data)}`);

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
    const sig = correlations.filter((c) => c.significant);
    const show = sig.length > 0 ? sig.slice(0, 10) : correlations.slice(0, 10);
    sections.push(
      `## CORRELATIONS (computed on-device, ${correlations.length} tested; ${sig.length} significant after FDR)\n` +
      show.map((c) =>
        `  ${c.metricA} ↔ ${c.metricB}: ${c.method} ${c.coefficient.toFixed(2)} (${c.direction}, ${c.strength}, n=${c.sampleSize}, p=${c.pValue.toFixed(3)}, q=${c.qValue.toFixed(3)}${c.significant ? ' ✓ significant' : ''}${c.sampleSize < c.requiredN ? `, ⚠ need ${c.requiredN} points` : ''})`
      ).join('\n'),
    );
  } else {
    sections.push('## CORRELATIONS\n  (untested — every correlation needs ≥6 days with BOTH habits and moods recorded on the same day. Log a mood on most active days to unlock this section.)');
  }

  sections.push(`## SKILLS & CAPACITIES\n${summarizeSkills(data)}`);
  sections.push(`## TRENDS (Mann-Kendall + Theil-Sen + changepoints; computed on-device)\n${summarizeTrends(data)}`);
  sections.push(`## CAPACITY TRENDS\n${summarizeCapacityTrends(data)}`);
  sections.push(`## EXPERIMENTS\n${summarizeExperiments(data)}`);
  sections.push(`## URGES (urge surfing)\n${summarizeUrges(data)}`);
  sections.push(`## URGES & MOOD ANALYSIS (computed on-device)\n${summarizeUrgeInsights(data)}`);
  sections.push(`## LEVER VALIDATION & RELAPSE\n${summarizeLeverInsights(data)}`);
  sections.push(`## CHAOS PRESSURE\n${summarizeChaos()}`);
  sections.push(`## CUSTOM MANTRAS (user values)\n${summarizeMantras(data)}`);
  sections.push(`## ACHIEVEMENTS (tagged notes by category)\n${summarizeAchievements(data)}`);

  const standaloneNotes = (data.notes ?? []).map((n) => {
    const tag = n.achievementCategory ? ` (achievement:${n.achievementCategory})` : '';
    return `  [${n.createdAt.slice(0, 10)}] ${n.content}${tag}`;
  }).join('\n');
  sections.push(`## ALL STANDALONE NOTES\n${standaloneNotes || '  (none)'}`);

  sections.push(`## JOURNAL MEMORY (past journal entries, newest first)\n${summarizeJournalMemory(data)}`);
  sections.push(`## JOURNAL LEARNINGS (answered self-questions)\n${summarizeJournalLearnings(data)}`);

  const totalCheckIns = Array.isArray(data.checkIns) ? data.checkIns.length : 0;
  const allCheckIns = Array.isArray(data.checkIns) ? data.checkIns : [];
  const completedCheckIns = allCheckIns.filter((c) => c.completed).length;
  const withNotes = allCheckIns.filter((c) => c.notes?.length).length;
  sections.push(`## OVERVIEW\n  ${data.habits.length} habits (${habits.length} active), ${totalCheckIns} check-ins (${completedCheckIns} completed), ${(data.notes ?? []).length} standalone notes, ${withNotes} check-ins with notes.`);

  return sections.join('\n\n');
}
