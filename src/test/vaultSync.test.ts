import { describe, it, expect } from 'vitest';
import { diffVault, toObsidianNotes, parseExclusions, filterExcluded, missingVaultNotes } from '../vaultSync';
import type { ObsidianNote } from '../types';

const note = (fileName: string, content: string): ObsidianNote => ({
  id: `id-${fileName}`,
  fileName,
  content,
  importedAt: '2026-01-01T00:00:00.000Z',
});

describe('vaultSync — diffVault', () => {
  it('flags new files as toAdd', () => {
    const diff = diffVault(
      [{ fileName: 'a.md', content: 'hello' }],
      [],
    );
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('ignores unchanged files', () => {
    const diff = diffVault(
      [{ fileName: 'a.md', content: 'hello' }],
      [note('a.md', 'hello')],
    );
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('flags changed content as toUpdate', () => {
    const diff = diffVault(
      [{ fileName: 'a.md', content: 'hello v2' }],
      [note('a.md', 'hello v1')],
    );
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toAdd).toHaveLength(0);
  });

  it('keeps stored notes that no longer exist in the vault (no deletion, read-only contract)', () => {
    const diff = diffVault([], [note('a.md', 'old')]);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('matches subfolder paths exactly', () => {
    const diff = diffVault(
      [{ fileName: 'Journal/2026-08-14.md', content: 'x' }],
      [note('2026-08-14.md', 'x')],
    );
    expect(diff.toAdd).toHaveLength(1); // different identity: subfolder path counts
  });

  it('toObsidianNotes stamps the import time', () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const notes = toObsidianNotes([{ fileName: 'a.md', content: 'c' }], now);
    expect(notes[0]).toEqual({ fileName: 'a.md', content: 'c', importedAt: now.toISOString() });
  });

  it('toObsidianNotes preserves the vault mtime for incremental sync', () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    const notes = toObsidianNotes([{ fileName: 'a.md', content: 'c', modifiedAt: '1724846400000' }], now);
    expect(notes[0].vaultModifiedAt).toBe('1724846400000');
  });
});

describe('vaultSync — incremental sync (mtime)', () => {
  it('skips files whose mtime AND content are unchanged', () => {
    const stored: ObsidianNote = { ...note('a.md', 'hello'), vaultModifiedAt: '111' };
    const diff = diffVault([{ fileName: 'a.md', content: 'hello', modifiedAt: '111' }], [stored]);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
  });

  it('updates when the mtime changed even if content is equal (metadata refresh)', () => {
    const stored: ObsidianNote = { ...note('a.md', 'hello'), vaultModifiedAt: '111' };
    const diff = diffVault([{ fileName: 'a.md', content: 'hello', modifiedAt: '222' }], [stored]);
    expect(diff.toUpdate).toHaveLength(1);
  });

  it('updates when content changed', () => {
    const stored: ObsidianNote = { ...note('a.md', 'hello'), vaultModifiedAt: '111' };
    const diff = diffVault([{ fileName: 'a.md', content: 'hello v2', modifiedAt: '222' }], [stored]);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0].content).toBe('hello v2');
  });

  it('reports missing notes (removed from the vault) without removing them', () => {
    const stored = [note('a.md', 'kept'), note('b.md', 'gone')];
    const diff = diffVault([{ fileName: 'a.md', content: 'kept' }], stored);
    expect(diff.missing).toEqual(['b.md']);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
  });
});

describe('vaultSync — folder exclusions', () => {
  it('parses comma-separated prefixes and trims slashes', () => {
    expect(parseExclusions(' Archive, /Templates/ ,, Brouillons ')).toEqual(['Archive', 'Templates', 'Brouillons']);
    expect(parseExclusions(undefined)).toEqual([]);
    expect(parseExclusions('')).toEqual([]);
  });

  it('filters vault files under excluded folders (case-insensitive)', () => {
    const files = [
      { fileName: 'Journal/2026-08-14.md', content: 'x' },
      { fileName: 'Archive/old.md', content: 'y' },
      { fileName: 'templates/tpl.md', content: 'z' },
      { fileName: 'root.md', content: 'r' },
    ];
    const kept = filterExcluded(files, 'Archive, Templates');
    expect(kept.map((f) => f.fileName)).toEqual(['Journal/2026-08-14.md', 'root.md']);
  });

  it('missingVaultNotes ignores excluded folders as sources of deletion', () => {
    const stored = [note('Archive/old.md', 'y'), note('keep.md', 'k')];
    const missing = missingVaultNotes([{ fileName: 'keep.md', content: 'k' }], stored);
    expect(missing).toEqual(['Archive/old.md']);
  });
});

