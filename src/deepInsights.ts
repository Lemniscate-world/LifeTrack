// src/deepInsights.ts
// Deep analysis engine — multi-hop chains, streak risk forecast, contrastive
// own-words, dose-response, cannibalization, restart patterns.
//
// Unlike recommendations.ts (broad coverage, one rule per pattern), this module
// digs FEW but DEEP: every card carries its sample size / p-value / effect and
// quotes the user's own data (notes words, weekday rates) so nothing feels
// generic. Pure module — fully unit-testable.

import type { Habit, CheckIn, Protocol } from './types';
import { moodRank } from './correlations';

export interface DeepInsight {
  id: string;
  icon: string;
  title: string;
  body: string;
  stat: string;
  action?: { label: string; view: 'grid' | 'stats' | 'correlations' | 'history' | 'journal' | 'knowledge' | 'stacks' };
  /** Concrete schedule: days to check, rendered as a mini calendar. */
  plan?: { label: string; dates: string[] };
}

// ---------- small stat helpers ----------

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

/** Two-proportion z-test p-value (two-sided). */
export function twoPropP(s1: number, n1: number, s2: number, n2: number): number | null {
  if (n1 < 5 || n2 < 5) return null;
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
  if (se === 0) return p1 === p2 ? 1 : 0.001;
  const z = (p1 - p2) / se;
  return 2 * (1 - normalCDF(Math.abs(z)));
}

function fmtP(p: number | null): string {
  if (p === null) return 'n insuffisant';
  if (p < 0.001) return 'p<0.001';
  return `p=${p.toFixed(3)}`;
}

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// ---------- day table ----------

interface DayRow {
  done: Set<string>;
  tracked: Set<string>;
  mood: number | null;
  energy: number | null;
}

