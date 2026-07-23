import React, { useState, useEffect, useMemo } from 'react';
import type { Skill } from './types';
import type { SkillProgress, CapacityProgress } from './store';
import {
  getSkills,
  addSkill,
  updateSkill,
  deleteSkill,
  computeSkillProgress,
  getHabits,
  subscribe,
  toggleCheckIn,
  getCheckIn,
  getCapacities,
  addCapacity,
  updateCapacity,
  deleteCapacity,
  computeCapacityProgress,
  logCapacityObservation,
  deleteCapacityRating,
} from './store';

// helper to get a textual title for each level tier
function getLevelTier(level: number): { title: string; color: string } {
  if (level >= 15) return { title: 'Legendary Master', color: '#EF4444' };
  if (level >= 10) return { title: 'Grandmaster', color: '#F59E0B' };
  if (level >= 6) return { title: 'Master', color: '#8B5CF6' };
  if (level >= 3) return { title: 'Practitioner', color: '#3B82F6' };
  return { title: 'Novice', color: '#10B981' };
}

export default function SkillsView() {
  const [tick, setTick] = useState(0);
  const [activeTab, setActiveTab] = useState<'browse' | 'create'>('browse');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [editSkillId, setEditSkillId] = useState<string | null>(null);

  // Form states for creating a new skill
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillEmoji, setNewSkillEmoji] = useState('🧠');
  const [newSkillColor, setNewSkillColor] = useState('#EDE9FE');
  
  // Link habit state
  const [linkHabitId, setLinkHabitId] = useState('');
  const [linkXpWeight, setLinkXpWeight] = useState(10);

  // Form states for editing a skill
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editColor, setEditColor] = useState('');

  // Capacity form states
  const [showCapacityForm, setShowCapacityForm] = useState(false);
  const [capName, setCapName] = useState('');
  const [capDesc, setCapDesc] = useState('');
  const [capUnit, setCapUnit] = useState('1-10');
  const [capBaseline, setCapBaseline] = useState(3);
  const [capTarget, setCapTarget] = useState(8);
  const [editingCapId, setEditingCapId] = useState<string | null>(null);
  // Per-capacity rating input state: capacityId → { rating, note }
  const [capRatingInputs, setCapRatingInputs] = useState<Record<string, { rating: string; note: string }>>({});

  useEffect(() => {
    const unsub = subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const habits = useMemo(() => getHabits(), [tick]);
  const skills = useMemo(() => getSkills(), [tick]);

  const skillProgresses = useMemo(() => {
    return skills.map((skill) => {
      const progress = computeSkillProgress(skill.id);
      return { skill, progress };
    }).filter(item => item.progress !== undefined) as { skill: Skill; progress: SkillProgress }[];
  }, [skills, tick]);

  const selectedItem = useMemo(() => {
    if (!selectedSkillId) return null;
    return skillProgresses.find((item) => item.skill.id === selectedSkillId) ?? null;
  }, [selectedSkillId, skillProgresses]);

  const unlinkedHabits = useMemo(() => {
    if (!selectedItem) return [];
    const linkedIds = new Set(selectedItem.skill.links.map((l) => l.habitId));
    return habits.filter((h) => !h.archived && !linkedIds.has(h.id));
  }, [selectedItem, habits]);

  // Set default form values when editing a skill
  const startEditSkill = (skill: Skill) => {
    setEditSkillId(skill.id);
    setEditName(skill.name);
    setEditDesc(skill.description);
    setEditEmoji(skill.emoji);
    setEditColor(skill.color);
  };

  const handleSaveEdit = () => {
    if (editSkillId && editName.trim()) {
      updateSkill(editSkillId, {
        name: editName.trim(),
        description: editDesc.trim(),
        emoji: editEmoji,
        color: editColor,
      });
      setEditSkillId(null);
    }
  };

  const handleCreateSkill = () => {
    if (newSkillName.trim()) {
      addSkill(
        newSkillName.trim(),
        newSkillDesc.trim(),
        newSkillEmoji,
        newSkillColor,
        []
      );
      // Reset fields and go to browse
      setNewSkillName('');
      setNewSkillDesc('');
      setNewSkillEmoji('🧠');
      setNewSkillColor('#EDE9FE');
      setActiveTab('browse');
    }
  };

  const handleLinkHabit = () => {
    if (selectedItem && linkHabitId) {
      const updatedLinks = [...selectedItem.skill.links, { habitId: linkHabitId, xpPerCompletion: linkXpWeight }];
      updateSkill(selectedItem.skill.id, { links: updatedLinks });
      setLinkHabitId('');
      setLinkXpWeight(10);
    }
  };

  const handleUnlinkHabit = (habitId: string) => {
    if (selectedItem) {
      const updatedLinks = selectedItem.skill.links.filter((l) => l.habitId !== habitId);
      updateSkill(selectedItem.skill.id, { links: updatedLinks });
    }
  };

  const handleUpdateLinkWeight = (habitId: string, newWeight: number) => {
    if (selectedItem) {
      const updatedLinks = selectedItem.skill.links.map((l) =>
        l.habitId === habitId ? { ...l, xpPerCompletion: newWeight } : l
      );
      updateSkill(selectedItem.skill.id, { links: updatedLinks });
    }
  };

  // --- Capacity handlers ---
  const capacities = useMemo(
    () => (selectedSkillId ? getCapacities(selectedSkillId) : []),
    [selectedSkillId, tick],
  );
  const capacityProgresses = useMemo(() => {
    return capacities.map((c) => ({ capacity: c, progress: computeCapacityProgress(c.id) }))
      .filter((x) => x.progress !== null) as { capacity: typeof capacities[0]; progress: CapacityProgress }[];
  }, [capacities, tick]);

  const handleAddCapacity = () => {
    if (!selectedSkillId || !capName.trim()) return;
    if (editingCapId) {
      updateCapacity(editingCapId, {
        name: capName.trim(),
        description: capDesc.trim(),
        unit: capUnit.trim() || '1-10',
        baseline: capBaseline,
        target: capTarget,
      });
      setEditingCapId(null);
    } else {
      addCapacity(selectedSkillId, capName.trim(), capDesc.trim(), capUnit.trim() || '1-10', capBaseline, capTarget);
    }
    setCapName('');
    setCapDesc('');
    setCapUnit('1-10');
    setCapBaseline(3);
    setCapTarget(8);
    setShowCapacityForm(false);
  };

  const handleEditCapacity = (capId: string) => {
    const cap = capacities.find((c) => c.id === capId);
    if (!cap) return;
    setCapName(cap.name);
    setCapDesc(cap.description);
    setCapUnit(cap.unit);
    setCapBaseline(cap.baseline);
    setCapTarget(cap.target);
    setEditingCapId(capId);
    setShowCapacityForm(true);
  };

  const handleRateCapacity = (capacityId: string) => {
    const input = capRatingInputs[capacityId];
    if (!input) return;
    const ratingNum = input.rating ? parseInt(input.rating, 10) : undefined;
    const note = input.note?.trim() || undefined;
    if (ratingNum === undefined && !note) return;
    logCapacityObservation(capacityId, { rating: ratingNum, note });
    setCapRatingInputs((prev) => {
      const next = { ...prev };
      delete next[capacityId];
      return next;
    });
  };

  const setCapRatingField = (capacityId: string, field: 'rating' | 'note', value: string) => {
    setCapRatingInputs((prev) => ({
      ...prev,
      [capacityId]: { ...(prev[capacityId] || { rating: '', note: '' }), [field]: value },
    }));
  };

  const applyTemplate = (template: { name: string; desc: string; emoji: string; color: string }) => {
    setNewSkillName(template.name);
    setNewSkillDesc(template.desc);
    setNewSkillEmoji(template.emoji);
    setNewSkillColor(template.color);
  };

  const templates = [
    { name: 'Mindfulness', desc: 'Training the mind to be present, note thoughts, and recognize mental patterns.', emoji: '🧠', color: '#EDE9FE' },
    { name: 'Physical Fitness', desc: 'Building physical capacity, endurance, and strength through body movement.', emoji: '💪', color: '#D1FAE5' },
    { name: 'Deep Work & Focus', desc: 'Developing cognitive stamina to focus intensely on complex tasks without distraction.', emoji: '⚡', color: '#DBEAFE' },
    { name: 'Knowledge Acquisition', desc: 'Expanding mental models, reading, and learning new concepts and tools.', emoji: '📚', color: '#FEF3C7' },
    { name: 'Mental Resilience', desc: 'Strengthening emotional regulation, gratitude, and stress management.', emoji: '🌱', color: '#FCE7F3' },
  ];

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  return (
    <div className="skills-view" aria-label="Skills and Capacities Dashboard">
      <div className="skills-header">
        <div className="skills-headline">
          <h2>💪 Skills & Capacities</h2>
          <p className="skills-subtitle">
            Sculpt your capabilities by practicing daily habits. Earn XP and level up.
          </p>
        </div>
        <div className="skills-nav-buttons">
          <button
            className={`btn btn-sm ${activeTab === 'browse' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setActiveTab('browse'); setSelectedSkillId(null); }}
          >
            📋 Browse Skills
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'create' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('create')}
          >
            ➕ Create Custom Skill
          </button>
        </div>
      </div>

      {activeTab === 'browse' && (
        <div className="skills-container">
          <div className="skills-grid">
            {skillProgresses.map(({ skill, progress }) => {
              const tier = getLevelTier(progress.level);
              return (
                <div
                  key={skill.id}
                  className="skill-card"
                  style={{ '--skill-color': skill.color } as React.CSSProperties}
                  onClick={() => setSelectedSkillId(skill.id)}
                >
                  <div className="skill-card-banner" style={{ backgroundColor: skill.color }} />
                  <div className="skill-card-avatar-wrapper">
                    <div className="skill-card-avatar">{skill.emoji}</div>
                  </div>
                  <div className="skill-card-body">
                    <div className="skill-card-meta">
                      <h3>{skill.name}</h3>
                      <span className="skill-level-badge" style={{ backgroundColor: `${tier.color}15`, color: tier.color }}>
                        Lvl {progress.level} · {tier.title}
                      </span>
                    </div>
                    <p className="skill-card-description">{skill.description}</p>
                    
                    {/* Progress Bar */}
                    <div className="skill-progress-bar-container">
                      <div className="skill-progress-bar-labels">
                        <span>{progress.totalXp} XP</span>
                        <span>Next: {progress.nextLevelXp} XP</span>
                      </div>
                      <div className="skill-progress-track">
                        <div
                          className="skill-progress-fill"
                          style={{ width: `${progress.progressPct}%`, backgroundColor: skill.color }}
                        />
                      </div>
                    </div>

                    <div className="skill-card-footer">
                      <span>🔗 {skill.links.length} Habit{skill.links.length !== 1 ? 's' : ''} Linked</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {skills.length === 0 && (
            <div className="skills-empty-state">
              <p>No skills created yet.</p>
              <button className="btn btn-primary" onClick={() => setActiveTab('create')}>
                Create your first skill
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'create' && (
        <div className="skills-create-panel">
          <div className="skills-create-grid">
            {/* Template Picker */}
            <div className="skills-templates-card">
              <h3>Templates</h3>
              <p className="template-hint">Choose a pre-configured template to start quickly:</p>
              <div className="template-list">
                {templates.map((tpl, i) => (
                  <button key={i} className="template-item" onClick={() => applyTemplate(tpl)}>
                    <span className="template-emoji">{tpl.emoji}</span>
                    <div className="template-info">
                      <span className="template-name">{tpl.name}</span>
                      <span className="template-desc">{tpl.desc.substring(0, 50)}...</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom creation form */}
            <div className="skills-form-card">
              <h3>Create Custom Skill</h3>
              <div className="form-group">
                <label htmlFor="skill-name-input">Skill Name</label>
                <input
                  id="skill-name-input"
                  type="text"
                  placeholder="e.g. Focus & Clarity"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="skill-desc-input">Description</label>
                <textarea
                  id="skill-desc-input"
                  placeholder="What capacity does this represent?"
                  value={newSkillDesc}
                  onChange={(e) => setNewSkillDesc(e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="skill-emoji-input">Emoji Icon</label>
                  <input
                    id="skill-emoji-input"
                    type="text"
                    placeholder="🧠"
                    maxLength={2}
                    value={newSkillEmoji}
                    onChange={(e) => setNewSkillEmoji(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="skill-color-input">Color Accent</label>
                  <div className="color-picker-row">
                    <input
                      id="skill-color-input"
                      type="color"
                      value={newSkillColor}
                      onChange={(e) => setNewSkillColor(e.target.value)}
                    />
                    <div className="color-presets">
                      {['#EDE9FE', '#D1FAE5', '#DBEAFE', '#FEF3C7', '#FCE7F3', '#FEE2E2'].map((colorPreset) => (
                        <button
                          key={colorPreset}
                          type="button"
                          className={`preset-btn ${newSkillColor === colorPreset ? 'selected' : ''}`}
                          style={{ backgroundColor: colorPreset }}
                          onClick={() => setNewSkillColor(colorPreset)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <button
                className="btn btn-primary create-skill-submit-btn"
                disabled={!newSkillName.trim()}
                onClick={handleCreateSkill}
              >
                Create Skill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Detail Modal Overlay */}
      {selectedItem && (
        <div className="skill-modal-overlay" onClick={() => setSelectedSkillId(null)}>
          <div className="skill-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="skill-modal-close" onClick={() => setSelectedSkillId(null)}>×</button>

            {editSkillId === selectedItem.skill.id ? (
              <div className="skill-edit-mode">
                <h3>Edit Skill Details</h3>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Emoji</label>
                    <input type="text" value={editEmoji} maxLength={2} onChange={(e) => setEditEmoji(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Color</label>
                    <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} />
                  </div>
                </div>
                <div className="edit-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}>Save Changes</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditSkillId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="skill-modal-header" style={{ '--skill-color': selectedItem.skill.color } as React.CSSProperties}>
                  <div className="skill-modal-avatar">{selectedItem.skill.emoji}</div>
                  <div className="skill-modal-heading">
                    <h2>{selectedItem.skill.name}</h2>
                    <span className="skill-level-badge large">
                      Level {selectedItem.progress.level} · {getLevelTier(selectedItem.progress.level).title}
                    </span>
                  </div>
                  <div className="skill-modal-actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => startEditSkill(selectedItem.skill)}>✏️ Edit</button>
                    {!selectedItem.skill.isDefault && (
                      <button
                        className="btn btn-sm btn-danger-ghost"
                        onClick={() => {
                          if (confirm(`Delete the skill "${selectedItem.skill.name}"?`)) {
                            deleteSkill(selectedItem.skill.id);
                            setSelectedSkillId(null);
                          }
                        }}
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                </div>

                <p className="skill-modal-description">{selectedItem.skill.description}</p>

                {/* Detailed XP bar */}
                <div className="skill-progress-bar-container large">
                  <div className="skill-progress-bar-labels">
                    <span>{selectedItem.progress.totalXp} XP (Current)</span>
                    <span>{selectedItem.progress.nextLevelXp - selectedItem.progress.totalXp} XP to Lvl {selectedItem.progress.level + 1}</span>
                  </div>
                  <div className="skill-progress-track">
                    <div
                      className="skill-progress-fill"
                      style={{ width: `${selectedItem.progress.progressPct}%`, backgroundColor: selectedItem.skill.color }}
                    />
                  </div>
                </div>

                {/* 30-Day XP History Bar Chart */}
                <div className="skill-history-section">
                  <h3>Recent Progression (Last 30 Days)</h3>
                  <div className="skill-history-chart-wrapper">
                    {(() => {
                      const history = selectedItem.progress.recentHistory;
                      const maxGain = Math.max(...history.map((h) => h.xpGained), 1);
                      return (
                        <div className="history-bars">
                          {history.map((day, idx) => {
                            const pct = (day.xpGained / maxGain) * 100;
                            return (
                              <div
                                key={idx}
                                className="history-bar-col"
                                title={`${day.date}: +${day.xpGained} XP`}
                              >
                                <div className="history-bar-fill-track">
                                  <div
                                    className="history-bar-fill"
                                    style={{
                                      height: `${day.xpGained > 0 ? Math.max(8, pct) : 0}%`,
                                      backgroundColor: day.xpGained > 0 ? selectedItem.skill.color : 'transparent'
                                    }}
                                  />
                                </div>
                                <span className="history-bar-dot" style={{ backgroundColor: day.xpGained > 0 ? selectedItem.skill.color : 'var(--border)' }} />
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  <p className="history-axis">30 days ago ➔ Today</p>
                </div>

                {/* Capacities Section */}
                <div className="capacities-section">
                  <div className="capacities-header">
                    <h3>🎯 Capacities (Micro-Abilities)</h3>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => { setShowCapacityForm(!showCapacityForm); setEditingCapId(null); setCapName(''); setCapDesc(''); setCapUnit('1-10'); setCapBaseline(3); setCapTarget(8); }}
                    >
                      {showCapacityForm ? '✕ Cancel' : '+ Add Capacity'}
                    </button>
                  </div>
                  <p className="capacities-subtitle">
                    Track specific sub-abilities under this skill. Rate yourself daily and watch your progress.
                  </p>

                  {showCapacityForm && (
                    <div className="capacity-form-card">
                      <h4>{editingCapId ? 'Edit Capacity' : 'New Capacity'}</h4>
                      <div className="capacity-form-grid">
                        <div className="form-group">
                          <label>Name</label>
                          <input
                            type="text"
                            placeholder="e.g. Pattern Detection"
                            value={capName}
                            onChange={(e) => setCapName(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Description</label>
                          <input
                            type="text"
                            placeholder="What does this capacity measure?"
                            value={capDesc}
                            onChange={(e) => setCapDesc(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Unit</label>
                          <input
                            type="text"
                            placeholder="1-10, minutes, count…"
                            value={capUnit}
                            onChange={(e) => setCapUnit(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Baseline</label>
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={capBaseline}
                            onChange={(e) => setCapBaseline(parseInt(e.target.value) || 0)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Target</label>
                          <input
                            type="number"
                            min={0}
                            max={1000}
                            value={capTarget}
                            onChange={(e) => setCapTarget(parseInt(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                      <div className="capacity-form-actions">
                        <button className="btn btn-sm btn-primary" onClick={handleAddCapacity}>
                          {editingCapId ? 'Save Changes' : 'Create Capacity'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => { setShowCapacityForm(false); setEditingCapId(null); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {capacityProgresses.length === 0 && !showCapacityForm && (
                    <p className="empty-panel-hint">No capacities defined yet. Add one to start tracking micro-abilities.</p>
                  )}

                  <div className="capacities-list">
                    {capacityProgresses.map(({ capacity, progress }) => {
                      const ratInput = capRatingInputs[capacity.id] || { rating: '', note: '' };
                      const lastRatings = progress.history.filter((h) => h.rating !== null).slice(-5);
                      const maxRating = Math.max(capacity.target, ...lastRatings.map((r) => r.rating!), 10);
                      return (
                        <div key={capacity.id} className="capacity-card">
                          <div className="capacity-card-top">
                            <div className="capacity-info">
                              <h4>{capacity.name}</h4>
                              <p className="capacity-desc">{capacity.description}</p>
                              <span className="capacity-meta">
                                {capacity.unit} · Baseline {capacity.baseline} → Target {capacity.target}
                                {progress.targetReached && <span className="capacity-reached-badge">✓ Reached!</span>}
                              </span>
                            </div>
                            <div className="capacity-actions">
                              <button className="btn btn-xs btn-ghost" onClick={() => handleEditCapacity(capacity.id)}>✏️</button>
                              <button
                                className="btn btn-xs btn-danger-ghost"
                                onClick={() => { if (confirm('Delete this capacity and all its ratings?')) deleteCapacity(capacity.id); }}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="capacity-progress-row">
                            <div className="skill-progress-bar-container small">
                              <div className="skill-progress-bar-labels">
                                <span>{progress.latestRating ?? '—'} {capacity.unit}</span>
                                <span>{Math.round(progress.progressPct)}% → {capacity.target}</span>
                              </div>
                              <div className="skill-progress-track">
                                <div
                                  className="skill-progress-fill"
                                  style={{
                                    width: `${Math.min(100, progress.progressPct)}%`,
                                    backgroundColor: selectedItem?.skill.color || '#8B5CF6',
                                  }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Sparkline */}
                          {progress.history.length > 0 && (
                            <div className="capacity-sparkline">
                              <div className="sparkline-bars">
                                {progress.history.slice(-14).map((day, idx) => {
                                  const pct = day.rating !== null
                                    ? (day.rating / maxRating) * 100
                                    : 0;
                                  return (
                                    <div
                                      key={idx}
                                      className="sparkline-bar-col"
                                      title={`${day.date}: ${day.rating ?? 'note only'}`}
                                    >
                                      <div className="sparkline-bar-track">
                                        <div
                                          className="sparkline-bar-fill"
                                          style={{
                                            height: `${day.rating !== null ? Math.max(4, pct) : 0}%`,
                                            backgroundColor: day.rating !== null
                                              ? (selectedItem?.skill.color || '#8B5CF6')
                                              : 'transparent',
                                          }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <span className="sparkline-label">
                                {progress.totalObservations} observation{progress.totalObservations !== 1 ? 's' : ''}
                                {progress.recentAverage !== null && ` · Avg last 5: ${progress.recentAverage.toFixed(1)}`}
                              </span>
                            </div>
                          )}

                          {/* Quick rate + note */}
                          <div className="capacity-rate-row">
                            <input
                              type="number"
                              className="capacity-rate-input"
                              placeholder="Rating"
                              min={0}
                              max={1000}
                              value={ratInput.rating}
                              onChange={(e) => setCapRatingField(capacity.id, 'rating', e.target.value)}
                            />
                            <input
                              type="text"
                              className="capacity-note-input"
                              placeholder="Note (optional)"
                              value={ratInput.note}
                              onChange={(e) => setCapRatingField(capacity.id, 'note', e.target.value)}
                            />
                            <button
                              className="btn btn-xs btn-primary"
                              disabled={!ratInput.rating && !ratInput.note}
                              onClick={() => handleRateCapacity(capacity.id)}
                            >
                              Log
                            </button>
                          </div>

                          {/* Observation log — all entries with delete */}
                          {progress.history.length > 0 && (
                            <div className="capacity-notes-log">
                              <span className="capacity-log-title">Observations</span>
                              {progress.history.slice().reverse().map((entry) => (
                                <div key={entry.id} className="capacity-note-entry">
                                  <span className="capacity-note-date">{entry.date}</span>
                                  {entry.rating !== null && (
                                    <span className="capacity-note-rating">{entry.rating}</span>
                                  )}
                                  {entry.note && (
                                    <span className="capacity-note-text">{entry.note}</span>
                                  )}
                                  <button
                                    className="btn-delete-log"
                                    title="Delete this entry"
                                    onClick={() => deleteCapacityRating(entry.id)}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="skill-associations-grid">
                  {/* Linked Habits List */}
                  <div className="linked-habits-panel">
                    <h3>Contributing Habits</h3>
                    <div className="linked-habits-list">
                      {selectedItem.progress.contributions.map((c) => {
                        const checkIn = getCheckIn(c.habitId, todayStr);
                        const isCompleted = checkIn?.completed ?? false;
                        
                        return (
                          <div key={c.habitId} className="linked-habit-row">
                            <span className="habit-indicator-dot" style={{ backgroundColor: c.habitColor }} />
                            <div className="linked-habit-info">
                              <span className="linked-habit-name">{c.habitName}</span>
                              <span className="linked-habit-stats">
                                {c.completions} completions · {c.xpContributed} XP total
                              </span>
                            </div>
                            <div className="linked-habit-actions">
                              {/* Quick complete */}
                              <button
                                className={`btn btn-xs quick-check-btn ${isCompleted ? 'checked' : ''}`}
                                style={{
                                  backgroundColor: isCompleted ? c.habitColor : 'transparent',
                                  borderColor: c.habitColor,
                                  color: isCompleted ? '#000' : 'inherit'
                                }}
                                onClick={() => toggleCheckIn(c.habitId, todayStr)}
                              >
                                {isCompleted ? '✓ Done' : 'Complete'}
                              </button>
                              
                              {/* Edit weight */}
                              <div className="weight-editor">
                                <label>Weight:</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={c.xpContributed / (c.completions || 1)}
                                  onChange={(e) => handleUpdateLinkWeight(c.habitId, Math.max(1, parseInt(e.target.value) || 1))}
                                />
                                <span>XP</span>
                              </div>
                              
                              {/* Unlink */}
                              <button
                                className="btn btn-xs btn-danger-ghost unlink-btn"
                                onClick={() => handleUnlinkHabit(c.habitId)}
                              >
                                Unlink
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {selectedItem.skill.links.length === 0 && (
                        <p className="empty-panel-hint">No habits linked to this skill yet.</p>
                      )}
                    </div>
                  </div>

                  {/* Link Habit Panel */}
                  <div className="link-habit-panel">
                    <h3>Link a Habit</h3>
                    {unlinkedHabits.length > 0 ? (
                      <div className="link-habit-form">
                        <div className="form-group">
                          <label htmlFor="habit-select">Select Habit</label>
                          <select
                            id="habit-select"
                            value={linkHabitId}
                            onChange={(e) => setLinkHabitId(e.target.value)}
                          >
                            <option value="">-- Choose Habit --</option>
                            {unlinkedHabits.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label htmlFor="weight-select">XP Weight per completion</label>
                          <div className="weight-slider-row">
                            <input
                              id="weight-select"
                              type="range"
                              min={5}
                              max={50}
                              step={5}
                              value={linkXpWeight}
                              onChange={(e) => setLinkXpWeight(parseInt(e.target.value))}
                            />
                            <span>{linkXpWeight} XP</span>
                          </div>
                          <p className="slider-hint">How much does completing this habit develop this skill?</p>
                        </div>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={!linkHabitId}
                          onClick={handleLinkHabit}
                        >
                          Link Habit
                        </button>
                      </div>
                    ) : (
                      <p className="empty-panel-hint">
                        All active habits are already linked to this skill, or you have no habits created.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
