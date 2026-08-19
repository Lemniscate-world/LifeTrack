// src/components/ViewTabs.tsx
// The top navigation bar of the app. Kept in its own component so App.tsx
// stays focused on state/wiring instead of 60 lines of tab buttons.

export type ViewKey =
  | 'today' | 'grid' | 'stats' | 'correlations' | 'gains' | 'history'
  | 'year' | 'challenge' | 'stacks' | 'skills' | 'chaos' | 'insights'
  | 'experiments' | 'urges' | 'journal' | 'mantras' | 'achievements'
  | 'settings' | 'psycho' | 'projects' | 'knowledge' | 'obsidian' | 'missions';

interface ViewTabsProps {
  view: ViewKey;
  onView: (view: ViewKey) => void;
}

const ACTIVE = (current: ViewKey, view: ViewKey) => `view-tab ${current === view ? 'active' : ''}`;

export default function ViewTabs({ view, onView }: ViewTabsProps) {
  return (
    <div className="view-tabs" role="tablist" aria-label="View selector">
      <button role="tab" aria-selected={view === 'today'} className={ACTIVE(view, 'today')} onClick={() => onView('today')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Today
      </button>
      <button role="tab" aria-selected={view === 'grid'} className={ACTIVE(view, 'grid')} onClick={() => onView('grid')}>Grid</button>
      <button role="tab" aria-selected={view === 'stats'} className={ACTIVE(view, 'stats')} onClick={() => onView('stats')}>Statistics</button>
      <button role="tab" aria-selected={view === 'correlations'} className={ACTIVE(view, 'correlations')} onClick={() => onView('correlations')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg> Corr.
      </button>
      <button role="tab" aria-selected={view === 'gains'} className={ACTIVE(view, 'gains')} onClick={() => onView('gains')}>📈 Gains</button>
      <button role="tab" aria-selected={view === 'history'} className={ACTIVE(view, 'history')} onClick={() => onView('history')}>History</button>
      <button role="tab" aria-selected={view === 'year'} className={ACTIVE(view, 'year')} onClick={() => onView('year')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Year
      </button>
      <button role="tab" aria-selected={view === 'challenge'} className={ACTIVE(view, 'challenge')} onClick={() => onView('challenge')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Challenges
      </button>
      <button role="tab" aria-selected={view === 'stacks'} className={ACTIVE(view, 'stacks')} onClick={() => onView('stacks')}>Stacks</button>
      <button role="tab" aria-selected={view === 'skills'} className={ACTIVE(view, 'skills')} onClick={() => onView('skills')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Skills
      </button>
      <button role="tab" aria-selected={view === 'insights'} className={ACTIVE(view, 'insights')} onClick={() => onView('insights')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg> Insights
      </button>
      <button role="tab" aria-selected={view === 'experiments'} className={ACTIVE(view, 'experiments')} onClick={() => onView('experiments')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Experiments
      </button>
      <button role="tab" aria-selected={view === 'urges'} className={ACTIVE(view, 'urges')} onClick={() => onView('urges')}>
        🌊 Urges
      </button>
      <button role="tab" aria-selected={view === 'journal'} className={ACTIVE(view, 'journal')} onClick={() => onView('journal')}>
        📓 Journal
      </button>
      <button role="tab" aria-selected={view === 'psycho'} className={ACTIVE(view, 'psycho')} onClick={() => onView('psycho')}>
        🧠 Psycho
      </button>
      <button role="tab" aria-selected={view === 'projects'} className={ACTIVE(view, 'projects')} onClick={() => onView('projects')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v11a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg> Projets
      </button>
      <button role="tab" aria-selected={view === 'knowledge'} className={ACTIVE(view, 'knowledge')} onClick={() => onView('knowledge')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg> Savoir
      </button>
      <button role="tab" aria-selected={view === 'obsidian'} className={ACTIVE(view, 'obsidian')} onClick={() => onView('obsidian')}>
        📓 Obsidian
      </button>
      <button role="tab" aria-selected={view === 'missions'} className={ACTIVE(view, 'missions')} onClick={() => onView('missions')}>
        🚀 Missions
      </button>
      <button role="tab" aria-selected={view === 'chaos'} className={ACTIVE(view, 'chaos')} onClick={() => onView('chaos')}>Chaos</button>
      <button role="tab" aria-selected={view === 'mantras'} className={ACTIVE(view, 'mantras')} onClick={() => onView('mantras')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4.5 12.5l3 3 5-7"/><circle cx="12" cy="12" r="10"/></svg> Mantras
      </button>
      <button role="tab" aria-selected={view === 'achievements'} className={ACTIVE(view, 'achievements')} onClick={() => onView('achievements')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15a7 7 0 100-14 7 7 0 000 14z"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/></svg> Achievements
      </button>
      <button role="tab" aria-selected={view === 'settings'} className={ACTIVE(view, 'settings')} onClick={() => onView('settings')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> Settings
      </button>
    </div>
  );
}
