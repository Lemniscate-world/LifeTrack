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
  transitHouse,
  wholeSignHouse,
} from '../astrology';
import * as A from 'astronomy-engine';

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
