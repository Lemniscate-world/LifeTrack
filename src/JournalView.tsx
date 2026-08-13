// src/JournalView.tsx
// Private AI journal: write freely, one of four personas reflects back.
// Personas: Coach (action), Sage (perspective), Psychologist (emotion),
// Strategist (planning). Uses the configured AI provider (cloud/local/auto).

import { useState, useEffect, useMemo } from 'react';
import { getJournalEntries, addJournalEntry, deleteJournalEntry, getJournalThreads, startJournalThread, deleteJournalThread, tagJournalEntryThread, exportAllData, getPreferences, subscribe, getPatternTracks, replacePatternTracks, getReflections, addReflection, answerReflection, getProjects, getProtocols, updateJournalEntryLinks, addChallenge, addNote } from './store';
import { buildAiContext } from './aiContext';
import { buildJournalPrompts, type JournalPrompt } from './journalPrompts';
import { detectNegativePatterns, allPatternsById } from './psychoanalysis';
import { advanceTracks, questionForStep, STEPS, MAX_STEP } from './patternProgress';
import { detectReflections, filterNewReflections, reflectionEmoji, type DetectedReflection } from './reflection';
import { buildJournalDigest, digestSummary, type DigestPeriod } from './journalDigest';
import { detectJournalLinks, resolveEntryLinks, type JournalLink } from './journalLinks';
import { suggestJournalActions } from './journalActions';
import { searchJournalEntries, highlightQuery } from './journalSearch';
import type { JournalEntry, JournalPersonality } from './types';

const PERSONALITIES: { id: JournalPersonality; name: string; emoji: string; tagline: string; color: string }[] = [
  { id: 'coach', name: 'Coach', emoji: '🥊', tagline: 'Actionable & direct', color: '#DBEAFE' },
  { id: 'sage', name: 'Sage', emoji: '🧘', tagline: 'Perspective & calm', color: '#EDE9FE' },
  { id: 'psychologist', name: 'Psychologist', emoji: '🫂', tagline: 'Emotions & depth', color: '#FCE7F3' },
  { id: 'strategist', name: 'Strategist', emoji: '♟️', tagline: 'Planning & clarity', color: '#FEF3C7' },
  { id: 'robert-greene', name: 'Robert Greene', emoji: '👑', tagline: 'Strategy & power', color: '#FEE2E2' },
  { id: 'huberman', name: 'Huberman', emoji: '🧬', tagline: 'Neuroscience & protocols', color: '#D1FAE5' },
];

