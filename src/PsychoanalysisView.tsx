// src/PsychoanalysisView.tsx
// Dedicated, deeper psychoanalysis view (v0.5.2):
//  - dominant negative patterns detected locally from the user's own writing,
//  - pattern ↔ mood impact (do patterns co-occur with lower mood?),
//  - weekly evolution of those patterns,
//  - automatic (deterministic) prompting + an AI chat to dismantle each pattern.
// All statistics are local and grounded; the AI only answers the open questions.

import { useState, useEffect, useCallback } from 'react';
import {
  detectNegativePatterns,
  detectAllFrames,
  patternTrend,
  patternMoodImpact,
  suggestedQuestions,
  type SuggestedQuestion,
  type PatternGroup,
} from './psychoanalysis';
import { exportAllData, getPreferences, subscribe } from './store';
import { buildAiContext } from './aiContext';
import type { AiChatMessage } from './aiAnalysis';

const AI_FRAMES: { id: string; emoji: string; name: string }[] = [
  { id: 'cognitive', emoji: '🧠', name: 'Cognitif (Beck)' },
  { id: 'lac', emoji: '🎭', name: 'Freud–Lacan' },
  { id: 'jungian', emoji: '🌑', name: 'Jung' },
  { id: 'act', emoji: '🌀', name: 'ACT' },
  { id: 'schema', emoji: '🏷️', name: 'Schémas (Young)' },
  { id: 'attachment', emoji: '🫶', name: 'Attachement' },
  { id: 'ta', emoji: '🫨', name: 'Analyse transactionnelle' },
];

const FRAME_META: Record<PatternGroup['source'], { emoji: string; label: string }> = {
  cognitive: { emoji: '🧠', label: 'Distorsions cognitives' },
  psychanalytic: { emoji: '🎭', label: 'Défenses (Freud–Lacan)' },
  jungian: { emoji: '🌑', label: 'Jung · ombre & complexes' },
  act: { emoji: '🌀', label: 'ACT · 3e vague' },
  schema: { emoji: '🎫', label: 'Thérapie des schémas (Young)' },
  attachment: { emoji: '🫶', label: 'Théorie de l\'attachement' },
  ta: { emoji: '📠', label: 'Analyse transactionnelle (Berne)' },
};