export function buildDayTable(checkIns: CheckIn[], moods: Record<string, string>, energies?: Record<string, number>): Map<string, DayRow> {
  const days = new Map<string, DayRow>();
  const row = (date: string): DayRow => {
    let r = days.get(date);
    if (!r) { r = { done: new Set(), tracked: new Set(), mood: null, energy: null }; days.set(date, r); }
    return r;
  };
  for (const ci of checkIns) {
    const r = row(ci.date);
    r.tracked.add(ci.habitId);
    if (ci.completed) r.done.add(ci.habitId);
  }
  for (const [date, moodId] of Object.entries(moods)) {
    row(date).mood = moodRank(moodId);
  }
  for (const [date, v] of Object.entries(energies ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) row(date).energy = v;
  }
  return days;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** Two-mean z-test (normal approx, pooled SD) p-value, two-sided. */
export function twoMeanP(a: number[], b: number[]): number | null {
  if (a.length < 5 || b.length < 5) return null;
  const sa = sd(a);
  const sb = sd(b);
  const pooled = Math.sqrt((sa * sa) / a.length + (sb * sb) / b.length);
  if (pooled === 0) return mean(a) === mean(b) ? 1 : 0.001;
  const z = (mean(a) - mean(b)) / pooled;
  return 2 * (1 - normalCDF(Math.abs(z)));
}

// ---------- 1. chains: A(day t) → B(day t+1) → mood ----------

function detectChains(habits: Habit[], days: Map<string, DayRow>): DeepInsight[] {
  const active = habits.filter((h) => !h.archived);
  const dates = [...days.keys()].sort();
  if (dates.length < 14) return [];
  const habitById = new Map(active.map((h) => [h.id, h]));

  // Global base rates
  const bDone = new Map<string, number>();
  const bTracked = new Map<string, number>();
  for (const d of dates) {
    const r = days.get(d)!;
    for (const id of r.tracked) {
      bTracked.set(id, (bTracked.get(id) ?? 0) + 1);
      if (r.done.has(id)) bDone.set(id, (bDone.get(id) ?? 0) + 1);
    }
  }

  interface Link { a: Habit; b: Habit; both: number; nA: number; lift: number; p: number; }
  const links: Link[] = [];

  for (const a of active) {
    const daysA = dates.filter((d) => days.get(d)!.done.has(a.id));
    if (daysA.length < 6) continue;
    for (const b of active) {
      if (b.id === a.id) continue;
      let both = 0;
      let nA = 0;
      for (const d of daysA) {
        const next = shiftDate(d, 1);
        const rNext = days.get(next);
        if (!rNext || !rNext.tracked.has(b.id)) continue;
        nA++;
        if (rNext.done.has(b.id)) both++;
      }
      if (nA < 6 || both < 4) continue;
      const pBgivenA = both / nA;
      const base = (bDone.get(b.id) ?? 0) / Math.max(1, bTracked.get(b.id) ?? 1);
      if (base <= 0) continue;
      const lift = pBgivenA / base;
      if (lift < 1.35) continue;
      const p = twoPropP(both, nA, bDone.get(b.id) ?? 0, bTracked.get(b.id) ?? 0);
      if (p === null || p >= 0.05) continue;
      links.push({ a, b, both, nA, lift, p });
    }
  }

  links.sort((x, y) => (y.lift * -Math.log(y.p)) - (x.lift * -Math.log(x.p)));

  const out: DeepInsight[] = [];
  for (const l of links.slice(0, 4)) {
    // Mood uplift on B-days preceded by A vs other B-days
    const withPrev: number[] = [];
    const without: number[] = [];
    for (const d of dates) {
      const r = days.get(d)!;
      if (!r.done.has(l.b.id) || r.mood === null) continue;
      const prev = days.get(shiftDate(d, -1));
      if (prev && prev.done.has(l.a.id)) withPrev.push(r.mood);
      else without.push(r.mood);
    }
    const moodUp = withPrev.length >= 4 && without.length >= 4 ? mean(withPrev) - mean(without) : null;
    const moodTxt = moodUp !== null && Math.abs(moodUp) >= 0.25
      ? `, et ton humeur ces jours-là est ${moodUp > 0 ? '+' : ''}${moodUp.toFixed(1)} vs les autres fois`
      : '';
    out.push({
      id: `chain|${l.a.id}|${l.b.id}`,
      icon: '⛓️',
      title: `Chaîne : "${l.a.name}" hier → "${l.b.name}" aujourd'hui`,
      body: `Quand tu fais "${l.a.name}", tu enchaînes "${l.b.name}" le lendemain ${l.lift.toFixed(1)}× plus souvent que ta normale (${Math.round((l.both / l.nA) * 100)}% vs ${Math.round(((bDone.get(l.b.id) ?? 0) / Math.max(1, bTracked.get(l.b.id) ?? 1)) * 100)}%)${moodTxt}. Protéger "${l.a.name}" protège toute la chaîne.`,
      stat: `${l.both}/${l.nA} jours · ×${l.lift.toFixed(1)} · ${fmtP(l.p)}${moodUp !== null ? ` · Δhumeur ${moodUp > 0 ? '+' : ''}${moodUp.toFixed(1)}` : ''}`,
      action: { label: 'Voir la grille', view: 'grid' },
    });
  }
  void habitById;
  return out.slice(0, 2);
}

// ---------- 2. streak risk forecast ----------

function detectStreakRisk(habits: Habit[], days: Map<string, DayRow>, today: Date): DeepInsight[] {
  const out: DeepInsight[] = [];
  const todayStr = today.toISOString().slice(0, 10);
  const doneOn = (habitId: string, date: string): boolean => days.get(date)?.done.has(habitId) ?? false;

  for (const h of habits.filter((x) => !x.archived)) {
    // current streak (allow today not yet done)
    let cursor = todayStr;
    if (!doneOn(h.id, cursor)) cursor = shiftDate(cursor, -1);
    let streak = 0;
    while (doneOn(h.id, cursor)) {
      streak++;
      cursor = shiftDate(cursor, -1);
    }
    if (streak < 3) continue;

    // weekday rates over last 90 days
    const perDow: { k: number; n: number }[] = Array.from({ length: 7 }, () => ({ k: 0, n: 0 }));
    for (let i = 1; i <= 90; i++) {
      const d = shiftDate(todayStr, -i);
      const r = days.get(d);
      if (!r || !r.tracked.has(h.id)) continue;
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      perDow[dow].n++;
      if (r.done.has(h.id)) perDow[dow].k++;
    }

    // first risky day in the next 7 days
    let riskDow = -1;
    let riskRate = 1;
    for (let i = 1; i <= 7; i++) {
      const d = shiftDate(todayStr, i);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      const w = perDow[dow];
      if (w.n >= 3 && w.k / w.n < 0.45 && w.k / w.n < riskRate) {
        riskDow = dow;
        riskRate = w.k / w.n;
      }
    }
    if (riskDow < 0) continue;

    const w = perDow[riskDow];
    const pKeep = twoPropP(streak, streak + 1, w.k, w.n); // heuristic contrast: current discipline vs that weekday
    out.push({
      id: `streakrisk|${h.id}`,
      icon: '⚠️',
      title: `Série "${h.name}" (${streak}j) — point fragile : ${DAY_NAMES[riskDow]}`,
      body: `Tes ${DAY_NAMES[riskDow]}s historiques : ${Math.round(riskRate * 100)}% de complétion (${w.k}/${w.n}) — c'est là que tes séries meurent. Sans parade, la série de ${streak} jours casse probablement ${DAY_NAMES[riskDow]} prochain. Réduis l'objectif ce jour-là ou pose le rappel au matin.`,
      stat: `série ${streak}j · ${DAY_NAMES[riskDow]} ${w.k}/${w.n}=${Math.round(riskRate * 100)}%${pKeep !== null ? ` · ${fmtP(pKeep)}` : ''}`,
      action: { label: 'Voir la grille', view: 'grid' },
    });
    break; // one urgent streak warning is enough
  }
  return out;
}

// ---------- 3. contrastive own-words on failed vs done days ----------

const STOPWORDS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'a', 'au', 'aux', 'en', 'dans', 'pour', 'pas', 'plus', 'sur', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te', 'se', 'ma', 'mon', 'mes', 'ta', 'ton', 'tes', 'sa', 'son', 'ses', 'cest', 'c', 'est', 'ai', 'as', 'avoir', 'ete', 'avec', 'sans', 'mais', 'que', 'qui', 'quoi', 'par', 'trop', 'tres', 'bien', 'moins', 'the', 'and', 'was', 'for', 'with', 'this', 'that', 'have', 'not', 'but', 'its', 'it', 'of', 'to', 'in', 'on', 'at', 'my', 'me', 'i', 'a', 'an', 'is', 'are', 'day', 'jour', 'journée', 'today', 'aujourd']);

function normalizeWord(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z']/g, '');
}

export function contrastiveWords(
  failTexts: string[],
  okTexts: string[],
): { word: string; failCount: number; ratio: number }[] {
  const failCounts = new Map<string, number>();
  const okCounts = new Map<string, number>();
  const display = new Map<string, string>();

  const tally = (texts: string[], into: Map<string, number>) => {
    for (const t of texts) {
      const seen = new Set<string>();
      for (const raw of t.split(/\s+/)) {
        const norm = normalizeWord(raw);
        if (norm.length < 4 || STOPWORDS.has(norm) || seen.has(norm)) continue;
        seen.add(norm);
        into.set(norm, (into.get(norm) ?? 0) + 1);
        if (!display.has(norm)) display.set(norm, raw.replace(/[^\wÀ-ÿ'-]/g, ''));
      }
    }
  };
  tally(failTexts, failCounts);
  tally(okTexts, okCounts);

  const results: { word: string; failCount: number; ratio: number }[] = [];
  for (const [word, failCount] of failCounts) {
    if (failCount < 3) continue;
    const rateFail = failCount / (failTexts.length + 1);
    const rateOk = (okCounts.get(word) ?? 0) / (okTexts.length + 1);
    const ratio = rateOk > 0 ? rateFail / rateOk : rateFail > 0 ? 99 : 0;
    if (ratio < 2) continue;
    results.push({ word: display.get(word) ?? word, failCount, ratio });
  }
  results.sort((a, b) => b.ratio * b.failCount - a.ratio * a.failCount);
  return results.slice(0, 3);
}

function detectOwnWords(checkIns: CheckIn[], today: Date): DeepInsight[] {
  const cutoff = shiftDate(today.toISOString().slice(0, 10), -60);
  const failTexts: string[] = [];
  const okTexts: string[] = [];
  for (const ci of checkIns) {
    if (ci.date < cutoff) continue;
    const texts = [...(ci.notes ?? [])];
    const legacy = (ci as unknown as Record<string, unknown>).note;
    if (typeof legacy === 'string' && legacy.trim()) texts.push(legacy);
    if (texts.length === 0) continue;
    if (ci.completed) okTexts.push(...texts);
    else failTexts.push(...texts);
  }
  if (failTexts.length < 5 || okTexts.length < 5) return [];
  const words = contrastiveWords(failTexts, okTexts);
  if (words.length === 0) return [];
  const quoted = words.map((w) => `« ${w.word} »`).join(', ');
  return [{
    id: 'ownwords',
    icon: '🗣️',
    title: 'Tes mots sur les jours ratés',
    body: `Sur tes ${failTexts.length} derniers check-ins ratés avec note, ton vocabulaire contraste nettement : ${quoted}. Ce sont TES signaux — quand tu t'écris ça, c'est le moment d'appliquer ta parade (objectif réduit, pas zéro).`,
    stat: `${failTexts.length} ratés vs ${okTexts.length} réussis · ratio ≥2× · 60j`,
    action: { label: "Voir l'historique", view: 'history' },
  }];
}

// ---------- 4. dose-response (complétions du jour → humeur) ----------

function detectDoseResponse(days: Map<string, DayRow>): DeepInsight[] {
  const doses: number[][] = [[], [], [], []]; // 0, 1, 2, 3+
  for (const r of days.values()) {
    if (r.mood === null) continue;
    if (r.tracked.size === 0) continue;
    const d = Math.min(3, r.done.size);
    doses[d].push(r.mood);
  }
  if (doses[1].length + doses[2].length + doses[3].length < 10) return [];
  const means = doses.map((xs) => (xs.length >= 3 ? mean(xs) : null));
  const valid = means.map((m, i) => ({ m, i })).filter((x) => x.m !== null) as { m: number; i: number }[];
  if (valid.length < 2) return [];
  // monotone increase check
  let mono = true;
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].m! < valid[i - 1].m! - 0.15) { mono = false; break; }
  }
  if (!mono || valid[valid.length - 1].m! - valid[0].m! < 0.3) return [];
  const parts = valid.map(({ m, i }) => {
    const label = i === 3 ? '2+' : String(i);
    const n = doses[i].length;
    return `${label} habitude${i > 1 ? 's' : ''}: ${m.toFixed(1)} (n=${n})`;
  });
  return [{
    id: 'dose',
    icon: '📐',
    title: 'Effet dose : plus tu coches, mieux tu te sens',
    body: `Humeur moyenne selon le nombre d'habitudes faites dans la journée — ${parts.join(' · ')}. La relation est monotone : chaque coche compte, mais le passage de 0 à 1 est le plus rentable.`,
    stat: `${doses.flat().filter((_) => true).length} jours notés · monotone · seuil Δ≥0.3`,
    action: { label: 'Voir stats', view: 'stats' },
  }];
}

// ---------- 5. cannibalization (A today → B same-day miss) ----------

function detectCannibalization(habits: Habit[], days: Map<string, DayRow>): DeepInsight[] {
  const active = habits.filter((h) => !h.archived);
  const dates = [...days.keys()].sort();
  if (dates.length < 20) return [];

  const perHabit = new Map<string, { k: number; n: number }>();
  for (const d of dates) {
    const r = days.get(d)!;
    for (const id of r.tracked) {
      const agg = perHabit.get(id) ?? { k: 0, n: 0 };
      agg.n++;
      if (!r.done.has(id)) agg.k++;
      perHabit.set(id, agg);
    }
  }

  interface Hit { a: Habit; b: Habit; k: number; n: number; missRate: number; base: number; p: number; }
  const hits: Hit[] = [];
  for (const a of active) {
    const daysA = dates.filter((d) => days.get(d)!.done.has(a.id));
    if (daysA.length < 8) continue;
    for (const b of active) {
      if (b.id === a.id) continue;
      let k = 0; let n = 0;
      for (const d of daysA) {
        const r = days.get(d)!;
        if (!r.tracked.has(b.id)) continue;
        n++;
        if (!r.done.has(b.id)) k++;
      }
      if (n < 6 || k < 4) continue;
      const baseAgg = perHabit.get(b.id)!;
      if (baseAgg.n < 10) continue;
      const base = baseAgg.k / baseAgg.n;
      const missRate = k / n;
      if (missRate < base * 1.6) continue;
      const p = twoPropP(k, n, baseAgg.k, baseAgg.n);
      if (p === null || p >= 0.05) continue;
      hits.push({ a, b, k, n, missRate, base, p });
    }
  }
  hits.sort((x, y) => y.missRate / y.base - x.missRate / x.base);

  return hits.slice(0, 1).map((h) => ({
    id: `cannibal|${h.a.id}|${h.b.id}`,
    icon: '🥊',
    title: `Interférence : "${h.a.name}" écrase "${h.b.name}"`,
    body: `Les jours où tu fais "${h.a.name}", "${h.b.name}" saute ${Math.round((h.missRate / h.base) * 10) / 10}× plus souvent que d'habitude (${Math.round(h.missRate * 100)}% vs ${Math.round(h.base * 100)}%). Elles se disputent la même énergie — décale "${h.b.name}" avant "${h.a.name}" ou réduis-le ces jours-là.`,
    stat: `${h.k}/${h.n} ratés les jours A · ×${(h.missRate / h.base).toFixed(1)} · ${fmtP(h.p)}`,
    action: { label: 'Voir la grille', view: 'grid' },
  }));
}

// ---------- 6. restart pattern after breaks ----------

function detectRestartPattern(habits: Habit[], checkIns: CheckIn[], days: Map<string, DayRow>, today: Date): DeepInsight[] {
  const todayStr = today.toISOString().slice(0, 10);
  const dowCounts = Array.from({ length: 7 }, () => 0);
  let restarts = 0;

  for (const h of habits.filter((x) => !x.archived)) {
    const dates = checkIns.filter((ci) => ci.habitId === h.id).map((ci) => ci.date);
    if (dates.length === 0) continue;
    const sorted = [...new Set(dates)].sort();
    let inBreak = false;
    let gapLen = 0;
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      // count consecutive untracked days between tracked entries
      let diff = 0;
      let cur = prev;
      while (cur < sorted[i]) { cur = shiftDate(cur, 1); diff++; }
      const missedDays = diff - 1;
      if (missedDays >= 3) {
        inBreak = true;
        gapLen = missedDays;
      } else if (missedDays === 0) {
        inBreak = false;
      }
      if (inBreak && gapLen >= 3) {
        // restart day = sorted[i] if it is done
        if (days.get(sorted[i])?.done.has(h.id)) {
          dowCounts[new Date(`${sorted[i]}T00:00:00Z`).getUTCDay()]++;
          restarts++;
          inBreak = false;
        }
      }
      prev = sorted[i];
    }
    // future window from today if currently in a long gap
    if (inBreak) {
      for (let i = 0; i <= 7; i++) {
        const d = shiftDate(todayStr, i);
        if (!days.get(d)?.tracked.has(h.id)) continue;
        void d;
        break;
      }
    }
  }

  if (restarts < 5) return [];
  const best = dowCounts.indexOf(Math.max(...dowCounts));
  const share = Math.max(...dowCounts) / restarts;
  if (share < 0.4) return [];
  // next occurrence of that weekday
  let nextDate = todayStr;
  for (let i = 1; i <= 7; i++) {
    const d = shiftDate(todayStr, i);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === best) { nextDate = d; break; }
  }
  return [{
    id: 'restart',
    icon: '🔄',
    title: `Tu reprends le ${DAY_NAMES[best]}`,
    body: `Après une coupure de 3+ jours, tu reprends ${Math.max(...dowCounts)} fois sur ${restarts} un ${DAY_NAMES[best]} (${Math.round(share * 100)}% des reprises). C'est ton point de rebond naturel — prochaine fenêtre : ${nextDate}. Si tu es en pause sur une habitude, calibre ton retour sur ce jour-là plutôt qu'au hasard.`,
    stat: `${restarts} reprises analysées · share ${Math.round(share * 100)}%`,
  }];
}

