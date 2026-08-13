// src/test/ProjectsView.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore } from '../store';
import ProjectsView from '../ProjectsView';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('ProjectsView', () => {
  it('shows the empty state and creates a project', async () => {
    const user = userEvent.setup();
    render(<ProjectsView />);
    expect(screen.getByText(/Aucun projet/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nom du projet'), 'Landing page');
    await user.click(screen.getByText('Créer le projet'));

    expect(screen.getByText(/Landing page/)).toBeInTheDocument();
  });

  it('adds and toggles tasks on a project', async () => {
    const user = userEvent.setup();
    render(<ProjectsView />);

    await user.type(screen.getByLabelText('Nom du projet'), 'LifeTrack v0.7');
    await user.click(screen.getByText('Créer le projet'));

    const taskInput = screen.getByLabelText('Tâche pour LifeTrack v0.7');
    await user.type(taskInput, 'Écrire le moteur de préférences');
    await user.type(taskInput, '{Enter}');

    expect(screen.getByText('Écrire le moteur de préférences')).toBeInTheDocument();

    // Toggle the task done.
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});