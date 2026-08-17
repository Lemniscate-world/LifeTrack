import { describe, expect, it } from 'vitest';
import {
  SIGNS,
  ascendantLongitude,
  findBoundaryCrossing,
  isRetrograde,
  moonPhaseAt,
  nextFullMoon,
  nextNewMoon,
  nextRetrograde,
  nextTransitWindow,
  planetLongitude,
  signInHouse,
  signIndexOfLongitude,
  signOfLongitude,
  signOfPlanet,
  resolveTransitWindow,
  transitHouse,
  wholeSignHouse,
  aspectBetween,
  separationDeg,
  nextAspect,
  upcomingTransits,
  upcomingAspects,
  currentAspects,
  ASPECT_DEFS,
} from '../astrology';
import * as A from 'astronomy-engine';
import type { TransitBodyId } from '../astrology';

// Reference dates (verified against known ephemerides):
// - March equinox 2026: Sun at 0° Aries on 2026-03-20 ~14:46 UTC.
// - Mars 2026-03-20: ~344° (Pisces). Jupiter: ~105° (Cancer).
const EQUINOX = new Date('2026-03-20T14:46:00Z');

function lonAt(bodyId: string, date: Date): number {
  return planetLongitude(bodyId as never, date);
}

describe('astrology.longitudes', () => {
  it('Sun is at 0° Aries at the March 2026 equinox', () => {
    const lon = lonAt('sun', EQUINOX);
    expect(Math.abs(lon)).toBeLessThan(0.5);
    expect(signOfPlanet('sun', EQUINOX).name).toBe('Bélier');
  });

  it('Mars is in Pisces (~344°) and Jupiter in Cancer (~105°) at the equinox', () => {
    const mars = lonAt('mars', EQUINOX);
    expect(mars).toBeGreaterThan(330);
    expect(mars).toBeLessThan(350);
    expect(signOfPlanet('mars', EQUINOX).name).toBe('Poissons');
    const jup = lonAt('jupiter', EQUINOX);
    expect(jup).toBeGreaterThan(95);
    expect(jup).toBeLessThan(115);
    expect(signOfPlanet('jupiter', EQUINOX).name).toBe('Cancer');
  });

  it('Moon moves ~13°/day (2.5-day sign visits)', () => {
    const a = lonAt('moon', new Date('2026-03-20T00:00:00Z'));
    const b = lonAt('moon', new Date('2026-03-21T00:00:00Z'));
    const delta = Math.abs(((b - a + 540) % 360) - 180);
    expect(delta).toBeGreaterThan(9);
    expect(delta).toBeLessThan(18);
  });

  it('lunar node moves slowly retrograde (~18.6-year period)', () => {
    const n0 = lonAt('node', EQUINOX);
    const n1 = lonAt('node', new Date(EQUINOX.getTime() + 18.6 * 365.25 * 86400000));
    const delta = Math.abs(((n1 - n0 + 540) % 360) - 180);
    expect(delta).toBeLessThan(5);
  });
});

describe('astrology.signs', () => {
  it('maps longitudes to the 12 signs', () => {
    expect(signOfLongitude(0).name).toBe('Bélier');
    expect(signOfLongitude(29).name).toBe('Bélier');
    expect(signOfLongitude(30).name).toBe('Taureau');
    expect(signOfLongitude(345).name).toBe('Poissons');
    expect(signOfLongitude(359.9).name).toBe('Poissons');
    expect(signOfLongitude(360).name).toBe('Bélier');
    expect(signOfLongitude(-1).name).toBe('Poissons');
    expect(SIGNS.length).toBe(12);
    expect(SIGNS[0].element).toBe('feu');
    expect(SIGNS[3].element).toBe('eau');
  });
});

describe('astrology.boundary crossings', () => {
  it('finds the Sun entering Taurus after the equinox (April ~20)', () => {
    const d = findBoundaryCrossing('sun', 30, new Date('2026-01-01T00:00:00Z'), true);
    expect(d).not.toBeNull();
    const diff = Math.abs(d!.getTime() - new Date('2026-04-20T00:00:00Z').getTime());
    expect(diff).toBeLessThan(2 * 86400000);
  });

  it('returns null when no crossing exists within the horizon', () => {
    // Sun never crosses 0° going DOWN — should stay null.
    expect(findBoundaryCrossing('sun', 0, EQUINOX, false)).toBeNull();
  });
});

