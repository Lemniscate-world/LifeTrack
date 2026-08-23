import { useState, useEffect } from 'react';
import {
  getStorageStatus,
  getMantraSettings,
  updateMantraSettings,
  getPreferences,
  updatePreferences,
  getLastSaved,
  flushSave,
  exportAllData,
  listUpgradeBackups,
  getHabits,
} from './store';
import type { MantraSettings, UserPreferences } from './types';
import { INSIGHT_RULES_COUNT } from './recommendations';
import { version as APP_VERSION } from '../package.json';
import { ascendantLongitude, signOfLongitude } from './astrology';

const THEMES = ['', 'theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald', 'theme-bw'];
const THEME_LABELS = ['Default', 'Ocean', 'Forest', 'Sunset', 'Rose', 'Mono', 'Midnight', 'Emerald', 'Noir & Blanc'];

interface SettingsViewProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  theme: string;
   
  onSetTheme: (_theme: string) => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onImportJSON: () => void;
  onRestoreBackup: () => void;
  onViewMantras: () => void;
}

export default function SettingsView({
  darkMode,
  onToggleDarkMode,
  theme,
  onSetTheme,
  onExportJSON,
  onExportCSV,
  onImportJSON,
  onRestoreBackup,
  onViewMantras,
}: SettingsViewProps) {
  const [mantraSettings, setMantraSettings] = useState<MantraSettings>(getMantraSettings());
  const [storageStatus, setStorageStatus] = useState(getStorageStatus());
  const [lastSaved, setLastSaved] = useState('');
  const [activeTab, setActiveTab] = useState<'appearance' | 'ai' | 'mantras' | 'data' | 'backups' | 'astro' | 'about'>('appearance');
  const [confirmReset, setConfirmReset] = useState(false);
  const [aiPrefs, setAiPrefs] = useState<UserPreferences>(getPreferences());
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Natal chart (whole-sign houses) — v0.7.0.
  const birthInit = getPreferences();
  const [birthDate, setBirthDate] = useState(birthInit.birthDate ?? '');
  const [birthTime, setBirthTime] = useState(birthInit.birthTime ?? '');
  const [birthLat, setBirthLat] = useState(birthInit.birthLat !== undefined ? String(birthInit.birthLat) : '');
  const [birthLon, setBirthLon] = useState(birthInit.birthLon !== undefined ? String(birthInit.birthLon) : '');

  const saveBirth = () => {
    const lat = birthLat.trim() === '' ? undefined : Number(birthLat.replace(',', '.'));
    const lon = birthLon.trim() === '' ? undefined : Number(birthLon.replace(',', '.'));
    updatePreferences({
      birthDate: birthDate || undefined,
      birthTime: birthTime || undefined,
      birthLat: lat !== undefined && Number.isFinite(lat) ? lat : undefined,
      birthLon: lon !== undefined && Number.isFinite(lon) ? lon : undefined,
    });
  };

  useEffect(() => {
    const update = () => {
      setMantraSettings(getMantraSettings());
      setStorageStatus(getStorageStatus());
      const ts = getLastSaved();
      setLastSaved(ts === 0 ? 'Not saved yet' : `${Math.round((Date.now() - ts) / 1000)}s ago`);
    };
    update();
    const id = setInterval(update, 3000);
    return () => clearInterval(id);
  }, []);

  const handleMantraSetting = (key: keyof MantraSettings, value: boolean | string) => {
    updateMantraSettings({ [key]: value });
    setMantraSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetData = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    // Remove ALL LifeTrack keys from localStorage (v0.3.2: complete cleanup)
    localStorage.removeItem('lifetrack-data');
    localStorage.removeItem('lifetrack-data-backup');
    localStorage.removeItem('lifetrack-raw');
    localStorage.removeItem('lifetrack-darkmode');
    localStorage.removeItem('lifetrack-theme');
    // Clean all upgrade backup keys (timestamped snapshots)
    for (const key of listUpgradeBackups()) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    window.location.reload();
  };

  const tabs = [
    { id: 'appearance' as const, label: '🎨 Appearance' },
    { id: 'ai' as const, label: '🤖 AI' },
    { id: 'mantras' as const, label: '🧘 Mantras' },
    { id: 'data' as const, label: '💾 Data' },
    { id: 'backups' as const, label: '🛡️ Backups' },
    { id: 'astro' as const, label: '🔯 Astro' },
    { id: 'about' as const, label: 'ℹ️ About' },
  ];

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h2>⚙️ Settings</h2>
      </div>

      <div className="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`settings-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* APPEARANCE */}
      {activeTab === 'appearance' && (
        <div className="settings-panel">
          <div className="settings-group">
            <h3>Theme</h3>
            <div className="settings-theme-grid">
              {THEMES.map((t, i) => (
                <button
                  key={t}
                  className={`settings-theme-btn ${theme === t ? 'active' : ''}`}
                  onClick={() => onSetTheme(t)}
                  title={THEME_LABELS[i]}
                >
                  <span className={`settings-theme-swatch ${t}`} />
                  <span>{THEME_LABELS[i]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group">
            <h3>Dark Mode</h3>
            <div className="settings-row">
              <span>Toggle dark/light mode</span>
              <label className="mantra-toggle">
                <input type="checkbox" checked={darkMode} onChange={onToggleDarkMode} />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
          </div>

          <div className="settings-group">
            <h3>Audio Feedback</h3>
            <div className="settings-row">
              <span>Effets sonores (chime au check-in / passage de niveau)</span>
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={aiPrefs.soundEnabled !== false}
                  onChange={(e) => {
                    const next = { ...aiPrefs, soundEnabled: e.target.checked };
                    setAiPrefs(next);
                    updatePreferences(next);
                  }}
                />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
          </div>

          <div className="settings-group">
            <h3>Grid</h3>
            <div className="settings-row">
              <span>Mode compact (cellules et lignes réduites pour afficher 25-50 habitudes)</span>
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={aiPrefs.compactGrid === true}
                  onChange={(e) => {
                    const next = { ...aiPrefs, compactGrid: e.target.checked };
                    setAiPrefs(next);
                    updatePreferences(next);
                  }}
                />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <span>Auto-compact (s'active automatiquement à partir du seuil)</span>
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={aiPrefs.autoCompact !== false}
                  onChange={(e) => {
                    const next = { ...aiPrefs, autoCompact: e.target.checked };
                    setAiPrefs(next);
                    updatePreferences(next);
                  }}
                />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <span>Seuil d'auto-compact (nb d'habitudes)</span>
              <select
                className="settings-select"
                disabled={aiPrefs.autoCompact === false}
                value={aiPrefs.compactThreshold ?? 30}
                onChange={(e) => {
                  const next = { ...aiPrefs, compactThreshold: Number(e.target.value) };
                  setAiPrefs(next);
                  updatePreferences(next);
                }}
              >
                {[20, 25, 30, 40, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <span>Densité compacte</span>
              <div className="settings-segmented" role="group" aria-label="Compact density">
                {([0, 1, 2] as const).map((level) => (
                  <button
                    key={level}
                    className={((aiPrefs.compactLevel ?? 0) === level ? 'active' : '')}
                    onClick={() => {
                      const next = { ...aiPrefs, compactLevel: level };
                      setAiPrefs(next);
                      updatePreferences(next);
                    }}
                  >
                    {level === 0 ? 'Standard' : level === 1 ? 'Dense' : 'Ultra'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI */}
      {activeTab === 'ai' && (
        <div className="settings-panel">
          <div className="settings-group">
            <h3>AI Provider</h3>
            <p className="settings-hint">
              Deep Analysis and the Coach use this provider. Auto = OpenRouter when an API key is set,
              falling back to local Ollama if the cloud is unreachable.
            </p>
            <div className="settings-row">
              <span>Provider</span>
              <select
                className="settings-select"
                value={aiPrefs.aiProvider ?? 'auto'}
                onChange={(e) => {
                  const next = { ...aiPrefs, aiProvider: e.target.value as UserPreferences['aiProvider'] };
                  setAiPrefs(next);
                  updatePreferences(next);
                }}
              >
                <option value="auto">Auto (cloud → Ollama fallback)</option>
                <option value="openrouter">Cloud (OpenRouter)</option>
                <option value="ollama">Local (Ollama)</option>
              </select>
            </div>
            <div className="settings-row">
              <span>Model</span>
              <input
                type="text"
                className="settings-text-input"
                placeholder="deepseek/deepseek-v4-flash (OpenRouter) — ou un modèle Ollama local"
                list="lifetrack-models"
                value={aiPrefs.aiModel ?? ''}
                onChange={(e) => {
                  const next = { ...aiPrefs, aiModel: e.target.value };
                  setAiPrefs(next);
                  updatePreferences(next);
                }}
              />
              <datalist id="lifetrack-models">
                <option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash (défaut cloud)</option>
                <option value="deepseek/deepseek-chat">DeepSeek Chat</option>
                <option value="openai/gpt-4o-mini">GPT-4o mini</option>
                <option value="anthropic/claude-3.7-sonnet">Claude Sonnet</option>
                <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
              </datalist>
            </div>
            <p className="settings-hint">
              ✨ Modèle cloud par défaut : <strong>DeepSeek V4 Flash</strong> (laisse le champ vide pour l'utiliser).
              Tu peux aussi typer n'importe quel id OpenRouter / Ollama.
            </p>
            <div className="settings-row">
              <span>API key</span>
              <input
                type="password"
                className="settings-text-input"
                placeholder="sk-or-… (OpenRouter)"
                value={aiPrefs.aiApiKey ?? ''}
                onChange={(e) => {
                  const next = { ...aiPrefs, aiApiKey: e.target.value };
                  setAiPrefs(next);
                  updatePreferences(next);
                }}
              />
            </div>
            <p className="settings-hint">
              🔒 The key is stored only on your machine and is only sent to the provider you chose.
            </p>
          </div>

          <div className="settings-group">
            <h3>Test Connection</h3>
            <div className="settings-actions">
              <button
                className="btn btn-primary"
                disabled={aiTesting}
                onClick={async () => {
                  setAiTesting(true);
                  setAiTestResult(null);
                  try {
                    const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
                    if (!isTauriEnv) {
                      setAiTestResult({ ok: false, message: 'Testing requires the desktop app.' });
                      return;
                    }
                    const { invoke } = await import('@tauri-apps/api/core');
                    const answer = await invoke<string>('ask_coach', {
                      question: 'Reply with exactly: OK',
                      summaryJson: '{}',
                      lastAnalysis: '',
                      model: aiPrefs.aiModel || null,
                      provider: aiPrefs.aiProvider || 'auto',
                      apiKey: aiPrefs.aiApiKey || '',
                    });
                    setAiTestResult({ ok: true, message: `Connected — model replied: ${answer.slice(0, 60)}` });
                  } catch (e) {
                    setAiTestResult({
                      ok: false,
                      message: e instanceof Error ? e.message : 'Connection test failed.',
                    });
                  } finally {
                    setAiTesting(false);
                  }
                }}
              >
                {aiTesting ? 'Testing…' : '🔌 Test Connection'}
              </button>
            </div>
            {aiTestResult && (
              <p className={`settings-hint ${aiTestResult.ok ? 'ai-test-ok' : 'ai-test-err'}`}>
                {aiTestResult.message}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="settings-group">
        <h3>💭 Rappel « Souviens-toi »</h3>
        <p className="settings-hint">
          Un rappel journalier qui te ressort tes accomplissements passés (wins, journal, records) à la
          même date — pour t'ancrer dans le présent sans oublier ce que tu as déjà construit.
        </p>
        <div className="settings-row">
          <label className="settings-check">
            <input
              type="checkbox"
              checked={!!aiPrefs.memoryReminderEnabled}
              onChange={(e) => {
                const next = { ...aiPrefs, memoryReminderEnabled: e.target.checked };
                setAiPrefs(next);
                updatePreferences(next);
              }}
            />
            <span>Activer le rappel quotidien</span>
          </label>
        </div>
        <div className="settings-row">
          <label className="settings-field">
            <span>Heure du rappel</span>
            <input
              type="time"
              className="settings-text-input"
              value={aiPrefs.memoryReminderTime ?? '20:00'}
              onChange={(e) => {
                const next = { ...aiPrefs, memoryReminderTime: e.target.value };
                setAiPrefs(next);
                updatePreferences(next);
              }}
            />
          </label>
        </div>
      </div>

      {/* MANTRAS */}
      {activeTab === 'mantras' && (
        <div className="settings-panel">
          <div className="settings-group">
            <h3>Daily Mantra Banner</h3>
            <div className="settings-row">
              <span>Show mantra on app entry</span>
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={mantraSettings.showOnEntry}
                  onChange={(e) => handleMantraSetting('showOnEntry', e.target.checked)}
                />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
          </div>

          <div className="settings-group">
            <h3>🌅 Morning Notification</h3>
            <div className="settings-row">
              <span>Enabled</span>
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={mantraSettings.morningEnabled}
                  onChange={(e) => handleMantraSetting('morningEnabled', e.target.checked)}
                />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <span>Time</span>
              <input
                type="time"
                className="mantra-time-input"
                value={mantraSettings.morningTime}
                onChange={(e) => handleMantraSetting('morningTime', e.target.value)}
              />
            </div>
          </div>

          <div className="settings-group">
            <h3>🌙 Evening Notification</h3>
            <div className="settings-row">
              <span>Enabled</span>
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={mantraSettings.eveningEnabled}
                  onChange={(e) => handleMantraSetting('eveningEnabled', e.target.checked)}
                />
                <span className="mantra-toggle-slider" />
              </label>
            </div>
            <div className="settings-row">
              <span>Time</span>
              <input
                type="time"
                className="mantra-time-input"
                value={mantraSettings.eveningTime}
                onChange={(e) => handleMantraSetting('eveningTime', e.target.value)}
              />
            </div>
          </div>

          <div className="settings-group">
            <button className="btn btn-ghost" onClick={onViewMantras}>
              🧘 Open Mantras Manager →
            </button>
          </div>
        </div>
      )}

      {/* DATA */}
      {activeTab === 'data' && (
        <div className="settings-panel">
          <div className="settings-group">
            <h3>Santé des données</h3>
            {(() => {
              const habits = getHabits();
              const hIds = new Set(habits.map((h) => h.id));
              const ci = exportAllData().checkIns ?? [];
              const orphans = ci.filter((c) => !hIds.has(c.habitId)).length;
              const seen = new Set<string>();
              let dups = 0;
              for (const c of ci) {
                const k = `${c.habitId}|${c.date}`;
                if (seen.has(k)) dups++;
                else seen.add(k);
              }
              const future = ci.filter((c) => c.date > new Date().toISOString().slice(0, 10)).length;
              const ok = orphans === 0 && future === 0;
              return (
                <p className="settings-hint" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>✓ {ci.length} check-ins</span>
                  <span>{orphans === 0 ? '✓' : '⚠'} {orphans} orphelin(s)</span>
                  <span>{dups === 0 ? '✓' : '⚠'} {dups} doublon(s) jour</span>
                  <span>{future === 0 ? '✓' : '⚠'} {future} datés dans le futur</span>
                  {ok && <span style={{ color: 'var(--text-muted)' }}>— base saine</span>}
                </p>
              );
            })()}
          </div>
          <div className="settings-group">
            <h3>Export</h3>
            <p className="settings-hint">Save your data as a file you can keep anywhere.</p>
            <div className="settings-actions">
              <button className="btn btn-primary" onClick={onExportJSON}>Export JSON</button>
              <button className="btn btn-ghost" onClick={onExportCSV}>Export CSV</button>
            </div>
          </div>

          <div className="settings-group">
            <h3>Import / Restore</h3>
            <p className="settings-hint">Restore habits from a previously exported JSON file.</p>
            <div className="settings-actions">
              <button className="btn btn-primary" onClick={onImportJSON}>Import JSON</button>
              <button className="btn btn-ghost" onClick={onRestoreBackup}>Restore from Backup</button>
            </div>
          </div>

          <div className="settings-group">
            <h3>Manual Backup</h3>
            <p className="settings-hint">Force an immediate backup to all locations now.</p>
            <div className="settings-actions">
              <button className="btn btn-primary" onClick={() => {
                flushSave();
                // Trigger auto_backup via Tauri
                const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
                if (isTauriEnv) {
                  import('@tauri-apps/api/core').then(({ invoke }) => {
                    invoke('auto_backup', { jsonData: JSON.stringify(exportAllData(), null, 2) });
                  }).catch(() => {});
                }
                setLastSaved('Saved just now');
              }}>💾 Backup Now</button>
              <button className="btn btn-ghost" onClick={() => {
                flushSave();
                setLastSaved('Saved just now');
              }}>Force Save</button>
            </div>
          </div>

          <div className="settings-group">
            <h3>🔬 Data Health Monitor</h3>
            <p className="settings-hint">État en temps réel de toutes vos données locales.</p>
            {(() => {
              try {
                const data = exportAllData() as unknown as Record<string, unknown>;
                const storeSizeKB = Math.round(JSON.stringify(data).length / 1024);
                const rows: { label: string; value: string | number }[] = [
                  { label: 'Habitudes', value: ((data.habits as unknown[]) ?? []).length },
                  { label: 'Check-ins', value: ((data.checkIns as unknown[]) ?? []).length },
                  { label: 'Notes', value: ((data.notes as unknown[]) ?? []).length },
                  { label: 'Humeurs', value: Object.keys((data.moods as Record<string, unknown>) ?? {}).length },
                  { label: 'Expériences', value: ((data.experiments as unknown[]) ?? []).length },
                  { label: 'Urges', value: ((data.urges as unknown[]) ?? []).length },
                  { label: 'Journal', value: ((data.journalEntries as unknown[]) ?? []).length },
                  { label: 'Protocoles', value: ((data.protocols as unknown[]) ?? []).length },
                  { label: 'Taille totale', value: `${storeSizeKB} KB` },
                  { label: 'Statut stockage', value: storageStatus },
                  { label: 'Dernier enregistrement', value: lastSaved },
                ];
                return (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', marginBottom: '1rem' }}>
                      {rows.map(r => (
                        <div key={r.label} className="settings-row" style={{ padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{r.label}</span>
                          <span className={`settings-mono ${r.label === 'Statut stockage' ? `storage-badge storage-${r.value}` : ''}`} style={{ fontSize: '0.85rem' }}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              } catch {
                return <p className="settings-hint">Impossible de lire les données.</p>;
              }
            })()}
          </div>

          <div className="settings-group settings-danger">
            <h3>⚠️ Danger Zone</h3>
            <p className="settings-hint">This will permanently delete all your habits, check-ins, and notes. Make sure you have an export first.</p>
            <button
              className={`btn ${confirmReset ? 'btn-danger' : 'btn-ghost'}`}
              onClick={handleResetData}
            >
              {confirmReset ? '⚠️ Click again to confirm DELETE ALL DATA' : 'Clear All Data'}
            </button>
            {confirmReset && (
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)} style={{ marginLeft: 8 }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* BACKUPS */}
      {activeTab === 'backups' && (
        <div className="settings-panel">
          <div className="settings-group">
            <h3>Automatic Backup Locations</h3>
            <p className="settings-hint">
              LifeTrack saves your data automatically every 15 minutes and after every change.
              Here are all the places your backups live:
            </p>
            <div className="backup-locations">
              <div className="backup-loc">
                <span className="backup-loc-icon">📁</span>
                <div>
                  <strong>AppData</strong>
                  <p>%APPDATA%\com.lemniscate.lifetrack\backups\</p>
                  <span className="backup-tag">10 backups kept</span>
                </div>
              </div>
              <div className="backup-loc">
                <span className="backup-loc-icon">📄</span>
                <div>
                  <strong>Documents</strong>
                  <p>Documents\LifeTrack-Backups\</p>
                  <span className="backup-tag">20 backups kept · survives AppData wipe</span>
                </div>
              </div>
              <div className="backup-loc">
                <span className="backup-loc-icon">🖥️</span>
                <div>
                  <strong>Desktop</strong>
                  <p>Desktop\LifeTrack-Backups\</p>
                  <span className="backup-tag">10 backups kept · easy to find</span>
                </div>
              </div>
              <div className="backup-loc">
                <span className="backup-loc-icon">☁️</span>
                <div>
                  <strong>Dropbox</strong>
                  <p>Dropbox\Apps\LifeTrack\</p>
                  <span className="backup-tag">30 backups kept · cloud-synced · auto-detected</span>
                </div>
              </div>
              <div className="backup-loc">
                <span className="backup-loc-icon">☁️</span>
                <div>
                  <strong>OneDrive</strong>
                  <p>OneDrive\Apps\LifeTrack\</p>
                  <span className="backup-tag">30 backups kept · cloud-synced · auto-detected</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ASTRO — natal chart for whole-sign transit houses */}
      {activeTab === 'astro' && (
        <div className="settings-panel">
          <div className="settings-group">
            <h3>🔯 Thème natal (maisons whole sign)</h3>
            <p className="settings-hint">
              Renseigne ta date, heure et lieu de naissance pour que LifeTrack calcule ton
              Ascendant et active les <strong>maisons whole sign</strong> dans les Missions
              (ex: « Mars en Bélier, maison 7 »). Sans thème, les transits restent
              « planète en signe ».
            </p>
            <div className="settings-row">
              <span>Date de naissance</span>
              <input type="date" className="text-input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>
            <div className="settings-row">
              <span>Heure de naissance (optionnel, précise l'Ascendant)</span>
              <input type="time" className="text-input" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} />
            </div>
            <div className="settings-row">
              <span>Latitude (ex: 48.85 pour Paris, 45.76 pour Lyon)</span>
              <input type="text" inputMode="decimal" className="text-input" placeholder="48.85" value={birthLat} onChange={(e) => setBirthLat(e.target.value)} style={{ width: '140px' }} />
            </div>
            <div className="settings-row">
              <span>Longitude (ex: 2.35 pour Paris — est positif)</span>
              <input type="text" inputMode="decimal" className="text-input" placeholder="2.35" value={birthLon} onChange={(e) => setBirthLon(e.target.value)} style={{ width: '140px' }} />
            </div>
            <div className="settings-row">
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {(() => {
                  const lat = Number(birthLat.replace(',', '.'));
                  const lon = Number(birthLon.replace(',', '.'));
                  if (!birthDate || !Number.isFinite(lat) || !Number.isFinite(lon)) {
                    return "⚠️ Il manque la date et le lieu pour calculer l'Ascendant.";
                  }
                  try {
                    const asc = ascendantLongitude(new Date(`${birthDate}T${birthTime || '12:00'}:00`), { lat, lon });
                    return `♈ Ton Ascendant calculé : ${signOfLongitude(asc).emoji} ${signOfLongitude(asc).name} (${asc.toFixed(1)}°) — les maisons whole sign sont actives.`;
                  } catch {
                    return "⚠️ Impossible de calculer l'Ascendant (valeurs invalides).";
                  }
                })()}
              </span>
              <button className="btn btn-sm btn-primary" onClick={saveBirth}>💾 Enregistrer le thème</button>
            </div>
          </div>
        </div>
      )}

      {/* ABOUT */}
      {activeTab === 'about' && (
        <div className="settings-panel">
          <div className="settings-group settings-about">
            <div className="about-logo">
              <span className="about-life">Life</span><span className="about-track">Track</span>
            </div>
            <p className="about-version">Version {APP_VERSION}</p>
            <p className="about-desc">
              A local-first, privacy-respecting habit tracker for Windows.
              No cloud, no telemetry, no accounts. Your data stays on your machine.
            </p>
            <div className="about-stats">
              <div><strong>{INSIGHT_RULES_COUNT}</strong> insight rules</div>
              <div><strong>6</strong> mantra domains</div>
              <div><strong>6</strong> backup locations</div>
              <div><strong>9</strong> themes</div>
            </div>
            <p className="about-tech">
              Built with React 19 · TypeScript 6 · Tauri 2 · Rust · Vite 8
            </p>
            <p className="about-copy">
              © 2026 Lemniscate — MIT License
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
