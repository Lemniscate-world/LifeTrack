// src/astrology.ts
// Pure, tested module for transit windows used by the Missions view.
//
// What it computes (all offline, via astronomy-engine ephemerides):
//   - geocentric ecliptic longitude of a planet at a date
//   - zodiac sign of a longitude / of a planet at a date
//   - transit windows: the period(s) a planet spends inside a sign
//   - retrograde periods (stations): start and end dates
//   - new moon / full moon dates
//   - Ascendant (whole-sign style, requires birth date + place) and whole-sign
//     house of a given longitude.
//
// Design notes:
//   - the Sun is NOT supported by astronomy-engine's EclipticLongitude
//     (heliocentric), so we always go through GeoVector + Ecliptic.
//   - Lunar nodes are not a physical body; we use the mean node formula
//     (always retrograde, period ~18.6 years).
//   - Sign ingress/egress handle retrograde re-entries (a planet can leave a
//     sign, come back, leave again — we return the contiguous window, and the
//     "revisit" flag tells the caller it bounced).

import * as A from 'astronomy-engine';

export type ElementType = 'feu' | 'terre' | 'air' | 'eau';

export interface SignInfo {
  index: number;      // 0 = Bélier … 11 = Poissons
  name: string;
  emoji: string;
  element: ElementType;
}

export const SIGNS: SignInfo[] = [
  { index: 0, name: 'Bélier', emoji: '♈', element: 'feu' },
  { index: 1, name: 'Taureau', emoji: '♉', element: 'terre' },
  { index: 2, name: 'Gémeaux', emoji: '♊', element: 'air' },
  { index: 3, name: 'Cancer', emoji: '♋', element: 'eau' },
  { index: 4, name: 'Lion', emoji: '♌', element: 'feu' },
  { index: 5, name: 'Vierge', emoji: '♍', element: 'terre' },
  { index: 6, name: 'Balance', emoji: '♎', element: 'air' },
  { index: 7, name: 'Scorpion', emoji: '♏', element: 'eau' },
  { index: 8, name: 'Sagittaire', emoji: '♐', element: 'feu' },
  { index: 9, name: 'Capricorne', emoji: '♑', element: 'terre' },
  { index: 10, name: 'Verseau', emoji: '♒', element: 'air' },
  { index: 11, name: 'Poissons', emoji: '♓', element: 'eau' },
];

export type TransitBodyId =
  | 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn'
  | 'uranus' | 'neptune' | 'pluto' | 'node';

export interface TransitBodyInfo {
  id: TransitBodyId;
  label: string;
  emoji: string;
  /** astronomy-engine body, or null for the lunar node (mean formula). */
  body: A.Body | null;
  /** True for the lunar node which is always retrograde. */
  alwaysRetrograde: boolean;
  /** Approx max daily motion in longitude (deg/day) — used for sampling. */
  maxDailyMotion: number;
  /** Max search horizon in days for ingress/retrograde solvers. */
  maxHorizonDays: number;
  /** Typical transit duration in a sign (for UX hints). */
  typicalSignDays: number;
}