export default function PsychoanalysisView() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const { checkIns, notes, urges, moods } = (() => {
    try {
      const d = exportAllData();
      return { checkIns: d.checkIns ?? [], notes: d.notes ?? [], urges: d.urges ?? [], moods: d.moods ?? {} };
    } catch { return { checkIns: [], notes: [], urges: [], moods: {} }; }
  })();

  const patternHits = detectNegativePatterns(checkIns, notes, urges);
  const frameGroups = detectAllFrames(checkIns, notes, urges);
  const trend = patternTrend(checkIns, notes, urges);
  const impacts = patternMoodImpact(checkIns, notes, urges, moods);
  const questions = suggestedQuestions(checkIns, notes, urges);

  // --- AI chat state ---
  const [frame, setFrame] = useState('cognitive');
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const ask = useCallback(async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || loading) return;
    setHistory((h) => [...h, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (!isTauriEnv) {
        setHistory((h) => [...h, { role: 'coach', content: 'Le chat psycho requiert l\'app de bureau (fournisseur IA).' }]);
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const prefs = getPreferences();
      const summary = buildAiContext(exportAllData());
      const answer = await invoke<string>('psychoanalysis_ask', {
        question,
        summaryJson: summary,
        model: prefs.aiModel || null,
        provider: prefs.aiProvider || 'auto',
        apiKey: prefs.aiApiKey || '',
        frame,
      });
      setHistory((h) => [...h, { role: 'coach', content: answer }]);
    } catch (e) {
      setHistory((h) => [...h, { role: 'coach', content: e instanceof Error ? `⚠️ ${e.message}` : '⚠️ Une erreur est survenue.' }]);
    } finally {
      setLoading(false);
    }
  }, [loading, frame]);

  const askSuggestion = (q: SuggestedQuestion) => {
    if (loading) return;
    ask(q.question);
  };

  return (
    <div className="psycho-section">
      <div className="psycho-header">
        <h3>🧠 Psychoanalysis</h3>
        <span className="psycho-subtitle">
          Schémas négatifs repérés dans vos propres écrits — et une IA pour les dissoudre.
        </span>
      </div>

      {patternHits.length > 0 ? (
        <div className="psycho-patterns">
          {patternHits.map((hit) => (
            <div key={hit.pattern.id} className={`psycho-card psycho-${hit.pattern.id}`}>
              <div className="psycho-card-head">
                <span className="psycho-card-icon">{hit.pattern.emoji}</span>
                <div className="psycho-card-title">
                  {hit.pattern.name}
                  <span className="psycho-card-count">×{hit.count}</span>
                </div>
              </div>
              <p className="psycho-card-desc">{hit.pattern.description}</p>
              {hit.sample && (
                <p className="psycho-card-sample">“{hit.sample.slice(0, 120)}{hit.sample.length > 120 ? '…' : ''}”</p>
              )}
              <p className="psycho-card-counter">💥 {hit.pattern.counter}</p>
              <span className="psycho-card-source">{hit.pattern.source}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="psycho-none">
          Aucun schéma négatif repéré pour l’instant. En écrivant, LifeTrack repère les
          distorsions cognitives et les signaux d’auto-sabotage — tout reste sur l’appareil.
        </p>
      )}

      {frameGroups.length > 0 && (
        <div className="psycho-frames">
          <h3>🎭 Mécanismes par cadre théorique</h3>
          <span className="trends-sub">
            Les mêmes écrits vus à travers plusieurs écoles (Beck, défenses Freud–Lacan, Jung, ACT, schémas de Young,
            attachement, analyse transactionnelle) — chacune nomme et désamorce différemment vos habitudes de pensée.
          </span>
          {frameGroups.map((group) => {
            const meta = FRAME_META[group.source];
            return (
              <div className="psycho-frame" key={group.source}>
                <h4>{meta.emoji} {meta.label}</h4>
                <div className="psycho-patterns">
                  {group.hits.map((hit) => (
                    <div key={hit.pattern.id} className={`psycho-card psycho-${hit.pattern.id}`}>
                      <div className="psycho-card-head">
                        <span className="psycho-card-icon">{hit.pattern.emoji}</span>
                        <div className="psycho-card-title">
                          {hit.pattern.name}
                          <span className="psycho-card-count">×{hit.count}</span>
                        </div>
                      </div>
                      <p className="psycho-card-desc">{hit.pattern.description}</p>
                      {hit.sample && (
                        <p className="psycho-card-sample">“{hit.sample.slice(0, 140)}{hit.sample.length > 140 ? '…' : ''}”</p>
                      )}
                      <p className="psycho-card-counter">💥 {hit.pattern.counter}</p>
                      <span className="psycho-card-source">{hit.pattern.source}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {impacts.length > 0 && (
        <div className="trends-section">
          <h3>🔬 Schémas ↔ humeur</h3>
          <span className="trends-sub">
            Humeur (classement) les jours où le schéma apparaît vs les jours sans — un delta négatif = humeur plus basse.
          </span>
          <div className="trends-list">
            {impacts.map((imp) => (
              <div key={imp.patternId} className="trend-row">
                <span className="trend-name">{imp.emoji} {imp.name}</span>
                <span className="trend-detail">
                  {imp.meanWith.toFixed(1)} <span className="trend-p">vs</span> {imp.meanWithout.toFixed(1)}
                  <span className="trend-p"> · p={imp.p.toFixed(3)}</span>
                </span>
                {imp.significant
                  ? <span className="trend-weekday">{imp.delta < 0 ? '▼ humeur basse' : '▲ humeur haute'}</span>
                  : <span className="trend-ns">(n.s.)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {trend.length >= 2 && (
        <div className="evo-section">
          <div className="evo-header">
            <h3>📉 Évolution des schémas</h3>
            <span className="evo-subtitle">
              Comptes hebdomadaires des schémas négatifs dans tes écrits — est-ce en baisse ?
            </span>
          </div>
          <div className="evo-bars">
            {trend.map((period, i) => {
              const maxTotal = Math.max(...trend.map((t) => t.total), 1);
              const hot = period.total > 0;
              const declining = i > 0 && period.total < trend[i - 1].total;
              return (
                <div className="evo-col" key={period.weekStart}>
                  <div className="evo-label">{period.label}</div>
                  <div className="evo-track">
                    <div
                      className={`evo-bar ${hot ? 'evo-bar-hot' : 'evo-bar-clear'} ${declining ? 'evo-bar-down' : ''}`}
                      style={{ height: `${Math.max(period.total === 0 ? 3 : 12, (period.total / maxTotal) * 100)}%` }}
                      title={`${period.total} schéma(s) cette semaine`}
                    />
                  </div>
                  <div className="evo-count">{period.total}</div>
                </div>
              );
            })}
          </div>
          <div className="evo-insight">
            {(() => {
              const first = trend[0].total;
              const last = trend[trend.length - 1].total;
              if (last < first) return '🎉 Tes schémas négatifs tendent à baisser — les atouts the counter-techniques fonctionnent.';
              if (last > first) return '⚠️ Tes schémas négatifs augmentent récemment. Demande à la psychoanalyse.';
              return '↔️ Tes schémas sont stables. Des contre-pas réguliers peuvent les faire descendre.';
            })()}
          </div>
        </div>
      )}

      <div className="psycho-questions">
        <h4>💡 Questions pour explorer</h4>
        {questions.length === 0 ? (
          <p className="psycho-none">Écris quelques notes pour que LifeTrack te propose des questions pertinentes.</p>
        ) : (
          <div className="psycho-question-list">
            {questions.map((q) => (
              <button
                key={q.id}
                type="button"
                className="psycho-question-chip"
                disabled={loading}
                onClick={() => askSuggestion(q)}
              >
                {q.patternId ? '🧠 ' : '✨ '}{q.question}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="psycho-lens">
        <h4>🔬 Cadre de l'assistant</h4>
        <div className="psycho-lens-list">
          {AI_FRAMES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`psycho-lens-chip ${frame === f.id ? 'psycho-lens-active' : ''}`}
              onClick={() => setFrame(f.id)}
            >
              {f.emoji} {f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="psycho-chat">
        <div className="psycho-chat-history">
          {history.length === 0 && (
            <div className="psycho-chat-empty">
              💬 Pose une question à l'assistant psycho sur une pensée ou une situation qui revient —
              « Pourquoi je sabote toujours mes projets ? ». Clique sur une question ci-dessus pour lancer.
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={`ai-chat-msg ai-chat-${m.role}`}>
              <span className="ai-chat-who">{m.role === 'user' ? 'Toi' : 'Psycho'}</span>
              <span className="ai-chat-content">{m.content}</span>
            </div>
          ))}
          {loading && (
            <div className="ai-chat-msg ai-chat-coach">
              <span className="ai-chat-who">Psycho</span>
              <span className="ai-chat-content ai-chat-thinking">réfléchit…</span>
            </div>
          )}
        </div>
        <form
          className="ai-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) ask(input);
          }}
        >
          <input
            className="ai-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pose une question sur un schéma négatif…"
            disabled={loading}
          />
          <button className="btn btn-sm btn-primary" type="submit" disabled={loading || !input.trim()}>
            {loading ? '…' : 'Envoyer'}
          </button>
        </form>
      </div>
    </div>
  );
}