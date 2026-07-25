// src/ExperimentsView.tsx
// N=1 Experiments: hypothesis-driven self-experimentation framework

import { useState, useEffect } from 'react';
import { getExperiments, addExperiment, completeExperiment, deleteExperiment, getHabits, subscribe } from './store';

export default function ExperimentsView() {
  const [, setTick] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
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

  return (
    <div className="experiments-view">
      <div className="experiments-header">
        <h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:6}}>
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          N=1 Experiments
        </h2>
        <button className="btn btn-sm btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Experiment'}
        </button>
      </div>

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
          <h3>Active</h3>
          {activeExps.map(exp => (
            <div key={exp.id} className="experiment-card active">
              <div className="experiment-card-header">
                <span className="experiment-title">{exp.title}</span>
                <span className="experiment-dates">{exp.startDate} {exp.endDate ? `→ ${exp.endDate}` : '→ ongoing'}</span>
              </div>
              <p className="experiment-hypothesis">"{exp.hypothesis}"</p>
              <div className="experiment-meta">
                {exp.linkedHabits.length > 0 && <span>Habits: {exp.linkedHabits.map(getHabitName).join(', ')}</span>}
                {exp.linkedMetrics.includes('mood') && <span> · Mood tracked</span>}
              </div>
              <div className="experiment-actions">
                <button className="btn btn-sm btn-ghost" onClick={() => { setCompleteId(exp.id); setConclusion(''); }}>Complete</button>
                <button className="btn btn-sm btn-ghost" onClick={() => deleteExperiment(exp.id)} style={{color:'var(--text-muted)'}}>Cancel</button>
              </div>
              {completeId === exp.id && (
                <div className="experiment-conclusion">
                  <textarea className="form-textarea" placeholder="What did you learn? What was the result?" value={conclusion} onChange={e => setConclusion(e.target.value)} rows={3} />
                  <button className="btn btn-sm btn-primary" onClick={handleComplete}>Save Conclusion</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Past experiments */}
      {pastExps.length > 0 && (
        <div className="experiments-section">
          <h3>Completed</h3>
          {pastExps.map(exp => (
            <div key={exp.id} className={`experiment-card ${exp.status}`}>
              <div className="experiment-card-header">
                <span className="experiment-title">{exp.title}</span>
                <span className="experiment-status">{exp.status === 'completed' ? '✅' : '❌'}</span>
              </div>
              <p className="experiment-hypothesis">"{exp.hypothesis}"</p>
              {exp.conclusion && <p className="experiment-conclusion-text">📋 {exp.conclusion}</p>}
              <button className="btn btn-sm btn-ghost" onClick={() => deleteExperiment(exp.id)} style={{color:'var(--text-muted)',fontSize:11}}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {experiments.length === 0 && !showForm && (
        <p className="empty-hint">No experiments yet. Start your first N=1 experiment to test a hypothesis about your habits.</p>
      )}
    </div>
  );
}
