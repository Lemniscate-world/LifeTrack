// src/JournalView.tsx
// Private AI journal: write freely, one of four personas reflects back.
// Personas: Coach (action), Sage (perspective), Psychologist (emotion),
// Strategist (planning). Uses the configured AI provider (cloud/local/auto).

import { useState, useEffect, useMemo } from 'react';
import { getJournalEntries, addJournalEntry, deleteJournalEntry, getJournalThreads, startJournalThread, deleteJournalThread, tagJournalEntryThread, exportAllData, getPreferences, subscribe, getPatternTracks, replacePatternTracks, getReflections, addReflection, answerReflection } from './store';
import { buildAiContext } from './aiContext';
import { buildJournalPrompts, type JournalPrompt } from './journalPrompts';
import { detectNegativePatterns, allPatternsById } from './psychoanalysis';
import { advanceTracks, questionForStep, STEPS, MAX_STEP } from './patternProgress';
import { detectReflections, filterNewReflections, reflectionEmoji, type DetectedReflection } from './reflection';
import type { JournalPersonality } from './types';

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
      const entry = addJournalEntry(content, personality, response);
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
          <h3>Past reflections</h3>
          {entries.map(entry => {
            const persona = PERSONALITIES.find(p => p.id === entry.personality);
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
                <p className="journal-entry-content">{entry.content}</p>
                <div className="journal-entry-response">
                  {entry.response.split('\n').map((line, i) => (
                    <p key={i}>{line || '\u00A0'}</p>
                  ))}
                </div>
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
