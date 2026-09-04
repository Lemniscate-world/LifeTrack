import { useState, useMemo, useEffect } from 'react';
import type { CSSProperties } from 'react';
import {
  getChaosDimensions,
  getHabits,
  getReflections,
  getRoutinesForTrigger,
  subscribe,
} from './store';
import { getHabitChaosLinks } from './store';
import { getDimensionAccent } from './chaosDimensions';
import PrincipleTriggersPanel from './components/PrincipleTriggersPanel';

export default function PrinciplesView() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const dimensions = useMemo(() => getChaosDimensions(), [tick]);
  const habits = useMemo(() => getHabits(), [tick]);
  const reflections = useMemo(() => getReflections(), [tick]);

  return (
    <div className="principles-view">
      <div className="principles-header">
        <h2>Principes</h2>
        <p className="principles-subtitle">
          Règles que tu ne veux plus violer. Chaque principe vit dans une dimension Chaos,
          se coche quotidiennement, et peut déclencher une routine fixe que tu composes toi-même.
        </p>
      </div>

      {dimensions.map((dim) => {
        const triggers = dim.triggers ?? [];
        const habitIdsInDim = new Set(
          habits.filter((h) => getHabitChaosLinks(h).some((l) => l.dimension === dim.id)).map((h) => h.id),
        );
        const linkedReflections = reflections
          .filter((r) => (r.habitIds ?? []).some((id) => habitIdsInDim.has(id)))
          .slice(0, 3);
        const accent = getDimensionAccent(dim.id);
        // Surface summary (Quiet Precision): one scannable line, primary info first.
        const activeCount = triggers.filter((t) => t.active).length;
        const routineCount = triggers.reduce((sum, t) => sum + getRoutinesForTrigger(t.id).length, 0);

        return (
          <section key={dim.id} className="principles-dim" style={{ '--dim-accent': accent } as CSSProperties}>
            <header className="principles-dim-head">
              <h3>
                <span className="principles-dim-dot" aria-hidden="true" />
                {dim.name}
              </h3>
              <span className="principles-dim-count">
                {triggers.length} principe{triggers.length !== 1 ? 's' : ''}
              </span>
            </header>

            {triggers.length > 0 && (
              <p className="principles-dim-summary">
                <strong>{activeCount}</strong> actif{activeCount !== 1 ? 's' : ''} sur {triggers.length}
                {routineCount > 0 && <> · {routineCount} routine{routineCount !== 1 ? 's' : ''} fixe{routineCount !== 1 ? 's' : ''}</>}
              </p>
            )}

            <PrincipleTriggersPanel
              dimensionId={dim.id}
              triggers={triggers}
              habits={habits}
              accent={accent}
              variant="full"
            />

            {linkedReflections.length > 0 && (
              <div className="principles-reflections">
                <span className="principles-reflections-title">Réflexions structurées liées</span>
                {linkedReflections.map((r) => (
                  <div key={r.id} className={`principles-reflection ${r.status}`}>
                    <span className="principles-reflection-question">{r.question}</span>
                    {r.answer && <span className="principles-reflection-answer">→ {r.answer.slice(0, 120)}</span>}
                    <span className={`principles-reflection-badge ${r.status}`}>
                      {r.status === 'answered' ? 'répondue' : 'ouverte'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
