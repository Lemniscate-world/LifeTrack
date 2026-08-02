// src/AchievementsView.tsx
// Achievements: notes tagged with a category, displayed as a timeline grouped
// by category (Psychological, Energy, Physical, etc.).

import { useState, useEffect } from 'react';
import { getAchievementCategories, getAchievements, tagNoteAchievement, exportAllData, getPreferences, subscribe } from './store';
import { buildAiContext } from './aiContext';
import type { Note } from './types';

export default function AchievementsView() {
  const [, setTick] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const categories = getAchievementCategories();
  const achievements = getAchievements();

  const byCategory = new Map<string, Note[]>();
  for (const note of achievements) {
    const key = note.achievementCategory ?? 'other';
    const list = byCategory.get(key);
    if (list) list.push(note);
    else byCategory.set(key, [note]);
  }

  const totalCount = achievements.length;

  const handleSummarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    setAiError(null);
    setAiSummary(null);
    try {
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setAiError('AI summary requires the desktop app (AI provider).');
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const context = buildAiContext(exportAllData());
      const response = await invoke<string>('summarize_achievements', {
        summaryJson: context,
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
      });
      setAiSummary(response);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Something went wrong while summarizing.');
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="achievements-view">
      <div className="achievements-header">
        <h2>🏆 Achievements</h2>
        <p className="achievements-subtitle">
          {totalCount === 0
            ? 'No achievements yet — tag a note as an achievement when you write it'
            : `${totalCount} achievement${totalCount > 1 ? 's' : ''} across ${byCategory.size} categor${byCategory.size > 1 ? 'ies' : 'y'}`}
        </p>
      </div>

      {totalCount > 0 && (
        <div className="achievements-ai">
          {!aiSummary && !aiError && (
            <button
              className="btn btn-primary"
              onClick={handleSummarize}
              disabled={summarizing}
            >
              {summarizing ? '✨ Writing summary…' : '✨ AI summary of your progress'}
            </button>
          )}
          {aiError && <p className="achievements-ai-error">{aiError}</p>}
          {aiSummary && (
            <div className="achievements-ai-card">
              <div className="achievements-ai-label">✨ Your progress, in one paragraph</div>
              <p className="achievements-ai-text">{aiSummary}</p>
              <button className="btn btn-sm btn-ghost" onClick={() => setAiSummary(null)}>Hide</button>
            </div>
          )}
        </div>
      )}

      {totalCount === 0 && (
        <p className="achievements-hint">
          Open the <strong>Notes</strong> panel in the Grid view, write about something you
          accomplished (a psychological win, an energy milestone, …) and pick a category before
          saving. It will appear here on your timeline.
        </p>
      )}

      <div className="achievements-grid">
        {categories.map((cat) => {
          const list = byCategory.get(cat.id) ?? [];
          return (
            <div key={cat.id} className={`achievement-card ${list.length === 0 ? 'empty' : ''}`}>
              <div className="achievement-card-header">
                <span className="achievement-cat-emoji" style={{ background: cat.color }}>{cat.emoji}</span>
                <span className="achievement-cat-name">{cat.name}</span>
                <span className="achievement-count">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <span className="achievement-empty-cat">No achievements yet</span>
              ) : (
                <ul className="achievement-timeline">
                  {list.map((note) => (
                    <li key={note.id} className="achievement-item">
                      <span className="achievement-item-date">
                        {new Date(note.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="achievement-item-text">{note.content}</span>
                      <button
                        className="achievement-item-untag"
                        onClick={() => tagNoteAchievement(note.id, null)}
                        title="Remove achievement tag"
                        aria-label="Remove achievement tag"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {totalCount > 0 && (
        <p className="achievements-footer">
          Achievements are notes you tagged with a category. Remove a tag with the ✕ button to unmark it.
        </p>
      )}
    </div>
  );
}
