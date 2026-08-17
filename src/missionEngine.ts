// src/missionEngine.ts
// Zero-touch mission engine: at startup (and on the ingestion heartbeat) the
// engine reads the sky — upcoming transits and planetary aspects — matches it
// to the user's weak life domains, and creates the matching missions
// automatically. No clicks. Idempotent by (body, sign) dedupe; opt-out via the
// missionAutoEnabled preference.

import {
  addMission, getMissions, getHabits, getCheckInsForHabit, exportAllData, getPreferences,
} from './store';
import { suggestMissionsFromSky } from './missions';
import { buildPreferenceReport } from './preferences';
import { ascendantLongitude } from './astrology';
import type { AppData, Mission, MissionTransitWindow } from './types';

/** Natal Ascendant longitude from the birth info stored in preferences (if any). */
function natalAscendant(): number | undefined {
  const p = getPreferences();
  if (!p.birthDate || p.birthLat === undefined || p.birthLon === undefined) return undefined;
  const date = new Date(`${p.birthDate}T${p.birthTime || '12:00'}:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    return ascendantLongitude(date, { lat: p.birthLat, lon: p.birthLon });
  } catch {
    return undefined;
  }
}

/**
 * Run one auto-mission pass. Creates at most `maxAuto` missions (weak-domain
 * transits first). Returns the number created.
 */
export function runAutoMissions(maxAuto = 2): number {
  try {
    if (getPreferences().missionAutoEnabled === false) return 0;
    const d = exportAllData() as unknown as AppData;
    const report = buildPreferenceReport({
      habits: d.habits ?? [],
      checkIns: d.checkIns ?? [],
      notes: d.notes ?? [],
      moods: d.moods ?? {},
      capacities: (d.capacities ?? []).map((c) => ({ id: c.id, name: c.name })),
      capacityRatings: d.capacityRatings ?? [],
      projects: d.projects ?? [],
      protocols: [],
      experiments: (d.experiments ?? []).map((e) => ({ id: e.id, title: e.title })),
      challenges: (d.challenges ?? []).map((c) => ({ id: c.id, name: c.name })),
      stickyMax: getPreferences().stickyMax ?? 3,
    });
    const habits = getHabits();
    const checkIns = habits.flatMap((h) => getCheckInsForHabit(h.id));
    const suggestions = suggestMissionsFromSky({
      habits,
      checkIns,
      weakDomains: report.weakDomains,
      existingMissions: getMissions(),
      ascendantLon: natalAscendant(),
      now: new Date(),
    });
    const coveredBodies = new Set(
      getMissions()
        .filter((m): m is Mission & { window: MissionTransitWindow } => m.window.kind === 'transit')
        .map((m) => m.window.body),
    );
    let created = 0;
    for (const s of suggestions) {
      if (!s.autoCreate || created >= maxAuto) break;
      if (s.window.kind === 'transit') {
        if (coveredBodies.has(s.window.body)) continue;
        coveredBodies.add(s.window.body);
      }
      addMission({
        name: s.name,
        objective: s.objective,
        habitIds: s.habitIds,
        window: s.window,
        quota: s.quota,
      });
      created++;
    }
    return created;
  } catch {
    return 0;
  }
}
