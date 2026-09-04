// src/ObsidianView.tsx
// Import free-form Obsidian notes (unstructured markdown) and turn them into
// qualitative signals: recurring themes (fatigue, stress, victory...), wikilink
// mentions of the user's habits ([[Gym]]), and a rough sentiment score.
// The signals feed the AI context (aiContext) and give LifeTrack more insight.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getObsidianNotes, importObsidianNotes, removeObsidianNote, clearObsidianNotes, getHabits, getPreferences, updatePreferences, subscribe } from './store';
import { analyzeNotes } from './obsidian';
import { detectVaults, syncVault, pickVaultFolder, type DetectedVault } from './vaultSync';
import type { ThemeValence } from './obsidian';
import type { ObsidianNote } from './types';

const VALENCE_LABEL: Record<ThemeValence, string> = {
  positive: '👍 Positif',
  negative: '👎 Négatif',
  neutral: '⚪ Neutre',
};

export default function ObsidianView() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const notes = useMemo(() => getObsidianNotes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);
  const habits = useMemo(() => getHabits(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);
  const analysis = useMemo(() => analyzeNotes(notes, habits), [notes, habits]);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteFileName, setPasteFileName] = useState('');
  const [flash, setFlash] = useState('');

  // --- Automatic vault detection & sync (READ-ONLY) ---
  const [vaults, setVaults] = useState<DetectedVault[]>([]);
  const [vaultMsg, setVaultMsg] = useState('');
  const prefs = getPreferences();
  const vaultPath = prefs.obsidianVaultPath ?? '';
  const autoSync = prefs.obsidianAutoSync === true;

  const doSync = useCallback(async (path: string, stored: ObsidianNote[], announce: boolean) => {
    const p = getPreferences();
    const res = await syncVault(path, stored, {
      exclude: p.obsidianExcludeFolders,
      mirrorDeletions: p.obsidianMirrorDeletions === true,
    });
    if (announce && res.skipped) setVaultMsg('Synchronisation dispo uniquement dans l\'app desktop.');
    else if (announce && res.error) setVaultMsg(`⚠️ ${res.error}`);
    else if (announce && res.added + res.updated === 0) setVaultMsg('Coffre déjà à jour ✅');
    else if (res.added + res.updated > 0 || res.missing > 0) {
      const parts = [`${res.added} ajoutée(s)`, `${res.updated} mise(s) à jour`];
      if (res.missing > 0) parts.push(`${res.missing} marquée(s) absente(s) du coffre`);
      setVaultMsg(`${parts.join(', ')} (lecture seule) ✅`);
      setTick((t) => t + 1);
    }
  }, []);

  // On mount: detect vaults (startup sync itself lives app-wide in App.tsx).
  useEffect(() => {
    let alive = true;
    detectVaults().then((v) => { if (alive) setVaults(v); }).catch(() => { /* browser dev */ });
    return () => { alive = false; };
  }, []);

  const onSelectVault = (path: string) => {
    updatePreferences({ obsidianVaultPath: path });
    setVaultMsg(path ? `Coffre sélectionné : ${path} (lecture seule, jamais modifié)` : '');
  };

  const onBrowseVault = async () => {
    const picked = await pickVaultFolder();
    if (picked) onSelectVault(picked);
  };

  const onSyncNow = () => { void doSync(vaultPath, notes, true); };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imported: Omit<ObsidianNote, 'id'>[] = [];
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.md')) continue;
      try {
        const content = await f.text();
        imported.push({ fileName: f.name, content, importedAt: new Date().toISOString() });
      } catch {
        // skip unreadable file
      }
    }
    if (imported.length === 0) return;
    const res = importObsidianNotes(imported);
    setFlash(`${res.added} note(s) ajoutée(s)${res.replaced > 0 ? `, ${res.replaced} mise(s) à jour` : ''} ✅`);
    setTick((t) => t + 1);
  };

  const onPaste = () => {
    if (!pasteText.trim()) return;
    const name = pasteFileName.trim() || `note-${new Date().toISOString().slice(0, 10)}.md`;
    const res = importObsidianNotes([{ fileName: name, content: pasteText, importedAt: new Date().toISOString() }]);
    setFlash(res.added > 0 ? 'Note importée ✅' : 'Note déjà présente, mise à jour ✅');
    setPasteText('');
    setPasteFileName('');
    setPasteOpen(false);
    setTick((t) => t + 1);
  };

  const positive = analysis.themeTotals.filter((t) => t.valence === 'positive').reduce((s, t) => s + t.count, 0);
  const negative = analysis.themeTotals.filter((t) => t.valence === 'negative').reduce((s, t) => s + t.count, 0);

  return (
    <div className="view knowledge-view" style={{ maxWidth: '860px', margin: '0 auto' }}>
      <h2>📓 Notes Obsidian</h2>
      <p className="lever-suggestions-hint">
        Importe tes notes libres (markdown) : LifeTrack y détecte les <strong>thèmes récurrents</strong>
        (fatigue, stress, victoires…), les mentions de tes habitudes via les liens <code>[[Nom]]</code>,
        et un ressenti global. Ces signaux alimentent les insights de l'IA.
      </p>

      <div className="lever-card" style={{ marginBottom: '1rem' }}>
        <div className="lever-card-main">
          <span className="lever-content">🔍 Coffre Obsidian — détection automatique</span>
          <span className="lever-effect">
            🔒 <strong>Lecture seule garantie</strong> : LifeTrack ne crée, ne modifie et ne supprime
            jamais aucun fichier dans ton coffre. Une copie est stockée localement dans LifeTrack.
          </span>
        </div>
        <div className="lever-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
          <select
            className="settings-select"
            value={vaultPath}
            onChange={(e) => onSelectVault(e.target.value)}
            style={{ minWidth: '260px' }}
          >
            <option value="">{vaults.length === 0 ? 'Aucun coffre détecté' : '— Choisir un coffre —'}</option>
            {vaults.map((v) => <option key={v.path} value={v.path}>{v.path}</option>)}
          </select>
          <button className="btn btn-sm btn-ghost" onClick={() => { detectVaults().then(setVaults).catch(() => setVaultMsg('Détection dispo uniquement dans l\'app desktop.')); }}>
            🔄 Détecter
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => { void onBrowseVault(); }}>📂 Parcourir…</button>
          <button className="btn btn-sm btn-ghost" disabled={!vaultPath} onClick={onSyncNow}>⬇️ Synchroniser maintenant</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => updatePreferences({ obsidianAutoSync: e.target.checked })}
            />
            Sync auto (lancement + toutes les 10 min)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }} title="Marque les notes disparues du coffre — sans jamais les supprimer de LifeTrack">
            <input
              type="checkbox"
              checked={prefs.obsidianMirrorDeletions === true}
              onChange={(e) => updatePreferences({ obsidianMirrorDeletions: e.target.checked })}
            />
            🪞 Miroir des suppressions
          </label>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <input
            className="text-input"
            placeholder="Dossiers ignorés, séparés par des virgules (ex : Archive, Templates, Brouillons)"
            value={prefs.obsidianExcludeFolders ?? ''}
            onChange={(e) => updatePreferences({ obsidianExcludeFolders: e.target.value })}
            style={{ width: '100%' }}
          />
        </div>
        {vaultPath && <span className="lever-effect" style={{ display: 'block', marginTop: '0.4rem' }}>📁 {vaultPath}</span>}
        {vaultMsg && <span className="lever-effect" style={{ display: 'block', marginTop: '0.3rem', color: 'var(--primary)' }}>{vaultMsg}</span>}
      </div>

      <div className="feed-actions" style={{ marginBottom: '1rem' }}>
        <label className="btn btn-primary" style={{ cursor: 'pointer', display: 'inline-block' }}>
          📂 Importer des fichiers .md
          <input
            type="file"
            accept=".md,.markdown"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
          />
        </label>
        <button className="btn btn-sm btn-ghost" onClick={() => setPasteOpen((o) => !o)}>✏️ Coller une note</button>
        {notes.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Supprimer toutes les notes importées ?')) { clearObsidianNotes(); setTick((t) => t + 1); } }}>
            🗑️ Tout effacer
          </button>
        )}
      </div>

      {flash && <div className="feed-status" style={{ marginBottom: '0.75rem', color: 'var(--primary)' }}>{flash}</div>}

      {pasteOpen && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-alt)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <input
            className="text-input"
            placeholder="Nom du fichier (ex: 2026-08-15.md) — optionnel"
            value={pasteFileName}
            onChange={(e) => setPasteFileName(e.target.value)}
            style={{ width: '100%', marginBottom: '0.5rem' }}
          />
          <textarea
            className="text-input"
            placeholder="Colle ici le contenu de ta note (markdown libre)…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <div className="feed-actions" style={{ marginTop: '0.5rem' }}>
            <button className="btn btn-sm btn-primary" onClick={onPaste}>Ajouter</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setPasteOpen(false)}>Annuler</button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <div style={{ padding: '3rem 1rem', background: 'var(--bg-alt)', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📄</div>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Aucune note importée</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            Exporte un dossier de ton vault Obsidian (ou glisse tes fichiers .md ci-dessus) pour
            commencer. Liens recommandés dans tes notes : <code>[[Gym]]</code>, <code>[[Méditation]]</code>…
          </p>
        </div>
      ) : (
        <>
          {/* Overview */}
          <div className="lever-card" style={{ marginBottom: '1rem' }}>
            <div className="lever-card-main">
              <span className="lever-content">📊 Vue d'ensemble — {notes.length} note(s)</span>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', padding: '0.5rem 0' }}>
              <span className="lever-effect">Thèmes positifs : <strong style={{ color: '#10b981' }}>{positive}</strong></span>
              <span className="lever-effect">Thèmes négatifs : <strong style={{ color: '#f59e0b' }}>{negative}</strong></span>
              <span className="lever-effect">
                Ressenti global : <strong style={{ color: analysis.sentiment > 0 ? '#10b981' : analysis.sentiment < 0 ? '#f59e0b' : 'inherit' }}>
                  {analysis.sentiment > 0 ? `+${analysis.sentiment}` : analysis.sentiment}
                </strong>
              </span>
              <span className="lever-effect">Liens habitudes : <strong>{analysis.mentionTotals.length}</strong></span>
            </div>
          </div>

          {/* Hardest notes */}
          {analysis.hardestNotes.length > 0 && (
            <div className="lever-card" style={{ marginBottom: '1rem', boxShadow: 'inset 2px 0 0 0 #f59e0b' }}>
              <div className="lever-card-main">
                <span className="lever-content">⚠️ Notes les plus difficiles</span>
                <span className="lever-notes">{analysis.hardestNotes.join(' · ')}</span>
                <span className="lever-effect">Garde un œil sur ces moments — les corrélations peuvent y puiser du contexte.</span>
              </div>
            </div>
          )}

          {/* Habit mentions */}
          {analysis.mentionTotals.length > 0 && (
            <h4 style={{ marginBottom: '0.5rem' }}>🔗 Habitudes mentionnées dans tes notes</h4>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            {analysis.mentionTotals.map((m) => (
              <span key={m.habitId} style={{ background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}>
                🏷️ {m.habitName} <strong>×{m.count}</strong>
              </span>
            ))}
          </div>

          {/* Theme totals */}
          <h4 style={{ marginBottom: '0.5rem' }}>🧠 Thèmes récurrents</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {analysis.themeTotals.length === 0 && <p className="lever-none">Aucun thème détecté pour l'instant.</p>}
            {analysis.themeTotals.map((t) => (
              <div key={t.themeId} className="lever-card">
                <div className="lever-card-main">
                  <span className="lever-content">{t.emoji} {t.label} <strong>×{t.count}</strong></span>
                  <span className="lever-effect" style={{ color: t.valence === 'positive' ? '#10b981' : t.valence === 'negative' ? '#f59e0b' : 'var(--text-muted)' }}>
                    {VALENCE_LABEL[t.valence]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Per-note detail */}
          <h4 style={{ marginBottom: '0.5rem' }}>📄 Détail par note</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {analysis.notes.map((n) => (
              <div key={n.fileName} className="lever-card">
                <div className="lever-card-main">
                  <span className="lever-content" style={{ fontWeight: 600 }}>
                    {n.fileName}
                    {notes.find((x) => x.fileName === n.fileName)?.vaultMissing && (
                      <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#f59e0b' }}>🗑️ supprimée du coffre</span>
                    )}
                  </span>
                  <span className="lever-effect">
                    {n.themes.length === 0 ? 'aucun thème' : n.themes.slice(0, 4).map((t) => `${t.emoji} ${t.label}`).join(' · ')}
                    {n.mentions.length > 0 && ` · ${n.mentions.map((m) => `[[${m.habitName}]]`).join(' ')}`}
                  </span>
                  <span className="lever-effect">
                    Sentiment : <strong style={{ color: n.sentiment > 0 ? '#10b981' : n.sentiment < 0 ? '#f59e0b' : 'inherit' }}>
                      {n.sentiment > 0 ? `+${n.sentiment}` : n.sentiment}
                    </strong>
                  </span>
                </div>
                <div className="lever-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => removeObsidianNote(notes.find((x) => x.fileName === n.fileName)?.id ?? '')}>
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