// ---------- 7. goal calibration (objectif mensuel vs réalité) + PLAN ----------

function detectGoalCalibration(habits: Habit[], checkIns: CheckIn[], days: Map<string, DayRow>, today: Date): DeepInsight[] {
  const out: DeepInsight[] = [];
  const now = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  // Last 3 full months keys (YYYY-MM), oldest first
  const months: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  for (const h of habits.filter((x) => !x.archived)) {
    if (!h.goal || h.goal <= 0) continue;
    const rates: { month: string; done: number }[] = [];
    for (const m of months) {
      const done = checkIns.filter((ci) => ci.habitId === h.id && ci.completed && ci.date.startsWith(m)).length;
      rates.push({ month: m, done });
    }
    const ratio = rates.map((r) => r.done / h.goal);
    // Needs at least 2 months tracked and chronic underachievement
    const tracked = ratio.filter((r) => r > 0).length;
    if (tracked < 2) continue;
    const medianRatio = [...ratio].sort((a, b) => a - b)[Math.floor(ratio.length / 2)];

    // Per-weekday success rate over the last 90 days — the plan's raw material.
    const todayStr = now.toISOString().slice(0, 10);
    const dowK = Array.from({ length: 7 }, () => 0);
    const dowN = Array.from({ length: 7 }, () => 0);
    for (let i = 1; i <= 90; i++) {
      const d = shiftDate(todayStr, -i);
      const r = days.get(d);
      if (!r || !r.tracked.has(h.id)) continue;
      const idx = new Date(`${d}T00:00:00Z`).getUTCDay();
      dowN[idx]++;
      if (r.done.has(h.id)) dowK[idx]++;
    }

    if (medianRatio < 0.65) {
      // --- Plan A : objectif réaliste + calendrier pré-rempli ---
      // Ancrage scientifique explicite :
      // - Progression graduelle (progressive overload appliqué aux habitudes) :
      //   la nouvelle cible ne dépasse JAMAIS +20% de ta médiane réalisée.
      // - Implementation intentions (Gollwitzer 1999) : des jours précis,
      //   choisis sur tes meilleurs taux historiques, valent mieux que
      //   "je ferai de mon mieux".
      // - Tiny Habits (Fogg) + Never miss twice (Clear) : version 2 minutes
      //   en repli, jamais deux échecs consécutifs.
      const medianDone = Math.round(medianRatio * h.goal);
      const suggested = Math.min(h.goal, Math.max(4, Math.round(medianDone * 1.2)));
      // Rank weekdays by historical success (need n>=2)
      const ranked = [1, 2, 3, 4, 5, 6, 0]
        .map((idx) => ({ idx, rate: dowN[idx] >= 2 ? dowK[idx] / dowN[idx] : 0.5 }))
        .sort((a, b) => b.rate - a.rate);
      // Next 31 days STARTING TOMORROW (not strict next month) so the plan is
      // visible in the grid immediately — circles appear from day 1.
      const occ: string[][] = Array.from({ length: 7 }, () => []);
      const horizonEnd = shiftDate(todayStr, 32);
      const ymA = shiftDate(todayStr, 1);
      for (let iso = ymA; iso <= horizonEnd; ) {
        const dt = new Date(`${iso}T00:00:00Z`);
        occ[dt.getUTCDay()].push(iso);
        iso = shiftDate(iso, 1);
      }
      // Greedy: cycle through best weekdays, one occurrence each, up to suggested
      const picked: string[] = [];
      const used = Array.from({ length: 7 }, () => 0);
      let guard = 0;
      while (picked.length < suggested && guard < 60) {
        for (const rw of ranked) {
          if (picked.length >= suggested) break;
          const list = occ[rw.idx];
          if (used[rw.idx] < list.length) {
            picked.push(list[used[rw.idx]]);
            used[rw.idx]++;
          }
        }
        guard++;
      }
      picked.sort();
      const topTxt = ranked.slice(0, Math.min(3, suggested))
        .filter((rw) => used[rw.idx] > 0)
        .map((rw) => `${DAY_NAMES[rw.idx]} (${Math.round(rw.rate * 100)}%)`)
        .join(', ');
      const firstDay = picked[0] ?? '';
      const startsToday = firstDay === shiftDate(todayStr, 1) ? 'dès demain' : `à partir du ${firstDay}`;
      out.push({
        id: `goalcal|${h.id}`,
        icon: '🎯',
        title: `Plan progressif pour "${h.name}" — ${suggested} jours, ${startsToday}`,
        body: `Ta médiane réelle : ${medianDone}/mois pour un objectif affiché à ${h.goal}. Le plan suit 3 principes validés : (1) progression ≤+20% par palier — cible ${suggested}, tenable ; (2) intentions d'implémentation — voici LES jours, calés sur tes meilleurs créneaux : ${topTxt} ; (3) si tu rates, version « 2 minutes » le lendemain et jamais deux ratés de suite. Les jours sont cerclés dans la grille + exportables vers ton agenda.`,
        stat: `médiane ${Math.round(medianRatio * 100)}% · cible ${h.goal}→${suggested} (+≤20%) · plan ${picked.length}j · Gollwitzer/Fogg/Clear`,
        action: { label: 'Voir la grille', view: 'grid' },
        plan: { label: `Plan "${h.name}" — mois prochain`, dates: picked },
      });
    } else {
      // --- Plan B : objectif tenu mais rythme du mois courant en retard → rattrapage ciblé ---
      const thisMonth = todayStr.slice(0, 7);
      const doneThisMonth = checkIns.filter((ci) => ci.habitId === h.id && ci.completed && ci.date.startsWith(thisMonth)).length;
      const dayOfMonth = Number(todayStr.slice(8, 10));
      const paceExpected = Math.round(h.goal * (dayOfMonth / 30));
      const shortfall = paceExpected - doneThisMonth;
      if (shortfall < 2 || dayOfMonth < 8) continue;
      const remaining = 30 - dayOfMonth;
      if (shortfall > remaining) continue;
      const upcoming = rankedUpcomingDays(days, h.id, todayStr, shortfall);
      if (upcoming.dates.length === 0) continue;
      out.push({
        id: `goalcatch|${h.id}`,
        icon: '📅',
        title: `"${h.name}" : rattraper ${shortfall} coches ce mois`,
        body: `À ce stade du mois tu devrais être à ~${paceExpected}/${h.goal}, tu es à ${doneThisMonth}. Il reste ${remaining} jours : coche les ${upcoming.dates.length} jours surlignés ci-dessous (tes créneaux à meilleur taux : ${upcoming.label}) et l'objectif reste atteignable sans sprint.`,
        stat: `fait ${doneThisMonth}/${paceExpected} attendus · rattrapage ${upcoming.dates.length}j · seuil ≥2`,
        action: { label: 'Voir la grille', view: 'grid' },
        plan: { label: `Rattrapage "${h.name}" — ce mois`, dates: upcoming.dates },
      });
    }
  }
  return out.slice(0, 2);
}

