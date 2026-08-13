// src/test/KnowledgeView.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore } from '../store';
import KnowledgeView from '../KnowledgeView';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('KnowledgeView', () => {
  it('renders the suggestions tab with an actionable empty state', async () => {
    render(<KnowledgeView />);
    expect(screen.getByText(/Connaissances & auto-amélioration/)).toBeInTheDocument();
    expect(screen.getByText(/Aucun protocole ne correspond encore/)).toBeInTheDocument();
  });

  it('ingests a source and extracts protocols automatically', async () => {
    const user = userEvent.setup();
    render(<KnowledgeView />);

    await user.click(screen.getByText('Ingest (sources)'));

    await user.type(screen.getByLabelText('Titre de la source'), 'Huberman Lab #42');
    await user.type(
      screen.getByLabelText('Contenu de la source'),
      '- La lumière du matin améliore le sommeil.\n- La caféine le soir nuit au repos.',
    );
    await user.click(screen.getByText(/Extraire & ingérer/));

    // The source is stored and marked as processed; the extracted protocols
    // are now part of the local library.
    expect(screen.getByText(/✓ traitée/)).toBeInTheDocument();
    expect(screen.getByText('Huberman Lab #42')).toBeInTheDocument();
  });

  it('renders the permanent feeds tab with its management form', async () => {
    const user = userEvent.setup();
    render(<KnowledgeView />);

    await user.click(screen.getByText('Flux auto'));

    expect(screen.getByText(/Ingestion permanente & automatique/)).toBeInTheDocument();
    expect(screen.getByLabelText('URL du flux')).toBeInTheDocument();
    expect(screen.getByText(/arXiv — neuroscience, IHM, IA/)).toBeInTheDocument();
  });
});