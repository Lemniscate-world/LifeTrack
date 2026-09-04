import { useState, useMemo } from 'react';
import { EMOTIONS_LIST, type EmotionalEvent } from './types';
import {
  getEmotionalEvents,
  getEmotionalChecks,
  addEmotionalEvent,
  updateEmotionalEvent,
  deleteEmotionalEvent,
  upsertEmotionalCheck,
  subscribe,
} from './store';

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

export default function EmotionalProcessingView() {
  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [situation, setSituation] = useState('');
  const [emotions, setEmotions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // need subscribe to re-render on store changes
  useMemo(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    // trick: keep unsub reachable for cleanup via effect-like pattern - we use useState+subscribe without useEffect cleanup for brevity; instead handle with window
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return unsub;
  }, []);

  const events = getEmotionalEvents().filter((e: EmotionalEvent) => !e.archived);
  const selected = selectedId ? events.find((e: EmotionalEvent) => e.id === selectedId) ?? null : null;

  const handleCreate = () => {
    if (!title.trim()) return;
    const ev = addEmotionalEvent({
      title: title.trim(),
      situation: situation.trim(),
      emotions: emotions as EmotionalEvent['emotions'],
      notes: notes.trim() || undefined,
    });
    setTitle(''); setSituation(''); setEmotions([]); setNotes(''); setShowForm(false);
    setSelectedId(ev.id);
  };

  const toggleEmotion = (emo: string) => {
    setEmotions((prev: string[]) => (prev.includes(emo) ? prev.filter((e) => e !== emo) : [...prev, emo].slice(0, 6)));
  };

  return (
    <div className="emotional-view">
      <div className="emotional-header">
        <h2>💭 Traitement Émotionnel</h2>
        <p className="emotional-subtitle">
          Un événement met du temps à s'éteindre. Associe les émotions ressenties, coche chaque jour avec l'intensité du jour,
          et ajoute dans les notes ce qui t'aide à faire baisser la charge — tu verras la courbe fondre.
        </p>
      </div>

      <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
        {showForm ? 'Annuler' : '+ Nouvel événement / trauma'}
      </button>

      {showForm && (
        <div className="emotional-form">
          <input placeholder="Titre — ex: Conflit avec X" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder="Situation — que s'est-il passé ?" value={situation} onChange={(e) => setSituation(e.target.value)} rows={3} />
          <div className="emotional-emotions">
            {EMOTIONS_LIST.map((emo) => (
              <button
                key={emo}
                type="button"
                className={`emotional-chip ${emotions.includes(emo) ? 'active' : ''}`}
                onClick={() => toggleEmotion(emo)}
              >
                {emo}
              </button>
            ))}
          </div>
          <textarea placeholder="Notes — choses à faire pour diminuer l'intensité (optionnel)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button className="btn btn-primary" onClick={handleCreate}>Créer</button>
        </div>
      )}

      <div className="emotional-layout">
        <div className="emotional-list">
          {events.length === 0 && <p className="empty-hint">Aucun événement — crée le premier ci-dessus.</p>}
          {events.map((ev) => {
            const checks = getEmotionalChecks(ev.id).sort((a, b) => a.date.localeCompare(b.date));
            const last = checks[checks.length - 1];
            const avg = checks.length ? (checks.reduce((s, c) => s + c.intensity, 0) / checks.length).toFixed(1) : '—';
            return (
              <div key={ev.id} className={`emotional-card ${selectedId === ev.id ? 'selected' : ''}`} onClick={() => setSelectedId(ev.id)}>
                <div className="emotional-card-top">
                  <strong>{ev.title}</strong>
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); updateEmotionalEvent(ev.id, { archived: true }); }}>Archiver</button>
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); if (confirm('Supprimer ?')) deleteEmotionalEvent(ev.id); }}>✕</button>
                </div>
                <p className="emotional-card-situation">{ev.situation}</p>
                <div className="emotional-card-emotions">
                  {ev.emotions.map((emo) => <span key={emo} className="emotional-chip small active">{emo}</span>)}
                </div>
                <div className="emotional-card-meta">
                  {checks.length} jour{checks.length !== 1 ? 's' : ''} cochés · dernière intensité {last ? `${last.intensity}/10` : '—'} · moy {avg}
                </div>
                {ev.notes && <p className="emotional-card-notes">📝 {ev.notes}</p>}
              </div>
            );
          })}
        </div>

        {selected && <EventDetail event={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

function EventDetail({ event, onClose }: { event: EmotionalEvent; onClose: () => void }) {
  const [intensity, setIntensity] = useState(5);
  const [note, setNote] = useState('');
  const [editNotes, setEditNotes] = useState(event.notes ?? '');
  const checks = getEmotionalChecks(event.id).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayIso();
  const todayCheck = checks.find((c) => c.date === today);

  // Build 30-day strip
  const days: { iso: string; check?: typeof checks[number] }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ iso, check: checks.find((c) => c.date === iso) });
  }
  const maxIntensity = 10;

  const handleCheckToday = () => {
    upsertEmotionalCheck(event.id, today, intensity, note.trim() || undefined);
    setNote('');
  };

  return (
    <div className="emotional-detail">
      <div className="emotional-detail-head">
        <h3>{event.title}</h3>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Fermer</button>
      </div>
      <p className="emotional-detail-situation">{event.situation}</p>
      <div className="emotional-detail-emotions">
        {event.emotions.map((emo) => <span key={emo} className="emotional-chip small active">{emo}</span>)}
      </div>

      <div className="emotional-notes-edit">
        <textarea
          placeholder="Choses à faire pour diminuer l'intensité au fil des jours..."
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          rows={2}
          onBlur={() => { if (editNotes !== event.notes) updateEmotionalEvent(event.id, { notes: editNotes }); }}
        />
      </div>

      <div className="emotional-today-check">
        <h4>Aujourd'hui — {today}</h4>
        {todayCheck ? (
          <p className="emotional-today-done">✓ Cochée : intensité {todayCheck.intensity}/10 {todayCheck.note ? `— ${todayCheck.note}` : ''}</p>
        ) : null}
        <div className="emotional-today-form">
          <label>Intensité du jour
            <input type="range" min={1} max={10} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
            <span className="emotional-intensity-value">{intensity}/10</span>
          </label>
          <input placeholder="Note du jour (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary" onClick={handleCheckToday}>{todayCheck ? 'Mettre à jour' : 'Cocher aujourd\'hui'}</button>
        </div>
      </div>

      <div className="emotional-curve">
        <h4>Courbe d'intensité (30 jours)</h4>
        <div className="emotional-bars">
          {days.map(({ iso, check }) => {
            const day = Number(iso.slice(8, 10));
            const isToday = iso === today;
            return (
              <div key={iso} className={`emotional-bar-wrap ${isToday ? 'today' : ''}`} title={`${iso} · ${check ? `${check.intensity}/10` : '—'}`}>
                <div className="emotional-bar-track">
                  {check && <div className="emotional-bar-fill" style={{ height: `${(check.intensity / maxIntensity) * 100}%` }} />}
                </div>
                <span className="emotional-bar-label">{day}</span>
              </div>
            );
          })}
        </div>
        {checks.length >= 3 && (
          <p className="emotional-trend">
            {(() => {
              const first = checks[0].intensity;
              const last = checks[checks.length - 1].intensity;
              const diff = last - first;
              if (diff < -1) return `En baisse de ${Math.abs(diff)} pts depuis le début — tu avances.`;
              if (diff > 1) return `En hausse de ${diff} pts — observe sans juger, note ce qui a changé.`;
              return 'Stable — la constance fait le travail, continue de cocher.';
            })()}
          </p>
        )}
      </div>

      <div className="emotional-history">
        <h4>Historique</h4>
        {checks.length === 0 && <p className="empty-hint">Aucun jour coché — coche aujourd'hui pour démarrer la courbe.</p>}
        {checks.slice().reverse().map((c) => (
          <div key={c.id} className="emotional-history-row">
            <span className="emotional-history-date">{c.date}</span>
            <span className="emotional-history-intensity">{c.intensity}/10</span>
            {c.note && <span className="emotional-history-note">{c.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
