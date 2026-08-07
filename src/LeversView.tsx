// src/LeversView.tsx
// "What works for me" — document the interventions you noticed actually help,
// then turn them into tracked habits. Also surfaces auto-detected levers
// (behaviours linked to a significantly better mood via a Welch test).
// Self-contained: subscribes to the store, owns its own draft state.

import { useState, useEffect, useMemo } from 'react';
import type { FormEvent } from 'react';
import {
  getLevers,
  addLever,
  deleteLever,
  getHabits,
  addHabit,
  updateHabit,
  exportAllData,
  subscribe,
} from './store';
import { suggestLevers } from './leverInsights';
import type { Habit, CheckIn, Lever } from './types';

export default function LeversView() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const levers: Lever[] = useMemo(() => {
    try { return getLevers(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTick]);

  const suggestedLevers = useMemo(() => {
    try {
      const d = exportAllData();
      const h = (d.habits ?? []) as Habit[];
      const c = (d.checkIns ?? []) as CheckIn[];
      const m = (d.moods ?? {}) as Record<string, string>;
      return suggestLevers(h, c, m);
    } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTick]);
  const [dismissedSuggestions, setDismissed] = useState<string[]>([]);
  const acceptLeverSuggestion = (name: string, habitId: string, delta: number, p: number) => {
    try {
      addLever(name, `Humeur · +${delta.toFixed(1)} pts · p=${p.toFixed(3)}`);
      setDismissed((prev) => [...prev, habitId]);
    } catch { /* ignore */ }
  };

  const [leverContent, setLeverContent] = useState('');
  const [leverEffect, setLeverEffect] = useState('');
  const [leverNotes, setLeverNotes] = useState('');
  const [leverAddedId, setLeverAddedId] = useState<string | null>(null);

  const handleAddLever = (e: FormEvent) => {
    e.preventDefault();
    const content = leverContent.trim();
    if (!content) return;
    try {
      const created = addLever(content, leverEffect.trim() || undefined, leverNotes.trim() || undefined);
      setLeverAddedId(created.id);
      setLeverContent('');
      setLeverEffect('');
      setLeverNotes('');
      setTimeout(() => setLeverAddedId((cur) => (cur === created.id ? null : cur)), 2000);
    } catch { /* ignore */ }
  };

  const handleConvertLever = (lever: Lever) => {
    const why: string[] = [];
    if (lever.content) why.push(`Le facteur : ${lever.content}`);
    if (lever.effect) why.push(`Effet attendu : ${lever.effect}`);
    const name = lever.content.length > 40 ? `${lever.content.slice(0, 40)}…` : lever.content;
    try {
      addHabit(name);
      if (why.length > 0) {
        const created = getHabits().find((h) => h.name === name);
        if (created) updateHabit(created.id, { why });
      }
      deleteLever(lever.id);
    } catch { /* ignore */ }
  };

  return (
    <div className="lever-section">
      <div className="lever-header">
        <h3>⚙️ Ce qui fonctionne pour moi</h3>
        <span className="lever-subtitle">
          Notez les interventions dont vous avez remarqué qu'elles aident réellement — puis transformez-les en habitudes.
        </span>
      </div>

      <form className="lever-form" onSubmit={handleAddLever}>
        <input
          className="lever-input"
          value={leverContent}
          onChange={(e) => setLeverContent(e.target.value)}
          placeholder="Le facteur qui a marché (ex : Magnésium B2 le matin)"
          required
        />
        <input
          className="lever-input lever-input-sm"
          value={leverEffect}
          onChange={(e) => setLeverEffect(e.target.value)}
          placeholder="Effet observé (ex : +15 d'énergie)"
        />
        <input
          className="lever-input lever-input-sm"
          value={leverNotes}
          onChange={(e) => setLeverNotes(e.target.value)}
          placeholder="Notes / contexte"
        />
        <button className="btn btn-primary" type="submit">Ajouter</button>
      </form>

      {levers.length === 0 ? (
        <p className="lever-none">
          Aucun levier enregistré. Dès que vous remarquez quelque chose qui marche — un supplément, une
          routine, un changement de mentalité — notez-le ici pour ne pas l'oublier.
        </p>
      ) : (
        <div className="lever-list">
          {levers.map((lever) => (
            <div className="lever-card" key={lever.id}>
              <div className="lever-card-main">
                <span className="lever-content">{lever.content}</span>
                {lever.effect && <span className="lever-effect">→ {lever.effect}</span>}
                {lever.notes && <span className="lever-notes">{lever.notes}</span>}
                <span className="lever-date">{new Date(lever.createdAt).toLocaleDateString()}</span>
                {leverAddedId === lever.id && <span className="lever-saved">✓ Ajouté</span>}
              </div>
              <div className="lever-actions">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleConvertLever(lever)}
                  title="Transforme ce levier en habitude suivie"
                >
                  ➕ Habitude
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => deleteLever(lever.id)}
                  title="Supprimer"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {suggestedLevers.filter((s) => !dismissedSuggestions.includes(s.habitId)).length > 0 && (
        <div className="lever-suggestions">
          <h4>🔎 Leviers détectés dans tes données</h4>
          <p className="lever-suggestions-hint">
            Des habitudes associées à une humeur nettement meilleure (test de Welch sur les jours
            réalisés vs non réalisés). Clique pour les transformer en leviers documentés.
          </p>
          <div className="lever-suggestions-list">
            {suggestedLevers
              .filter((s) => !dismissedSuggestions.includes(s.habitId))
              .map((s) => (
                <div className="lever-suggestion-card" key={s.habitId}>
                  <span className="lever-suggestion-name">{s.emoji ? `${s.emoji} ` : ''}{s.name}</span>
                  <span className="lever-suggestion-metric">
                    humeur {s.meanWith.toFixed(1)} <span className="trend-p">vs</span> {s.meanWithout.toFixed(1)}
                    <span className="trend-p"> · p={s.p.toFixed(3)} · d={s.d !== null ? s.d.toFixed(2) : '—'}</span>
                  </span>
                  <div className="lever-suggestion-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => acceptLeverSuggestion(s.name, s.habitId, s.delta, s.p)}
                    >
                      ✓ Accepter
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setDismissed((prev) => [...prev, s.habitId])}
                      title="Ignorer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}