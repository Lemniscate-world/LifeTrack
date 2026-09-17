// src/AstoView.tsx
// Asto: a goal bound to a window (fixed dates or an astrological
// whole-sign transit) and tied to the user's habits. LifeTrack measures the
// progress automatically from the real check-ins and shows the pace required
// to reach the quota before the window closes.

import { useState, useEffect, useMemo } from 'react';
import {
  getMissions, addMission, deleteMission, archiveMission,
  getHabits, getCheckInsForHabit, getPreferences, subscribe, exportAllData,
} from './store';
import { computeMissionProgress, suggestQuota, MISSION_STATUS_LABEL, suggestMissionsFromSky, type AutoMissionSuggestion } from './asto';
import { buildPreferenceReport } from './preferences';
import {
  SIGNS, TRANSIT_BODIES, resolveTransitWindow, signOfPlanet, isRetrograde, getTransitBody,
  ascendantLongitude, moonPhaseAt, wholeSignHouse, planetLongitude, nextRetrograde,
  upcomingTransits, upcomingAspects, currentAspects, ASPECT_DEFS, ASPECT_PAIRS, ASC_ASPECT_PAIRS,
  type TransitBodyId,
} from './astrology';
import { todayStr } from './mantras';
import type { Mission, MissionWindow } from './types';
import { toDateKey } from './dates';