/** Pick the next `count` calendar days with the highest historical success rate. */
function rankedUpcomingDays(
  days: Map<string, DayRow>,
  habitId: string,
  todayStr: string,
  count: number,
): { dates: string[]; label: string } {
  const dowK = Array.from({ length: 7 }, () => 0);
  const dowN = Array.from({ length: 7 }, () => 0);
  for (let i = 1; i <= 90; i++) {
    const d = shiftDate(todayStr, -i);
    const r = days.get(d);
    if (!r || !r.tracked.has(habitId)) continue;
    const idx = new Date(`${d}T00:00:00Z`).getUTCDay();
    dowN[idx]++;
    if (r.done.has(habitId)) dowK[idx]++;
  }
  const ranked = [0, 1, 2, 3, 4, 5, 6]
    .map((idx) => ({ idx, rate: dowN[idx] >= 2 ? dowK[idx] / dowN[idx] : 0.5 }))
    .sort((a, b) => b.rate - a.rate);
  const dates: string[] = [];
  for (let i = 1; i <= 30 && dates.length < count; i++) {
    const iso = shiftDate(todayStr, i);
    const idx = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (ranked.find((r) => r.idx === idx)!.rate >= 0.5) dates.push(iso);
  }
  const label = ranked.slice(0, 2).map((r) => `${DAY_NAMES[r.idx]} ${Math.round(r.rate * 100)}%`).join(', ');
  return { dates, label };
}

