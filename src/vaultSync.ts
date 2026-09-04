// src/vaultSync.ts
// Automatic Obsidian vault synchronization engine (READ-ONLY).
//
// LifeTrack detects installed vaults (via the Tauri `detect_obsidian_vault`
// command which reads Obsidian's own registry) and reads their markdown files
// with `read_vault_notes`. It NEVER writes anything to the vault: the vault is
// treated as an immutable source, and only LifeTrack's local store is updated.
//
// Pure diff engine: `diffVault` takes vault files + currently stored notes and
// returns what should be added/updated. Persistence is the caller's job
// (store.importObsidianNotes), so this module stays trivially testable.

import type { ObsidianNote } from './types';

/** Shape returned by the Tauri `read_vault_notes` command. */
export interface VaultFile {
  /** Vault-relative path, e.g. "Journal/2026-08-14.md". */
  fileName: string;
  content: string;
  /** Last-modified epoch millis string — enables incremental sync. */
  modifiedAt?: string;
}

export interface VaultDiff {
  /** Notes that don't exist in the store yet. */
  toAdd: VaultFile[];
  /** Notes whose content changed since the last import. */
  toUpdate: VaultFile[];
  /** Stored notes whose file no longer exists in the vault (mirror mode). */
  missing: string[];
}

/** Parse the comma-separated exclusion pref into clean path prefixes. */
export function parseExclusions(exclude?: string): string[] {
  return (exclude ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0);
}

/** Drop vault files living under an excluded folder prefix (case-insensitive). */
export function filterExcluded(files: VaultFile[], exclude?: string): VaultFile[] {
  const prefixes = parseExclusions(exclude).map((p) => `${p.toLowerCase()}/`);
  if (prefixes.length === 0) return files;
  return files.filter((f) => {
    const path = f.fileName.toLowerCase();
    return !prefixes.some((p) => path.startsWith(p) || path === p.slice(0, -1));
  });
}

/** Stored note file names that no longer exist in the vault snapshot. */
export function missingVaultNotes(files: VaultFile[], stored: ObsidianNote[]): string[] {
  const present = new Set(files.map((f) => f.fileName));
  return stored.filter((n) => !present.has(n.fileName)).map((n) => n.fileName);
}

/** Compare vault files against stored notes (match by vault-relative fileName).
 *  Incremental: a file with the same mtime AND same content is skipped. */
export function diffVault(files: VaultFile[], stored: ObsidianNote[]): VaultDiff {
  const byName = new Map(stored.map((n) => [n.fileName, n]));
  const toAdd: VaultFile[] = [];
  const toUpdate: VaultFile[] = [];
  for (const f of files) {
    const existing = byName.get(f.fileName);
    if (!existing) { toAdd.push(f); continue; }
    const mtimeUnchanged = !!f.modifiedAt && existing.vaultModifiedAt === f.modifiedAt;
    if (mtimeUnchanged && existing.content === f.content) continue;
    if (existing.content !== f.content) toUpdate.push(f);
    else if (f.modifiedAt) {
      // Content equal but we learned the mtime — harmless refresh of metadata.
      toUpdate.push(f);
    }
  }
  return { toAdd, toUpdate, missing: missingVaultNotes(files, stored) };
}

/** Convert vault files to storable notes (now timestamp, mtime preserved). */
export function toObsidianNotes(files: VaultFile[], now: Date = new Date()): Omit<ObsidianNote, 'id'>[] {
  return files.map((f) => ({
    fileName: f.fileName,
    content: f.content,
    importedAt: now.toISOString(),
    ...(f.modifiedAt ? { vaultModifiedAt: f.modifiedAt } : {}),
  }));
}

/** True when running inside the Tauri desktop shell (vault commands need it). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface DetectedVault {
  path: string;
}

/** Ask the Rust backend for installed vaults (read-only registry + scan). */
export async function detectVaults(): Promise<DetectedVault[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DetectedVault[]>('detect_obsidian_vault');
}

/** Read all markdown notes of a vault through the Rust backend (read-only). */
export async function readVault(vaultPath: string): Promise<VaultFile[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<VaultFile[]>('read_vault_notes', { vaultPath });
}

export interface SyncOptions {
  /** Comma-separated folder prefixes to ignore (pref obsidianExcludeFolders). */
  exclude?: string;
  /** Flag (never delete) notes removed from the vault. */
  mirrorDeletions?: boolean;
}

export interface SyncResult {
  added: number;
  updated: number;
  /** Notes flagged as removed from the vault (mirror mode only). */
  missing: number;
  skipped: boolean; // true when not in Tauri (browser dev) — nothing to sync
  error?: string;
}

/**
 * One full vault sync: read the vault (read-only), diff against the store,
 * persist new/changed notes into LifeTrack's local store only.
 * Never throws for environmental reasons (browser, missing vault).
 */
export async function syncVault(vaultPath: string, stored: ObsidianNote[], opts: SyncOptions = {}): Promise<SyncResult> {
  if (!isTauri()) return { added: 0, updated: 0, missing: 0, skipped: true };
  if (!vaultPath) return { added: 0, updated: 0, missing: 0, skipped: false, error: 'Aucun coffre configuré.' };
  let files: VaultFile[];
  try {
    files = await readVault(vaultPath);
  } catch (e) {
    return { added: 0, updated: 0, missing: 0, skipped: false, error: String(e) };
  }
  const visible = filterExcluded(files, opts.exclude);
  const diff = diffVault(visible, stored);

  // Mirror mode: flag removed notes (content is kept, never deleted).
  let missingCount = 0;
  if (opts.mirrorDeletions) {
    const { applyVaultMirror } = await import('./store');
    applyVaultMirror(diff.missing);
    missingCount = diff.missing.filter((name) => stored.find((n) => n.fileName === name && !n.vaultMissing)).length;
  }

  const all = [...diff.toAdd, ...diff.toUpdate];
  if (all.length === 0) return { added: 0, updated: 0, missing: missingCount, skipped: false };
  // Import must be deferred to avoid a circular dependency with store.ts:
  // the caller passes its own importer. We use a dynamic import here instead.
  return { added: diff.toAdd.length, updated: diff.toUpdate.length, missing: missingCount, skipped: false, ...(await importNotes(all)) };
}

/** Let the user pick a vault folder manually (when auto-detection can't see it). */
export async function pickVaultFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const sel = await open({ directory: true, multiple: false });
  return typeof sel === 'string' && sel.trim() ? sel : null;
}

/** Indirection so tests can stub persistence without touching store.ts. */
async function importNotes(files: VaultFile[]): Promise<{ imported: number }> {
  const { importObsidianNotes } = await import('./store');
  const res = importObsidianNotes(toObsidianNotes(files));
  return { imported: res.added + res.replaced };
}