export const TRANSIT_BODIES: TransitBodyInfo[] = [
  { id: 'sun', label: 'Soleil', emoji: '☀️', body: A.Body.Sun, alwaysRetrograde: false, maxDailyMotion: 1.02, maxHorizonDays: 370, typicalSignDays: 30 },
  { id: 'moon', label: 'Lune', emoji: '🌙', body: A.Body.Moon, alwaysRetrograde: false, maxDailyMotion: 14.3, maxHorizonDays: 35, typicalSignDays: 2.5 },
  { id: 'mercury', label: 'Mercure', emoji: '☿', body: A.Body.Mercury, alwaysRetrograde: false, maxDailyMotion: 2.1, maxHorizonDays: 180, typicalSignDays: 21 },
  { id: 'venus', label: 'Vénus', emoji: '♀', body: A.Body.Venus, alwaysRetrograde: false, maxDailyMotion: 1.2, maxHorizonDays: 180, typicalSignDays: 25 },
  { id: 'mars', label: 'Mars', emoji: '♂', body: A.Body.Mars, alwaysRetrograde: false, maxDailyMotion: 0.7, maxHorizonDays: 400, typicalSignDays: 45 },
  { id: 'jupiter', label: 'Jupiter', emoji: '♃', body: A.Body.Jupiter, alwaysRetrograde: false, maxDailyMotion: 0.23, maxHorizonDays: 1400, typicalSignDays: 365 },
  { id: 'saturn', label: 'Saturne', emoji: '♄', body: A.Body.Saturn, alwaysRetrograde: false, maxDailyMotion: 0.13, maxHorizonDays: 1400, typicalSignDays: 840 },
  { id: 'uranus', label: 'Uranus', emoji: '⛢', body: A.Body.Uranus, alwaysRetrograde: false, maxDailyMotion: 0.06, maxHorizonDays: 2000, typicalSignDays: 2555 },
  { id: 'neptune', label: 'Neptune', emoji: '♆', body: A.Body.Neptune, alwaysRetrograde: false, maxDailyMotion: 0.04, maxHorizonDays: 2000, typicalSignDays: 4380 },
  { id: 'pluto', label: 'Pluton', emoji: '♇', body: A.Body.Pluto, alwaysRetrograde: false, maxDailyMotion: 0.03, maxHorizonDays: 2000, typicalSignDays: 7300 },
  { id: 'node', label: 'Nœud Nord', emoji: '☊', body: null, alwaysRetrograde: true, maxDailyMotion: 0.054, maxHorizonDays: 2000, typicalSignDays: 555 },
];

const BODY_BY_ID = new Map(TRANSIT_BODIES.map((b) => [b.id, b]));

export function getTransitBody(id: TransitBodyId): TransitBodyInfo {
  return BODY_BY_ID.get(id)!;
}

const DEG = Math.PI / 180;

/** Mean obliquity of the ecliptic (degrees) — varies <0.02° over a century. */
export const MEAN_OBLIQUITY_DEG = 23.43928;

/** J2000 epoch in UTC-based Julian days used by astronomy-engine. */
function makeTime(date: Date): A.AstroTime {
  return A.MakeTime(date);
}

/** Geocentric apparent ecliptic longitude of a planet at a date (0-360°). */
export function planetLongitude(bodyId: TransitBodyId, date: Date): number {
  const info = getTransitBody(bodyId);
  if (info.body === null) {
    // Mean lunar node (always retrograde).
    const jd = makeTime(date).ut;
    const T = jd - 2451545.0;
    return (((125.04452 - 0.05295377 * T) % 360) + 360) % 360;
  }
  const v = A.GeoVector(info.body, makeTime(date), true);
  const e = A.Ecliptic(v);
  return ((e.elon % 360) + 360) % 360;
}

/** Index (0-11) of the zodiac sign containing a longitude. */
export function signIndexOfLongitude(lon: number): number {
  return Math.floor((((lon % 360) + 360) % 360) / 30) % 12;
}

export function signOfLongitude(lon: number): SignInfo {
  return SIGNS[signIndexOfLongitude(lon)];
}

export function signOfPlanet(bodyId: TransitBodyId, date: Date): SignInfo {
  return signOfLongitude(planetLongitude(bodyId, date));
}

