// src/ProjectsView.tsx
// Projects attached to habits — turn a habit click into evidence of a real
// deliverable. A habit (e.g. "coding") can be linked to one or many projects;
// each project has tasks and a progress derived from real check-ins + tasks.
// Self-contained: subscribes to the store, owns its own draft state.

import { useState, useEffect, useMemo } from 'react';
import type { FormEvent } from 'react';
import {
  getProjects,
  addProject,
  deleteProject,
  addProjectTask,
  toggleProjectTask,
  linkHabitToProject,
  unlinkHabitFromProject,
  getHabits,
  exportAllData,
  subscribe,
} from './store';
import {
  computeProjectProgress,
  deriveDeliverableSkills,
  type ProjectProgress,
} from './projects';
import type { Project, Habit, CheckIn } from './types';

export default function ProjectsView() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const projects: Project[] = useMemo(() => {
    try { return getProjects(); } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const habits: Habit[] = useMemo(() => getHabits(), [tick]);

  const checkIns: CheckIn[] = useMemo(() => {
    try { return (exportAllData().checkIns ?? []) as CheckIn[]; } catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const progressByProject = useMemo(() => {
    const map = new Map<string, ProjectProgress>();
    for (const p of projects) {
      try { map.set(p.id, computeProjectProgress(p, habits, checkIns)); } catch { /* ignore */ }
    }
    return map;
  }, [projects, habits, checkIns]);

  const deliverableSkills = useMemo(
    () => deriveDeliverableSkills(projects, habits, checkIns),
    [projects, habits, checkIns],
  );

  const [newName, setNewName] = useState('');
  const [newHabitId, setNewHabitId] = useState('');
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const created = addProject({
      name,
      ...(newHabitId ? { habitIds: [newHabitId] } : {}),
    });
    setNewName('');
    setNewHabitId('');
    if (created && newHabitId) {
      try { linkHabitToProject(created.id, newHabitId); } catch { /* ignore */ }
    }
  };

  const handleAddTask = (projectId: string, title: string) => {
    if (!title.trim()) return;
    addProjectTask(projectId, title.trim());
    setTaskDrafts((d) => ({ ...d, [projectId]: '' }));
  };

  const linkOptionsFor = (project: Project): Habit[] =>
    habits.filter((h) => !(project.habitIds ?? []).includes(h.id));

  const statusEmoji: Record<Project['status'], string> = {
    active: '🟢', done: '✅', paused: '⏸️', archived: '🗄️',
  };
return (
    <div className="lever-section projects-section">
      <div className="lever-header">
        <h3>📦 Projets liés aux habitudes</h3>
        <span className="lever-subtitle">
          Une habitude comme « coding » peut alimenter plusieurs projets. En liant un check-in à un
          projet, tu transformes un clic en livrable réel — c'est ainsi que tes skills sont mesurés
          par ce que tu produis, pas devinés par une base de données.
        </span>
      </div>

      <form className="lever-form" onSubmit={handleCreate}>
        <input
          className="text-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nom du projet (ex : Landing page, LifeTrack v0.7…)"
          aria-label="Nom du projet"
        />
        <select
          className="text-input"
          value={newHabitId}
          onChange={(e) => setNewHabitId(e.target.value)}
          aria-label="Habitude liée"
        >
          <option value="">— habitude liée (optionnel) —</option>
          {habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <button className="btn btn-primary" type="submit">Créer le projet</button>
      </form>

      {deliverableSkills.length > 0 && (
        <div className="lever-suggestions">
          <h4>🧬 Skills mesurés par des livrables réels</h4>
          <div className="lever-suggestions-list">
            {deliverableSkills.map((s) => (
              <div className="lever-suggestion-card" key={s.projectId}>
                <span className="lever-suggestion-name">📦 {s.projectName}</span>
                <span className="lever-suggestion-metric">
                  {s.completions} réalisation(s) · {s.activeDays} j actifs
                  {s.taskPct > 0 ? ` · ${s.taskPct}% des tâches` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="lever-none">
          Aucun projet. Crée-en un et lie-le à une habitude pour voir ta progression — et tes
          compétences émergent des livrables, pas d'un catalogue.
        </p>
      ) : (
        <div className="lever-list">
          {projects.map((p) => {
            const prog = progressByProject.get(p.id);
            return (
              <div className="lever-card project-card" key={p.id}>
                <div className="lever-card-main">
                  <span className="lever-content">
                    {statusEmoji[p.status]}{p.emoji ? ` ${p.emoji} ` : ' '}{p.name}
                  </span>
                  {p.description && <span className="lever-notes">{p.description}</span>}
                  {prog && (
                    <>
                      <div className="skill-progress-bar-container">
                        <div className="skill-progress-bar-labels">
                          <span>{prog.completions} réalisation(s) · {prog.activeDays} j actifs</span>
                          <span>Tâches : {prog.doneTasks}/{prog.totalTasks}</span>
                        </div>
                        <div className="skill-progress-track">
                          <div
                            className="skill-progress-fill"
                            style={{ width: `${prog.taskPct}%`, background: 'var(--accent, #8b5cf6)' }}
                          />
                        </div>
                      </div>
                      {prog.overdue && <span className="trend-p">⚠️ Échéance dépassée</span>}
                    </>
                  )}

                  <div className="project-tasks">
                    {(p.tasks ?? []).map((t) => (
                      <label className="project-task" key={t.id}>
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={(e) => toggleProjectTask(p.id, t.id, e.target.checked)}
                        />
                        <span className={t.done ? 'project-task-done' : ''}>{t.title}</span>
                      </label>
                    ))}
                  </div>
                  <div className="project-task-add">
                    <input
                      className="text-input"
                      value={taskDrafts[p.id] ?? ''}
                      onChange={(e) => setTaskDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTask(p.id, taskDrafts[p.id] ?? '');
                      }}
                      placeholder="Ajouter une tâche…"
                      aria-label={`Tâche pour ${p.name}`}
                    />
                    <button className="btn btn-sm btn-primary" onClick={() => handleAddTask(p.id, taskDrafts[p.id] ?? '')}>+</button>
                  </div>

                  <div className="project-habits">
                    <span className="lever-notes">Habitudes liées : </span>
                    {(p.habitIds ?? []).length === 0 && <span className="trend-p">aucune</span>}
                    {(p.habitIds ?? []).map((id) => {
                      const h = habits.find((x) => x.id === id);
                      return (
                        <span className="project-habit-pill" key={id}>
                          {h?.name ?? id}
                          <button className="btn-icon-sm" onClick={() => unlinkHabitFromProject(p.id, id)} title="Retirer">✕</button>
                        </span>
                      );
                    })}
                    {linkOptionsFor(p).length > 0 && (
                      <select
                        className="text-input project-habit-select"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) linkHabitToProject(p.id, e.target.value);
                        }}
                        aria-label={`Lier une habitude à ${p.name}`}
                      >
                        <option value="">+ lier une habitude</option>
                        {linkOptionsFor(p).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <div className="lever-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => deleteProject(p.id)} title="Supprimer le projet">🗑️</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}