const STATUS_EMOJI: Record<string, string> = {
  upcoming: '🕐', active: '🔥', done: '✅', failed: '❌', archived: '📦',
};

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export default function AstoView() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const missions = useMemo(() => getMissions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);
  const habits = useMemo(() => getHabits(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);
  const prefs = useMemo(() => getPreferences(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);
  const today = todayStr();
  const now = useMemo(() => new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);

  const natalAsc = useMemo(() => {
    const bd = prefs.birthDate;
    const bt = prefs.birthTime;
    const lat = prefs.birthLat;
    const lon = prefs.birthLon;
    if (!bd || lat === undefined || lon === undefined) return null;
    const date = new Date(`${bd}T${bt || '12:00'}:00`);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return { ascendant: ascendantLongitude(date, { lat, lon }), lat, lon };
    } catch { return null; }
  }, [prefs.birthDate, prefs.birthTime, prefs.birthLat, prefs.birthLon]);

  // --- Sky dashboard: current position of each planet ---
  const sky = useMemo(() => TRANSIT_BODIES.map((b) => {
    const sign = signOfPlanet(b.id, now);
    const retro = isRetrograde(b.id, now);
    return { body: b, sign, retro };
  }), [now]);

  const moonPhase = useMemo(() => {
    const p = ((moonPhaseAt(now) % 360) + 360) % 360;
    if (p < 22.5 || p >= 337.5) return '🌑 Nouvelle lune';
    if (p < 67.5) return '🌒 Premier croissant';
    if (p < 112.5) return '🌓 Premier quartier';
    if (p < 157.5) return '🌔 Gibbeuse croissante';
    if (p < 202.5) return '🌕 Pleine lune';
    if (p < 247.5) return '🌖 Gibbeuse décroissante';
    if (p < 292.5) return '🌗 Dernier quartier';
    return '🌘 Dernier croissant';
  }, [now]);

  // Aspects currently in orb (sky dashboard).
  const aspectsNow = useMemo(() => {
    try {
      const pairs = natalAsc ? [...ASPECT_PAIRS, ...ASC_ASPECT_PAIRS] : ASPECT_PAIRS;
      return currentAspects(pairs, now, natalAsc?.ascendant);
    } catch { return []; }
  }, [now, natalAsc]);

  // --- Sky-driven mission suggestions (transits + aspects × weak domains) ---
  const suggestions = useMemo(() => {
    try {
      const d = exportAllData();
      const report = buildPreferenceReport({
        habits: d.habits ?? [],
        checkIns: d.checkIns ?? [],
        notes: d.notes ?? [],
        moods: d.moods ?? {},
        capacities: (d.capacities ?? []).map((c) => ({ id: c.id, name: c.name })),
        capacityRatings: d.capacityRatings ?? [],
        projects: d.projects ?? [],
        protocols: d.protocols ?? [],
        experiments: (d.experiments ?? []).map((e) => ({ id: e.id, title: e.title })),
        challenges: (d.challenges ?? []).map((c) => ({ id: c.id, name: c.name })),
      });
      return suggestMissionsFromSky({
        habits,
        checkIns: habits.flatMap((h) => getCheckInsForHabit(h.id)),
        weakDomains: report.weakDomains,
        existingMissions: missions,
        ascendantLon: natalAsc?.ascendant,
        now,
      });
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, habits, missions, now]);

  // --- Calendar of upcoming transits & aspects ---
  const calendar = useMemo(() => {
    try {
      return {
        transits: upcomingTransits(TRANSIT_BODIES.map((b) => b.id as TransitBodyId), 60, now),
        aspects: upcomingAspects(
          natalAsc ? [...ASPECT_PAIRS, ...ASC_ASPECT_PAIRS] : ASPECT_PAIRS,
          90,
          now,
          natalAsc?.ascendant,
        ),
      };
    } catch { return { transits: [], aspects: [] }; }
  }, [now, natalAsc]);

  const acceptSuggestion = (s: AutoMissionSuggestion) => {
    addMission({
      name: s.name,
      objective: s.objective,
      habitIds: s.habitIds,
      window: s.window,
      quota: s.quota,
    });
    setTick((t) => t + 1);
  };

  // --- Creation form ---
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'fixed' | 'transit'>('transit');
  const [body, setBody] = useState<TransitBodyId>('mars');
  const [signIndex, setSignIndex] = useState(0);
  const [fixedStart, setFixedStart] = useState('');
  const [fixedEnd, setFixedEnd] = useState('');
  const [habitIds, setHabitIds] = useState<string[]>([]);
  const [objective, setObjective] = useState('');
  const [quota, setQuota] = useState('');
  const [milestone, setMilestone] = useState(false);
  const [formError, setFormError] = useState('');

  // Live-resolved transit window for the form.
  const transitPreview = useMemo(() => {
    if (kind !== 'transit') return null;
    try {
      return resolveTransitWindow(body, signIndex, now);
    } catch { return null; }
  }, [kind, body, signIndex, now]);

  // Weekly pace of the selected habits over the last 28 days → quota suggestion.
  const weeklyPace = useMemo(() => {
    if (habitIds.length === 0) return 0;
    const end = today;
    const start = toDateKey(new Date(now.getTime() - 27 * 86400000));
    let total = 0;
    for (const h of habitIds) {
      for (const c of getCheckInsForHabit(h)) {
        if (!c.completed) continue;
        if (c.date >= start && c.date <= end) total += c.count && c.count > 0 ? c.count : 1;
      }
    }
    return total / 4; // 28 days ≈ 4 weeks
  }, [habitIds, today, now]);

  const previewDays = useMemo(() => {
    if (kind === 'fixed') {
      if (!fixedStart || !fixedEnd) return null;
      return Math.round((Date.parse(fixedEnd) - Date.parse(fixedStart)) / 86400000) + 1;
    }
    if (!transitPreview) return null;
    return Math.round((transitPreview.end.getTime() - transitPreview.start.getTime()) / 86400000) + 1;
  }, [kind, fixedStart, fixedEnd, transitPreview]);

  const suggestedQuota = previewDays ? suggestQuota(weeklyPace, previewDays) : 0;
  const quotaValue = quota === '' ? suggestedQuota : Number(quota) || 0;

  const previewHouse = useMemo(() => {
    if (kind !== 'transit' || !transitPreview || !natalAsc) return null;
    return wholeSignHouse(planetLongitude(body, transitPreview.start), natalAsc.ascendant);
  }, [kind, body, transitPreview, natalAsc]);

  const retroInWindow = useMemo(() => {
    if (kind !== 'transit' || !transitPreview) return null;
    try {
      const r = nextRetrograde(body, new Date(Math.max(transitPreview.start.getTime() - 1, 0)));
      if (!r) return null;
      if (r.start.getTime() < transitPreview.end.getTime()) {
        return { start: toDateKey(r.start), end: toDateKey(r.end) };
      }
      return null;
    } catch { return null; }
  }, [kind, body, transitPreview]);

  const resetForm = () => {
    setName(''); setKind('transit'); setBody('mars'); setSignIndex(0);
    setFixedStart(''); setFixedEnd(''); setHabitIds([]); setObjective('');
    setQuota(''); setMilestone(false); setFormError('');
  };

  const onHabitToggle = (id: string) => {
    setHabitIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const onCreate = () => {
    setFormError('');
    if (!name.trim()) { setFormError('Donne un nom à ton Asto.'); return; }
    if (habitIds.length === 0) { setFormError('Choisis au moins une habitude liée.'); return; }
    let window: MissionWindow;
    if (kind === 'fixed') {
      if (!fixedStart || !fixedEnd || fixedEnd < fixedStart) { setFormError('La fenêtre fixe est invalide.'); return; }
      window = { kind: 'fixed', startDate: fixedStart, endDate: fixedEnd };
    } else {
      if (!transitPreview) { setFormError('Impossible de calculer la fenêtre de transit.'); return; }
      window = {
        kind: 'transit', body, signIndex,
        startDate: toDateKey(transitPreview.start),
        endDate: toDateKey(transitPreview.end),
      };
    }
    addMission({
      name: name.trim(),
      objective: objective.trim() || undefined,
      habitIds,
      window,
      quota: quotaValue > 0 ? quotaValue : undefined,
      milestoneDate: milestone && retroInWindow ? retroInWindow.start : undefined,
      milestoneLabel: milestone && retroInWindow ? `Début rétrogradation ${getTransitBody(body).label}` : undefined,
    });
    resetForm();
    setCreating(false);
    setTick((t) => t + 1);
  };

  const active = missions.filter((m) => !m.archived);
  const sorted = [...active].sort((a, b) => a.window.startDate.localeCompare(b.window.startDate));

  const progressOf = (m: Mission) => computeMissionProgress(m, habits.flatMap((h) => getCheckInsForHabit(h.id)), today);

  return (
    <div className="view missions-view" style={{ maxWidth: '920px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>✨ Asto</h2>
        <button className="btn btn-primary" onClick={() => { setCreating((c) => !c); if (creating) resetForm(); }}>
          {creating ? '✕ Fermer' : '＋ Nouveau Asto'}
        </button>
      </div>
      <p className="lever-suggestions-hint">
        Un Asto = un objectif lié à tes habitudes, borné par une fenêtre : des dates fixes ou le passage
        d'une planète dans un signe (transit whole sign). La progression est mesurée automatiquement sur tes check-ins.
      </p>

      {/* SKY DASHBOARD */}
      <div className="lever-card" style={{ marginBottom: '1rem' }}>
        <div className="lever-card-main">
          <span className="lever-content">☀️ Ciel du moment — {moonPhase}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.25rem 0' }}>
          {sky.map(({ body: b, sign, retro }) => (
            <span
              key={b.id}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.3rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
              title={`${b.label} en ${sign.name}${retro ? ' · rétrograde' : ''}`}
            >
              {b.emoji} {b.label} en {sign.emoji} {sign.name}
              {retro && <span style={{ color: '#f59e0b', marginLeft: '0.3rem' }}>⟲</span>}
            </span>
          ))}
        </div>
        {aspectsNow.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.25rem 0' }}>
            {aspectsNow.map((a) => {
              const def = ASPECT_DEFS[a.kind];
              return (
                <span
                  key={`${a.bodyA}-${a.bodyB}-${a.kind}`}
                  style={{
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px',
                    padding: '0.3rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap',
                    color: def.tone === 'favorable' ? '#10b981' : def.tone === 'tension' ? '#f59e0b' : 'var(--text-muted)',
                  }}
                >
{a.bodyA === 'asc' ? '⬆️ Ascendant' : `${getTransitBody(a.bodyA).emoji} ${getTransitBody(a.bodyA).label}`} {def.emoji} {a.bodyB === 'asc' ? '⬆️ Ascendant' : `${getTransitBody(a.bodyB).emoji} ${getTransitBody(a.bodyB).label}`}
                  <span style={{ marginLeft: '0.3rem' }}>({def.label} active)</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* SKY-DRIVEN SUGGESTIONS */}
      {suggestions.length > 0 && (
        <div className="lever-card" style={{ marginBottom: '1rem' }}>
          <div className="lever-card-main">
            <span className="lever-content">🎯 Suggestions du ciel</span>
            <span className="lever-notes">
              Le moteur lit le ciel et tes domaines faibles. Les transits sur un domaine faible sont
              créés automatiquement ⚡ ; le reste se valide d'un clic.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.5rem' }}>
            {suggestions.map((s) => (
              <div key={s.key} className="lever-card" style={{ borderLeft: s.autoCreate ? '4px solid #10b981' : '4px solid var(--border)' }}>
                <div className="lever-card-main">
                  <span className="lever-content">
                    {s.name}
                    {s.autoCreate && <span style={{ fontSize: '0.72rem', color: '#10b981', marginLeft: '0.5rem' }}>⚡ auto-créée</span>}
                  </span>
                  <span className="lever-notes">
                    {s.rationale} · {fmtDate(s.window.startDate)} → {fmtDate(s.window.endDate)}
                    {' '}· quota suggéré : {s.quota ?? '—'}
                  </span>
                  {s.objective && <span className="lever-effect">« {s.objective} »</span>}
                </div>
                {!s.autoCreate && (
                  <div className="lever-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => acceptSuggestion(s)}>✓ Créer</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TRANSIT & ASPECT CALENDAR */}
      <div className="lever-card" style={{ marginBottom: '1rem' }}>
        <div className="lever-card-main">
          <span className="lever-content">📅 Calendrier des transits & aspects</span>
          <span className="lever-notes">Prochains passages planétaires (60 j) et aspects exacts (90 j).</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingTop: '0.5rem', fontSize: '0.85rem' }}>
          {calendar.transits.map((t) => (
            <div key={`t-${t.bodyId}-${t.signIndex}-${t.window.start.toISOString()}`}>
              <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>
                {fmtDate(toDateKey(t.window.start))} → {fmtDate(toDateKey(t.window.end))}
              </span>
              {getTransitBody(t.bodyId).emoji} {getTransitBody(t.bodyId).label} en {t.sign.emoji} {t.sign.name}
              {t.window.revisit && <span style={{ color: '#f59e0b' }}> (va-et-vient rétrograde)</span>}
            </div>
          ))}
          {calendar.aspects.map((a) => {
            const def = ASPECT_DEFS[a.kind];
            return (
              <div key={`a-${a.bodyA}-${a.bodyB}-${a.kind}-${a.exactAt.toISOString()}`}>
                <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>{fmtDate(toDateKey(a.exactAt))}</span>
                {a.bodyA === 'asc' ? '⬆️ Ascendant' : `${getTransitBody(a.bodyA).emoji} ${getTransitBody(a.bodyA).label}`} {def.emoji} {a.bodyB === 'asc' ? '⬆️ Ascendant' : `${getTransitBody(a.bodyB).emoji} ${getTransitBody(a.bodyB).label}`}
                <span style={{ color: def.tone === 'favorable' ? '#10b981' : def.tone === 'tension' ? '#f59e0b' : 'var(--text-muted)' }}>
                  {' '}({def.label} exact)
                </span>
              </div>
            );
          })}
          {calendar.transits.length === 0 && calendar.aspects.length === 0 && (
            <span className="lever-none">Rien dans l'horizon de calcul.</span>
          )}
        </div>
      </div>

      {/* CREATION FORM */}
      {creating && (
        <div style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--bg-alt)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <h4 style={{ margin: '0 0 0.75rem 0' }}>Nouveau Asto</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <input
              className="text-input" placeholder="Nom (ex: Sport dans le Bélier)" value={name}
              onChange={(e) => setName(e.target.value)} style={{ width: '100%' }}
            />

            {/* Window kind */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={`btn btn-sm ${kind === 'transit' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKind('transit')}>
                ✨ Transit astrologique
              </button>
              <button className={`btn btn-sm ${kind === 'fixed' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKind('fixed')}>
                📅 Dates fixes
              </button>
            </div>

            {kind === 'transit' ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <select className="text-input" value={body} onChange={(e) => setBody(e.target.value as TransitBodyId)} style={{ flex: '1 1 150px' }}>
                  {TRANSIT_BODIES.map((b) => (
                    <option key={b.id} value={b.id}>{b.emoji} {b.label}</option>
                  ))}
                </select>
                <select className="text-input" value={signIndex} onChange={(e) => setSignIndex(Number(e.target.value))} style={{ flex: '1 1 150px' }}>
                  {SIGNS.map((s) => (
                    <option key={s.index} value={s.index}>{s.emoji} {s.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Début <input type="date" className="text-input" value={fixedStart} onChange={(e) => setFixedStart(e.target.value)} />
                </label>
                <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Fin <input type="date" className="text-input" value={fixedEnd} onChange={(e) => setFixedEnd(e.target.value)} />
                </label>
              </div>
            )}

            {kind === 'transit' && transitPreview && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {getTransitBody(body).emoji} {getTransitBody(body).label} en {SIGNS[signIndex].emoji} {SIGNS[signIndex].name} :
                du <strong>{fmtDate(toDateKey(transitPreview.start))}</strong> au <strong>{fmtDate(toDateKey(transitPreview.end))}</strong>
                {' '}({Math.round((transitPreview.end.getTime() - transitPreview.start.getTime()) / 86400000) + 1} jours)
                {previewHouse && <span style={{ color: 'var(--primary)' }}> · en maison {previewHouse}</span>}
                {!previewHouse && natalAsc === null && <span> · <em>règle ton thème natal dans Réglages pour voir les maisons</em></span>}
                {isRetrograde(body, now) && <span style={{ color: '#f59e0b' }}> · actuellement rétrograde ⟲</span>}
              </div>
            )}

            {kind === 'transit' && retroInWindow && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} />
                Jalon : début de rétrogradation de {getTransitBody(body).label} le {fmtDate(retroInWindow.start)}
              </label>
            )}

            {/* Habits */}
            <div>
              <div style={{ fontSize: '0.8rem', marginBottom: '0.35rem' }}>Habitudes liées :</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {habits.map((h) => (
                  <label
                    key={h.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.82rem',
                      background: habitIds.includes(h.id) ? 'rgba(56,189,248,0.15)' : 'var(--bg)',
                      border: `1px solid ${habitIds.includes(h.id) ? '#38bdf8' : 'var(--border)'}`,
                      borderRadius: '8px', padding: '0.3rem 0.6rem',
                    }}
                  >
                    <input type="checkbox" checked={habitIds.includes(h.id)} onChange={() => onHabitToggle(h.id)} />
                    <span style={{ color: h.color }}>●</span> {h.name}
                  </label>
                ))}
                {habits.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Aucune habitude — crée-en d'abord une dans le Grid.</span>}
              </div>
            </div>

            {/* Objective + quota */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                className="text-input" placeholder="Objectif libre (ex: « méditer chaque matin ») — optionnel"
                value={objective} onChange={(e) => setObjective(e.target.value)} style={{ flex: '1 1 260px' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                Quota :
                <input
                  type="number" min={1} className="text-input" style={{ width: '90px' }}
                  placeholder={String(suggestedQuota)} value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                />
              </label>
            </div>
            {weeklyPace > 0 && previewDays && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Ton rythme actuel : {weeklyPace.toFixed(1)}/semaine → suggestion : {suggestedQuota} sur {previewDays} jours
                {quota !== '' && Number(quota) > 0 && Number(quota) !== suggestedQuota && ` (tu as choisi ${quota})`}
              </div>
            )}

            {formError && <div style={{ color: '#f59e0b', fontSize: '0.82rem' }}>⚠️ {formError}</div>}

            <div className="feed-actions">
              <button className="btn btn-sm btn-primary" onClick={onCreate}>Créer l'Asto</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { resetForm(); setCreating(false); }}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* MISSIONS LIST */}
      {sorted.length === 0 ? (
        <div style={{ padding: '3rem 1rem', background: 'var(--bg-alt)', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎯</div>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Aucun Asto pour l'instant</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            Crée ton premier Asto : choisis un transit (ex: Mars en Bélier), attache tes habitudes,
            fixe un quota — et suis ta progression en direct.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {sorted.map((m) => {
            const p = progressOf(m);
            const transit = m.window.kind === 'transit' ? m.window : null;
            const bodyInfo = transit ? getTransitBody(transit.body as TransitBodyId) : null;
            const signInfo = transit ? SIGNS[transit.signIndex] : null;
            const pct = Math.round(p.quotaRatio * 100);
            return (
              <div key={m.id} className="lever-card" style={{ borderLeft: p.status === 'failed' ? '4px solid #f59e0b' : p.status === 'done' ? '4px solid #10b981' : p.status === 'active' ? '4px solid #38bdf8' : '4px solid var(--border)' }}>
                <div className="lever-card-main">
                  <span className="lever-content" style={{ fontWeight: 600 }}>
                    {STATUS_EMOJI[p.status]} {m.name}
                    <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {MISSION_STATUS_LABEL[p.status]}
                    </span>
                  </span>
                  <span className="lever-notes">
                    {transit
                      ? `${bodyInfo?.emoji} ${bodyInfo?.label} en ${signInfo?.emoji} ${signInfo?.name}`
                      : '📅 Dates fixes'}
                    {' '}· {fmtDate(m.window.startDate)} → {fmtDate(m.window.endDate)}
                    {p.daysLeft > 0 && p.status === 'active' && ` · ${p.daysLeft} j restants`}
                  </span>
                  {m.objective && <span className="lever-effect">« {m.objective} »</span>}
                  <span className="lever-effect">
                    Habitudes : {m.habitIds.map((id) => {
                      const h = habits.find((x) => x.id === id);
                      return h
                        ? <span key={id} style={{ color: h.color }} title={h.name}>●</span>
                        : <span key={id} style={{ color: 'var(--text-muted)' }}>❔</span>;
                    })}
                  </span>
                  {m.milestoneDate && <span className="lever-effect">🎯 Jalon : {fmtDate(m.milestoneDate)} {m.milestoneLabel ? `(${m.milestoneLabel})` : ''}</span>}
                </div>

                {/* Quota bar */}
                <div style={{ margin: '0.5rem 0 0.25rem 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                    <span>
                      {p.completedCount}/{m.quota ?? p.completedCount} sessions
                      {p.paceStatus === 'ahead' && <span style={{ color: '#10b981', marginLeft: '0.4rem' }}>⚡ en avance</span>}
                      {p.paceStatus === 'on_track' && <span style={{ color: '#38bdf8', marginLeft: '0.4rem' }}>✓ dans le rythme</span>}
                      {p.paceStatus === 'behind' && <span style={{ color: '#f59e0b', marginLeft: '0.4rem' }}>⚠ en retard</span>}
                      {p.quotaPerWeek > 0 && ` · rythme requis ${p.quotaPerWeek.toFixed(1)}/sem`}
                      {p.actualPerWeek > 0 && ` · réel ${p.actualPerWeek.toFixed(1)}/sem`}
                    </span>
                    <span>
                      {p.status === 'active' && m.quota && !p.quotaReached && p.neededPerWeek > 0
                        ? `il faut ${p.neededPerWeek.toFixed(1)}/sem pour y arriver`
                        : p.projectedTotal !== null && m.quota
                          ? `projection : ${p.projectedTotal}`
                          : `${pct}%`}
                    </span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: p.quotaReached || p.paceStatus === 'ahead' ? '#10b981' : p.paceStatus === 'behind' || p.status === 'failed' ? '#f59e0b' : '#38bdf8' }} />
                  </div>
                  {/* Window elapsed mini-bar */}
                  <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden', marginTop: '0.3rem' }}>
                    <div style={{ height: '100%', width: `${Math.round(p.elapsedRatio * 100)}%`, background: 'var(--text-muted)', opacity: 0.6 }} />
                  </div>
                </div>

                <div className="lever-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => archiveMission(m.id)}>
                    {m.archived ? '📦 Réactiver' : '📦 Archiver'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Supprimer cette mission ?')) deleteMission(m.id); }}>
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ARCHIVED */}
      {missions.some((m) => m.archived) && (
        <details style={{ marginTop: '1.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            📦 Astos archivés ({missions.filter((m) => m.archived).length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
            {missions.filter((m) => m.archived).map((m) => {
              const p = progressOf(m);
              return (
                <div key={m.id} className="lever-card">
                  <div className="lever-card-main">
                    <span className="lever-content">{m.name} — {MISSION_STATUS_LABEL[p.status]}</span>
                    <span className="lever-notes">{fmtDate(m.window.startDate)} → {fmtDate(m.window.endDate)} · {p.completedCount} sessions</span>
                  </div>
                  <div className="lever-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => archiveMission(m.id)}>♻️ Réactiver</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Supprimer définitivement ?')) deleteMission(m.id); }}>🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}