// src/KnowledgeView.tsx
// The "preference engine" surface: LifeTrack reads YOUR data (notes, habits,
// projects, correlations) and proposes a small, ranked set of protocols to try,
// challenges to take and experiments to run — nothing endless to "complete".
// Plus the automated ingest: deposit a source (transcript/article/feed) and the
// pipeline extracts structured, evidence-graded protocols.

import { useState, useEffect, useMemo } from 'react';
import {
  getProtocols,
  setProtocols,
  getIngestedSources,
  addIngestedSource,
  markIngestedSource,
  deleteIngestedSource,
  getFeeds,
  addFeed,
  updateFeed,
  deleteFeed,
  applyFeedIngest,
  addChallenge,
  addExperiment,
  getPreferences,
  updatePreferences,
  exportAllData,
  subscribe,
} from './store';
import { buildPreferenceReport, type RankedProtocol } from './preferences';
import type { ChallengeSuggestion } from './challengeSuggestions';
import type { ExperimentDraft } from './experimentFactory';
import { extractProtocolsFromText, mergeProtocols, aiExtractProtocols } from './ingest';
import { DOMAIN_LABEL, adoptProtocol, SEED_PROTOCOLS } from './protocols';
import { getHabits, addHabit } from './store';
import { runFeedCycle, pickFetcher, DEFAULT_FEEDS } from './autoIngest';
import type { AppData, IngestedSource, FeedConfig, Protocol } from './types';

const EVIDENCE_META: Record<Protocol['evidenceLevel'], { label: string; cls: string }> = {
  A: { label: 'Preuve A · études contrôlées', cls: 'proto-ev-a' },
  B: { label: 'Preuve B · protocole d’expert', cls: 'proto-ev-b' },
  C: { label: 'Preuve C · corrélation/anecdote', cls: 'proto-ev-c' },
};

