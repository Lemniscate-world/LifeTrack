// src/JournalView.tsx
// Private AI journal: write freely, one of four personas reflects back.
// Personas: Coach (action), Sage (perspective), Psychologist (emotion),
// Strategist (planning). Uses the configured AI provider (cloud/local/auto).

import { useState, useEffect, useMemo } from 'react';
import { getJournalEntries, addJournalEntry, deleteJournalEntry, exportAllData, getPreferences, subscribe } from './store';
import { buildAiContext } from './aiContext';
import { buildJournalPrompts, type JournalPrompt } from './journalPrompts';
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
  const [, setTick] = useState(0);
  const [personality, setPersonality] = useState<JournalPersonality>('coach');
  const [draft, setDraft] = useState('');
  const [reflecting, setReflecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptRandom, setPromptRandom] = useState(0);
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

  const applyPrompt = (p: JournalPrompt) => setDraft(p.text);

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
      addJournalEntry(content, personality, response);
      setDraft('');
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