// ---------- 8. first-check timing effect ----------

export function firstCheckHours(checkIns: CheckIn[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ci of checkIns) {
    if (!ci.completed || !ci.checkedAt) continue;
    const hour = new Date(ci.checkedAt).getHours();
    const cur = map.get(ci.date);
    if (cur === undefined || hour < cur) map.set(ci.date, hour);
  }
  return map;
}

function detectFirstCheckEffect(checkIns: CheckIn[], days: Map<string, DayRow>): DeepInsight[] {
  const firstHour = firstCheckHours(checkIns);
  const early: number[] = []; // done/tracked on days first check < 10h
  const late: number[] = [];  // ≥ 12h
  for (const [date, hour] of firstHour) {
    const r = days.get(date);
    if (!r || r.tracked.size < 3) continue;
    const rate = r.done.size / r.tracked.size;
    if (hour < 10) early.push(rate);
    else if (hour >= 12) late.push(rate);
  }
  if (early.length < 8 || late.length < 8) return [];
  const p = twoMeanP(early, late);
  const diff = mean(early) - mean(late);
  if (p === null || p >= 0.05 || diff < 0.1) return [];
  return [{
    id: 'firstcheck',
    icon: '🌅',
    title: 'Ton premier coche tire toute la journée',
    body: `Les jours où tu coches quelque chose avant 10h, tu complètes ${Math.round(mean(early) * 100)}% de tes habitudes ; après 12h, seulement ${Math.round(mean(late) * 100)}%. L'effet premier coche est réel dans TES données — ancre une micro-habitude au réveil (2 min max) et le reste suit.`,
    stat: `n=${early.length}j vs ${late.length}j · Δ${Math.round(diff * 100)}pts · ${fmtP(p)}`,
    action: { label: 'Voir stats', view: 'stats' },
  }];
}

// ---------- 9. weekend drift per habit ----------

function detectWeekendDrift(habits: Habit[], days: Map<string, DayRow>, today: Date): DeepInsight[] {
  const todayStr = today.toISOString().slice(0, 10);
  const out: DeepInsight[] = [];
  for (const h of habits.filter((x) => !x.archived)) {
    let wkK = 0; let wkN = 0; let weK = 0; let weN = 0;
    for (let i = 0; i < 90; i++) {
      const d = shiftDate(todayStr, -i);
      const r = days.get(d);
      if (!r || !r.tracked.has(h.id)) continue;
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) { weN++; if (r.done.has(h.id)) weK++; }
      else { wkN++; if (r.done.has(h.id)) wkK++; }
    }
    if (wkN < 10 || weN < 5) continue;
    const p = twoPropP(wkK, wkN, weK, weN);
    if (p === null || p >= 0.05) continue;
    const diff = wkK / wkN - weK / weN;
    if (Math.abs(diff) < 0.15) continue;
    out.push({
      id: `drift|${h.id}`,
      icon: diff > 0 ? '🛋️' : '💪',
      title: diff > 0
        ? `"${h.name}" s'effondre le week-end`
        : `"${h.name}" : ton point d'appui du week-end`,
      body: diff > 0
        ? `Semaine : ${Math.round((wkK / wkN) * 100)}% (${wkK}/${wkN}) vs week-end : ${Math.round((weK / weN) * 100)}% (${weK}/${weN}). Ce n'est pas un manque de volonté ponctuel, c'est structurel — prévois une version week-end plus petite (moitié moins, autre créneau).`
        : `Contrairement au reste, "${h.name}" monte le week-end : ${Math.round((weK / weN) * 100)}% (${weK}/${weN}) vs ${Math.round((wkK / wkN) * 100)}% en semaine (${wkK}/${wkN}). C'est ton socle stable quand la semaine dérape.`,
      stat: `semaine ${wkK}/${wkN} · w-e ${weK}/${weN} · Δ${diff > 0 ? '-' : '+'}${Math.abs(Math.round(diff * 100))}pts · ${fmtP(p)}`,
    });
  }
  return out.sort((a, b) => parseInt(b.stat.match(/Δ([-+]\d+)/)?.[1] ?? '0', 10) - parseInt(a.stat.match(/Δ([-+]\d+)/)?.[1] ?? '0', 10)).slice(0, 2);
}

