import { useState, useEffect } from 'react';
import {
  getStorageStatus,
  getMantraSettings,
  updateMantraSettings,
  getLastSaved,
  flushSave,
  exportAllData,
  listUpgradeBackups,
} from './store';
import type { MantraSettings } from './types';

const THEMES = ['', 'theme-ocean', 'theme-forest', 'theme-sunset', 'theme-rose', 'theme-mono', 'theme-midnight', 'theme-emerald'];
const THEME_LABELS = ['Default', 'Ocean', 'Forest', 'Sunset', 'Rose', 'Mono', 'Midnight', 'Emerald'];

interface SettingsViewProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  theme: string;
  // eslint-disable-next-line no-unused-vars
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
  const [activeTab, setActiveTab] = useState<'appearance' | 'mantras' | 'data' | 'backups' | 'about'>('appearance');
  const [confirmReset, setConfirmReset] = useState(false);

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
    { id: 'mantras' as const, label: '🧘 Mantras' },
    { id: 'data' as const, label: '💾 Data' },
    { id: 'backups' as const, label: '🛡️ Backups' },
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
        </div>
      )}

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
            <h3>Storage Health</h3>
            <div className="settings-row">
              <span>Status</span>
              <span className={`storage-badge storage-${storageStatus}`}>{storageStatus}</span>
            </div>
            <div className="settings-row">
              <span>Last saved</span>
              <span className="settings-mono">{lastSaved}</span>
            </div>
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

      {/* ABOUT */}
      {activeTab === 'about' && (
        <div className="settings-panel">
          <div className="settings-group settings-about">
            <div className="about-logo">
              <span className="about-life">Life</span><span className="about-track">Track</span>
            </div>
            <p className="about-version">Version 0.2.1</p>
            <p className="about-desc">
              A local-first, privacy-respecting habit tracker for Windows.
              No cloud, no telemetry, no accounts. Your data stays on your machine.
            </p>
            <div className="about-stats">
              <div><strong>12</strong> insight rules</div>
              <div><strong>6</strong> mantra domains</div>
              <div><strong>4</strong> backup locations</div>
              <div><strong>8</strong> themes</div>
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