export default function KnowledgeView() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const [activeTab, setActiveTab] = useState<'suggest' | 'ingest' | 'feeds'>('suggest');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedTitle, setFeedTitle] = useState('');
  const [cycleRunning, setCycleRunning] = useState(false);
  const [cycleStatus, setCycleStatus] = useState('');

  const report = useMemo(() => {
    try {
      const d = exportAllData() as unknown as AppData;
      return buildPreferenceReport({
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
    } catch { /* fallthrough */ }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const sources: IngestedSource[] = useMemo(() => {
    try { return getIngestedSources(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const feeds: FeedConfig[] = useMemo(() => {
    try { return getFeeds(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const ingest = () => {
    const title = sourceTitle.trim() || 'Source importée';
    const text = sourceText.trim();
    if (!text) return;
    const extracted = extractProtocolsFromText(text, title);
    if (extracted.length > 0) {
      setProtocols(mergeProtocols(getProtocols(), extracted));
    }
    const src = addIngestedSource(title, text);
    markIngestedSource(src.id);
    setSourceTitle('');
    setSourceText('');
  };

  const acceptChallenge = (s: ChallengeSuggestion) => {
    try {
      addChallenge(s.habitId, s.title, s.days, s.dailyGoal, s.adaptive);
    } catch { /* ignore */ }
  };

  const acceptExperiment = (e: ExperimentDraft) => {
    try {
      addExperiment({
        title: e.title,
        hypothesis: e.hypothesis,
        startDate: e.startDate,
        endDate: e.endDate,
        linkedHabits: e.linkedHabits,
        linkedMetrics: e.linkedMetrics,
      });
    } catch { /* ignore */ }
  };
const refreshFeedsNow = async () => {
    if (cycleRunning) return;
    setCycleRunning(true);
    setCycleStatus('Récupération des flux…');
    try {
      const fetcher = await pickFetcher();
      const outcome = await runFeedCycle(getFeeds(), getProtocols(), getIngestedSources(), fetcher, new Date());

      // Optional AI enrichment (DeepSeek V4 Flash): structure the newest sources
      // more precisely than the offline heuristic. Best-effort, batched to 3.
      let lib = outcome.protocols;
      let aiAdded = 0;
      if (getPreferences().ingestAiEnabled) {
        for (const src of outcome.sources.slice(0, 3)) {
          try {
            const ai = await aiExtractProtocols(src.rawText, src.title, {
              model: getPreferences().aiModel ?? undefined,
              provider: getPreferences().aiProvider || 'auto',
              apiKey: getPreferences().aiApiKey || '',
            });
            const before = lib.length;
            lib = mergeProtocols(lib, ai);
            aiAdded += lib.length - before;
          } catch { /* best-effort */ }
        }
      }
      if (aiAdded > 0) {
        applyFeedIngest({ ...outcome, protocols: lib });
      } else {
        applyFeedIngest(outcome);
      }

      const errNote = outcome.errors.length > 0 ? ` · ${outcome.errors.length} erreur(s)` : '';
      setCycleStatus(
        `✓ ${outcome.newItemsCount} article(s) · +${outcome.newProtocolsCount} protocole(s)${aiAdded ? ` · +${aiAdded} IA` : ''}${errNote}`,
      );
    } catch (e) {
      setCycleStatus(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCycleRunning(false);
    }
  };

  const handleAddFeed = () => {
    const url = feedUrl.trim();
    if (!url) return;
    addFeed(url, feedTitle.trim() || undefined);
    setFeedUrl('');
    setFeedTitle('');
  };

  const toggleAutostart = async (enabled: boolean) => {
    updatePreferences({ autostartEnabled: enabled });
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      void invoke('set_autostart', { enabled }).catch(() => { /* best-effort */ });
    }
  };

  const prefs = getPreferences();

  const protoBadge = (p: RankedProtocol) => (
    <span className={`proto-ev-badge ${EVIDENCE_META[p.protocol.evidenceLevel].cls}`}>
      {EVIDENCE_META[p.protocol.evidenceLevel].label}
    </span>
  );

  const weakLabel = (d: string) => DOMAIN_LABEL[d as keyof typeof DOMAIN_LABEL] ?? d;

  return (
    <div className="lever-section knowledge-section">
      <div className="lever-header">
        <h3>🧠 Connaissances & auto-amélioration</h3>
        <span className="lever-subtitle">
          Le moteur de préférences lit tes notes, habitudes, projets et corrélations, puis te propose
          un petit nombre de protocoles, challenges et expériences — rien à « compléter ».
        </span>
      </div>

      <div className="mantra-tabs">
        <button className={`mantra-tab ${activeTab === 'suggest' ? 'active' : ''}`} onClick={() => setActiveTab('suggest')}>
          Suggestions
        </button>
        <button className={`mantra-tab ${activeTab === 'ingest' ? 'active' : ''}`} onClick={() => setActiveTab('ingest')}>
          Ingest (sources)
        </button>
        <button className={`mantra-tab ${activeTab === 'feeds' ? 'active' : ''}`} onClick={() => setActiveTab('feeds')}>
          Flux auto
        </button>
      </div>

      {activeTab === 'suggest' && (
        <div className="knowledge-suggest">
          {report && report.weakDomains.length > 0 && (
            <p className="lever-suggestions-hint">
              📉 Domaine(s) faible(s) détecté(s) cette quinzaine :{' '}
              {report.weakDomains.map((d) => (
                <span className="project-habit-pill" key={d}>{weakLabel(d)}</span>
              ))}
            </p>
          )}

          {report && report.protocols.length > 0 && (
            <>
              <h4>🧪 Protocoles à tester maintenant</h4>
              <div className="lever-list">
                {report.protocols.map((p) => {
                  const handleAdopt = () => {
                    const currentHabits = getHabits();
                    const allP = getProtocols();
                    const res = adoptProtocol(p.protocol.id, allP.length > 0 ? allP : SEED_PROTOCOLS, currentHabits, (hData) => addHabit(hData.name ?? p.protocol.title));
                    if (res.created.length > 0) {
                      setTick(t => t + 1);
                    }
                  };

                  return (
                    <div className="lever-card proto-card" key={p.protocol.id}>
                      <div className="lever-card-main">
                        <span className="lever-content">{p.protocol.title}</span>
                        <span className="lever-effect">→ {p.protocol.protocol}</span>
                        {p.protocol.claim && <span className="lever-notes">{p.protocol.claim}</span>}
                        <span className="lever-notes">
                          Source : {p.protocol.source} · {DOMAIN_LABEL[p.protocol.domain]}
                        </span>
                        <div className="proto-reasons">
                          {p.alreadyPursued && <span className="proto-reason">✅ déjà poursuivi</span>}
                          {p.reasons.map((r, i) => <span className="proto-reason" key={i}>{r}</span>)}
                          {protoBadge(p)}
                        </div>
                      </div>
                      <div className="lever-actions" style={{ marginLeft: '1rem' }}>
                        {!p.alreadyPursued && (
                          <button className="btn btn-sm btn-primary" onClick={handleAdopt}>
                            ⚡ Adopter
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="lever-suggestions-hint">
                Niveaux de preuve (honnêtes) : {EVIDENCE_META.A.label} · {EVIDENCE_META.B.label} ·{' '}
                {EVIDENCE_META.C.label}. Un protocole risqué (suppléments, jeûne…) demande prudence.
              </p>
            </>
          )}
          {report && report.protocols.length === 0 && (
            <p className="lever-none">
              Aucun protocole ne correspond encore à tes données : écris des notes, ajoute des
              habitudes ou importe une source dans l'onglet « Ingest » pour que les suggestions
              émergent.
            </p>
          )}

          {report && report.challenges.length > 0 && (
            <>
              <h4>🏔️ Challenges recommandés par l'analyse</h4>
              <div className="lever-list">
                {report.challenges.map((c) => (
                  <div className="lever-card" key={`${c.kind}-${c.habitId}`}>
                    <div className="lever-card-main">
                      <span className="lever-content">{c.title}</span>
                      <span className="lever-notes">{c.rationale}</span>
                      <span className="lever-effect">{c.days} jours · {c.dailyGoal}×/jour · {c.kind}</span>
                    </div>
                    <div className="lever-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => acceptChallenge(c)}>
                        ✓ Lancer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report && report.experiments.length > 0 && (
            <>
              <h4>🧪 Expériences (N=1) proposées</h4>
              <div className="lever-list">
                {report.experiments.map((e, idx) => (
                  <div className="lever-card" key={`exp-${idx}`}>
                    <div className="lever-card-main">
                      <span className="lever-content">{e.title}</span>
                      <span className="lever-notes">{e.hypothesis}</span>
                      <span className="lever-effect">
                        {e.suggestedDays} jours · du {e.startDate} au {e.endDate}
                      </span>
                    </div>
                    <div className="lever-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => acceptExperiment(e)}>
                        🧪 Créer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'ingest' && (
        <div className="knowledge-ingest">
          <h4>📥 Ingestion automatisée</h4>
          <p className="lever-suggestions-hint">
            Dépose un transcript de podcast, article ou notes de recherche. L'extraction divise la
            source en affirmations, classe le domaine et grade le niveau de preuve — sans rien avoir à
            compléter.
          </p>
          <div className="lever-form">
            <input
              className="text-input"
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="Titre / source (ex : Huberman Lab #42)"
              aria-label="Titre de la source"
            />
            <textarea
              className="ingest-textarea"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={'Colle ici le contenu…\n- La lumière du matin améliore le sommeil.\n- La caféine le soir nuit au repos.'}
              aria-label="Contenu de la source"
              rows={8}
            />
            <button className="btn btn-primary" onClick={ingest}>⚙️ Extraire & ingérer</button>
          </div>

          {sources.length > 0 && (
            <div className="lever-suggestions">
              <h4>🗂️ Sources ingérées</h4>
              <div className="lever-list">
                {sources.map((s) => (
                  <div className="lever-card" key={s.id}>
                    <div className="lever-card-main">
                      <span className="lever-content">{s.title}</span>
                      <span className="lever-notes">
                        {s.ingested ? '✓ traitée' : 'en attente'} · {s.rawText.length} caractères ·{' '}
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="lever-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => deleteIngestedSource(s.id)}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'feeds' && (
        <div className="knowledge-feeds">
          <h4>♻️ Ingestion permanente & automatique</h4>
          <p className="lever-suggestions-hint">
            LifeTrack récupère tes flux RSS/Atom en arrière-plan, extrait les protocoles et enrichit
            la bibliothèque — sans que tu n'aies rien à coller ni à compléter.
          </p>

          <div className="feed-prefs">
            <label className="project-task">
              <input
                type="checkbox"
                checked={prefs.autoIngestEnabled !== false}
                onChange={(e) => updatePreferences({ autoIngestEnabled: e.target.checked })}
              />
              <span>Activer l'ingestion automatique</span>
            </label>
            <label className="project-task">
              <input
                type="checkbox"
                checked={prefs.autostartEnabled === true}
                onChange={(e) => toggleAutostart(e.target.checked)}
              />
              <span>Lancer LifeTrack au démarrage de Windows (ingestion en continu)</span>
            </label>
            <label className="project-task feed-interval">
              <span>Fréquence :</span>
              <select
                className="text-input"
                value={prefs.autoIngestIntervalHours ?? 6}
                onChange={(e) => updatePreferences({ autoIngestIntervalHours: Number(e.target.value) })}
              >
                {[1, 3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} h</option>)}
              </select>
            </label>
          </div>

          <div className="feed-actions">
            <button className="btn btn-primary" onClick={refreshFeedsNow} disabled={cycleRunning}>
              {cycleRunning ? '⏳ Récupération…' : '🔃 Rafraîchir maintenant'}
            </button>
            {cycleStatus && <span className="feed-status">{cycleStatus}</span>}
          </div>

          {feeds.length === 0 ? (
            <p className="lever-none">Aucun flux configuré. Ajoute un flux RSS ci-dessous.</p>
          ) : (
            <div className="lever-list">
              {feeds.map((f) => (
                <div className="lever-card" key={f.id}>
                  <div className="lever-card-main">
                    <span className="lever-content">{f.title}</span>
                    <span className="lever-notes">{f.url}</span>
                    <span className="lever-effect">
                      {f.lastFetchAt ? `Dernière vérif : ${new Date(f.lastFetchAt).toLocaleString()}` : 'Jamais vérifiée'}
                    </span>
                  </div>
                  <div className="lever-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => updateFeed(f.id, { enabled: !f.enabled })}>
                      {f.enabled ? '🟢 Actif' : '⚪ Inactif'}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => deleteFeed(f.id)}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="lever-form feed-add">
            <input
              className="text-input"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="URL du flux RSS/Atom (arXiv, podcast Huberman, Modern Wisdom…)"
              aria-label="URL du flux"
            />
            <input
              className="text-input"
              value={feedTitle}
              onChange={(e) => setFeedTitle(e.target.value)}
              placeholder="Nom (optionnel)"
              aria-label="Nom du flux"
            />
            <button className="btn btn-primary" onClick={handleAddFeed}>+ Ajouter</button>
          </div>

          <p className="lever-suggestions-hint">
            Flux par défaut (arXiv — neuroscience, IHM, IA) : {DEFAULT_FEEDS.map((f) => f.url).join(' · ')}.
          </p>
        </div>
      )}
    </div>
  );
}