/** Signed smallest angle a→b in degrees, in [-180, 180). */
function signedAngle(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Find the most recent moment before `fromDate` where the body entered
 * `signIndex` (rising crossing of its lower boundary). Used when the body is
 * already inside the sign. Returns null if not found within the horizon.
 */
export function findLastIngress(bodyId: TransitBodyId, signIndex: number, fromDate: Date): Date | null {
  const info = getTransitBody(bodyId);
  const stepDays = sampleStep(info);
  const jd0 = makeTime(fromDate).ut;
  const horizon = info.maxHorizonDays;
  const offset = (jd: number) => signedAngle(signIndex * 30, planetLongitude(bodyId, dateFromJulian(jd)));

  let t1 = jd0;
  let o1 = offset(t1);
  const end = jd0 - horizon;
  for (let t = t1 - stepDays; t >= end; t -= stepDays) {
    const o0 = offset(t);
    if (o0 !== 0 && o1 !== 0 && Math.sign(o0) !== Math.sign(o1)) {
      const dir = Math.sign(o1 - o0);
      if (dir > 0) {
        return dateFromJulian(bissect(offset, t, t1));
      }
    }
    t1 = t;
    o1 = o0;
  }
  return null;
}

/**
 * Resolve the current/next window of a body inside a sign, relative to
 * `fromDate`: if the body is already inside, the window started at the last
 * ingress; otherwise it starts at the next ingress. The end is the first
 * exit after the start.
 */
export function resolveTransitWindow(
  bodyId: TransitBodyId,
  signIndex: number,
  fromDate: Date,
): TransitWindow | null {
  const info = getTransitBody(bodyId);
  const inside = signIndexOfLongitude(planetLongitude(bodyId, fromDate)) === signIndex;
  let start: Date | null;
  if (inside) {
    start = findLastIngress(bodyId, signIndex, fromDate);
  } else {
    start = findBoundaryCrossing(bodyId, signIndex * 30, fromDate, true);
  }
  if (!start) return null;

  // Walk forward from the start, detect the first exit (any direction).
  const stepDays = sampleStep(info);
  const jd0 = makeTime(start).ut;
  const horizon = info.maxHorizonDays;
  let prevJd = jd0;
  for (let t = jd0 + stepDays; t <= jd0 + horizon; t += stepDays) {
    const sign = signIndexOfLongitude(planetLongitude(bodyId, dateFromJulian(t)));
    if (sign !== signIndex) {
      const exitDate = dateFromJulian(bissect(
        (jd) => signIndex - signIndexOfLongitude(planetLongitude(bodyId, dateFromJulian(jd))),
        prevJd,
        t,
      ));
      return { start, end: exitDate, revisit: inside };
    }
    prevJd = t;
  }
  return null;
}

/** Bisection over an interval [t0, t1] where f flips sign, up to `iter` passes. */
function bissect(f: (t: number) => number, t0: number, t1: number, iter = 60): number {
  let lo = t0;
  let hi = t1;
  let fLo = f(lo);
  for (let i = 0; i < iter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (fMid === 0) return mid;
    if (Math.sign(fLo) === Math.sign(fMid)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** J2000 epoch in ms — astronomy-engine AstroTime.ut is days since J2000. */
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

function dateFromJulian(jd: number): Date {
  return new Date(J2000_MS + jd * 86400000);
}

/** Sample step in days so we never skip a full sign (30°) with retrograde motion. */
function sampleStep(info: TransitBodyInfo): number {
  // Must satisfy step * (maxDailyMotion) < 15° to never skip a boundary,
  // and < 30° to never skip a whole sign. Use a safe factor of 6°.
  const step = 6 / info.maxDailyMotion;
  return Math.min(step, 1.5); // cap at 1.5 days for fine resolution
}

/**
 * Find the next moment where the body's longitude crosses `targetLon`
 * moving in direction `up` (true = rising through the boundary).
 * Returns a Date or null if not found within the horizon.
 */
export function findBoundaryCrossing(
  bodyId: TransitBodyId,
  targetLon: number,
  fromDate: Date,
  up: boolean,
): Date | null {
  const info = getTransitBody(bodyId);
  const stepDays = sampleStep(info);
  const jd0 = makeTime(fromDate).ut;
  const horizon = info.maxHorizonDays;

  const offset = (jd: number) => signedAngle(targetLon, planetLongitude(bodyId, dateFromJulian(jd)));

  let t0 = jd0;
  let o0 = offset(t0);
  const end = jd0 + horizon;
  for (let t = t0 + stepDays; t <= end; t += stepDays) {
    const o1 = offset(t);
    // Crossing when sign flips; direction = sign of the slope.
    if (o0 !== 0 && o1 !== 0 && Math.sign(o0) !== Math.sign(o1)) {
      const dir = Math.sign(o1 - o0);
      if ((up && dir > 0) || (!up && dir < 0)) {
        const x = bissect(offset, t0, t);
        // Guard against false crossings at the antipode (offset jumps ±180
        // there without the body actually reaching targetLon).
        const lon = planetLongitude(bodyId, dateFromJulian(x));
        if (Math.abs(signedAngle(targetLon, lon)) < 1) {
          return dateFromJulian(x);
        }
      }
    }
    t0 = t;
    o0 = o1;
  }
  return null;
}

export interface TransitWindow {
  start: Date;
  end: Date;
  /** True when the planet left the sign then came back (retrograde bounce). */
  revisit: boolean;
}

/**
 * Next contiguous window during which the body stays inside `signIndex`.
 * Handles retrograde exits/re-entries by walking day by day from the ingress.
 */
export function nextTransitWindow(bodyId: TransitBodyId, signIndex: number, fromDate: Date): TransitWindow | null {
  const info = getTransitBody(bodyId);
  const ingress = findBoundaryCrossing(bodyId, signIndex * 30, fromDate, true);
  if (!ingress) return null;

  // Walk forward from the ingress, detect the first exit (any direction).
  const stepDays = sampleStep(info);
  const jd0 = makeTime(ingress).ut;
  const horizon = info.maxHorizonDays;
  let prevJd = jd0;
  for (let t = jd0 + stepDays; t <= jd0 + horizon; t += stepDays) {
    const sign = signIndexOfLongitude(planetLongitude(bodyId, dateFromJulian(t)));
    if (sign !== signIndex) {
      const exitDate = dateFromJulian(bissect(
        (jd) => signIndex - signIndexOfLongitude(planetLongitude(bodyId, dateFromJulian(jd))),
        prevJd,
        t,
      ));
      return { start: ingress, end: exitDate, revisit: false };
    }
    prevJd = t;
  }
  return null;
}

/** True if the body is retrograde (apparent longitude decreasing) at a date. */
export function isRetrograde(bodyId: TransitBodyId, date: Date): boolean {
  const info = getTransitBody(bodyId);
  if (info.alwaysRetrograde) return true;
  const jd = makeTime(date).ut;
  const delta = info.maxDailyMotion < 0.1 ? 1.5 : 0.25;
  const lonA = planetLongitude(bodyId, dateFromJulian(jd - delta));
  const lonB = planetLongitude(bodyId, dateFromJulian(jd + delta));
  return signedAngle(lonA, lonB) < 0;
}

export interface RetrogradeWindow {
  start: Date;
  end: Date;
}

/** Next retrograde period: station retrograde → station direct. */
export function nextRetrograde(bodyId: TransitBodyId, fromDate: Date): RetrogradeWindow | null {
  const info = getTransitBody(bodyId);
  if (info.alwaysRetrograde) return null;

  const stepDays = Math.max(sampleStep(info) * 2, 1);
  const jd0 = makeTime(fromDate).ut;
  // Venus has a ~584-day retrograde cycle; use a generous horizon.
  const horizon = Math.max(info.maxHorizonDays, 1100);
  const vel = (jd: number) =>
    signedAngle(
      planetLongitude(bodyId, dateFromJulian(jd - stepDays)),
      planetLongitude(bodyId, dateFromJulian(jd + stepDays)),
    );

  let t0 = jd0;
  let v0 = vel(t0);
  for (let t = jd0 + stepDays; t <= jd0 + horizon; t += stepDays) {
    const v1 = vel(t);
    // Retrograde start: speed goes from positive to negative.
    if (v0 > 0 && v1 < 0) {
      const start = dateFromJulian(bissect(vel, t0, t));
      // Find station direct after the start.
      let u0 = makeTime(start).ut;
      let w0 = vel(u0);
      for (let u = u0 + stepDays; u <= u0 + horizon; u += stepDays) {
        const w1 = vel(u);
        if (w0 < 0 && w1 > 0) {
          return { start, end: dateFromJulian(bissect(vel, u0, u)) };
        }
        u0 = u;
        w0 = w1;
      }
      return { start, end: dateFromJulian(u0) };
    }
    t0 = t;
    v0 = v1;
  }
  return null;
}

/** Next new moon (phase 0°) after a date. */
export function nextNewMoon(fromDate: Date): Date {
  const r = A.SearchMoonPhase(0, makeTime(fromDate), 40);
  if (!r) throw new Error('nextNewMoon: no result within 40 days');
  return r.date;
}

/** Next full moon (phase 180°) after a date. */
export function nextFullMoon(fromDate: Date): Date {
  const r = A.SearchMoonPhase(180, makeTime(fromDate), 40);
  if (!r) throw new Error('nextFullMoon: no result within 40 days');
  return r.date;
}

/** Moon phase (0 = new, 180 = full) at a date, in degrees. */
export function moonPhaseAt(date: Date): number {
  return A.MoonPhase(makeTime(date));
}

export interface Place {
  /** Latitude in degrees (positive = north). */
  lat: number;
  /** Longitude in degrees (positive = east of Greenwich). */
  lon: number;
}

/**
 * Ecliptic longitude of the Ascendant at a given moment and place.
 * Formula: the point of the ecliptic that lies on the eastern horizon,
 * derived from the local sidereal time and the mean obliquity.
 */
export function ascendantLongitude(date: Date, place: Place): number {
  const gmstHours = A.SiderealTime(makeTime(date)); // hours
  const lst = ((gmstHours * 15 + place.lon) % 360 + 360) % 360;
  const phi = place.lat * DEG;
  const L = lst * DEG;
  const eps = MEAN_OBLIQUITY_DEG * DEG;
  const asc = Math.atan2(Math.cos(L), -(Math.sin(eps) * Math.tan(phi) + Math.cos(eps) * Math.sin(L)));
  return ((asc / DEG) % 360 + 360) % 360;
}

/** Whole-sign house (1-12) of an ecliptic longitude given the natal Ascendant. */
export function wholeSignHouse(lon: number, natalAscendant: number): number {
  const d = (((lon - natalAscendant) % 360) + 360) % 360;
  return Math.floor(d / 30) + 1;
}

export interface HouseInfo {
  house: number; // 1-12
  sign: SignInfo;
}

/** Sign occupying a given whole-sign house in the natal chart. */
export function signInHouse(natalAscendant: number, house: number): HouseInfo {
  const h = Math.max(1, Math.min(12, Math.round(house)));
  const lon = (natalAscendant + (h - 1) * 30) % 360;
  return { house: h, sign: signOfLongitude(lon) };
}

/** Whole-sign house of a transit body at a date, against a natal chart. */
export function transitHouse(bodyId: TransitBodyId, date: Date, natalAscendant: number): HouseInfo {
  const lon = planetLongitude(bodyId, date);
  const house = wholeSignHouse(lon, natalAscendant);
  return { house, sign: signOfLongitude(lon) };
}

// ============================================================================
// Planetary aspects (Jupiter trine Pluto, Mars square Saturn, …)
// ============================================================================

export type AspectKind = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';

export interface AspectDef {
  kind: AspectKind;
  /** Exact angle of the aspect (degrees). */
  angle: number;
  /** Classical orb (degrees) used for the "active now" display. */
  orbDeg: number;
  emoji: string;
  label: string;
  /** Favorable (opportunity) vs tense (vigilance). */
  tone: 'favorable' | 'tension' | 'neutral';
}

export const ASPECT_DEFS: Record<AspectKind, AspectDef> = {
  conjunction: { kind: 'conjunction', angle: 0, orbDeg: 8, emoji: '☌', label: 'Conjonction', tone: 'neutral' },
  sextile: { kind: 'sextile', angle: 60, orbDeg: 4, emoji: '⚹', label: 'Sextile', tone: 'favorable' },
  square: { kind: 'square', angle: 90, orbDeg: 6, emoji: '□', label: 'Carré', tone: 'tension' },
  trine: { kind: 'trine', angle: 120, orbDeg: 6, emoji: '△', label: 'Trigon', tone: 'favorable' },
  opposition: { kind: 'opposition', angle: 180, orbDeg: 8, emoji: '☍', label: 'Opposition', tone: 'tension' },
};

export const ASPECT_KINDS: AspectKind[] = ['conjunction', 'sextile', 'square', 'trine', 'opposition'];

/**
 * Absolute minimal angular separation between two longitudes (0-180°).
 */
export function separationDeg(lonA: number, lonB: number): number {
  const d = Math.abs((((lonA - lonB) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * The aspect (if any) formed between two bodies at a date, within the
 * classical orb. Returns the tightest aspect when several are in orb
 * (only possible for the conjunction/sextile zone in practice).
 */
export function aspectBetween(bodyA: TransitBodyId, bodyB: TransitBodyId, date: Date): AspectKind | null {
  const sep = separationDeg(planetLongitude(bodyA, date), planetLongitude(bodyB, date));
  let best: AspectKind | null = null;
  let bestGap = Infinity;
  for (const kind of ASPECT_KINDS) {
    const def = ASPECT_DEFS[kind];
    const gap = Math.abs(sep - def.angle);
    if (gap <= def.orbDeg && gap < bestGap) {
      best = kind;
      bestGap = gap;
    }
  }
  return best;
}

/** Absolute separation from the exact angle of an aspect kind. */
function aspectGap(bodyA: TransitBodyId, bodyB: TransitBodyId, kind: AspectKind, date: Date): number {
  const def = ASPECT_DEFS[kind];
  return Math.abs(separationDeg(planetLongitude(bodyA, date), planetLongitude(bodyB, date)) - def.angle);
}

/** Ternary-search refinement of a unimodal gap function over [t0, t1]. */
function refineMin(f: (t: number) => number, t0: number, t1: number, iter = 60): number {
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < iter; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (f(m1) <= f(m2)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

export interface AspectEvent {
  bodyA: AspectPoint;
  bodyB: AspectPoint;
  kind: AspectKind;
  /** Moment when the aspect is exact. */
  exactAt: Date;
}

/**
 * Next moment when two bodies form an exact `kind` aspect, scanning forward
 * from `fromDate`. The gap function is sampled, local minima below the orb
 * are refined by ternary search. Null when nothing within the horizon.
 */
export function nextAspect(
  bodyA: TransitBodyId,
  bodyB: TransitBodyId,
  kind: AspectKind,
  fromDate: Date,
  horizonDays = 150,
): Date | null {
  const gap = (t: number) => aspectGap(bodyA, bodyB, kind, dateFromJulian(t));
  const step = 0.5;
  const jd0 = makeTime(fromDate).ut;
  let prevT = jd0;
  let prevGap = gap(prevT);
  for (let t = jd0 + step; t <= jd0 + horizonDays; t += step) {
    const g = gap(t);
    if (g < prevGap) {
      // Still descending — the local minimum is ahead.
      const tNext = t + step;
      const gNext = gap(tNext);
      if (g <= gNext) {
        const refined = refineMin(gap, prevT, tNext);
        if (gap(refined) < ASPECT_DEFS[kind].orbDeg) {
          return dateFromJulian(refined);
        }
      }
    }
    prevT = t;
    prevGap = g;
  }
  return null;
}

/** Curated pair list for the aspect calendar (all bodies except the Moon). */
export const ASPECT_PAIRS: [TransitBodyId, TransitBodyId][] = [
  ['sun', 'mercury'], ['sun', 'venus'], ['sun', 'mars'], ['sun', 'jupiter'], ['sun', 'saturn'],
  ['mercury', 'venus'], ['mercury', 'mars'], ['mercury', 'jupiter'], ['mercury', 'saturn'],
  ['venus', 'mars'], ['venus', 'jupiter'], ['venus', 'saturn'], ['venus', 'uranus'],
  ['mars', 'jupiter'], ['mars', 'saturn'], ['mars', 'uranus'], ['mars', 'pluto'],
  ['jupiter', 'saturn'], ['jupiter', 'uranus'], ['jupiter', 'neptune'], ['jupiter', 'pluto'],
  ['saturn', 'uranus'], ['saturn', 'neptune'], ['saturn', 'pluto'],
  ['uranus', 'neptune'], ['uranus', 'pluto'], ['neptune', 'pluto'],
  ['jupiter', 'node'], ['saturn', 'node'],
];

export type AspectPoint = TransitBodyId | 'asc';

export interface TransitScheduleItem {
  bodyId: TransitBodyId;
  signIndex: number;
  sign: SignInfo;
  window: TransitWindow;
}

/**
 * Aspect pairs against the natal Ascendant point: transiting planets in exact
 * aspect to the Rising sign are a classic "personal timing" signal. The Moon is
 * excluded (too fast). 'asc' pairs need an `ascendantLon` at call time.
 */
export const ASC_ASPECT_PAIRS: [AspectPoint, AspectPoint][] = [
  ['asc', 'sun'], ['asc', 'mercury'], ['asc', 'venus'], ['asc', 'mars'],
  ['asc', 'jupiter'], ['asc', 'saturn'], ['asc', 'uranus'], ['asc', 'neptune'],
  ['asc', 'pluto'], ['asc', 'node'],
];

/**
 * Upcoming whole-sign transit windows (next ingress → exit) for a set of
 * bodies, within a horizon. Moon windows (~2.5 days) are included — the
 * mission engine filters them out, the calendar keeps them.
 */
export function upcomingTransits(
  bodies: TransitBodyId[],
  horizonDays: number,
  fromDate: Date,
): TransitScheduleItem[] {
  const items: TransitScheduleItem[] = [];
  for (const bodyId of bodies) {
    const info = getTransitBody(bodyId);
    const horizon = Math.min(horizonDays, info.maxHorizonDays);
    const signIndex = signIndexOfLongitude(planetLongitude(bodyId, fromDate));
    const first = resolveTransitWindow(bodyId, signIndex, fromDate);
    if (first && first.end.getTime() > fromDate.getTime()) {
      items.push({ bodyId, signIndex, sign: SIGNS[signIndex], window: first });
    }
    const next = nextTransitWindow(bodyId, (signIndex + 1) % 12, fromDate);
    if (next && next.start.getTime() - fromDate.getTime() <= horizon * 86400000) {
      items.push({ bodyId, signIndex: (signIndex + 1) % 12, sign: SIGNS[(signIndex + 1) % 12], window: next });
    }
  }
  return items.sort((a, b) => a.window.start.getTime() - b.window.start.getTime());
}

/**
 * Upcoming exact aspect events for the curated pair list, within a horizon.
 * Longitudes are precomputed once on a shared 0.5-day grid (one ephemeris call
 * per body per step) and every pair×kind crossing is detected on the arrays —
 * roughly 20× cheaper than per-pair sampling. Local minima below the orb are
 * refined by ternary search. When `ascendantLon` is given, the natal Ascendant
 * point ('asc') can be part of the pairs — its longitude is constant, so it
 * only adds array work, no extra ephemeris calls.
 */
export function upcomingAspects(
  pairs: [AspectPoint, AspectPoint][],
  horizonDays: number,
  fromDate: Date,
  ascendantLon?: number,
): AspectEvent[] {
  const bodies: AspectPoint[] = [];
  for (const [bodyA, bodyB] of pairs) {
    if (bodyA === 'asc' || bodyB === 'asc') {
      if (ascendantLon === undefined) continue;
    }
    if (!bodies.includes(bodyA)) bodies.push(bodyA);
    if (!bodies.includes(bodyB)) bodies.push(bodyB);
  }

  const step = 0.5;
  const n = Math.max(3, Math.ceil(horizonDays / step) + 2);
  const jd0 = makeTime(fromDate).ut;
  const grid: number[] = new Array(n);
  const lons: Record<string, number[]> = {};
  for (const b of bodies) lons[b] = new Array(n);
  for (let i = 0; i < n; i++) {
    grid[i] = jd0 + i * step;
    const date = dateFromJulian(grid[i]);
    for (const b of bodies) {
      lons[b][i] = b === 'asc' ? ascendantLon! : planetLongitude(b, date);
    }
  }

  const lonAt = (point: AspectPoint, t: number): number =>
    point === 'asc' ? ascendantLon! : planetLongitude(point, dateFromJulian(t));
  const gapAt = (pointA: AspectPoint, pointB: AspectPoint, kind: AspectKind, t: number): number =>
    Math.abs(separationDeg(lonAt(pointA, t), lonAt(pointB, t)) - ASPECT_DEFS[kind].angle);

  const events: AspectEvent[] = [];
  for (const [bodyA, bodyB] of pairs) {
    if (bodyA === 'asc' || bodyB === 'asc') {
      if (ascendantLon === undefined) continue;
    }
    const la = lons[bodyA];
    const lb = lons[bodyB];
    for (const kind of ASPECT_KINDS) {
      const angle = ASPECT_DEFS[kind].angle;
      const orb = ASPECT_DEFS[kind].orbDeg;
      for (let i = 1; i < n - 1; i++) {
        const gPrev = Math.abs(separationDeg(la[i - 1], lb[i - 1]) - angle);
        const gCur = Math.abs(separationDeg(la[i], lb[i]) - angle);
        const gNext = Math.abs(separationDeg(la[i + 1], lb[i + 1]) - angle);
        if (gCur <= gPrev && gCur <= gNext && gCur < orb) {
          const refined = refineMin((t) => gapAt(bodyA, bodyB, kind, t), grid[i - 1], grid[i + 1]);
          const exactAt = dateFromJulian(refined);
          if (exactAt.getTime() >= fromDate.getTime() && gapAt(bodyA, bodyB, kind, refined) < 0.1) {
            events.push({ bodyA, bodyB, kind, exactAt });
          }
        }
      }
    }
  }
  return events.sort((a, b) => a.exactAt.getTime() - b.exactAt.getTime());
}

/**
 * Aspects currently in orb at a date, for a pair list — the "sky dashboard".
 * `asc` pairs are evaluated against the natal Ascendant longitude when given.
 */
export function currentAspects(
  pairs: [AspectPoint, AspectPoint][],
  date: Date,
  ascendantLon?: number,
): AspectEvent[] {
  const lonOf = (point: AspectPoint): number =>
    point === 'asc' ? (ascendantLon ?? NaN) : planetLongitude(point, date);
  const out: AspectEvent[] = [];
  for (const [bodyA, bodyB] of pairs) {
    const la = lonOf(bodyA);
    const lb = lonOf(bodyB);
    if (!Number.isFinite(la) || !Number.isFinite(lb)) continue;
    const kind = ASPECT_KINDS.find((k) => Math.abs(separationDeg(la, lb) - ASPECT_DEFS[k].angle) <= ASPECT_DEFS[k].orbDeg);
    if (kind) out.push({ bodyA, bodyB, kind, exactAt: date });
  }
  return out.sort((a, b) =>
    ASPECT_KINDS.indexOf(a.kind) - ASPECT_KINDS.indexOf(b.kind),
  );
}
