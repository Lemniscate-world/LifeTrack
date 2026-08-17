// src/knowledgeEngine.ts
// Zero-touch knowledge engine: the preference report already reads notes,
// habits, projects and correlations, then ranks protocols worth testing. This
// engine goes one step further — it adopts the top suggested protocols by
// itself (creating the linked habits) at startup and on the ingestion
// heartbeat. Idempotent: adopted protocols become "already pursued" on the
// next pass. Opt-out via the knowledgeAutoAdopt preference (default ON).

import {
  exportAllData, getPreferences, getHabits, getProtocols, addHabit,
} from './store';
import { buildPreferenceReport } from './preferences';
import { adoptProtocol, SEED_PROTOCOLS } from './protocols';
import type { AppData } from './types';

/**
 * Run one auto-adoption pass. Adopts at most `maxAuto` suggested protocols
 * (those with the highest evidence score that are not pursued yet) by creating
 * their linked habits. Returns the number of newly adopted protocols.
 */
export function runAutoKnowledge(maxAuto = 2): number {
  try {
    if (getPreferences().knowledgeAutoAdopt === false) return 0;
    const d = exportAllData() as unknown as AppData;
    const report = buildPreferenceReport({
      habits: d.habits ?? [],
      checkIns: d.checkIns ?? [],
      notes: d.notes ?? [],
      moods: d.moods ?? {},
      capacities: (d.capacities ?? []).map((c) => ({ id: c.id, name: c.name })),
      capacityRatings: d.capacityRatings ?? [],
      projects: d.projects ?? [],
      protocols: getProtocols(),
      experiments: (d.experiments ?? []).map((e) => ({ id: e.id, title: e.title })),
      challenges: (d.challenges ?? []).map((c) => ({ id: c.id, name: c.name })),
      stickyMax: getPreferences().stickyMax ?? 3,
    });
    const allProtocols = getProtocols();
    const habits = getHabits();
    let adopted = 0;
    for (const ranked of report.protocols) {
      if (adopted >= maxAuto) break;
      if (ranked.alreadyPursued) continue;
      const res = adoptProtocol(
        ranked.protocol.id,
        allProtocols.length > 0 ? allProtocols : SEED_PROTOCOLS,
        habits,
        (hData) => addHabit(hData.name ?? ranked.protocol.title),
      );
      if (res.created.length > 0) {
        adopted++;
        // Keep the pass consistent: later ranks must see the new habits.
        habits.push(...res.created);
      }
    }
    return adopted;
  } catch {
    return 0;
  }
}