// ---------- 10. pair synergy on mood ----------

function detectPairSynergy(habits: Habit[], days: Map<string, DayRow>): DeepInsight[] {
  const active = habits.filter((h) => !h.archived);
  const dates = [...days.keys()].sort().filter((d) => days.get(d)!.mood !== null);
  if (dates.length < 20) return [];
  interface Hit { a: Habit; b: Habit; bothMood: number[]; neitherMood: number[]; p: number; }
  const hits: Hit[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const both: number[] = [];
      const neither: number[] = [];
      for (const d of dates) {
        const r = days.get(d)!;
        const aDone = r.done.has(a.id);
        const bDone = r.done.has(b.id);
        if (aDone && bDone) both.push(r.mood!);
        else if (!r.tracked.has(a.id) && !r.tracked.has(b.id)) continue; // day off entirely → ignore
        else if (!aDone && !bDone) neither.push(r.mood!);
      }
      if (both.length < 6 || neither.length < 6) continue;
      const diff = mean(both) - mean(neither);
      if (diff < 0.4) continue;
      const p = twoMeanP(both, neither);
      if (p === null || p >= 0.05) continue;
      hits.push({ a, b, bothMood: both, neitherMood: neither, p });
    }
  }
  hits.sort((x, y) => (mean(y.bothMood) - mean(y.neitherMood)) - (mean(x.bothMood) - mean(x.neitherMood)));
  const top = hits[0];
  if (!top) return [];
  return [{
    id: `synergy|${top.a.id}|${top.b.id}`,
    icon: '🤝',
    title: `Duo gagnant : "${top.a.name}" + "${top.b.name}"`,
    body: `Les jours où tu fais LES DEUX, ton humeur moyenne est ${mean(top.bothMood).toFixed(1)} vs ${mean(top.neitherMood).toFixed(1)} les jours où aucune des deux n'est faite (+${(mean(top.bothMood) - mean(top.neitherMood)).toFixed(1)}). Ce combo vaut plus que la somme de ses parties — protège-les ensemble, surtout les jours difficiles.`,
    stat: `n=${top.bothMood.length}j duo vs ${top.neitherMood.length}j zéro · ${fmtP(top.p)}`,
    action: { label: 'Voir corrélations', view: 'correlations' },
  }];
}

// ---------- 11. weekly load sweet spot ----------

function detectWeeklyLoad(days: Map<string, DayRow>, today: Date): DeepInsight[] {
  const todayStr = today.toISOString().slice(0, 10);
  // group last 84 days into Mon-Sun weeks
  const weeks = new Map<string, { dones: number; moodDays: number; moodSum: number }>();
  for (let i = 0; i < 84; i++) {
    const d = shiftDate(todayStr, -i);
    const dt = new Date(`${d}T00:00:00Z`);
    const dow = dt.getUTCDay();
    // Monday-based week key
    const monday = new Date(dt);
    monday.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const r = days.get(d);
    if (!r) continue;
    const w = weeks.get(key) ?? { dones: 0, moodDays: 0, moodSum: 0 };
    w.dones += r.done.size;
    if (r.mood !== null) { w.moodDays++; w.moodSum += r.mood; }
    weeks.set(key, w);
  }
  const valid = [...weeks.entries()]
    .filter(([, w]) => w.moodDays >= 3)
    .map(([key, w]) => ({ key, load: w.dones, mood: w.moodSum / w.moodDays }))
    .filter((w) => w.load > 0)
    .sort((a, b) => b.mood - a.mood);
  if (valid.length < 6) return [];
  const top = valid.slice(0, 3);
  const bottom = valid.slice(-3);
  const topLoads = top.map((w) => w.load).sort((a, b) => a - b);
  const bottomMeanLoad = mean(bottom.map((w) => w.load));
  const topMeanLoad = mean(topLoads);
  // current week load
  const currentMonday = (() => {
    const dt = new Date(`${todayStr}T00:00:00Z`);
    const dow = dt.getUTCDay();
    const m = new Date(dt);
    m.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
    return m.toISOString().slice(0, 10);
  })();
  const cur = weeks.get(currentMonday);

  if (topMeanLoad + 2 <= bottomMeanLoad) {
    return [{
      id: 'load|less',
      icon: '🎚️',
      title: 'Ta zone optimale : faire MOINS',
      body: `Tes semaines d'humeur haute tournent à ${Math.round(topMeanLoad)} coches en moyenne, celles d'humeur basse à ${Math.round(bottomMeanLoad)}. Chez toi, en faire plus s'accompagne d'une humeur plus basse — signe de surcharge. Expérimente un plafond à ~${Math.round(topMeanLoad)} cette semaine.${cur ? ` Tu es actuellement à ${cur.dones}.` : ''}`,
      stat: `${valid.length} semaines · top-3 vs bottom-3 humeur`,
    }];
  }
  const lo = topLoads[0];
  const hi = topLoads[topLoads.length - 1];
  return [{
    id: 'load|zone',
    icon: '🎚️',
    title: 'Ta charge hebdo optimale',
    body: `Tes 3 meilleures semaines d'humeur ont un point commun : ${lo}–${hi} coches. En dessous, tu tournes à vide ; au-dessus de ${hi}, l'humeur ne monte plus. Utilise ${hi} comme plafond sain plutôt que comme plancher.${cur ? ` Cette semaine : ${cur.dones}.` : ''}`,
    stat: `${valid.length} semaines · zone ${lo}-${hi}`,
  }];
}

// ---------- 12. knowledge bridge: protocol → weakest habit ----------

/**
 * Connects the Savoir (knowledge base) to the rest of the app: finds the
 * habit with the worst completion rate and matches an evidence-graded
 * protocol whose domain/keywords fit it, so Insights can say "here is WHAT
 * to do, from the science base" instead of only "here is what's wrong".
 */