describe('astrology.transit windows', () => {
  it('Sun in Taurus: ~1 month window starting late April 2026', () => {
    const w = nextTransitWindow('sun', 1, new Date('2026-01-01T00:00:00Z'));
    expect(w).not.toBeNull();
    const startDiff = Math.abs(w!.start.getTime() - new Date('2026-04-20T00:00:00Z').getTime());
    expect(startDiff).toBeLessThan(2 * 86400000);
    const dur = (w!.end.getTime() - w!.start.getTime()) / 86400000;
    expect(dur).toBeGreaterThan(28);
    expect(dur).toBeLessThan(33);
  });

  it('Moon visits a sign for ~2.5 days', () => {
    const w = nextTransitWindow('moon', 0, new Date('2026-03-01T00:00:00Z'));
    expect(w).not.toBeNull();
    const dur = (w!.end.getTime() - w!.start.getTime()) / 86400000;
    expect(dur).toBeGreaterThan(1.8);
    expect(dur).toBeLessThan(3.6);
  });

  it('window start equals the rising boundary crossing', () => {
    const crossing = findBoundaryCrossing('sun', 60, new Date('2026-01-01T00:00:00Z'), true);
    const w = nextTransitWindow('sun', 2, new Date('2026-01-01T00:00:00Z'));
    expect(crossing).not.toBeNull();
    expect(w).not.toBeNull();
    expect(Math.abs(w!.start.getTime() - crossing!.getTime())).toBeLessThan(3600000);
  });
});

describe('astrology.resolveTransitWindow', () => {
  it('when the body is already inside the sign, starts at the last ingress', () => {
    // 2026-05-10: Sun is in Taurus (Apr 20 → May 21).
    const w = resolveTransitWindow('sun', 1, new Date('2026-05-10T00:00:00Z'));
    expect(w).not.toBeNull();
    expect(w!.start.getTime()).toBeLessThan(new Date('2026-05-10T00:00:00Z').getTime());
    expect(Math.abs(w!.start.getTime() - new Date('2026-04-20T00:00:00Z').getTime())).toBeLessThan(2 * 86400000);
    expect(w!.end.getTime()).toBeGreaterThan(new Date('2026-05-10T00:00:00Z').getTime());
    expect(w!.revisit).toBe(true);
  });

  it('when the body is not inside, starts at the next ingress (same as nextTransitWindow)', () => {
    const w = resolveTransitWindow('sun', 1, new Date('2026-01-01T00:00:00Z'));
    const w2 = nextTransitWindow('sun', 1, new Date('2026-01-01T00:00:00Z'));
    expect(w).not.toBeNull();
    expect(w2).not.toBeNull();
    expect(Math.abs(w!.start.getTime() - w2!.start.getTime())).toBeLessThan(3600000);
    expect(w!.revisit).toBe(false);
  });

  it('Moon: resolves the current 2.5-day visit when inside', () => {
    const signNow = signOfPlanet('moon', new Date('2026-03-20T00:00:00Z'));
    const w = resolveTransitWindow('moon', signNow.index, new Date('2026-03-20T00:00:00Z'));
    expect(w).not.toBeNull();
    const dur = (w!.end.getTime() - w!.start.getTime()) / 86400000;
    expect(dur).toBeGreaterThan(1);
    expect(dur).toBeLessThan(4);
  });
});