export default function JournalView() {
  const [tick, setTick] = useState(0);
  const [personality, setPersonality] = useState<JournalPersonality>('coach');
  const [draft, setDraft] = useState('');
  const [reflecting, setReflecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptRandom, setPromptRandom] = useState(0);
  // Active discussion thread: when non-null, the next reflection is tagged to it.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Reflection answers being drafted (id → draft text).
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [today] = useState(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  });

  // Periodic synthesis + search + interactivity (v0.6.2).
  const [digestPeriod, setDigestPeriod] = useState<DigestPeriod>('week');
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [showActions, setShowActions] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe(() => setTick(t => t + 1));
    return unsub;
  }, []);

  const entries = getJournalEntries();

  const prompts = useMemo(() => {
    try { return buildJournalPrompts(exportAllData(), today, promptRandom); }
    catch { return { prompts: [], summary: '' }; }
  }, [today, promptRandom]);

  const applyPrompt = (p: JournalPrompt) => {
    setDraft(p.text);
    // Starting a fresh thread only when a new question is picked; re-applying
    // the same question keeps the existing thread so the discussion continues.
    const existing = getJournalThreads().find(
      (t) => t.question === p.text && (!p.patternId || t.patternId === p.patternId),
    );
    setActiveThreadId(existing ? existing.id : startJournalThread({
      question: p.text,
      patternId: p.patternId,
      step: p.patternStep,
      emoji: p.emoji,
    }).id);
  };

  const threads = useMemo(() => {
    try { return getJournalThreads(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, entries.length]);

  const threadCount = (threadId: string) =>
    entries.filter((e) => e.threadId === threadId).length;

  const tracks = useMemo(() => {
    try { return getPatternTracks(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Self-improvement loop: current data → open questions, minus any already
  // asked/persisted recently under the same dedupeKey.
  const reflections = useMemo(() => {
    try {
      const all = exportAllData();
      const detected = detectReflections({
        habits: all.habits,
        checkIns: all.checkIns,
        notes: all.notes,
        urges: all.urges,
        challenges: all.challenges,
        journalEntries: all.journalEntries,
        tracks: all.patternTracks,
      });
      const fresh = filterNewReflections(detected, getReflections(), 7);
      return fresh
        .sort((a, b) => (b.habitIds.length - a.habitIds.length))
        .slice(0, 4);
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, entries.length]);

  const handleAnswerReflection = (r: DetectedReflection) => {
    const answer = (answerDrafts[r.dedupeKey] ?? '').trim();
    if (!answer) return;
    const entry = addReflection({
      kind: r.kind,
      title: r.title,
      question: r.question,
      context: r.context,
      habitIds: r.habitIds,
      dedupeKey: r.dedupeKey,
    });
    answerReflection(entry.id, answer);
    setAnswerDrafts((d) => ({ ...d, [r.dedupeKey]: '' }));
  };

  const allFrames = useMemo(() => {
    try { return allPatternsById(); } catch { return new Map<string, import('./psychoanalysis').NegativePattern>(); }
  }, []);
  const patternsById = allFrames;

  const handleReflect = async () => {
    const content = draft.trim();
    if (!content || reflecting) return;
    setReflecting(true);
    setError(null);
    try {
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setError('Journal reflection requires the desktop app (AI provider).');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      let context = '';
      try { context = buildAiContext(exportAllData()); } catch { context = ''; }
      const response = await invoke<string>('journal_analyze', {
        content,
        personality,
        summaryJson: context,
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      // Auto-link the entry to projects/protocols/habits mentioned in it.
      let links: JournalLink[] = [];
      try {
        links = detectJournalLinks(content, getProjects(), getProtocols(), exportAllData().habits);
      } catch { links = []; }
      const entry = addJournalEntry(content, personality, response, {
        projectIds: links.filter((l) => l.kind === 'project').map((l) => l.id),
        protocolIds: links.filter((l) => l.kind === 'protocol').map((l) => l.id),
        habitIds: links.filter((l) => l.kind === 'habit').map((l) => l.id),
      });
      if (activeThreadId) tagJournalEntryThread(entry.id, activeThreadId);
      // Progressive psychological work: detect the patterns in what was just
      // written, advance their tracks, and persist so growth continues later.
      try {
        const tracks = getPatternTracks();
        const hitList = detectNegativePatterns([], [{ id: 'tmp', habitId: 'tmp', content, createdAt: new Date().toISOString() }], []);
        const next = advanceTracks(tracks, hitList, new Date());
        replacePatternTracks(next);
      } catch { /* pattern tracking is best-effort */ }
      setDraft('');
      setPromptRandom((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong while reflecting.');
    } finally {
      setReflecting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const digest = useMemo(() => {
    try { return buildJournalDigest(entries, today, digestPeriod); } catch { return null; }
  }, [entries, today, digestPeriod]);

  const handleSynthesize = async () => {
    if (synthesizing) return;
    setSynthesizing(true);
    setError(null);
    try {
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setError('La synthèse IA nécessite l\'application desktop (fournisseur IA).');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const periodLabel = digestPeriod === 'week' ? 'semaine' : 'mois';
      const entriesForAi = entries
        .filter((e) => {
          const d = e.createdAt.slice(0, 10);
          return digest ? d >= digest.windowStart && d <= digest.windowEnd : false;
        })
        .slice(0, 40)
        .map((e) => `[${e.createdAt.slice(0, 10)}] (${e.personality}) ${e.content.slice(0, 200)}`)
        .join('\n');
      const out = await invoke<string>('journal_summary', {
        digestJson: digest ? digestSummary(digest) : 'Aucune donnée.',
        entriesJson: entriesForAi || '(aucune entrée dans la période)',
        period: periodLabel,
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      setSynthesis(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur pendant la synthèse.');
    } finally {
      setSynthesizing(false);
    }
  };

  const filteredEntries = useMemo(() => {
    const query = { text: searchText.trim() };
    try { return searchText.trim() ? searchJournalEntries(entries, query) : entries; } catch { return entries; }
  }, [entries, searchText]);

  const projects = getProjects();
  const protocols = getProtocols();
  const allHabits = exportAllData().habits;

  const handleAction = (entry: JournalEntry, action: ReturnType<typeof suggestJournalActions>[number]) => {
    try {
      if (action.type === 'challenge' && action.habitId) {
        const habit = allHabits.find((h) => h.id === action.habitId);
        addChallenge(action.habitId, `Défi ${habit?.name ?? '7j'}`, 7, 1, true);
        setError(null);
        setShowActions(null);
        return;
      }
      if (action.type === 'note' && action.noteText) {
        addNote(action.noteText);
        setError(null);
        setShowActions(null);
        return;
      }
      if ((action.type === 'link-project' || action.type === 'link-protocol') && (action.projectId || action.protocolId)) {
        const resolved = resolveEntryLinks(entry, []);
        updateJournalEntryLinks(entry.id, {
          projectIds: action.projectId ? [...new Set([...(entry.projectIds ?? []), action.projectId])] : undefined,
          protocolIds: action.protocolId ? [...new Set([...(entry.protocolIds ?? []), action.protocolId])] : undefined,
          habitIds: resolved.habitIds,
        });
        setError(null);
        setShowActions(null);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur.');
    }
  };

  const projectLabel = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const protocolLabel = (id: string) => protocols.find((p) => p.id === id)?.title ?? id;
  const habitLabel = (id: string) => allHabits.find((h) => h.id === id)?.name ?? id;

  return (
    <div className="journal-view">
      <div className="journal-header">
        <h2>📓 Journal</h2>
        <p className="journal-subtitle">
          Write freely. Choose who you want to hear you — then reflect with them.
        </p>
      </div>

      {/* Personality picker */}
      <div className="journal-personas">
        {PERSONALITIES.map(p => (
          <button
            key={p.id}
            className={`journal-persona ${personality === p.id ? 'active' : ''}`}
            style={personality === p.id ? { borderColor: p.color, background: `${p.color}22` } : undefined}
            onClick={() => setPersonality(p.id)}
          >
            <span className="journal-persona-emoji">{p.emoji}</span>
            <span className="journal-persona-name">{p.name}</span>
            <span className="journal-persona-tagline">{p.tagline}</span>
          </button>
        ))}
      </div>

      {/* Prompts — "rien à écrire" deepl first, so the journal starts from data */}
      <div className="journal-prompts">
        <div className="journal-prompts-header">
          <h3 className="journal-prompts-title">🧭 Rien à écrire ? Commence par là</h3>
          <button
            className="btn btn-sm btn-ghost journal-prompts-refresh"
            onClick={() => setPromptRandom((n) => n + 1)}
            title="De nouvelles questions"
          >
            🔄
          </button>
        </div>
        {prompts.prompts.length === 0 ? (
          <p className="journal-prompts-empty">Donne-toi quelques jours de données, et le journal te posera des questions ancrées sur ta propre vie.</p>
        ) : (
          <>
            <ul className="journal-prompt-list">
              {prompts.prompts.map((p) => (
                <li key={p.id} className="journal-prompt-chip-wrap">
                  <button type="button" className="journal-prompt-chip" onClick={() => applyPrompt(p)}>
                    <span className="journal-prompt-emoji">{p.emoji}</span>
                    <span className="journal-prompt-text">{p.text}</span>
                  </button>
                  {p.context && <span className="journal-prompt-context">{p.context}</span>}
                </li>
              ))}
            </ul>
            <p className="journal-prompts-summary">{prompts.summary}</p>
          </>
        )}
      </div>

      {/* Progressive work on detected patterns — "continue où tu en étais" */}
      {tracks.length > 0 && (
        <div className="journal-tracks">
          <div className="journal-tracks-header">
            <h3 className="journal-tracks-title">🧬 Les failles en travail</h3>
            <span className="journal-tracks-hint">Chaque jour où tu en reparles, tu passes à l'étape suivante.</span>
          </div>
          <ul className="journal-track-list">
            {tracks.slice(0, 5).map((t) => {
              const pat = patternsById.get(t.patternId);
              if (!pat) return null;
              const stepClamped = Math.max(0, Math.min(t.step, MAX_STEP));
              const pct = Math.round((t.step / MAX_STEP) * 100);
              return (
                <li key={t.patternId} className="journal-track">
                  <div className="journal-track-top">
                    <span className="journal-track-name">{pat.emoji} {pat.name}</span>
                    <span className="journal-track-step">{STEPS[stepClamped].emoji} {STEPS[stepClamped].label} · {pct}%</span>
                  </div>
                  <div className="journal-track-bar">
                    <div className="journal-track-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="journal-track-question">{questionForStep(pat, t.step)}</p>
                  <button type="button" className="btn btn-sm btn-ghost journal-track-apply" onClick={() => applyPrompt({ id: `track-${t.patternId}`, emoji: pat.emoji, text: questionForStep(pat, t.step), patternId: t.patternId, patternStep: t.step })}>
                    Répondre à cette étape
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Composer */}
      <div className="journal-composer">
        <textarea
          className="form-textarea journal-textarea"
          placeholder="What's on your mind right now? No filter, no structure — just write."
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={5}
        />
        <div className="journal-composer-actions">
          <button
            className="btn btn-primary"
            onClick={handleReflect}
            disabled={reflecting || !draft.trim()}
          >
            {reflecting ? 'Reflecting…' : `✨ Reflect with ${PERSONALITIES.find(p => p.id === personality)?.name}`}
          </button>
        </div>
        {error && <p className="journal-error">{error}</p>}
      </div>

      {/* Réflexions — les questions que LifeTrack se pose sur TES données */}
      {reflections.length > 0 && (
        <div className="journal-reflections">
          <div className="journal-reflections-header">
            <h3>🔮 Le regard de LifeTrack</h3>
            <span className="journal-reflections-hint">
              Il observe tes données et se pose des questions. Réponds-les :
              la leçon est enregistrée et nourrit l'analyse future.
            </span>
          </div>
          <ul className="journal-reflection-list">
            {reflections.map((r) => (
              <li key={r.dedupeKey} className="journal-reflection">
                <div className="journal-reflection-top">
                  <span className="journal-reflection-emoji">{reflectionEmoji(r.kind)}</span>
                  <span className="journal-reflection-title">{r.title}</span>
                </div>
                <p className="journal-reflection-question">{r.question}</p>
                <span className="journal-reflection-context">{r.context}</span>
                <div className="journal-reflection-answer">
                  <textarea
                    className="form-textarea journal-reflection-textarea"
                    rows={2}
                    placeholder="Ta leçon, en une phrase ou deux… (sera enregistrée comme donnée)"
                    value={answerDrafts[r.dedupeKey] ?? ''}
                    onChange={(e) => setAnswerDrafts((d) => ({ ...d, [r.dedupeKey]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleAnswerReflection(r)}
                    disabled={!(answerDrafts[r.dedupeKey] ?? '').trim()}
                  >
                    Enregistrer la leçon
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Synthèse périodique — le journal se résume tout seul (v0.6.2) */}
      {digest && digest.totalEntries > 0 && (
        <div className="journal-digest">
          <div className="journal-digest-header">
            <h3>📊 Synthèse {digestPeriod === 'week' ? 'hebdomadaire' : 'mensuelle'}</h3>
            <div className="journal-digest-period">
              <button className={`btn btn-sm ${digestPeriod === 'week' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDigestPeriod('week')}>7 jours</button>
              <button className={`btn btn-sm ${digestPeriod === 'month' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDigestPeriod('month')}>30 jours</button>
            </div>
          </div>
          <p className="journal-digest-summary">{digestSummary(digest)}</p>
          {digest.topWords.length > 0 && (
            <p className="journal-digest-words">
              Thèmes récurrents : {digest.topWords.map((w) => `« ${w.word} » ×${w.count}`).join(', ')}
            </p>
          )}
          <button
            className="btn btn-sm btn-primary journal-digest-ai"
            onClick={handleSynthesize}
            disabled={synthesizing}
          >
            {synthesizing ? 'Synthèse en cours…' : `✨ Synthèse IA de la ${digestPeriod === 'week' ? 'semaine' : 'mois'}`}
          </button>
          {synthesis && (
            <div className="journal-digest-output">
              {synthesis.split('\n').map((line, i) => (
                <p key={i}>{line || '\u00A0'}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fils de discussion — questions persistées qui ouvrent une conversation */}
      {threads.length > 0 && (
        <div className="journal-threads">
          <h3>💬 Fils de discussion</h3>
          <p className="journal-threads-hint">
            Chaque question cliquée ouvre un fil enregistré : tes réponses successives y restent
            rangées, même des jours plus tard.
          </p>
          {activeThreadId && (
            <span className="journal-thread-active">
              Fil actif : continuez à écrire — la prochaine réflexion y sera rattachée.
            </span>
          )}
          <ul className="journal-thread-list">
            {threads.map((thread) => {
              const count = threadCount(thread.id);
              return (
                <li key={thread.id} className={`journal-thread ${activeThreadId === thread.id ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="journal-thread-open"
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      setDraft(thread.question);
                    }}
                  >
                    <span className="journal-thread-emoji">{thread.emoji ?? '💬'}</span>
                    <span className="journal-thread-question">{thread.question}</span>
                    <span className="journal-thread-count">{count} réponse{count > 1 ? 's' : ''}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost journal-thread-delete"
                    title="Supprimer ce fil (les entrées restent dans l'historique)"
                    onClick={() => deleteJournalThread(thread.id)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* History */}
      {entries.length > 0 && (
        <div className="journal-history">
          <div className="journal-history-header">
            <h3>Past reflections</h3>
            <input
              className="form-input journal-search"
              type="search"
              placeholder="🔍 Rechercher (contenu, réponse, personne)…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          {filteredEntries.length === 0 && <p className="empty-hint">Aucune entrée ne correspond à cette recherche.</p>}
          {filteredEntries.map(entry => {
            const persona = PERSONALITIES.find(p => p.id === entry.personality);
            const entryActions = showActions === entry.id
              ? (() => { try { return suggestJournalActions(entry, allHabits, projects, protocols, entry); } catch { return []; } })()
              : [];
            return (
              <div key={entry.id} className="journal-entry">
                <div className="journal-entry-meta">
                  <span className="journal-entry-persona">{persona?.emoji} {persona?.name}</span>
                  <span className="journal-entry-date">{formatDate(entry.createdAt)}</span>
                  <button
                    className="btn btn-sm btn-ghost journal-delete"
                    onClick={() => deleteJournalEntry(entry.id)}
                  >
                    ✕
                  </button>
                </div>
                <p className="journal-entry-content">
                  {searchText.trim()
                    ? highlightQuery(entry.content, searchText).split('**').map((part, i) =>
                        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
                      )
                    : entry.content}
                </p>
                <div className="journal-entry-response">
                  {entry.response.split('\n').map((line, i) => (
                    <p key={i}>{line || '\u00A0'}</p>
                  ))}
                </div>
                {(entry.projectIds?.length || entry.protocolIds?.length || entry.habitIds?.length) && (
                  <div className="journal-entry-links">
                    {entry.projectIds?.map((id) => (
                      <span key={`p-${id}`} className="journal-link journal-link-project">🗂️ {projectLabel(id)}</span>
                    ))}
                    {entry.protocolIds?.map((id) => (
                      <span key={`pr-${id}`} className="journal-link journal-link-protocol">📚 {protocolLabel(id)}</span>
                    ))}
                    {entry.habitIds?.map((id) => (
                      <span key={`h-${id}`} className="journal-link journal-link-habit">🎯 {habitLabel(id)}</span>
                    ))}
                  </div>
                )}
                <div className="journal-entry-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setShowActions(showActions === entry.id ? null : entry.id)}
                  >
                    ⚡ Actions
                  </button>
                </div>
                {entryActions.length > 0 && (
                  <div className="journal-entry-actions-panel">
                    {entryActions.map((a, i) => (
                      <button
                        key={`${a.type}-${i}`}
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleAction(entry, a)}
                      >
                        {a.emoji} {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {entries.length === 0 && (
        <p className="empty-hint">
          No reflections yet. Write a few lines and pick a persona to hear back from — each one sees something different.
        </p>
      )}
    </div>
  );
}
