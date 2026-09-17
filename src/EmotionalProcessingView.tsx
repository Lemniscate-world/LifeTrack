import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { EMOTIONS_LIST, type EmotionalEvent } from './types';
import { forecastEmotion, findHelpfulNotes, learnedHalfLives, compareEmotionalEvents, capacityTrendByEmotion, fitPerEmotion, perEmotionSeries, temporalPatterns, buildTherapistReport, checkStreak, buildEmotionalMemory, detectEmotionsFromText, parseActionPlan, suggestCoping, type TemporalPattern } from './emotionForecast';
import type { EmotionForecast } from './emotionForecast';
import {
  getEmotionalEvents,
  getEmotionalChecks,
  getMoods,
  getPreferences,
  addEmotionalEvent,
  addJournalEntry,
  updateEmotionalEvent,
  deleteEmotionalEvent,
  upsertEmotionalCheck,
  subscribe,
} from './store';
import { localReflection } from './localReflection';
import { todayKey, toDateKey } from './dates';

// Local civil date (never UTC): a check at 00:30 belongs to the new day.
// The old UTC version silently filed night check-ins under yesterday.
function todayIso(): string { return todayKey(); }

// Same-day Q&R cache: reopening an event reuses the answer instead of
// burning another AI call. Invalidated when the checks change.
const aiQACache = new Map<string, { day: string; checksKey: string; qa: { question: string; recommendation: string } }>();

function downloadBlobLocal(content: string, filename: string): void {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch { /* best-effort */ }
}

