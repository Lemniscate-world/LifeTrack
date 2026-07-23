/**
 * Mantras Module — Daily inspiration across life domains.
 *
 * Provides:
 * - Default mantra domains (Financial, Life, Health, Spiritual, Productivity, Relationships)
 * - Built-in mantras for each domain
 * - Deterministic daily selection (same mantra all day, changes at midnight)
 * - User can add/remove custom mantras
 *
 * All logic is pure and local. No external API.
 */

import type { Mantra, MantraDomain, MantraSettings } from './types';

// --- Domain definitions ---

export const MANTRA_DOMAINS: MantraDomain[] = [
  { id: 'financial', name: 'Financial', icon: '💰', color: '#FEF3C7' },
  { id: 'life', name: 'Life', icon: '🌟', color: '#D1FAE5' },
  { id: 'health', name: 'Health', icon: '💪', color: '#FCE7F3' },
  { id: 'spiritual', name: 'Spiritual', icon: '🧘', color: '#EDE9FE' },
  { id: 'productivity', name: 'Productivity', icon: '⚡', color: '#DBEAFE' },
  { id: 'relationships', name: 'Relationships', icon: '❤️', color: '#FEE2E2' },
];

// --- Built-in default mantras ---

const DEFAULT_MANTRAS: Omit<Mantra, 'id'>[] = [
  // Financial
  { text: 'Money is a tool, not a master. Use it wisely.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Wealth is the ability to fully experience life.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Spend less than you earn. Invest the difference.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Financial freedom is not about having millions — it\'s about having enough.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Every euro you save is a euro that works for you.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The best investment you can make is in yourself.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Budgeting is telling your money where to go instead of wondering where it went.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Compound interest is the eighth wonder of the world.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'True wealth is measured by time, not money.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Financial discipline today buys freedom tomorrow.', domain: 'financial', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },

  // Life
  { text: 'Every day is a new chance to rewrite your story.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'You are exactly where you need to be. Keep going.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The two most important days in your life are the day you are born and the day you find out why.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Happiness is not something ready-made. It comes from your own actions.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Life is 10% what happens to you and 90% how you react to it.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Do not wait; the time will never be just right.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The purpose of life is a life of purpose.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'In the end, we only regret the chances we didn\'t take.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'You miss 100% of the shots you don\'t take.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Be the change you want to see in the world.', domain: 'life', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },

  // Health
  { text: 'Your body hears everything your mind says.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Take care of your body. It\'s the only place you have to live.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Health is not just about what you\'re eating. It\'s about what you\'re thinking and saying.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'An early-morning walk is a blessing for the whole day.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Let food be thy medicine and medicine be thy food.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The greatest wealth is health.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Movement is a medicine for creating change in a person\'s physical, emotional, and mental states.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Sleep is the best meditation.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'You don\'t have to be extreme, just consistent.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'A healthy outside starts from the inside.', domain: 'health', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },

  // Spiritual
  { text: 'The present moment is filled with joy and happiness. If you are attentive, you will see it.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Gratitude turns what we have into enough.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Peace comes from within. Do not seek it without.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The soul always knows what to do to heal itself. The challenge is to silence the mind.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'What you seek is seeking you.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The wound is the place where the Light enters you.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Meditation is not about stopping thoughts, but recognizing that we are more than our thoughts and our feelings.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'When you do things from your soul, you feel a river moving in you, a joy.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Let go of the attachment to things that you think you need.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The quieter you become, the more you can hear.', domain: 'spiritual', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },

  // Productivity
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The secret of getting ahead is getting started.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Focus on being productive instead of busy.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'What gets measured gets managed.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Eat a live frog first thing in the morning and nothing worse will happen to you the rest of the day.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The way to get started is to quit talking and begin doing.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Amateurs sit and wait for inspiration. The rest of us just get up and go to work.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'It\'s not that we have little time, but more that we waste a good deal of it.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Small daily improvements over time lead to stunning results.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Don\'t watch the clock; do what it does. Keep going.', domain: 'productivity', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },

  // Relationships
  { text: 'The quality of your life is the quality of your relationships.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'We are like islands in the sea, separate on the surface but connected in the deep.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The greatest gift you can give someone is your time.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'People will forget what you said, people will forget what you did, but people will never forget how you made them feel.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'A friend is someone who knows all about you and still loves you.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'The best thing to hold onto in life is each other.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Love is composed of a single soul inhabiting two bodies.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'To love and be loved is to feel the sun from both sides.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Apologizing does not always mean you\'re wrong and the other person is right. It means you value your relationship more than your ego.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
  { text: 'Kindness is a language which the deaf can hear and the blind can see.', domain: 'relationships', createdAt: '2025-01-01T00:00:00.000Z', isDefault: true },
];

// --- Default settings ---

export const DEFAULT_MANTRA_SETTINGS: MantraSettings = {
  morningEnabled: true,
  eveningEnabled: true,
  morningTime: '08:00',
  eveningTime: '20:00',
  showOnEntry: true,
  lastMorningDate: '',
  lastEveningDate: '',
  lastEntryDate: '',
};

// --- Factory ---

/**
 * Create a fresh set of default mantras with deterministic IDs.
 * Uses a counter-based approach so IDs are stable across reloads.
 */
export function createDefaultMantras(): Mantra[] {
  let counter = 0;
  return DEFAULT_MANTRAS.map((m) => ({
    ...m,
    id: `default-${m.domain}-${String(counter++).padStart(2, '0')}`,
  }));
}

/**
 * Create a new user mantra with a random UUID.
 */
export function createMantra(text: string, domain: string): Mantra {
  return {
    id: crypto.randomUUID(),
    text: text.trim(),
    domain,
    createdAt: new Date().toISOString(),
    isDefault: false,
  };
}

// --- Daily Selection ---

/**
 * Simple deterministic hash from a date string.
 * Returns 0..1 pseudo-random number that is stable for a given date.
 */
function dateHash(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    const char = dateStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  // Normalize to 0..1
  return ((Math.abs(hash) % 10000) / 10000);
}

/**
 * Get today's date as YYYY-MM-DD in local timezone.
 */
export function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Select a deterministic mantra for a given date and domain.
 * Uses the date as a seed so the same mantra is shown all day.
 * Falls back to a random mantra if no mantras exist for the domain.
 */
export function getDailyMantra(mantras: Mantra[], domain: string, dateStr?: string): Mantra | null {
  const date = dateStr || todayStr();
  const domainMantras = mantras.filter((m) => m.domain === domain);
  if (domainMantras.length === 0) return null;

  // Use hash of date + domain to pick consistently for the whole day
  const seed = `${date}-${domain}`;
  const hash = dateHash(seed);
  const index = Math.floor(hash * domainMantras.length);
  return domainMantras[index];
}

/**
 * Get all daily mantras for today, one per domain that has mantras.
 * Returns a Map of domainId -> Mantra.
 */
export function getAllDailyMantras(mantras: Mantra[], dateStr?: string): Map<string, Mantra> {
  const result = new Map<string, Mantra>();
  const date = dateStr || todayStr();
  for (const domain of MANTRA_DOMAINS) {
    const mantra = getDailyMantra(mantras, domain.id, date);
    if (mantra) result.set(domain.id, mantra);
  }
  return result;
}

// --- Notification helpers ---

/**
 * Check if a mantra notification should be shown.
 * Returns true if notifications are enabled for the period and haven't been shown today.
 */
export function shouldShowMantraNotification(
  settings: MantraSettings,
  period: 'morning' | 'evening',
): boolean {
  const date = todayStr();
  if (period === 'morning') {
    return settings.morningEnabled && settings.lastMorningDate !== date;
  }
  return settings.eveningEnabled && settings.lastEveningDate !== date;
}

/**
 * Mark a mantra notification as shown for today.
 */
export function markMantraNotificationShown(
  settings: MantraSettings,
  period: 'morning' | 'evening',
): MantraSettings {
  const date = todayStr();
  return {
    ...settings,
    ...(period === 'morning' ? { lastMorningDate: date } : { lastEveningDate: date }),
  };
}

/**
 * Parse time string "HH:MM" to { hours, minutes }.
 */
export function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Get a single random mantra from across all domains.
 * Used for the daily entry banner when we want just one mantra.
 */
export function getDailyEntryMantra(mantras: Mantra[], dateStr?: string): Mantra | null {
  if (mantras.length === 0) return null;
  const date = dateStr || todayStr();
  const hash = dateHash(date);
  const index = Math.floor(hash * mantras.length);
  return mantras[index];
}

// --- System Notification (Web Notification API) ---

let notificationPermission: typeof Notification.permission | 'unsupported' = 'unsupported';

/**
 * Initialize notification permission state. Call once on app startup.
 * Returns the current permission state.
 */
export function initNotificationPermission(): typeof Notification.permission | 'unsupported' {
  if (typeof Notification === 'undefined') {
    notificationPermission = 'unsupported';
    return 'unsupported';
  }
  notificationPermission = Notification.permission;
  return notificationPermission;
}

/**
 * Request permission for system notifications.
 * Must be called from a user gesture (click handler).
 */
export async function requestNotificationPermission(): Promise<typeof Notification.permission> {
  if (typeof Notification === 'undefined') return 'denied';
  const result = await Notification.requestPermission();
  notificationPermission = result;
  return result;
}

/**
 * Send a system-level notification if permission is granted.
 * Falls back silently if notifications are not supported or denied.
 */
export function sendSystemNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'lifetrack-mantra', // replaces previous mantra notification
      silent: false,
    });
  } catch {
    // Notification API can fail in some contexts (e.g., service worker required)
  }
}
