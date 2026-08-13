// src/test/projects.test.ts
import { describe, it, expect } from 'vitest';
import type { CheckIn, Habit, Project } from '../types';
import {
  computeProjectProgress,
  linkHabit,
  unlinkHabit,
  addTask,
  toggleTask,
  deriveDeliverableSkills,
  projectTasks,
} from '../projects';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'LifeTrack',
    status: 'active',
    habitIds: ['h1'],
    tasks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function checkIn(habitId: string, date: string, over: Partial<CheckIn> = {}): CheckIn {
  return { habitId, date, completed: true, count: 1, ...over };
}

const habits: Habit[] = [
  { id: 'h1', name: 'Coding', color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 0 },
  { id: 'h2', name: 'Writing', color: '#fff', goal: 1, createdAt: '2026-01-01', archived: false, order: 1 },
];

describe('projects', () => {
  it('computes completions from directly-linked check-ins', () => {
    const checkIns = [
      checkIn('h1', '2026-02-01', { projectId: 'p1' }),
      checkIn('h1', '2026-02-02', { projectId: 'p1' }),
      checkIn('h1', '2026-02-03', { projectId: 'p1' }),
      checkIn('h2', '2026-02-03'), // unlinked habit
    ];
    const prog = computeProjectProgress(project(), habits, checkIns, new Date(2026, 1, 3));
    expect(prog.completions).toBe(3);
    expect(prog.activeDays).toBe(3);
  });

  it('attributes via linked habit even without projectId on the check-in', () => {
    const checkIns = [checkIn('h1', '2026-02-01')];
    const prog = computeProjectProgress(project({ habitIds: ['h1'] }), habits, checkIns, new Date(2026, 1, 1));
    expect(prog.completions).toBe(1);
  });

  it('computes task progress', () => {
    let p = project();
    p = addTask(p, { id: 't1', title: 'Write tests' });
    p = addTask(p, { id: 't2', title: 'Ship' });
    p = toggleTask(p, 't1', true);
    const prog = computeProjectProgress(p, habits, [], new Date(2026, 1, 1));
    expect(prog.totalTasks).toBe(2);
    expect(prog.doneTasks).toBe(1);
    expect(prog.taskPct).toBe(50);
  });

  it('flags overdue projects', () => {
    const p = project({ deadline: '2026-01-01' });
    const prog = computeProjectProgress(p, habits, [], new Date(2026, 5, 1));
    expect(prog.overdue).toBe(true);
  });

  it('link/unlink habit are idempotent and reversible', () => {
    const linked = linkHabit(project({ habitIds: ['h1'] }), 'h2');
    expect(linked.habitIds).toEqual(['h1', 'h2']);
    expect(linkHabit(linked, 'h2').habitIds).toEqual(['h1', 'h2']);
    expect(unlinkHabit(linked, 'h2').habitIds).toEqual(['h1']);
  });

  it('derives deliverable skills only from real evidence', () => {
    const checkIns = [
      checkIn('h1', '2026-02-01', { projectId: 'p1' }),
      checkIn('h1', '2026-02-02', { projectId: 'p1' }),
    ];
    const skills = deriveDeliverableSkills([project()], habits, checkIns);
    expect(skills).toHaveLength(1);
    expect(skills[0].completions).toBe(2);
    expect(skills[0].projectName).toBe('LifeTrack');
    // Empty project (no completions, no tasks) produces no skill.
    expect(deriveDeliverableSkills([project({ name: 'Idle' })], habits, [])).toHaveLength(0);
  });

  it('projectTasks returns a flat task list', () => {
    const p = addTask(project(), { id: 't1', title: 'x' });
    expect(projectTasks(p)).toHaveLength(1);
  });
});