export default function EmotionalProcessingView() {
  const [, setTick] = useState(0);
  // Auto-select when there is a single event so the detail (curve, forecast,
  // check-in) is visible immediately — nothing hidden behind an undiscoverable click.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const evs = getEmotionalEvents().filter((e: EmotionalEvent) => !e.archived);
      return evs.length === 1 ? evs[0]!.id : null;
    } catch { return null; }
  });
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [situation, setSituation] = useState('');
  const [emotions, setEmotions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [aiFilling, setAiFilling] = useState(false);
  const [aiFillInfo, setAiFillInfo] = useState<string | null>(null);

  const handleAiFill = async () => {
    const text = situation.trim();
    if (text.length < 10 || aiFilling) return;
    setAiFilling(true);
    setAiFillInfo(null);
    try {
      const memory = buildEmotionalMemory(
        getEmotionalEvents().map((e) => ({
          id: e.id,
          title: e.title,
          emotions: e.emotions as string[],
          createdAt: e.createdAt,
          archived: e.archived,
          notes: e.notes,
          checks: getEmotionalChecks(e.id).map((c) => ({ date: c.date, intensity: c.intensity, note: c.note })),
        })),
      );
      const content =
        `Nouvel événement à décrire : ${text}\n` +
        (memory ? `\n${memory}\n` : '') +
        `\nRéponds en JSON strict avec exactement ces clés : ` +
        `"title" (titre court, max 6 mots), ` +
        `"emotions" (tableau de 1 à 4 émotions choisies UNIQUEMENT parmi : ${EMOTIONS_LIST.join(', ')}), ` +
        `"actions" (tableau de 2 à 3 actions concrètes et courtes pour faire baisser l'intensité). Tout en français.`;
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) throw new Error('no-tauri');
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const raw = await invoke<string>('journal_analyze', {
        content,
        personality: 'psychologist',
        summaryJson: '',
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      const parsed = JSON.parse(raw);
      const aiTitle = typeof parsed?.title === 'string' ? parsed.title.trim().slice(0, 80) : '';
      const aiEmotions = Array.isArray(parsed?.emotions)
        ? parsed.emotions.filter((e: unknown): e is string => typeof e === 'string' && (EMOTIONS_LIST as readonly string[]).includes(e)).slice(0, 4)
        : [];
      const aiActions = Array.isArray(parsed?.actions)
        ? parsed.actions.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0).slice(0, 3)
        : [];
      if (!aiTitle && aiEmotions.length === 0 && aiActions.length === 0) throw new Error('bad-shape');
      if (aiTitle) setTitle(aiTitle);
      if (aiEmotions.length > 0) setEmotions(aiEmotions);
      if (aiActions.length > 0) setNotes(aiActions.map((a: string) => `• ${a.trim()}`).join('\n'));
      setAiFillInfo('Champs pré-remplis par l\u2019IA à partir de ta description et de ta mémoire émotionnelle — vérifie et ajuste.');
    } catch {
      // Offline fallback: local keyword guess for emotions only.
      const guess = detectEmotionsFromText(text);
      if (guess.length > 0) {
        setEmotions(guess);
        setAiFillInfo('IA indisponible — émotions devinées localement à partir de tes mots. Titre et actions à compléter.');
      } else {
        setAiFillInfo("IA indisponible (hors-ligne et aucun fournisseur dans Réglages → IA). Remplis à la main.");
      }
    } finally {
      setAiFilling(false);
    }
  };

  // need subscribe to re-render on store changes
  useMemo(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    // trick: keep unsub reachable for cleanup via effect-like pattern - we use useState+subscribe without useEffect cleanup for brevity; instead handle with window
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return unsub;
  }, []);

  const events = getEmotionalEvents().filter((e: EmotionalEvent) => !e.archived);
  const selected = selectedId ? events.find((e: EmotionalEvent) => e.id === selectedId) ?? null : null;
  const allChecksForLearned = getEmotionalChecks();
  const learnedKey = allChecksForLearned.map((c) => `${c.eventId}:${c.date}:${c.intensity}`).join(',');
  const learned = useMemo(() => {
    try {
      return learnedHalfLives(
        getEmotionalEvents().map((e) => ({
          emotions: e.emotions as string[],
          checks: allChecksForLearned
            .filter((c) => c.eventId === e.id)
            .map((c) => ({ date: c.date, intensity: c.intensity })),
        })),
      );
    } catch { return []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnedKey]);
  const trends = useMemo(() => {
    try {
      return capacityTrendByEmotion(
        getEmotionalEvents().map((e) => ({
          emotions: e.emotions as string[],
          checks: allChecksForLearned
            .filter((c) => c.eventId === e.id)
            .map((c) => ({ date: c.date, intensity: c.intensity })),
        })),
      );
    } catch { return []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnedKey]);

  const handleCreate = () => {
    if (!title.trim()) return;
    const ev = addEmotionalEvent({
      title: title.trim(),
      situation: situation.trim(),
      emotions: emotions as EmotionalEvent['emotions'],
      notes: notes.trim() || undefined,
    });
    setTitle(''); setSituation(''); setEmotions([]); setNotes(''); setShowForm(false);
    setSelectedId(ev.id);
  };

  const toggleEmotion = (emo: string) => {
    setEmotions((prev: string[]) => (prev.includes(emo) ? prev.filter((e) => e !== emo) : [...prev, emo].slice(0, 6)));
  };

  return (
    <div className="emotional-view">
      <div className="emotional-header">
        <h2>💭 Traitement Émotionnel</h2>
        <p className="emotional-subtitle">
          Un événement met du temps à s'éteindre. Associe les émotions ressenties, coche chaque jour avec l'intensité du jour,
          et ajoute dans les notes ce qui t'aide à faire baisser la charge — tu verras la courbe fondre.
        </p>
      </div>

      <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
        {showForm ? 'Annuler' : '+ Nouvel événement / trauma'}
      </button>

      {(learned.length > 0 || trends.length > 0) && (
        <div className="emotional-learned">
          <h4>📏 Tes demi-vies apprises</h4>
          <p className="emotional-learned-hint">Apprises sur tes événements passés — elles remplacent les moyennes de la littérature dans tes futures estimations.</p>
          <ul>
            {learned.map((l) => {
              const trend = trends.find((t) => t.emotion === l.emotion);
              return (
                <li key={l.emotion}>
                  <strong>{l.emotion}</strong> : ≈{l.halfLifeDays < 10 ? l.halfLifeDays.toFixed(1) : Math.round(l.halfLifeDays)} j
                  <span className="emotional-learned-n"> ({l.events} événement{l.events !== 1 ? 's' : ''})</span>
                  {trend && trend.direction === 'growing' && (
                    <span className="emotional-trend-badge up" title="Tes demi-vies raccourcissent : tu digères plus vite qu'avant"> 📈 capacité +</span>
                  )}
                  {trend && trend.direction === 'stable' && (
                    <span className="emotional-trend-badge"> → stable</span>
                  )}
                  {trend && trend.direction === 'declining' && (
                    <span className="emotional-trend-badge down" title="Tes demi-vies s'allongent : contexte plus dur ou soutien à renforcer"> 📉 à surveiller</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showForm && (
        <div className="emotional-form">
          <input placeholder="Titre — ex: Conflit avec X" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder="Situation — que s'est-il passé ?" value={situation} onChange={(e) => setSituation(e.target.value)} rows={3} />
          <div className="emotional-ai-fill-row">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={handleAiFill}
              disabled={aiFilling || situation.trim().length < 10}
              title="L'IA propose un titre, détecte les émotions et suggère des actions à partir de ta description et de ta mémoire émotionnelle"
            >
              {aiFilling ? 'Analyse en cours…' : '✨ Remplir avec l\u2019IA'}
            </button>
            {aiFillInfo && <span className="emotional-ai-fill-info">{aiFillInfo}</span>}
          </div>
          <div className="emotional-emotions">
            {EMOTIONS_LIST.map((emo) => (
              <button
                key={emo}
                type="button"
                className={`emotional-chip ${emotions.includes(emo) ? 'active' : ''}`}
                onClick={() => toggleEmotion(emo)}
              >
                {emo}
              </button>
            ))}
          </div>
          <textarea placeholder="Notes — choses à faire pour diminuer l'intensité (optionnel)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button className="btn btn-primary" onClick={handleCreate}>Créer</button>
        </div>
      )}

      <div className="emotional-layout">
        <div className="emotional-list">
          {events.length === 0 && <p className="empty-hint">Aucun événement — crée le premier ci-dessus.</p>}
          {events.map((ev) => {
            const checks = getEmotionalChecks(ev.id).sort((a, b) => a.date.localeCompare(b.date));
            const last = checks[checks.length - 1];
            const avg = checks.length ? (checks.reduce((s, c) => s + c.intensity, 0) / checks.length).toFixed(1) : '—';
            const todayStr = todayIso();
            const doneToday = checks.some((c) => c.date === todayStr);
            const mini: ReturnType<typeof forecastEmotion> | null = (() => {
              try {
                return forecastEmotion(checks.map((c) => ({ date: c.date, intensity: c.intensity })), ev.emotions);
              } catch { return null; }
            })();
            const isOpen = selectedId === ev.id;
            return (
              <div
                key={ev.id}
                className={`emotional-card${isOpen ? ' selected' : ''}`}
                onClick={() => setSelectedId(isOpen ? null : ev.id)}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                title="Cliquer pour ouvrir le détail : courbe, prévision, coche du jour"
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(isOpen ? null : ev.id); } }}
              >
                <div className="emotional-card-top">
                  <span className="emotional-card-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <strong>{ev.title}</strong>
                  <span className={`emotional-today-dot${doneToday ? ' done' : ''}`} title={doneToday ? "Coché aujourd'hui" : "Pas encore coché aujourd'hui"}>{doneToday ? '●' : '○'}</span>
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); updateEmotionalEvent(ev.id, { archived: true }); }}>Archiver</button>
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer ?')) deleteEmotionalEvent(ev.id); }}>✕</button>
                </div>
                <p className="emotional-card-situation">{ev.situation}</p>
                <div className="emotional-card-emotions">
                  {ev.emotions.map((emo) => <span key={emo} className="emotional-chip small active">{emo}</span>)}
                </div>
                <div className="emotional-card-meta">
                  {checks.length === 0
                    ? 'aucun jour coché — cliquez pour commencer'
                    : `${checks.length} jour${checks.length !== 1 ? 's' : ''} coché${checks.length !== 1 ? 's' : ''} · dernière intensité ${last ? `${last.intensity}/10` : '—'} · moy ${avg}`}
                  {(() => { const s = checkStreak(checks, todayIso()); return s >= 2 ? ` · 🔥 ${s} j d'affilée` : ''; })()}
                  {mini && mini.daysRemaining !== null && ` · ≈${mini.daysRemaining} j restants`}
                  {mini && mini.relapsed && ' · ⚠️ rechute'}
                </div>
                {ev.notes && <p className="emotional-card-notes">📝 {ev.notes}</p>}
                {!isOpen && <div className="emotional-card-open">Voir la courbe, la prévision et cocher aujourd'hui →</div>}
              </div>
            );
          })}
        </div>

        {selected && <EventDetail key={selected.id} event={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

function EventDetail({ event, onClose }: { event: EmotionalEvent; onClose: () => void }) {
  const [intensity, setIntensity] = useState(5);
  const [note, setNote] = useState('');
  const [editNotes, setEditNotes] = useState(event.notes ?? '');
  const checks = getEmotionalChecks(event.id).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayIso();
  const todayCheck = checks.find((c) => c.date === today);
  // Per-emotion sliders, prefilled from today's check. The parent keys this
  // component by event id, so state resets naturally when switching events.
  const [emoIntensities, setEmoIntensities] = useState<Record<string, number>>(
    () => todayCheck?.intensities ?? Object.fromEntries(event.emotions.map((e) => [e, 5])),
  );
  const [editingEmotions, setEditingEmotions] = useState(false);
  const [closureText, setClosureText] = useState(event.closureNote ?? '');
  // Per-emotion focus: null = whole event ("Toutes"), else one emotion to
  // dissect (evolution, notes, estimation, coping, action items).
  const [focusEmotion, setFocusEmotion] = useState<string | null>(null);
  // Emotion tags for the daily note being written (sticky across checks).
  const [noteEmoTags, setNoteEmoTags] = useState<string[]>([]);
  const effEmo: Record<string, number> = emoIntensities;
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQA, setAiQA] = useState<{ question: string; recommendation: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Latest-inputs ref: the stable callback below always prompts from FRESH
  // data (checks, forecast, coping…) with no TDZ and no stale closure.
  // The sync effect lives after the memos (no lexical TDZ) and runs before
  // the auto-run effect by declaration order.
  const qaInputsRef = useRef<{
    event: EmotionalEvent;
    checks: ReturnType<typeof getEmotionalChecks>;
    checksKey: string;
    today: string;
    helpfulNotes: ReturnType<typeof findHelpfulNotes>;
    copingTracks: ReturnType<typeof suggestCoping>;
    perEmotionFits: ReturnType<typeof fitPerEmotion>;
    forecast: EmotionForecast | null;
    focusEmotion: string | null;
  } | null>(null);
  // Stable identity so the auto-run effect tracks it and the React Compiler
  // preserves every manual memo in this component.
  const handleAskAi = useCallback(async (force = false) => {
    const live = qaInputsRef.current;
    if (aiLoading || !live) return;
    const { event, checks, checksKey, today, helpfulNotes, copingTracks, perEmotionFits, forecast, focusEmotion } = live;
    // Same-day cache: reopening the event doesn't burn another API call.
    const cached = aiQACache.get(event.id);
    if (!force && cached && cached.day === today && cached.checksKey === checksKey) {
      setAiQA(cached.qa);
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const recent = checks.slice(-7).map((c) => `${c.date}: ${c.intensity}/10${c.note ? ` (${c.note})` : ''}`).join('\n');
      const memory = buildEmotionalMemory(
        getEmotionalEvents().map((e) => ({
          id: e.id,
          title: e.title,
          emotions: e.emotions as string[],
          createdAt: e.createdAt,
          archived: e.archived,
          notes: e.notes,
          checks: getEmotionalChecks(e.id).map((c) => ({ date: c.date, intensity: c.intensity, note: c.note })),
        })),
        event.id,
      );
      // Everything the user wrote, so the answer actually frames THEIR notes.
      const userNotes = (event.notes ?? '').trim();
      const plansTxt = (event.plans ?? [])
        .map((p) => `- ${p.title} (${p.steps.filter((s) => s.done).length}/${p.steps.length} étapes)${p.sourceNote ? ` — issu de : « ${p.sourceNote} »` : ''}`)
        .join('\n');
      const helpfulTxt = helpfulNotes
        .map((h) => `- ${h.date} : « ${h.note} » (−${h.drop} pts ensuite)${h.copingTags.length ? ` [${h.copingTags.join(', ')}]` : ''}`)
        .join('\n');
      const copingTxt = copingTracks.map((c) => `- ${c.track} : ${c.detail}`).join('\n');
      const perEmoTxt = perEmotionFits
        .map((p) => `- ${p.emotion} : demi-vie ≈${p.halfLifeDays !== null ? p.halfLifeDays.toFixed(1) : '?'} j${p.daysRemaining !== null ? `, ≈${p.daysRemaining} j restants` : ''}`)
        .join('\n');
      const forecastTxt = forecast && forecast.daysRemaining !== null
        ? `Estimation : ≈${forecast.daysRemaining} j restants (fourchette ${forecast.loDays}–${forecast.hiDays}), confiance ${forecast.confidence}${forecast.rumination ? ', MODE RUMINATION (traîne lente + micro-pics normaux)' : ''}${forecast.relapsed ? ', rebond récent' : ''}.`
        : '';
      const content =
        `Événement émotionnel « ${event.title} » : ${event.situation}\n` +
        `Émotions associées : ${event.emotions.join(', ')}\n` +
        (focusEmotion ? `FOCUS DEMANDÉ : analyse centrée sur « ${focusEmotion} » — question et recommandation taillées pour elle en priorité.\n` : '') +
        `Derniers relevés d'intensité :\n${recent || '(aucun relevé)'}\n` +
        (userNotes ? `NOTES DE L'UTILISATEUR (à cadrer en priorité) :\n${userNotes}\n` : '') +
        (plansTxt ? `PLANS D'ACTION EN COURS :\n${plansTxt}\n` : '') +
        (helpfulTxt ? `CE QUI A DÉJÀ FAIT BAISSER (corrélation locale) :\n${helpfulTxt}\n` : '') +
        (copingTxt ? `PISTES DE COPING ADAPTÉES :\n${copingTxt}\n` : '') +
        (perEmoTxt ? `DYNAMIQUE PAR ÉMOTION :\n${perEmoTxt}\n` : '') +
        (forecastTxt ? `${forecastTxt}\n` : '') +
        (memory ? `\n${memory}\n` : '') +
        `En t'appuyant D'ABORD sur les notes, plans et baisses observées ci-dessus (cite-les explicitement), ` +
        `puis sur les épisodes passés (ce qui avait aidé, les demi-vies apprises), ` +
        `réponds en JSON strict avec exactement ces deux clés : ` +
        `"question" (une seule question percutante, en français, qui aide à voir l'événement sous un angle nouveau, max 2 phrases) et ` +
        `"recommendation" (2 à 3 actions concrètes et courtes, en français, adaptées à ces émotions — réutilise ce qui avait marché avant si pertinent).`;
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) throw new Error('no-tauri');
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const raw = await invoke<string>('journal_analyze', {
        content,
        personality: 'psychologist',
        summaryJson: '',
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      const parsed = JSON.parse(raw);
      const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
      const recommendation = typeof parsed?.recommendation === 'string' ? parsed.recommendation.trim() : '';
      if (!question && !recommendation) throw new Error('bad-shape');
      const qa = { question, recommendation };
      aiQACache.set(event.id, { day: today, checksKey, qa });
      setAiQA(qa);
    } catch {
      // Fallback hors-ligne : réflexion locale, jamais de mur vide.
      try {
        const fallback = localReflection(
          `Événement « ${event.title} » (${event.emotions.join(', ')}) : ${event.situation}` +
          (event.notes ? ` Notes : ${event.notes}` : ''),
          'psychologist',
        );
        setAiQA({ question: fallback, recommendation: '' });
      } catch {
        setAiError("IA indisponible (hors-ligne et aucun fournisseur configuré dans Réglages → IA).");
      }
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, setAiQA, setAiError, setAiLoading]);

  const handleSaveAiToJournal = () => {
    if (!aiQA) return;
    try {
      addJournalEntry(
        `Événement « ${event.title} » — question IA : ${aiQA.question}${aiQA.recommendation ? `\nRecommandation IA : ${aiQA.recommendation}` : ''}`,
        'psychologist',
        '',
        { habitIds: [] },
        { local: true },
      );
    } catch { /* best-effort */ }
  };

  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const handleNoteToPlan = async () => {
    const seed = (event.notes ?? '').trim() || event.situation.trim();
    if (!seed || planLoading) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const memory = buildEmotionalMemory(
        getEmotionalEvents().map((e) => ({
          id: e.id,
          title: e.title,
          emotions: e.emotions as string[],
          createdAt: e.createdAt,
          archived: e.archived,
          notes: e.notes,
          checks: getEmotionalChecks(e.id).map((c) => ({ date: c.date, intensity: c.intensity, note: c.note })),
        })),
        event.id,
      );
      const content =
        `Événement émotionnel « ${event.title} » (${event.emotions.join(', ')}) : ${event.situation}\n` +
        `Intention notée par l'utilisateur : « ${seed} »\n` +
        (memory ? `\n${memory}\n` : '') +
        `Transforme cette intention en plan d'action pas à pas, en tenant compte des épisodes passés (démarche qui avait aidé, rythme de digestion observé). ` +
        `IMPORTANT : titre ET étapes entièrement en français (l'utilisateur est francophone — aucun mot d'anglais). ` +
        `Réponds en JSON strict avec exactement ces clés : "title" (titre court du plan, en français) et "steps" (tableau de 3 à 5 micro-étapes concrètes, ordonnées, chacune faisable en moins de 30 minutes, en français).`;
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) throw new Error('no-tauri');
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const raw = await invoke<string>('journal_analyze', {
        content,
        personality: 'strategist',
        summaryJson: '',
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      const parsed = parseActionPlan(raw);
      if (!parsed) throw new Error('bad-shape');
      const plan: import('./types').EmotionalActionPlan = {
        id: crypto.randomUUID(),
        title: parsed.title,
        sourceNote: seed.slice(0, 200),
        steps: parsed.steps.map((label) => ({ id: crypto.randomUUID(), label, done: false })),
        createdAt: new Date().toISOString(),
      };
      updateEmotionalEvent(event.id, { plans: [...(event.plans ?? []), plan] });
    } catch {
      setPlanError("Plan impossible pour l'instant (IA indisponible et aucun fournisseur dans Réglages → IA).");
    } finally {
      setPlanLoading(false);
    }
  };

  const togglePlanStep = (planId: string, stepId: string) => {
    try {
      const plans = (event.plans ?? []).map((p) => p.id === planId
        ? { ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) }
        : p);
      updateEmotionalEvent(event.id, { plans });
    } catch { /* best-effort */ }
  };

  const togglePlanEmotion = (planId: string, emo: string) => {
    try {
      const plans = (event.plans ?? []).map((p) => {
        if (p.id !== planId) return p;
        const cur = p.emotions ?? [];
        const next = cur.includes(emo) ? cur.filter((e) => e !== emo) : [...cur, emo].slice(0, 6);
        return { ...p, emotions: next.length > 0 ? next : undefined };
      });
      updateEmotionalEvent(event.id, { plans });
    } catch { /* best-effort */ }
  };

  const deletePlan = (planId: string) => {
    try {
      updateEmotionalEvent(event.id, { plans: (event.plans ?? []).filter((p) => p.id !== planId) });
    } catch { /* best-effort */ }
  };

  const [noteReplies, setNoteReplies] = useState<Record<string, { loading: boolean; text: string }>>({});

  const handleReplyToNote = async (checkId: string, date: string, note: string) => {
    if (noteReplies[checkId]?.loading) return;
    setNoteReplies((m) => ({ ...m, [checkId]: { loading: true, text: '' } }));
    try {
      const content =
        `Dans le cadre de l'événement « ${event.title} » (${event.emotions.join(', ')}) : ${event.situation}\n` +
        `Note du ${date} : « ${note} »\n` +
        `Réponds en 2 à 4 phrases, en français : valide puis propose UNE micro-action concrète liée à cette note. Pas de JSON, juste le texte.`;
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) throw new Error('no-tauri');
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const raw = await invoke<string>('journal_analyze', {
        content,
        personality: 'psychologist',
        summaryJson: '',
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      setNoteReplies((m) => ({ ...m, [checkId]: { loading: false, text: raw.trim().slice(0, 1200) } }));
    } catch {
      try {
        const fallback = localReflection(`Note du ${date} : ${note}`, 'psychologist');
        setNoteReplies((m) => ({ ...m, [checkId]: { loading: false, text: fallback } }));
      } catch {
        setNoteReplies((m) => {
          const next = { ...m };
          delete next[checkId];
          return next;
        });
      }
    }
  };

  const checksKey = checks.map((c) => `${c.date}:${c.intensity}:${c.note ?? ''}:${(c.noteEmotions ?? []).join('+')}`).join(',');
  const emotionsKey = event.emotions.join(',');
  const moods = useMemo(() => {
    try { return getMoods(); } catch { return {}; }
  }, []);
  const moodsKey = Object.keys(moods).length;
  const forecast: EmotionForecast | null = useMemo(() => {
    if (checks.length === 0) return null;
    const history: { emotions: string[]; checks: { date: string; intensity: number }[] }[] = (() => {
      try {
        const siblingEvents = getEmotionalEvents().filter((e) => e.id !== event.id);
        const allChecks = getEmotionalChecks();
        return siblingEvents.map((e) => ({
          emotions: e.emotions as string[],
          checks: allChecks
            .filter((c) => c.eventId === e.id)
            .map((c) => ({ date: c.date, intensity: c.intensity })),
        }));
      } catch { return []; }
    })();
    try {
      return forecastEmotion(
        checks.map((c) => ({ date: c.date, intensity: c.intensity })),
        event.emotions as string[],
        { personalHistory: history, moods },
      );
    } catch { return null; }
  // Keys are stable serializations of checks/emotions/moods: recompute only when data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksKey, emotionsKey, moodsKey, checks.length, event.id]);

  const helpfulNotes = useMemo(() => {
    try {
      return findHelpfulNotes(checks.map((c) => ({ date: c.date, intensity: c.intensity, note: c.note })));
    } catch { return []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksKey]);

  const [compareId, setCompareId] = useState<string | null>(null);
  const compareCandidates = useMemo(() => {
    try {
      const allChecks = getEmotionalChecks();
      return getEmotionalEvents()
        .filter((e) => e.id !== event.id && e.emotions.some((m) => event.emotions.includes(m)))
        .map((e) => ({
          id: e.id,
          title: e.title,
          shared: e.emotions.filter((m) => event.emotions.includes(m)).length,
          checks: allChecks.filter((c) => c.eventId === e.id).length,
        }))
        .sort((a, b) => b.shared - a.shared || b.checks - a.checks);
    } catch { return []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksKey, event.id]);
  const comparison = useMemo(() => {
    if (!compareId) return null;
    try {
      const allChecks = getEmotionalChecks();
      const past = getEmotionalEvents().find((e) => e.id === compareId);
      if (!past) return null;
      return compareEmotionalEvents(
        {
          emotions: event.emotions as string[],
          checks: checks.map((c) => ({ date: c.date, intensity: c.intensity })),
        },
        {
          emotions: past.emotions as string[],
          checks: allChecks.filter((c) => c.eventId === past.id).map((c) => ({ date: c.date, intensity: c.intensity })),
        },
      );
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareId, checksKey]);

  const resolvable = checks.length >= 3 && checks.slice(-3).every((c) => c.intensity <= 2);

  // Build 30-day strip (local dates — must match the keys checks are saved under)
  const days: { iso: string; check?: typeof checks[number] }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = toDateKey(d);
    days.push({ iso, check: checks.find((c) => c.date === iso) });
  }
  const maxIntensity = 10;

  const handleCheckToday = () => {
    const perEmo: Record<string, number> = {};
    for (const emo of event.emotions) {
      const v = effEmo[emo];
      if (typeof v === 'number' && Number.isFinite(v)) perEmo[emo] = Math.min(10, Math.max(1, Math.round(v)));
    }
    const tags = noteEmoTags.filter((t) => (event.emotions as string[]).includes(t));
    upsertEmotionalCheck(event.id, today, intensity, note.trim() || undefined, Object.keys(perEmo).length ? perEmo : undefined, tags.length > 0 ? tags : undefined);
    setNote('');
  };

  const toggleNoteEmoTag = (emo: string) => {
    setNoteEmoTags((prev) => (prev.includes(emo) ? prev.filter((e) => e !== emo) : [...prev, emo].slice(0, 6)));
  };

  const perEmotionFits = useMemo(() => {
    try {
      return fitPerEmotion(checks, event.emotions as string[]);
    } catch { return []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksKey]);

  const timePatterns: TemporalPattern | null = useMemo(() => {
    try {
      return temporalPatterns(checks);
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksKey]);

  const emotionKey = (event.emotions as string[]).join('|');
  const copingTracks = useMemo(() => {
    try {
      return suggestCoping(emotionKey.split('|').filter(Boolean));
    } catch { return []; }
  }, [emotionKey]);

  // Sync latest inputs for the stable Q&R callback (placed after the memos
  // so there is no use-before-declare). Runs before the auto-run below.
  useEffect(() => {
    qaInputsRef.current = { event, checks, checksKey, today, helpfulNotes, copingTracks, perEmotionFits, forecast, focusEmotion };
  });
  // Auto-run the Q&R on open (no mandatory button): the answer appears by
  // itself, fresh when the checks changed, cached otherwise. The component
  // is keyed by event id so the guard fires once per opened event.
  const aiAutoRan = useRef(false);
  useEffect(() => {
    if (aiAutoRan.current) return;
    aiAutoRan.current = true;
    void handleAskAi(false);
  }, [handleAskAi]);

  const handleExportTherapist = () => {
    try {
      const md = buildTherapistReport(
        { title: event.title, situation: event.situation, emotions: event.emotions as string[], createdAt: event.createdAt, notes: event.notes, closureNote: event.closureNote },
        checks,
        forecast ? {
          daysRemaining: forecast.daysRemaining, loDays: forecast.loDays, hiDays: forecast.hiDays,
          halfLifeDays: forecast.halfLifeDays, confidence: forecast.confidence, method: forecast.method,
          relapsed: forecast.relapsed,
        } : null,
        helpfulNotes,
        perEmotionFits,
      );
      const safe = event.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evenement';
      const filename = `suivi-emotionnel-${safe}-${today}.md`;
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('export_file', { jsonData: md }).catch(() => {
          downloadBlobLocal(md, filename);
        }),
      ).catch(() => downloadBlobLocal(md, filename));
    } catch { /* best-effort */ }
  };

  return (
    <div className="emotional-detail">
      <div className="emotional-detail-head">
        <h3>{event.title}</h3>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Fermer</button>
      </div>
      <p className="emotional-detail-situation">{event.situation}</p>
      {event.closureNote && (
        <p className="emotional-closure-done" title="Phrase de sens écrite à la clôture">🕊️ Ce que ça m'a appris : « {event.closureNote} »</p>
      )}
      <div className="emotional-detail-emotions">
        {event.emotions.map((emo) => <span key={emo} className="emotional-chip small active">{emo}</span>)}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setEditingEmotions((v) => !v)}
          title="Ajouter ou retirer des émotions associées (ex : la colère arrive plus tard)"
        >
          {editingEmotions ? 'OK' : '+ Émotion'}
        </button>
      </div>
      {editingEmotions && (
        <div className="emotional-emotions" style={{ marginBottom: 10 }}>
          {EMOTIONS_LIST.map((emo) => {
            const active = event.emotions.includes(emo);
            return (
              <button
                key={emo}
                type="button"
                className={`emotional-chip${active ? ' active' : ''}`}
                onClick={() => {
                  const next = active
                    ? event.emotions.filter((e) => e !== emo)
                    : [...event.emotions, emo].slice(0, 6);
                  updateEmotionalEvent(event.id, { emotions: next });
                }}
              >
                {emo}
              </button>
            );
          })}
        </div>
      )}

      {(event.emotions as string[]).length > 1 && (
        <div className="emotional-focus-tabs" role="tablist" aria-label="Analyser par émotion">
          <button
            type="button"
            role="tab"
            aria-selected={focusEmotion === null}
            className={`emotional-chip small${focusEmotion === null ? ' active' : ''}`}
            onClick={() => setFocusEmotion(null)}
            title="Vue d'ensemble de l'événement"
          >
            Toutes
          </button>
          {(event.emotions as string[]).map((emo) => (
            <button
              key={emo}
              type="button"
              role="tab"
              aria-selected={focusEmotion === emo}
              className={`emotional-chip small${focusEmotion === emo ? ' active' : ''}`}
              onClick={() => setFocusEmotion(focusEmotion === emo ? null : emo)}
              title={`Analyser « ${emo} » seule : évolution, notes, estimation, coping, actions`}
            >
              🔍 {emo}
            </button>
          ))}
        </div>
      )}
      {focusEmotion && (
        <EmotionFocusPanel
          event={event}
          focus={focusEmotion}
          checks={checks}
          strip={days}
          perEmotionFits={perEmotionFits}
          copingTracks={copingTracks}
          togglePlanStep={togglePlanStep}
          onUnfocus={() => setFocusEmotion(null)}
        />
      )}

      <div className="emotional-notes-edit">
        <textarea
          placeholder="Choses à faire pour diminuer l'intensité au fil des jours..."
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          rows={2}
          onBlur={() => { if (editNotes !== event.notes) updateEmotionalEvent(event.id, { notes: editNotes }); }}
        />
      </div>

      <div className="emotional-plans">
        <h4>🪜 Plans d'action</h4>
        {(event.plans ?? []).length === 0 && (
          <p className="emotional-plans-hint">Transforme ta note en plan pas à pas — l'IA tient compte de tes épisodes passés.</p>
        )}
        {(event.plans ?? []).map((plan) => {
          const done = plan.steps.filter((s) => s.done).length;
          return (
            <div key={plan.id} className="emotional-plan">
              <div className="emotional-plan-head">
                <strong>{plan.title}</strong>
                <span className="emotional-plan-progress">{done}/{plan.steps.length}</span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => { if (confirm('Supprimer ce plan ?')) deletePlan(plan.id); }}
                  title="Supprimer le plan"
                >
                  ✕
                </button>
              </div>
              {plan.sourceNote && <p className="emotional-plan-source">Depuis : « {plan.sourceNote} »</p>}
              <div className="plan-emo-tags" title="Émotions ciblées par ce plan (vide = global)">
                {(event.emotions as string[]).map((emo) => (
                  <button
                    key={emo}
                    type="button"
                    className={`emotional-chip small${(plan.emotions ?? []).includes(emo) ? ' active' : ''}`}
                    onClick={() => togglePlanEmotion(plan.id, emo)}
                    title={(plan.emotions ?? []).includes(emo) ? `Retirer « ${emo} » de ce plan` : `Cibler ce plan sur « ${emo} »`}
                  >
                    {emo}
                  </button>
                ))}
              </div>
              <div className="emotional-plan-bar"><div style={{ width: `${plan.steps.length ? Math.round((done / plan.steps.length) * 100) : 0}%` }} /></div>
              <ul className="emotional-plan-steps">
                {plan.steps.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input type="checkbox" checked={s.done} onChange={() => togglePlanStep(plan.id, s.id)} />
                      <span className={s.done ? 'emotional-plan-step-done' : ''}>{s.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <button
          className="btn btn-sm btn-ghost"
          onClick={handleNoteToPlan}
          disabled={planLoading || !((event.notes ?? '').trim() || event.situation.trim())}
          title="L'IA découpe ta note en micro-étapes faisables, en s'appuyant sur ta mémoire émotionnelle"
        >
          {planLoading ? 'Plan en cours…' : '✨ Transformer ma note en plan d\u2019action'}
        </button>
        {planError && <p className="emotional-ai-error">{planError}</p>}
      </div>

      <div className="emotional-today-check">
        <h4>Aujourd'hui — {today}</h4>
        {todayCheck ? (
          <p className="emotional-today-done">✓ Cochée : intensité {todayCheck.intensity}/10 {todayCheck.note ? `— ${todayCheck.note}` : ''}</p>
        ) : null}
        <div className="emotional-today-form">
          <label>Charge globale du jour
            <input type="range" min={1} max={10} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
            <span className="emotional-intensity-value">{intensity}/10</span>
          </label>
          {event.emotions.map((emo) => (
            <label key={emo} className="emotional-emo-slider">{emo}
              <input
                type="range" min={1} max={10}
                value={effEmo[emo] ?? 5}
                onChange={(e) => setEmoIntensities({ ...effEmo, [emo]: Number(e.target.value) })}
              />
              <span className="emotional-intensity-value">{effEmo[emo] ?? 5}/10</span>
            </label>
          ))}
          <input placeholder="Note du jour (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="note-emo-tags" title="De quelle(s) émotion(s) parle cette note ? (vide = note globale)">
            {(event.emotions as string[]).map((emo) => (
              <button
                key={emo}
                type="button"
                className={`emotional-chip small${noteEmoTags.includes(emo) ? ' active' : ''}`}
                onClick={() => toggleNoteEmoTag(emo)}
                title={noteEmoTags.includes(emo) ? `Retirer le tag « ${emo} »` : `Tagguer la note « ${emo} »`}
              >
                {emo}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={handleCheckToday}>{todayCheck ? 'Mettre à jour' : 'Cocher aujourd\'hui'}</button>
        </div>
      </div>

      <div className="emotional-curve">
        <h4>Courbe d'intensité (30 jours + projection 7 j)</h4>
        <div className="emotional-bars">
          {days.map(({ iso, check }) => {
            const day = Number(iso.slice(8, 10));
            const isToday = iso === today;
            return (
              <div key={iso} className={`emotional-bar-wrap ${isToday ? 'today' : ''}`} title={`${iso} · ${check ? `${check.intensity}/10` : '—'}`}>
                <div className="emotional-bar-track">
                  {check && <div className="emotional-bar-fill" style={{ height: `${(check.intensity / maxIntensity) * 100}%` }} />}
                </div>
                <span className="emotional-bar-label">{day}</span>
              </div>
            );
          })}
          {(forecast?.projection ?? []).map((p) => (
            <div key={`proj-${p.date}`} className="emotional-bar-wrap projected" title={`${p.date} · projection ≈${p.intensity}/10`}>
              <div className="emotional-bar-track">
                <div className="emotional-bar-fill projected" style={{ height: `${(p.intensity / maxIntensity) * 100}%` }} />
              </div>
              <span className="emotional-bar-label">{Number(p.date.slice(8, 10))}</span>
            </div>
          ))}
        </div>
        {checks.length >= 3 && (
          <p className="emotional-trend">
            {(() => {
              const first = checks[0].intensity;
              const last = checks[checks.length - 1].intensity;
              const diff = last - first;
              if (diff < -1) return `En baisse de ${Math.abs(diff)} pts depuis le début — tu avances.`;
              if (diff > 1) return `En hausse de ${diff} pts — observe sans juger, note ce qui a changé.`;
              return 'Stable — la constance fait le travail, continue de cocher.';
            })()}
          </p>
        )}
      </div>

      {forecast && (
        <div className="emotional-forecast">
          <h4>🔮 Estimation — jours restants</h4>
          {forecast.relapsed && (
            <p className="emotional-relapse">
              ⚠️ Rebond détecté : l'intensité est repartie à la hausse. L'estimation repart du rebond
              ({forecast.fitStartDate}) au lieu de moyenner à travers la cassure.
            </p>
          )}
          {forecast.daysRemaining === null ? (
            <p className="emotional-forecast-none">
              Pas de décroissance détectée pour l'instant — la courbe ne descend pas encore.
              Continue de cocher chaque jour ; dès qu'une tendance se dessine, l'estimation apparaîtra.
            </p>
          ) : forecast.daysRemaining === 0 ? (
            <p className="emotional-forecast-done">
              ✅ Seuil déjà atteint — l'intensité est retombée à un niveau résiduel. Tu peux archiver l'événement quand tu veux.
            </p>
          ) : (
            <>
              <p className="emotional-forecast-main">
                Intensité ≤ 2/10 estimée dans <strong>≈{forecast.daysRemaining} jour{forecast.daysRemaining !== 1 ? 's' : ''}</strong>
                {forecast.loDays !== null && forecast.hiDays !== null && (
                  <> <span className="emotional-forecast-range">(fourchette {forecast.loDays}–{forecast.hiDays} j)</span></>
                )}
              </p>
              <p className="emotional-forecast-meta">
                Demi-vie estimée : {forecast.halfLifeDays < 10 ? forecast.halfLifeDays.toFixed(1) : Math.round(forecast.halfLifeDays)} j
                {' · '}confiance {forecast.confidence === 'high' ? 'haute' : forecast.confidence === 'medium' ? 'moyenne' : 'faible'}
                {' · '}base {forecast.method === 'personal' ? 'tes données seules' : forecast.method === 'blended' ? 'tes données + ordre de grandeur littérature' : 'littérature seule (peu de points) — la fourchette se resserrera'}
                {' · '}n={forecast.n}{forecast.rSquared !== null ? ` · R²=${forecast.rSquared.toFixed(2)}` : ''}
                {forecast.moodAdjusted ? ' · humeur du jour prise en compte' : ''}
              </p>
            </>
          )}
          {resolvable && (
            <div className="emotional-resolve">
              <p>
                🕊️ Intensité résiduelle depuis {checks.slice(-3)[0]?.date} — l'événement semble digéré.
                Avant de l'archiver, une phrase de sens : mettre des mots sur ce que ça t'a appris accélère la résolution (bien plus que cocher).
              </p>
              <input
                className="emotional-closure-input"
                placeholder="Qu'est-ce que ça m'a appris ? (une phrase suffit)"
                value={closureText}
                onChange={(e) => setClosureText(e.target.value)}
                maxLength={500}
              />
              <div className="emotional-resolve-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    updateEmotionalEvent(event.id, {
                      archived: true,
                      ...(closureText.trim() ? { closureNote: closureText.trim().slice(0, 500) } : {}),
                    });
                    onClose();
                  }}
                >
                  Archiver comme résolu
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => { updateEmotionalEvent(event.id, { archived: true }); onClose(); }}
                  title="Archiver sans phrase de sens"
                >
                  Archiver sans phrase
                </button>
              </div>
            </div>
          )}
          {forecast.rumination && (
            <p className="emotional-rumination-note" title="L'humiliation décroît vite puis rumine : la courbe suit une lente traîne avec des micro-pics de replay (soirs j+2, j+5)">
              🌀 Mode rumination : décroissance rapide puis lente traîne — des micro-pics le soir sont normaux, pas des rechutes.
            </p>
          )}
        </div>
      )}

      {copingTracks.length > 0 && (
        <div className="emotional-coping">
          <h4>🧭 Pistes de coping adaptées</h4>
          <p className="emotional-coping-hint">
            {(event.emotions as string[]).includes('Humiliation')
              ? 'Humiliation = blessure externe + injustice : ça se répare vers l\u2019extérieur (limites, lien choisi), pas en te jugeant.'
              : 'Honte = auto-évaluation interne : ça se répare vers l\u2019intérieur (bienveillance, réévaluation), pas en te punissant.'}
          </p>
          <ul>
            {copingTracks.map((c) => (
              <li key={`${c.emotion}-${c.track}`}>
                <strong>{c.track}</strong> <span className="emotional-coping-source">({c.emotion} · {c.source})</span>
                <br />{c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {helpfulNotes.length > 0 && (
        <div className="emotional-helpful">
          <h4>💡 Ce qui a fait baisser (à réappliquer)</h4>
          <p className="emotional-helpful-hint">Notes écrites juste avant une baisse ≥ 2 pts — corrélation, pas preuve. À retester délibérément.</p>
          <ul>
            {helpfulNotes.map((h) => (
              <li key={`${h.date}-${h.note.slice(0, 20)}`}>
                <span className="emotional-helpful-drop">−{h.drop}</span> « {h.note} » <span className="emotional-helpful-date">({h.date})</span>
                {h.copingTags.map((t) => (
                  <span key={t} className="emotional-coping-tag" title="Piste de coping détectée dans cette note">{t}</span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="emotional-ai">
        <h4>🤖 Question & recommandation IA</h4>
        <p className="emotional-ai-hint">Générée automatiquement à l'ouverture, cadrée sur tes notes — pas sur du générique. Modèle raisonnant quand disponible, sinon réflexion locale.</p>
        {aiLoading && !aiQA && <p className="emotional-ai-loading">Réflexion en cours…</p>}
        {aiError && <p className="emotional-ai-error">{aiError}</p>}
        {aiQA && (
          <div className="emotional-ai-result">
            {aiQA.question && <p className="emotional-ai-question">❓ {aiQA.question}</p>}
            {aiQA.recommendation && <p className="emotional-ai-reco">💡 {aiQA.recommendation}</p>}
            <div className="emotional-ai-actions">
              <button className="btn btn-sm btn-ghost" onClick={handleSaveAiToJournal}>→ Journal</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setAiQA(null); void handleAskAi(true); }} disabled={aiLoading}>
                {aiLoading ? 'Réflexion en cours…' : '↻ Reposer une question'}
              </button>
            </div>
          </div>
        )}
      </div>

      {compareCandidates.length > 0 && (
        <div className="emotional-compare">
          <h4>🔄 Comparer à un épisode passé du même type</h4>
          <select
            className="emotional-compare-select"
            value={compareId ?? ''}
            onChange={(e) => setCompareId(e.target.value || null)}
            aria-label="Choisir un épisode passé à comparer"
          >
            <option value="">— choisir un épisode —</option>
            {compareCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.shared} émotion{c.shared !== 1 ? 's' : ''} en commun, {c.checks} cochés)
              </option>
            ))}
          </select>
          {comparison && (
            <div className="emotional-compare-table">
              <div className="emotional-compare-row emotional-compare-head">
                <span></span><span>Épisode actuel</span><span>Épisode passé</span>
              </div>
              <div className="emotional-compare-row">
                <span>Émotions communes</span><span className="emotional-compare-span">{comparison.sharedEmotions.join(', ')}</span>
              </div>
              <div className="emotional-compare-row">
                <span>Pic d'intensité</span><span>{comparison.currentPeak}/10</span><span>{comparison.pastPeak}/10</span>
              </div>
              <div className="emotional-compare-row">
                <span>Jours suivis</span><span>{comparison.currentDays}</span><span>{comparison.pastDays}</span>
              </div>
              <div className="emotional-compare-row">
                <span>Demi-vie ajustée</span>
                <span>{comparison.currentHalfLife !== null ? `≈${comparison.currentHalfLife < 10 ? comparison.currentHalfLife.toFixed(1) : Math.round(comparison.currentHalfLife)} j` : '—'}</span>
                <span>{comparison.pastHalfLife !== null ? `≈${comparison.pastHalfLife < 10 ? comparison.pastHalfLife.toFixed(1) : Math.round(comparison.pastHalfLife)} j` : '—'}</span>
              </div>
              <div className="emotional-compare-row">
                <span>Jours jusqu'au calme (≤2)</span>
                <span>{comparison.currentDaysToCalm !== null ? `≈${comparison.currentDaysToCalm} j` : '—'}</span>
                <span>{comparison.pastDaysToCalm !== null ? `≈${comparison.pastDaysToCalm} j` : '—'}</span>
              </div>
              <p className="emotional-compare-verdict">
                {comparison.verdict === 'faster' && `📈 Tu digères ${comparison.halfLifeDeltaPct}% plus vite que cet épisode passé — ta capacité progresse.`}
                {comparison.verdict === 'slower' && `📉 Cet épisode met ${comparison.halfLifeDeltaPct !== null ? Math.abs(comparison.halfLifeDeltaPct) : ''}% plus de temps à fondre — qu'est-ce qui diffère (contexte, soutien, sommeil) ? Note-le.`}
                {comparison.verdict === 'similar' && '➡️ Trajectoire comparable à l\u2019épisode passé — même rythme, mêmes leviers.'}
                {comparison.verdict === 'unknown' && 'Pas assez de recul des deux côtés pour comparer les vitesses.'}
              </p>
            </div>
          )}
        </div>
      )}

      {perEmotionFits.some((p) => p.halfLifeDays !== null) && (
        <div className="emotional-per-emotion">
          <h4>Par émotion</h4>
          <ul>
            {perEmotionFits.filter((p) => p.halfLifeDays !== null).map((p) => (
              <li key={p.emotion}>
                <strong>{p.emotion}</strong> : demi-vie ≈{p.halfLifeDays! < 10 ? p.halfLifeDays!.toFixed(1) : Math.round(p.halfLifeDays!)} j
                {p.daysRemaining !== null ? ` · ≈${p.daysRemaining} j restants` : ''}
                <span className="emotional-learned-n"> (n={p.n}{p.rSquared !== null ? `, R²=${p.rSquared.toFixed(2)}` : ''})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {timePatterns && (timePatterns.peakDow !== null || timePatterns.peakHour !== null) && (
        <div className="emotional-temporal">
          <h4>🕐 Quand ça pique le plus</h4>
          <p>
            {timePatterns.peakDow !== null && (
              <>Pics (≥7/10) concentrés le <strong>{['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][timePatterns.peakDow]}</strong> ({timePatterns.peakDowCount}×). </>
            )}
            {timePatterns.peakHour !== null && (
              <>Heure la plus fréquente : <strong>{timePatterns.peakHour}h</strong> ({timePatterns.peakHourCount}×).</>
            )}
            {' '}Sur {timePatterns.totalChecks} relevés — descriptif, pas prédictif.
          </p>
        </div>
      )}

      <div className="emotional-export">
        <button className="btn btn-sm btn-ghost" onClick={handleExportTherapist} title="Génère un résumé lisible pour un professionnel">
          📄 Exporter pour mon thérapeute (.md)
        </button>
      </div>

      <div className="emotional-history">
        <h4>Historique</h4>
        {checks.length === 0 && <p className="empty-hint">Aucun jour coché — coche aujourd'hui pour démarrer la courbe.</p>}
        {checks.slice().reverse().map((c) => (
          <div key={c.id}>
            <div className="emotional-history-row">
              <span className="emotional-history-date">{c.date}</span>
              <span className="emotional-history-intensity">{c.intensity}/10</span>
              {c.note && <span className="emotional-history-note">{c.note}</span>}
              {(c.noteEmotions ?? []).length > 0 && (
                <span className="emotional-history-tags" title={`Note à propos de : ${(c.noteEmotions ?? []).join(', ')}`}>
                  {(c.noteEmotions ?? []).map((t) => (
                    <span key={t} className="emotional-coping-tag">{t}</span>
                  ))}
                </span>
              )}
              {c.note && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleReplyToNote(c.id, c.date, c.note as string)}
                  disabled={!!noteReplies[c.id]?.loading}
                  title="L'IA répond à cette note dans son contexte"
                >
                  {noteReplies[c.id]?.loading ? '…' : '↩ Répondre'}
                </button>
              )}
            </div>
            {noteReplies[c.id]?.text && (
              <p className="emotional-note-reply">🤖 {noteReplies[c.id]!.text}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmotionFocusPanel({ event, focus, checks, strip, perEmotionFits, copingTracks, togglePlanStep, onUnfocus }: {
  event: EmotionalEvent;
  focus: string;
  checks: ReturnType<typeof getEmotionalChecks>;
  strip: { iso: string }[];
  perEmotionFits: ReturnType<typeof fitPerEmotion>;
  copingTracks: ReturnType<typeof suggestCoping>;
  togglePlanStep: (planId: string, stepId: string) => void;
  onUnfocus: () => void;
}) {
  const series = perEmotionSeries(checks, focus);
  const byDate = new Map(series.map((p) => [p.date, p.value]));
  const hasValues = series.some((p) => p.value !== null);
  const fit = perEmotionFits.find((p) => p.emotion === focus);
  const taggedNotes = checks.filter((c) => c.note && (c.noteEmotions ?? []).includes(focus));
  const coping = copingTracks.filter((c) => c.emotion === focus);
  const targetedPlans = (event.plans ?? []).filter((p) => (p.emotions ?? []).includes(focus));
  const globalPlans = (event.plans ?? []).filter((p) => !(p.emotions ?? []).length);
  return (
    <div className="emotional-focus-panel" role="tabpanel" aria-label={`Analyse de ${focus}`}>
      <div className="emotional-focus-head">
        <h4>🔍 {focus} — analyse</h4>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onUnfocus} title="Revenir à la vue d'ensemble">
          Toutes
        </button>
      </div>

      <div className="emotional-focus-block">
        <h5>Évolution</h5>
        {!hasValues ? (
          <p className="empty-hint">Aucun relevé par émotion pour « {focus} » — coche avec les curseurs par émotion et sa trajectoire apparaîtra ici.</p>
        ) : (
          <div className="emotional-bars per-emotion" role="img" aria-label={`Trajectoire de ${focus}`}>
            {strip.map(({ iso }) => {
              const v = byDate.get(iso) ?? null;
              const day = Number(iso.slice(8, 10));
              return (
                <div key={iso} className="emotional-bar-wrap" title={`${iso} · ${v !== null ? `${v}/10` : '—'}`}>
                  <div className="emotional-bar-track">
                    {v !== null && <div className="emotional-bar-fill per-emotion-fill" style={{ height: `${(v / 10) * 100}%` }} />}
                  </div>
                  <span className="emotional-bar-label">{day}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="emotional-focus-block">
        <h5>Estimation</h5>
        {fit && fit.halfLifeDays !== null ? (
          <p className="emotional-focus-est">
            Demi-vie ≈{fit.halfLifeDays < 10 ? fit.halfLifeDays.toFixed(1) : Math.round(fit.halfLifeDays)} j
            {fit.daysRemaining !== null ? ` · ≈${fit.daysRemaining} j restants` : ''}
            <span className="emotional-learned-n"> (n={fit.n}{fit.rSquared !== null ? `, R²=${fit.rSquared.toFixed(2)}` : ''})</span>
          </p>
        ) : (
          <p className="empty-hint">Pas encore de trajectoire mesurable pour « {focus} » — il faut 3 relevés avec curseurs par émotion.</p>
        )}
      </div>

      <div className="emotional-focus-block">
        <h5>Notes liées ({taggedNotes.length})</h5>
        {taggedNotes.length === 0 ? (
          <p className="empty-hint">Aucune note taggée « {focus} » — écris la note du jour avec son tag ci-dessous.</p>
        ) : (
          <ul className="emotional-focus-notes">
            {taggedNotes.map((c) => (
              <li key={c.id}>
                <span className="emotional-history-date">{c.date}</span> « {c.note} »
              </li>
            ))}
          </ul>
        )}
      </div>

      {coping.length > 0 && (
        <div className="emotional-focus-block">
          <h5>Pistes de coping — {focus}</h5>
          <ul className="emotional-focus-coping">
            {coping.map((c) => (
              <li key={c.track}><strong>{c.track}</strong> — {c.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="emotional-focus-block">
        <h5>Choses à faire ({targetedPlans.length + globalPlans.length})</h5>
        {targetedPlans.length === 0 && globalPlans.length === 0 && (
          <p className="empty-hint">Aucun plan pour l'instant — tagge un plan existant avec « {focus} » ou transforme ta note en plan.</p>
        )}
        {targetedPlans.map((plan) => (
          <div key={plan.id} className="emotional-plan emotional-plan-targeted">
            <div className="emotional-plan-head">
              <strong>{plan.title}</strong>
              <span className="emotional-plan-progress">{plan.steps.filter((s) => s.done).length}/{plan.steps.length}</span>
            </div>
            <ul className="emotional-plan-steps">
              {plan.steps.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={s.done} onChange={() => togglePlanStep(plan.id, s.id)} />
                    <span className={s.done ? 'emotional-plan-step-done' : ''}>{s.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {globalPlans.map((plan) => (
          <div key={plan.id} className="emotional-plan">
            <div className="emotional-plan-head">
              <strong>{plan.title}</strong>
              <span className="emotional-coping-tag" title="Plan global : utile pour toutes les émotions">global</span>
              <span className="emotional-plan-progress">{plan.steps.filter((s) => s.done).length}/{plan.steps.length}</span>
            </div>
            <ul className="emotional-plan-steps">
              {plan.steps.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={s.done} onChange={() => togglePlanStep(plan.id, s.id)} />
                    <span className={s.done ? 'emotional-plan-step-done' : ''}>{s.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
