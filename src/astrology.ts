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
