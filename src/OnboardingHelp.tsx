// OnboardingHelp — guided tutorial for new LifeTrack users.
// Explains key features step by step. Dismissable, shown only once.
import { useState } from 'react';

interface Step {
  title: string;
  emoji: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to LifeTrack',
    emoji: '🌱',
    body: 'LifeTrack is a local-first habit tracker designed for deep self-observation. No cloud, no ads, no telemetry — your data stays on your machine.',
  },
  {
    title: 'The Grid — Your Month at a Glance',
    emoji: '📅',
    body: 'Each row is a habit. Each cell is a day. Click to check it off. Right-click to add notes. Use the grip icon (⋮⋮) to drag and reorder habits.',
  },
  {
    title: 'Multi-click & Streaks',
    emoji: '🔥',
    body: 'Enable multi-click (＋ button) to count repetitions per day (e.g., 3 glasses of water). Streaks turn cells brighter — 3 levels of intensity up to a glowing 30-day streak.',
  },
  {
    title: 'Notes & Observations',
    emoji: '📝',
    body: 'Right-click any cell to log observations. You can add MULTIPLE notes per day — perfect for tracking patterns, triggers, and insights. A yellow dot ● appears on cells with notes.',
  },
  {
    title: 'Mood & Chaos Tracking',
    emoji: '🎭',
    body: 'The Mood row at the bottom lets you log your emotional state each day. Chaos dimensions (Physical, Financial, Social, etc.) help you see which life areas need attention.',
  },
  {
    title: 'Urge Surfing 🌊',
    emoji: '🌊',
    body: 'When you feel a craving or impulse, log it in the Urges tab. Ride the wave instead of acting on it. Link counter-habits to help you redirect.',
  },
  {
    title: 'Backups — Your Data is Safe',
    emoji: '🛡️',
    body: 'LifeTrack automatically backs up to 8 locations: Documents, Desktop, Dropbox, OneDrive, Google Drive, and more. Even if you reinstall, your data comes back. Nothing is ever lost.',
  },
  {
    title: 'Stacks & Categories',
    emoji: '🔗',
    body: 'Chain habits together with Stacks (e.g., "After Coffee → Meditate"). Group habits by category (Health, Work, Learning...) using the dropdown in each row.',
  },
  {
    title: 'Keyboard Shortcuts',
    emoji: '⌨️',
    body: 'Ctrl+N: new habit · Space: toggle · Ctrl+1-9: switch tabs · Ctrl+Z: undo · Ctrl+S: force save · ?: this help. Arrow keys: navigate the grid.',
  },
  {
    title: 'You\'re All Set!',
    emoji: '🚀',
    body: 'Start small — pick 3 habits and track them daily. The key is consistency, not perfection. Missed a day? That\'s a data point, not a failure.',
  },
];

interface Props {
  onDismiss: () => void;
}

export default function OnboardingHelp({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="onboarding-overlay" onClick={onDismiss}>
      <div className="onboarding-card" onClick={e => e.stopPropagation()}>
        <div className="onboarding-emoji">{current.emoji}</div>
        <h2 className="onboarding-title">{current.title}</h2>
        <p className="onboarding-body">{current.body}</p>
        <div className="onboarding-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} onClick={() => setStep(i)} />
          ))}
        </div>
        <div className="onboarding-actions">
          {step > 0 && (
            <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>← Back</button>
          )}
          <span className="onboarding-step-count">{step + 1} / {STEPS.length}</span>
          {isLast ? (
            <button className="btn btn-primary" onClick={onDismiss}>Got it! 🚀</button>
          ) : (
            <button className="btn btn-primary" onClick={() => setStep(s => s + 1)}>Next →</button>
          )}
        </div>
        <button className="onboarding-skip" onClick={onDismiss}>Skip tutorial</button>
      </div>
    </div>
  );
}
