import { useState, useMemo } from 'react';
import type { Mantra, MantraSettings } from './types';
import { MANTRA_DOMAINS, getAllDailyMantras } from './mantras';
import { getMantras, addMantra, deleteMantra, getMantraSettings, updateMantraSettings } from './store';

interface MantraViewProps {
  onDismiss?: () => void;
}

/**
 * MantraView — Daily mantra inspiration across life domains.
 * 
 * Displays today's mantras organized by domain. Users can toggle
 * notification settings and add/remove their own custom mantras.
 */
export default function MantraView({ onDismiss }: MantraViewProps) {
  const [mantras, setMantras] = useState<Mantra[]>(getMantras());
  const [settings, setSettings] = useState<MantraSettings>(getMantraSettings());
  const [newMantraText, setNewMantraText] = useState('');
  const [newMantraDomain, setNewMantraDomain] = useState(MANTRA_DOMAINS[0].id);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'daily' | 'manage' | 'settings'>('daily');
  // Confirmation of the last added mantra (id + domain name): the form proves
  // the save happened instead of leaving the user wondering.
  const [justAdded, setJustAdded] = useState<{ id: string; domainName: string } | null>(null);

  const refresh = () => {
    setMantras(getMantras());
    setSettings(getMantraSettings());
  };

  const dailyMantras = useMemo(() => getAllDailyMantras(mantras), [mantras]);

  const handleAddMantra = () => {
    const text = newMantraText.trim();
    if (!text) return;
    const created = addMantra(text, newMantraDomain);
    setNewMantraText('');
    // Show the proof: open the right domain, highlight the new row.
    setExpandedDomain(newMantraDomain);
    const domainName = MANTRA_DOMAINS.find((d) => d.id === newMantraDomain)?.name ?? newMantraDomain;
    setJustAdded({ id: created.id, domainName });
    refresh();
  };

  const handleDeleteMantra = (id: string) => {
    deleteMantra(id);
    refresh();
  };

  const handleToggleSetting = (key: keyof MantraSettings, value: boolean | string) => {
    updateMantraSettings({ [key]: value });
    refresh();
  };

  const domainMantras = useMemo(() => {
    const map = new Map<string, Mantra[]>();
    for (const domain of MANTRA_DOMAINS) {
      map.set(domain.id, mantras.filter((m) => m.domain === domain.id));
    }
    return map;
  }, [mantras]);

  return (
    <div className="mantra-view">
      <div className="mantra-header">
        <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{verticalAlign:'middle',marginRight:6}}><path d="M4.5 12.5l3 3 5-7"/><circle cx="12" cy="12" r="10"/></svg>Mantras</h2>
        <span className="mantra-subtitle">
          L'inspiration du jour, par domaine de vie
        </span>
        {onDismiss && (
          <button className="btn btn-sm btn-ghost mantra-dismiss" onClick={onDismiss}>
            Fermer
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mantra-tabs">
        <button
          className={`mantra-tab ${activeTab === 'daily' ? 'active' : ''}`}
          onClick={() => setActiveTab('daily')}
        >
          Aujourd'hui
        </button>
        <button
          className={`mantra-tab ${activeTab === 'manage' ? 'active' : ''}`}
          onClick={() => setActiveTab('manage')}
        >
          Gérer
        </button>
        <button
          className={`mantra-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Réglages
        </button>
      </div>

      {/* Today's Mantras Tab */}
      {activeTab === 'daily' && (
        <div className="mantra-daily">
          {dailyMantras.size === 0 ? (
            <div className="mantra-empty">
              <p>Aucun mantra. Va dans Gérer pour ajouter ton premier mantra !</p>
            </div>
          ) : (
            <div className="mantra-domain-list">
              {MANTRA_DOMAINS.map((domain) => {
                const mantra = dailyMantras.get(domain.id);
                if (!mantra) return null;
                return (
                  <div
                    key={domain.id}
                    className="mantra-domain-card"
                    style={{ borderLeftColor: domain.color }}
                  >
                    <div className="mantra-domain-header">
                      <span className="mantra-domain-icon">{domain.icon}</span>
                      <span className="mantra-domain-name">{domain.name}</span>
                    </div>
                    <blockquote className="mantra-text">
                      "{mantra.text}"
                    </blockquote>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Manage Tab */}
      {activeTab === 'manage' && (
        <div className="mantra-manage">
          {/* Add new mantra */}
          <div className="mantra-add-form">
            <h3>Ajoute ton mantra</h3>
            {justAdded && (
              <p className="mantra-just-added" role="status">
                ✓ Enregistré dans {justAdded.domainName} — le voilà ci-dessous.
              </p>
            )}
            <div className="mantra-add-row">
              <select
                className="mantra-domain-select"
                value={newMantraDomain}
                onChange={(e) => setNewMantraDomain(e.target.value)}
              >
                {MANTRA_DOMAINS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.icon} {d.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="mantra-text-input"
                placeholder="Écris ton mantra…"
                aria-label="Texte du nouveau mantra"
                value={newMantraText}
                onChange={(e) => setNewMantraText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddMantra();
                }}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={handleAddMantra}
                disabled={!newMantraText.trim()}
              >
                Ajouter
              </button>
            </div>
          </div>

          {/* Browse by domain */}
          <div className="mantra-browse">
            {MANTRA_DOMAINS.map((domain) => {
              const domainList = domainMantras.get(domain.id) || [];
              const isExpanded = expandedDomain === domain.id;
              return (
                <div key={domain.id} className="mantra-browse-domain">
                  <button
                    className="mantra-domain-toggle"
                    style={{ borderLeftColor: domain.color }}
                    onClick={() => setExpandedDomain(isExpanded ? null : domain.id)}
                  >
                    <span className="mantra-domain-icon">{domain.icon}</span>
                    <span className="mantra-domain-name">{domain.name}</span>
                    <span className="mantra-domain-count">{domainList.length}</span>
                    <span className="mantra-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                  </button>
                  {isExpanded && (
                    <div className="mantra-domain-items">
                      {domainList.length === 0 ? (
                        <p className="mantra-empty-domain">Aucun mantra dans ce domaine.</p>
                      ) : (
                        domainList.map((m) => (
                          <div key={m.id} className={`mantra-item${justAdded?.id === m.id ? ' just-added' : ''}`}>
                            <span className="mantra-item-text">« {m.text} »</span>
                            <span className="mantra-item-meta">
                              {m.isDefault ? (
                                <span className="mantra-badge-default" title="Mantra intégré">défaut</span>
                              ) : (
                                <span className="mantra-badge-custom" title="Ton mantra">à toi</span>
                              )}
                            </span>
                            {!m.isDefault && (
                              <button
                                className="mantra-delete-btn"
                                onClick={() => handleDeleteMantra(m.id)}
                                title="Supprimer ce mantra"
                                aria-label={`Supprimer ${m.text}`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="mantra-settings">
          <h3>Rappels</h3>
          <p className="mantra-settings-desc">
            Reçois un mantra chaque jour pour rester inspiré.
          </p>

          <div className="mantra-setting-row">
            <label className="mantra-setting-label">
              <span className="mantra-setting-icon">🌅</span>
              <span>Rappel du matin</span>
            </label>
            <div className="mantra-setting-controls">
              <input
                type="time"
                className="mantra-time-input"
                value={settings.morningTime}
                onChange={(e) => handleToggleSetting('morningTime', e.target.value)}
              />
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={settings.morningEnabled}
                  onChange={(e) => handleToggleSetting('morningEnabled', e.target.checked)}
                />
                <span className="mantra-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="mantra-setting-row">
            <label className="mantra-setting-label">
              <span className="mantra-setting-icon">🌙</span>
              <span>Rappel du soir</span>
            </label>
            <div className="mantra-setting-controls">
              <input
                type="time"
                className="mantra-time-input"
                value={settings.eveningTime}
                onChange={(e) => handleToggleSetting('eveningTime', e.target.value)}
              />
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={settings.eveningEnabled}
                  onChange={(e) => handleToggleSetting('eveningEnabled', e.target.checked)}
                />
                <span className="mantra-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="mantra-setting-row">
            <label className="mantra-setting-label">
              <span className="mantra-setting-icon">👋</span>
              <span>Afficher un mantra à l'ouverture</span>
            </label>
            <div className="mantra-setting-controls">
              <label className="mantra-toggle">
                <input
                  type="checkbox"
                  checked={settings.showOnEntry}
                  onChange={(e) => handleToggleSetting('showOnEntry', e.target.checked)}
                />
                <span className="mantra-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div className="mantra-settings-info">
            <p>
              💡 <strong>Comment ça marche :</strong> les rappels s'affichent dans l'appli
              en douceur. Pour des notifications système, active-les dans ton navigateur/OS
              et garde LifeTrack ouvert.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
