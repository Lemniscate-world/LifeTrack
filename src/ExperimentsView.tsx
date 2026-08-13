// src/ExperimentsView.tsx
// N=1 Experiments: hypothesis-driven self-experimentation framework

import { useState, useEffect } from 'react';
import { getExperiments, addExperiment, completeExperiment, deleteExperiment, getHabits, subscribe } from './store';
import { toDateKey } from './stats';

export default function ExperimentsView() {
  const [, setTick] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [startDate, setStartDate] = useState(() => toDateKey(new Date()));
  const [endDate, setEndDate] = useState('');
  const [linkedHabits, setLinkedHabits] = useState<string[]>([]);
  const [linkedMetrics, setLinkedMetrics] = useState<string[]>(['mood']);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [conclusion, setConclusion] = useState('');

  useEffect(() => {
    const unsub = subscribe(() => setTick(t => t + 1));
    return unsub;
  }, []);

  const experiments = getExperiments();
  const habits = getHabits().filter(h => !h.archived);

  const activeExps = experiments.filter(e => e.status === 'active');
  const pastExps = experiments.filter(e => e.status !== 'active');

  const handleCreate = () => {
    if (!title.trim() || !hypothesis.trim()) return;
    addExperiment({
      title: title.trim(),
      hypothesis: hypothesis.trim(),
      startDate,
      endDate: endDate || '',
      linkedHabits,
      linkedMetrics,
    });
    setShowForm(false);
    setTitle('');
    setHypothesis('');
    setEndDate('');
    setLinkedHabits([]);
    setLinkedMetrics(['mood']);
  };

  const handleComplete = () => {
    if (!completeId || !conclusion.trim()) return;
    completeExperiment(completeId, conclusion.trim());
    setCompleteId(null);
    setConclusion('');
  };

  const getHabitName = (id: string) => habits.find(h => h.id === id)?.name ?? id;

  // Preset templates
  const PRESET_EXPERIMENTS = [
    {
      title: 'Exposition à la lumière matinale (10 min)',
      hypothesis: 'Si je m’expose à la lumière extérieure dès le réveil, ma vigilance et la qualité de mon sommeil s’amélioreront.',
      linkedMetrics: ['mood']
    },
    {
      title: 'Repos profond NSDR (20 min après-midi)',
      hypothesis: 'Si je fais 20min de NSDR au creux de l’après-midi, mon niveau de fatigue baissera et ma capacité de concentration s’élèvera.',
      linkedMetrics: ['mood']
    },
    {
      title: 'Arrêt caféine après 14h00',
      hypothesis: 'Si je stoppe toute caféine 8h avant le coucher, mon sommeil sera plus réparateur et mon énergie matinale plus élevée.',
      linkedMetrics: ['mood']
    },
    {
      title: 'Cardio Zone 2 (45 min 3x/semaine)',
      hypothesis: 'Si je pratique du cardio en Zone 2 régulièrement, mon énergie de base augmentera et mon stress diminuera.',
      linkedMetrics: ['mood']
    }
  ];

  const handleApplyPreset = (preset: typeof PRESET_EXPERIMENTS[0]) => {
    setTitle(preset.title);
    setHypothesis(preset.hypothesis);
    setLinkedMetrics(preset.linkedMetrics);
    setShowForm(true);
  };

  return (
    <div className="experiments-view">
      <div className="experiments-header">
        <h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:6}}>
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          Expériences N=1 (Auto-Expérimentation)
        </h2>
        <button className="btn btn-sm btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Annuler' : '+ Nouvelle Expérience'}
        </button>
      </div>

      {/* Preset bar */}
      {!showForm && (
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
          {PRESET_EXPERIMENTS.map((preset, idx) => (
            <button
              key={idx}
              className="btn btn-sm btn-ghost"
              onClick={() => handleApplyPreset(preset)}
              style={{ whiteSpace: 'nowrap', background: 'var(--bg-card, #1e293b)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
            >
              ⚡ {preset.title}
            </button>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="experiment-form">
          <input className="form-input" placeholder="Title (e.g. Morning meditation & focus)" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea className="form-textarea" placeholder="Hypothesis: If I [action], then [outcome] will [change] because [reason]." value={hypothesis} onChange={e => setHypothesis(e.target.value)} rows={3} />
          <div className="form-row">
            <label>Start: <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
            <label>End (optional): <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
          </div>
          <div className="form-row">
            <label>Linked habits:</label>
            <div className="habit-chips">
              {habits.map(h => (
                <label key={h.id} className={`chip ${linkedHabits.includes(h.id) ? 'active' : ''}`}>
                  <input type="checkbox" checked={linkedHabits.includes(h.id)} onChange={() => setLinkedHabits(prev => prev.includes(h.id) ? prev.filter(x => x !== h.id) : [...prev, h.id])} />
                  {h.name}
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>Track mood: <input type="checkbox" checked={linkedMetrics.includes('mood')} onChange={() => setLinkedMetrics(prev => prev.includes('mood') ? prev.filter(x => x !== 'mood') : [...prev, 'mood'])} /></label>
          </div>
          <button className="btn btn-sm btn-primary" onClick={handleCreate}>Start Experiment</button>
        </div>
      )}

      {/* Active experiments */}
      {activeExps.length > 0 && (
        <div className="experiments-section">
          <h3>Actives</h3>
          {activeExps.map(exp => (
            <div key={exp.id} className="experiment-card active">
              <div className="experiment-card-header">
                <span className="experiment-title">{exp.title}</span>
                <span className="experiment-dates">{exp.startDate} {exp.endDate ? `→ ${exp.endDate}` : '→ en cours'}</span>
              </div>
              <p className="experiment-hypothesis">"{exp.hypothesis}"</p>
              <div className="experiment-meta">
                {exp.linkedHabits.length > 0 && <span>Habitudes : {exp.linkedHabits.map(getHabitName).join(', ')}</span>}
                {exp.linkedMetrics.includes('mood') && <span> · Suivi humeur actif</span>}
              </div>
              <div className="experiment-actions">
                <button className="btn btn-sm btn-ghost" onClick={() => { setCompleteId(exp.id); setConclusion(''); }}>Terminer</button>
                <button className="btn btn-sm btn-ghost" onClick={() => deleteExperiment(exp.id)} style={{color:'var(--text-muted)'}}>Annuler</button>
              </div>
              {completeId === exp.id && (
                <div className="experiment-conclusion">
                  <textarea className="form-textarea" placeholder="Qu'avez-vous appris ? Quel est le résultat observé ?" value={conclusion} onChange={e => setConclusion(e.target.value)} rows={3} />
                  <button className="btn btn-sm btn-primary" onClick={handleComplete}>Enregistrer la Conclusion</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Past experiments */}
      {pastExps.length > 0 && (
        <div className="experiments-section">
          <h3>Terminées</h3>
          {pastExps.map(exp => (
            <div key={exp.id} className={`experiment-card ${exp.status}`}>
              <div className="experiment-card-header">
                <span className="experiment-title">{exp.title}</span>
                <span className="experiment-status">{exp.status === 'completed' ? '✅' : '❌'}</span>
              </div>
              <p className="experiment-hypothesis">"{exp.hypothesis}"</p>
              {exp.conclusion && <p className="experiment-conclusion-text">📋 {exp.conclusion}</p>}
              <button className="btn btn-sm btn-ghost" onClick={() => deleteExperiment(exp.id)} style={{color:'var(--text-muted)',fontSize:11}}>Supprimer</button>
            </div>
          ))}
        </div>
      )}

      {experiments.length === 0 && !showForm && (
        <p className="empty-hint">Aucune expérience enregistrée. Lancez votre première expérience N=1 pour tester vos hypothèses.</p>
      )}
    </div>
  );
}

