// src/deepInsights.ts
// Deep analysis engine — multi-hop chains, streak risk forecast, contrastive
// own-words, dose-response, cannibalization, restart patterns.
//
// Unlike recommendations.ts (broad coverage, one rule per pattern), this module
// digs FEW but DEEP: every card carries its sample size / p-value / effect and
// quotes the user's own data (notes words, weekday rates) so nothing feels
// generic. Pure module — fully unit-testable.

import type { Habit, CheckIn } from './types';
import { moodRank } from './correlations';

export interface DeepInsight {
  id: string;
  icon: string;
  title: string;
  body: string;
  stat: string;
  action?: { label: string; view: 'grid' | 'stats' | 'correlations' | 'history' | 'journal' };
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

// ---------- 1. chains: A(day t) → B(day t+1) → mood ----------

function detectChains(habits: Habit[], days: Map<string, DayRow>): DeepInsight[] {
  const active = habits.filter((h) => !h.archived);
  const dates = [...days.keys()].sort();
  if (dates.length < 14) return [];
  const habitById = new Map(active.map((h) => [h.id, h]));

  // Global base rates
  let totalTrackedDays = 0;
  const bDone = new Map<string, number>();
  const bTracked = new Map<string, number>();
  for (const d of dates) {
    const r = days.get(d)!;
    if (r.tracked.size > 0) totalTrackedDays++;
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

// ---------- entry ----------

export function generateDeepInsights(
  habits: Habit[],
  checkIns: CheckIn[],
  moods: Record<string, string> = {},
  energies: Record<string, number> = {},
  today: Date = new Date(),
): DeepInsight[] {
  try {
    const days = buildDayTable(checkIns, moods, energies);
    const out: DeepInsight[] = [
      ...detectStreakRisk(habits, days, today),
      ...detectChains(habits, days),
      ...detectCannibalization(habits, days),
      ...detectOwnWords(checkIns, today),
      ...detectDoseResponse(days),
      ...detectRestartPattern(habits, checkIns, days, today),
    ];
    return out.slice(0, 7);
  } catch {
    return [];
  }
}