function detectKnowledgeBridge(
  habits: Habit[],
  days: Map<string, DayRow>,
  today: Date,
  protocols: Protocol[],
): DeepInsight[] {
  if (protocols.length === 0) return [];
  const todayStr = today.toISOString().slice(0, 10);
  // Rank active habits by 30-day completion rate, weakest first.
  const scored = habits
    .filter((h) => !h.archived)
    .map((h) => {
      let k = 0; let n = 0;
      for (let i = 1; i <= 30; i++) {
        const d = shiftDate(todayStr, -i);
        const r = days.get(d);
        if (!r || !r.tracked.has(h.id)) continue;
        n++;
        if (r.done.has(h.id)) k++;
      }
      return { h, rate: n >= 5 ? k / n : -1 }; // -1 = not enough data
    })
    .filter((s) => s.rate >= 0)
    .sort((a, b) => a.rate - b.rate);
  const weak = scored.slice(0, 3); // the three strugglers
  if (weak.length === 0) return [];

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const out: DeepInsight[] = [];
  const usedProtocols = new Set<string>();
  for (const { h, rate } of weak) {
    const hn = norm(h.name);
    let best: Protocol | null = null;
    let bestScore = 0;
    for (const p of protocols) {
      if (usedProtocols.has(p.id)) continue;
      if (p.risky) continue;
      let score = 0;
      for (const kw of p.keywords ?? []) {
        const nk = norm(kw);
        if (nk.length >= 3 && (hn.includes(nk) || nk.includes(hn))) score += 3;
      }
      if ((p.habitSuggestions ?? []).some((s) => norm(s).includes(hn) || hn.includes(norm(s)))) score += 2;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best || bestScore === 0) continue;
    usedProtocols.add(best.id);
    out.push({
      id: `know|${h.id}|${best.id}`,
      icon: '📚',
      title: `Le savoir pour "${h.name}" (${Math.round(rate * 100)}% de réussite)`,
      body: `"${h.name}" est dans ton bas du classement. La base de connaissances contient un protocole gradué qui colle : « ${best.title} » — ${best.claim} Dosage concret : ${best.protocol}.${best.metric ? ` À mesurer : ${best.metric}.` : ''} Source : ${best.source}${best.evidenceLevel ? ` · niveau ${best.evidenceLevel}` : ''}.`,
      stat: `${bestScore >= 5 ? 'match fort' : 'match partiel'} · ${norm(best.domain)} · ${rate >= 0 ? `${Math.round(rate * 100)}%` : 'n faible'}`,
      action: { label: 'Ouvrir le Savoir', view: 'knowledge' },
    });
  }
  return out.slice(0, 2);
}

// ---------- .ics export: the plan goes into any calendar ----------

/**
 * Build a valid VCALENDAR string with one all-day VEVENT per planned date.
 * Imports cleanly into Google Calendar / Outlook / Fastmail.
 */
export function buildIcsForPlan(summary: string, description: string, dates: string[]): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lemniscate//LifeTrack Plan//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  dates.forEach((d, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:lifetrack-plan-${d}-${i}@lifetrack.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Download the plan as an .ics file (works in WebView2 and browsers). */
export function downloadPlanIcs(fileName: string, summary: string, description: string, dates: string[]): boolean {
  try {
    if (dates.length === 0) return false;
    const ics = buildIcsForPlan(summary, description, dates);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.ics') ? fileName : `${fileName}.ics`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    return true;
  } catch { return false; }
}

// ---------- 13. prime window per habit (from checkedAt hours) ----------

export function dominantCheckWindow(habitId: string, checkIns: CheckIn[]): { label: string; share: number; n: number } | null {
  const buckets = [
    { label: '5h-9h', lo: 5, hi: 9 },
    { label: '9h-12h', lo: 9, hi: 12 },
    { label: '12h-17h', lo: 12, hi: 17 },
    { label: '17h-21h', lo: 17, hi: 21 },
    { label: '21h-1h', lo: 21, hi: 25 },
    { label: '1h-5h', lo: -3, hi: 5 },
  ];
  const counts = new Array(buckets.length).fill(0);
  let total = 0;
  for (const ci of checkIns) {
    if (ci.habitId !== habitId || !ci.completed || !ci.checkedAt) continue;
    const h = new Date(ci.checkedAt).getHours();
    total++;
    buckets.forEach((b, i) => {
      const hh = h < 5 ? h + 24 : h;
      if (hh >= b.lo && hh < b.hi) counts[i]++;
    });
  }
  if (total < 8) return null;
  let bi = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[bi]) bi = i;
  const share = counts[bi] / total;
  if (share < 0.55) return null;
  return { label: buckets[bi].label, share, n: total };
}

function detectPrimeWindows(habits: Habit[], checkIns: CheckIn[]): DeepInsight[] {
  const out: DeepInsight[] = [];
  for (const h of habits.filter((x) => !x.archived)) {
    const w = dominantCheckWindow(h.id, checkIns);
    if (!w) continue;
    out.push({
      id: `primewin|${h.id}`,
      icon: '⏰',
      title: `"${h.name}" vit entre ${w.label}`,
      body: `${Math.round(w.share * 100)}% de tes ${w.n} réussites "${h.name}" sont cochées entre ${w.label}. Ce n'est pas de la discipline générale, c'est un CRÉNEAU. Bloque-le (rappel à heure fixe) et le taux suit tout seul.`,
      stat: `${w.n} cochages · seuil ≥55%`,
    });
  }
  return out.slice(0, 1);
}

// ---------- 14. regime flip: a link that stopped working ----------

