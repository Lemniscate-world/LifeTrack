// src/projects.ts
// Projects attached to habits — the piece that turns a habit click into
// evidence of REAL deliverables. A habit (e.g. "coding") can be linked to one
// or many projects; when you check it you can attach which project/task you
// contributed to, so skills stop being "detected from a large database" and
// become measured by your own outputs.
//
// Pure module: (data) → stats. No store, no UI, fully unit-testable.

import type { CheckIn, Habit, Project, Task } from './types';
import { todayKey } from './dates';

/** All completed check-ins that reference a given project (directly or via a linked habit). */
export function projectCheckIns(project: Project, checkIns: CheckIn[]): CheckIn[] {
  if (!Array.isArray(project.habitIds)) return [];
  return checkIns.filter(
    (c) => c.completed && c.projectId === project.id,
  );
}

/** Flat list of a project's tasks. */
export function projectTasks(project: Project): Task[] {
  return project.tasks ?? [];
}

export interface ProjectProgress {
  project: Project;
  activeDays: number;         // distinct days with any completed linked check-in
  completions: number;        // total linked completions
  linkedWork: { habitId: string; completions: number }[];
  doneTasks: number;
  totalTasks: number;
  taskPct: number;            // 0-100, proportion of tasks done
  overdue: boolean;           // deadline passed and not done
}

/**
 * Per-project progress derived from real data. Because check-ins carry an
 * optional projectId, completions are attributed precisely; linked habits that
 * predate project-linking still contribute via their habit link.
 */
export function computeProjectProgress(
  project: Project,
  _habits: Habit[],
  checkIns: CheckIn[],
  now: Date = new Date(),
): ProjectProgress {
  const linked = new Set<string>(project.habitIds ?? []);
  const linkedWork = new Map<string, number>();
  let activeDays = 0;
  let completions = 0;
  const daySet = new Set<string>();

  for (const ci of checkIns) {
    if (!ci.completed) continue;
    const direct = ci.projectId === project.id;
    const viaHabit = linked.has(ci.habitId);
    if (!direct && !viaHabit) continue;
    completions += ci.count ?? 1;
    if (!daySet.has(ci.date)) {
      daySet.add(ci.date);
      activeDays++;
    }
    linkedWork.set(ci.habitId, (linkedWork.get(ci.habitId) ?? 0) + (ci.count ?? 1));
  }

  const tasks = projectTasks(project);
  const doneTasks = tasks.filter((t) => t.done).length;
  const totalTasks = tasks.length;
  const today = todayKey(now);

  return {
    project,
    activeDays,
    completions,
    linkedWork: [...linkedWork.entries()].map(([habitId, n]) => ({ habitId, completions: n })),
    doneTasks,
    totalTasks,
    taskPct: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    overdue: project.status !== 'done' && !!project.deadline && project.deadline < today,
  };
}

/** Active (non-archived, non-done) projects. */
export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status === 'active' || p.status === 'paused');
}

export interface AddTaskInput {
  title: string;
  id: string;      // caller supplies a unique id
  createdAt?: string;
}

/** Return a new project with the task appended. */
export function addTask(project: Project, input: AddTaskInput): Project {
  const task: Task = {
    id: input.id,
    title: input.title,
    done: false,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  return { ...project, tasks: [...(project.tasks ?? []), task] };
}

/** Return a new project with the task's done state toggled (and timestamp). */
export function toggleTask(project: Project, taskId: string, done: boolean): Project {
  return {
    ...project,
    tasks: (project.tasks ?? []).map((t) =>
      t.id === taskId
        ? { ...t, done, completedAt: done ? new Date().toISOString() : undefined }
        : t,
    ),
  };
}

/** Return a new project with a habit linked (idempotent). */
export function linkHabit(project: Project, habitId: string): Project {
  if ((project.habitIds ?? []).includes(habitId)) return project;
  return { ...project, habitIds: [...(project.habitIds ?? []), habitId] };
}

/** Return a new project with a habit unlinked. */
export function unlinkHabit(project: Project, habitId: string): Project {
  return { ...project, habitIds: (project.habitIds ?? []).filter((id) => id !== habitId) };
}

// --- Skills from deliverables ---
// The insight: crowd/DB skills can't know YOUR context, but your structured
// projects can. Each project's linked habits + completions are real evidence
// of a skill, with a concrete "what I produced" number instead of a guess.

export interface DeliverableSkill {
  projectId: string;
  projectName: string;
  habitIds: string[];
  completions: number;   // real measured outputs
  activeDays: number;    // consistency evidence
  taskPct: number;       // shippability
}

export function deriveDeliverableSkills(
  projects: Project[],
  habits: Habit[],
  checkIns: CheckIn[],
): DeliverableSkill[] {
  return projects
    .map((p) => {
      const prog = computeProjectProgress(p, habits, checkIns);
      return {
        projectId: p.id,
        projectName: p.name,
        habitIds: p.habitIds ?? [],
        completions: prog.completions,
        activeDays: prog.activeDays,
        taskPct: prog.taskPct,
      };
    })
    .filter((s) => s.completions > 0 || s.taskPct > 0);
}
