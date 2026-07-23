interface ShortcutsHelpProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl+1..9,0', desc: 'Switch tabs' },
  { keys: 'Space', desc: 'Toggle check-in on focused day' },
  { keys: '← → ↑ ↓', desc: 'Navigate grid cells' },
  { keys: 'Ctrl+Z', desc: 'Undo last toggle' },
  { keys: 'Ctrl+Y', desc: 'Redo last undo' },
  { keys: 'Ctrl+N', desc: 'Add new habit' },
  { keys: 'Ctrl+S', desc: 'Force save' },
  { keys: '?', desc: 'Show/hide this help' },
  { keys: 'Esc', desc: 'Close any editor' },
];

export default function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>⌨️ Keyboard Shortcuts</h2>
          <button className="shortcuts-close" onClick={onClose}>×</button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="shortcuts-row">
              <kbd className="shortcuts-key">{s.keys}</kbd>
              <span className="shortcuts-desc">{s.desc}</span>
            </div>
          ))}
        </div>
        <p className="shortcuts-hint">Press <kbd>?</kbd> anytime to show this help.</p>
      </div>
    </div>
  );
}