function detectRegimeFlips(habits: Habit[], days: Map<string, DayRow>): DeepInsight[] {
  const active = habits.filter((h) => !h.archived);
  const dates = [...days.keys()].sort();
  if (dates.length < 40) return [];
  interface Flip { a: Habit; b: Habit; before: number; after: number; }
  const flips: Flip[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      // same-day co-occurrence lift, recent 14d vs prior 45d
      const calc = (from: string, to: string): { k: number; na: number; base: number; nb: number } => {
        let k = 0; let na = 0; let nb = 0;
        for (const d of dates) {
          if (d < from || d > to) continue;
          const r = days.get(d)!;
          if (!r.tracked.has(a.id)) continue;
          na++;
          if (r.done.has(a.id)) {
            nb++;
            if (r.tracked.has(b.id) && r.done.has(b.id)) k++;
          }
        }
        let bt = 0; let bd = 0;
        for (const d of dates) {
          if (d < from || d > to) continue;
          const r = days.get(d)!;
          if (!r.tracked.has(b.id)) continue;
          bt++;
          if (r.done.has(b.id)) bd++;
        }
        return { k, na, base: bt > 0 ? bd / bt : 0, nb };
      };
      const todayStr = dates[dates.length - 1];
      const rec14From = shiftDate(todayStr, -13);
      const priorTo = shiftDate(todayStr, -14);
      const priorFrom = shiftDate(todayStr, -58);
      const rec = calc(rec14From, todayStr);
      const pri = calc(priorFrom, priorTo);
      if (rec.na < 5 || pri.na < 8 || rec.base <= 0 || pri.base <= 0) continue;
      const liftNow = (rec.k / rec.na) / rec.base;
      const liftBefore = (pri.k / pri.na) / pri.base;
      if (liftBefore >= 1.6 && liftNow <= 1.05) {
        flips.push({ a, b, before: liftBefore, after: liftNow });
      }
    }
  }
  flips.sort((x, y) => y.before - x.before);
  const f = flips[0];
  if (!f) return [];
  return [{
    id: `flip|${f.a.id}|${f.b.id}`,
    icon: '📉',
    title: `Régime changé : « ${f.a.name} » n'entraîne plus « ${f.b.name} »`,
    body: `Avant (6 semaines), faire « ${f.a.name} » s'accompagnait de « ${f.b.name} » ×${f.before.toFixed(1)} plus souvent que la normale. Sur les 2 dernières semaines : ×${f.after.toFixed(1)} — l'effet a disparu. Cause probable : la routine s'est mechanicalisée ou ton contexte a changé. Re-ancre-les explicitement (stack) ou accepte que le lien soit terminé.`,
    stat: `lift ×${f.before.toFixed(1)}→×${f.after.toFixed(1)} · fenêtres 45j vs 14j`,
    action: { label: 'Voir stacks', view: 'stacks' as const },
  }];
}

// ---------- 15. habit ROI ranking (mood lift per check) ----------

function detectHabitRoi(habits: Habit[], days: Map<string, DayRow>): DeepInsight[] {
  const active = habits.filter((h) => !h.archived);
  const dates = [...days.keys()].sort().filter((d) => days.get(d)!.mood !== null);
  if (dates.length < 25 || active.length < 4) return [];
  const rois: { h: Habit; delta: number; k: number }[] = [];
  for (const h of active) {
    const withMood: number[] = [];
    const withoutMood: number[] = [];
    for (const d of dates) {
      const r = days.get(d)!;
      if (r.done.has(h.id)) withMood.push(r.mood!);
      else withoutMood.push(r.mood!);
    }
    if (withMood.length < 8 || withoutMood.length < 8) continue;
    const delta = mean(withMood) - mean(withoutMood);
    const p = twoMeanP(withMood, withoutMood);
    if (p === null || p >= 0.15 || delta <= 0.15) continue;
    rois.push({ h, delta, k: withMood.length });
  }
  if (rois.length < 3) return [];
  rois.sort((a, b) => b.delta - a.delta);
  const top = rois.slice(0, 3).map((r) => `« ${r.h.name} » (+${r.delta.toFixed(1)}, n=${r.k})`).join(' · ');
  return [{
    id: 'roi',
    icon: '🏆',
    title: 'Ton top 3 rendement/humeur',
    body: `Par humeur gagnée les jours faits vs non faits : ${top}. Si une semaine doit être serrée, ce sont CES trois-là à protéger en premier — le reste peut passer en version minimale.`,
    stat: `seuils Δ≥+0.15 · p<0.15 · n≥8 par côté`,
  }];
}

// ---------- 16. archive candidates ----------

function detectArchiveCandidates(habits: Habit[], days: Map<string, DayRow>, today: Date): DeepInsight[] {
  const out: DeepInsight[] = [];
  const todayStr = today.toISOString().slice(0, 10);
  for (const h of habits.filter((x) => !x.archived)) {
    const createdAgo = Math.floor((Date.now() - new Date(`${h.createdAt.slice(0, 10)}T00:00:00Z`).getTime()) / 86400000);
    if (createdAgo < 45) continue;
    let k = 0; let n = 0;
    for (let i = 1; i <= 30; i++) {
      const d = shiftDate(todayStr, -i);
      const r = days.get(d);
      if (!r || !r.tracked.has(h.id)) continue;
      n++;
      if (r.done.has(h.id)) k++;
    }
    if (n >= 10 && k / n < 0.25) {
      out.push({
        id: `archivecand|${h.id}`,
        icon: '📦',
        title: `« ${h.name} » : 45+ jours, ${Math.round((k / n) * 100)}% sur 30j`,
        body: `Créée il y a ${createdAgo} jours, complétée ${k}/${n} jours le mois dernier. Trois options honnêtes : archiver (la liste reste un moteur, pas un musée), réduire l'objectif au strict minimum, ou la fusionner dans une stack existante. Garder une habitude fantôme coûte de l'attention chaque jour.`,
        stat: `âge ${createdAgo}j · taux ${Math.round((k / n) * 100)}% · seuil <25%`,
        action: { label: 'Voir grille', view: 'grid' },
      });
    }
  }
  return out.slice(0, 1);
}

// ---------- entry ----------

export function generateDeepInsights(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string> = {},
  energies: Record<string, number> = {},
  today: Date = new Date(),
  protocols: Protocol[] = [],
): DeepInsight[] {
  try {
    const days = buildDayTable(checkIns, moods, energies);
    const out: DeepInsight[] = [
      ...detectStreakRisk(habits, days, today),
      ...detectFirstCheckEffect(checkIns, days),
      ...detectChains(habits, days),
      ...detectGoalCalibration(habits, checkIns, days, today),
      ...detectCannibalization(habits, days),
      ...detectWeekendDrift(habits, days, today),
      ...detectPairSynergy(habits, days),
      ...detectWeeklyLoad(days, today),
      ...detectOwnWords(checkIns, today),
      ...detectKnowledgeBridge(habits, days, today, protocols),
      ...detectPrimeWindows(habits, checkIns),
      ...detectRegimeFlips(habits, days),
      ...detectHabitRoi(habits, days),
      ...detectArchiveCandidates(habits, days, today),
      ...detectDoseResponse(days),
      ...detectRestartPattern(habits, checkIns, days, today),
    ];
    return out.slice(0, 11);
  } catch {
    return [];
  }
}