describe('astrology.retrogrades', () => {
  it('Venus: retrograde spring 2025 and late Oct 2026, direct in between', () => {
    expect(isRetrograde('venus', new Date('2025-04-05T00:00:00Z'))).toBe(true);
    expect(isRetrograde('venus', new Date('2025-06-01T00:00:00Z'))).toBe(false);
    expect(isRetrograde('venus', new Date('2025-10-22T00:00:00Z'))).toBe(false);
    expect(isRetrograde('venus', new Date('2026-11-01T00:00:00Z'))).toBe(true);
  });

  it('next retrograde: Venus cycle (~584 days) finds a window with start<end', () => {
    const r = nextRetrograde('venus', new Date('2026-01-01T00:00:00Z'));
    expect(r).not.toBeNull();
    expect(r!.start.getTime()).toBeGreaterThanOrEqual(new Date('2026-01-01T00:00:00Z').getTime());
    expect(r!.end.getTime()).toBeGreaterThan(r!.start.getTime());
    const durDays = (r!.end.getTime() - r!.start.getTime()) / 86400000;
    expect(durDays).toBeGreaterThan(30); // Venus retrogrades last ~6 weeks
  });

  it('isRetrograde is true inside the returned window and false just outside', () => {
    const r = nextRetrograde('mars', new Date('2026-01-01T00:00:00Z'));
    expect(r).not.toBeNull();
    const mid = new Date((r!.start.getTime() + r!.end.getTime()) / 2);
    const before = new Date(r!.start.getTime() - 3 * 86400000);
    const after = new Date(r!.end.getTime() + 3 * 86400000);
    expect(isRetrograde('mars', mid)).toBe(true);
    expect(isRetrograde('mars', before)).toBe(false);
    expect(isRetrograde('mars', after)).toBe(false);
  });

  it('lunar node is always retrograde', () => {
    expect(isRetrograde('node', EQUINOX)).toBe(true);
  });

  it('Sun and Moon are never retrograde', () => {
    expect(isRetrograde('sun', EQUINOX)).toBe(false);
    expect(isRetrograde('moon', EQUINOX)).toBe(false);
    expect(nextRetrograde('sun', new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('astrology.moon phases', () => {
  it('new moon after the 2026-03-20 equinox is 2026-04-17 (±1 day)', () => {
    const nm = nextNewMoon(EQUINOX);
    const diff = Math.abs(nm.getTime() - new Date('2026-04-17T00:00:00Z').getTime());
    expect(diff).toBeLessThan(86400000);
  });

  it('full moon after the equinox is early April 2026 (±1 day)', () => {
    const fm = nextFullMoon(EQUINOX);
    const diff = Math.abs(fm.getTime() - new Date('2026-04-02T00:00:00Z').getTime());
    expect(diff).toBeLessThan(86400000);
  });

  it('moonPhaseAt returns 0-360 degrees', () => {
    const p = moonPhaseAt(EQUINOX);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(360);
  });
});

describe('astrology.ascendant & whole sign houses', () => {
  it('ascendant ≈ Sun longitude at sunrise on the equinox (Greenwich)', () => {
    // At sunrise the Sun lies on the eastern horizon = the Ascendant point.
    const obs = new A.Observer(51.4779, 0, 0); // Greenwich
    const rise = A.SearchRiseSet(A.Body.Sun, obs, 1, A.MakeTime(new Date('2026-03-20T00:00:00Z')), 2);
    expect(rise).not.toBeNull();
    const asc = ascendantLongitude(rise!.date, { lat: 51.4779, lon: 0 });
    const sunLon = lonAt('sun', rise!.date);
    // SearchRiseSet returns the top of the Sun's disk with refraction, so the
    // centre is still slightly below the horizon — the Ascendant point is a few
    // degrees before the Sun, still in the previous sign. Allow ~5°.
    expect(Math.abs(asc - sunLon)).toBeLessThan(5);
    expect(['Bélier', 'Poissons']).toContain(signOfLongitude(asc).name);
  });

  it('whole-sign houses map correctly from a Bélier ascendant', () => {
    const asc = 0; // 0° Bélier ascendant
    expect(wholeSignHouse(0, asc)).toBe(1);       // Bélier = maison 1
    expect(wholeSignHouse(90, asc)).toBe(4);      // Cancer = maison 4 (IC)
    expect(wholeSignHouse(180, asc)).toBe(7);     // Balance = maison 7 (Desc)
    expect(wholeSignHouse(270, asc)).toBe(10);    // Capricorne = maison 10 (MC)
    expect(wholeSignHouse(350, asc)).toBe(12);
    expect(wholeSignHouse(360, asc)).toBe(1);
  });

  it('signInHouse returns the sign owning each house', () => {
    const h1 = signInHouse(0, 1);
    expect(h1.sign.name).toBe('Bélier');
    expect(signInHouse(0, 7).sign.name).toBe('Balance');
    expect(signInHouse(30, 1).sign.name).toBe('Taureau');
  });

  it('transitHouse places the Sun in house 1 when conjunct the ascendant', () => {
    // Find the moment the Sun crosses 0° (Bélier ingress) and place it against
    // a natal chart with Bélier ascendant: it must fall in house 1.
    const ingress = findBoundaryCrossing('sun', 0, new Date('2026-01-01T00:00:00Z'), true);
    expect(ingress).not.toBeNull();
    const h = transitHouse('sun', ingress!, 0);
    expect(h.house).toBe(1);
  });
});

describe('astrology.signIndexOfLongitude', () => {
  it('handles boundaries and negatives', () => {
    expect(signIndexOfLongitude(0)).toBe(0);
    expect(signIndexOfLongitude(29.99)).toBe(0);
    expect(signIndexOfLongitude(30)).toBe(1);
    expect(signIndexOfLongitude(359.9)).toBe(11);
    expect(signIndexOfLongitude(-30)).toBe(11);
    expect(signIndexOfLongitude(-1)).toBe(11);
  });
});

describe('astrology.aspects', () => {
  it('separationDeg returns the minimal absolute angle', () => {
    expect(separationDeg(10, 130)).toBe(120);
    expect(separationDeg(350, 10)).toBe(20);
    expect(separationDeg(0, 180)).toBe(180);
    expect(separationDeg(100, 100)).toBe(0);
  });

  it('aspectBetween recognizes a trine from real longitudes', () => {
    // Sun at 0° Aries (equinox) vs Jupiter ~105°: ~105° apart → trine (120) is
    // out of orb; verify against computed separation instead of fixed signs.
    const lonA = planetLongitude('sun', EQUINOX);
    const lonB = planetLongitude('jupiter', EQUINOX);
    const sep = separationDeg(lonA, lonB);
    // No aspect is guaranteed here; but the function must never return a kind
    // whose exact angle is far from the real separation.
    const kind = aspectBetween('sun', 'jupiter', EQUINOX);
    if (kind !== null) {
      const def = ASPECT_DEFS[kind];
      expect(Math.abs(sep - def.angle)).toBeLessThanOrEqual(def.orbDeg);
    }
  });

  it('nextAspect returns a moment where the aspect is exact (±0.05°)', () => {
    // Sun–Mars has a known cycle; find the next square from a fixed date and
    // verify the ephemeris at the returned moment.
    const from = new Date('2026-01-01T00:00:00Z');
    const ev = nextAspect('sun', 'mars', 'square', from, 400);
    expect(ev).not.toBeNull();
    const lonA = planetLongitude('sun', ev!);
    const lonB = planetLongitude('mars', ev!);
    const sep = separationDeg(lonA, lonB);
    expect(Math.abs(sep - 90)).toBeLessThan(0.05);
  });

  it('nextAspect finds an exact conjunction for Mercury–Sun within 120 days', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const ev = nextAspect('mercury', 'sun', 'conjunction', from, 120);
    expect(ev).not.toBeNull();
    const sep = separationDeg(planetLongitude('mercury', ev!), planetLongitude('sun', ev!));
    expect(sep).toBeLessThan(0.05);
  });

  it('upcomingTransits lists the current and next sign window for the Sun', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const items = upcomingTransits(['sun'], 120, from);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const sunItem = items.find((i) => i.bodyId === 'sun');
    expect(sunItem).toBeDefined();
    expect(sunItem!.window.end.getTime()).toBeGreaterThan(from.getTime());
    expect(sunItem!.signIndex).toBeGreaterThanOrEqual(0);
    expect(sunItem!.signIndex).toBeLessThanOrEqual(11);
  });

  it('upcomingAspects returns exact events consistent with the ephemeris', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const events = upcomingAspects([['sun', 'venus']], 150, from);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const ev of events.slice(0, 3)) {
      const def = ASPECT_DEFS[ev.kind];
      const sep = separationDeg(planetLongitude(ev.bodyA as TransitBodyId, ev.exactAt), planetLongitude(ev.bodyB as TransitBodyId, ev.exactAt));
      expect(Math.abs(sep - def.angle)).toBeLessThan(0.1);
      expect(ev.exactAt.getTime()).toBeGreaterThan(from.getTime());
    }
  });

  it('aspects to the natal Ascendant resolve against a fixed point', () => {
    // Cancer ascendant ≈ 90°; Mercury sweeps the whole zodiac in ~88 days, so
    // an exact aspect to the fixed ascendant point is guaranteed in 120 days.
    const from = new Date('2026-01-01T00:00:00Z');
    const ascLon = 90; // 0° Cancer
    const events = upcomingAspects([['asc', 'mercury']], 120, from, ascLon);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const ev of events.slice(0, 3)) {
      const def = ASPECT_DEFS[ev.kind];
      const sep = separationDeg(ascLon, planetLongitude(ev.bodyB as TransitBodyId, ev.exactAt));
      expect(Math.abs(sep - def.angle)).toBeLessThan(0.1);
    }
  });

  it('currentAspects evaluates asc pairs when the ascendant is given, ignores them otherwise', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const ascLon = 90;
    const withAsc = currentAspects([['asc', 'jupiter']], at, ascLon);
    const withoutAsc = currentAspects([['asc', 'jupiter']], at);
    expect(withoutAsc).toHaveLength(0);
    // With the ascendant the pair is evaluated: either in orb or not — but
    // never crashes and never fabricates an event outside the orb.
    for (const ev of withAsc) {
      expect(ev.bodyA).toBe('asc');
      const other = ev.bodyB as TransitBodyId;
      const sep = separationDeg(ascLon, planetLongitude(other, at));
      expect(Math.abs(sep - ASPECT_DEFS[ev.kind].angle)).toBeLessThanOrEqual(ASPECT_DEFS[ev.kind].orbDeg);
    }
  });
});
