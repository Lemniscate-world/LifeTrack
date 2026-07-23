export interface HabitTemplate {
  name: string;
  category: string;
  goal: number;
  why?: string[];
}

export interface TemplatePack {
  id: string;
  name: string;
  icon: string;
  habits: HabitTemplate[];
}

export const TEMPLATE_PACKS: TemplatePack[] = [
  {
    id: 'fitness',
    name: 'Fitness',
    icon: '💪',
    habits: [
      { name: 'Gym / Workout', category: 'health', goal: 0, why: ['Build strength', 'Boost energy', 'Long-term health'] },
      { name: '10k Steps', category: 'health', goal: 0, why: ['Stay active', 'Clear your mind'] },
      { name: 'Stretch / Yoga', category: 'health', goal: 0, why: ['Flexibility', 'Injury prevention'] },
      { name: 'Drink 2L Water', category: 'health', goal: 0, why: ['Hydration', 'Better skin', 'Energy'] },
    ],
  },
  {
    id: 'productivity',
    name: 'Productivity',
    icon: '⚡',
    habits: [
      { name: 'Plan Tomorrow', category: 'work', goal: 0, why: ['Start each day with clarity', 'Reduce decision fatigue'] },
      { name: 'Deep Work (2h)', category: 'work', goal: 0, why: ['Highest impact work', 'No distractions'] },
      { name: 'No Phone First Hour', category: 'personal', goal: 0, why: ['Protect your morning', 'Better focus'] },
      { name: 'Review Weekly Goals', category: 'work', goal: 0, why: ['Stay aligned', 'Course correct'] },
    ],
  },
  {
    id: 'mindfulness',
    name: 'Mindfulness',
    icon: '🧘',
    habits: [
      { name: 'Meditate 10min', category: 'personal', goal: 0, why: ['Mental clarity', 'Stress reduction'] },
      { name: 'Gratitude Journal', category: 'personal', goal: 0, why: ['Positive mindset', 'Perspective'] },
      { name: 'Read 30min', category: 'learning', goal: 0, why: ['Continuous growth', 'New ideas'] },
      { name: 'No Screens Before Bed', category: 'personal', goal: 0, why: ['Better sleep', 'Wind down naturally'] },
    ],
  },
  {
    id: 'finance',
    name: 'Finance',
    icon: '💰',
    habits: [
      { name: 'Track Expenses', category: 'finance', goal: 0, why: ['Know where money goes', 'Spot waste'] },
      { name: 'No Impulse Buys', category: 'finance', goal: 0, why: ['Save money', 'Intentional spending'] },
      { name: 'Review Budget Weekly', category: 'finance', goal: 0, why: ['Stay on track', 'Adjust as needed'] },
    ],
  },
  {
    id: 'social',
    name: 'Social',
    icon: '❤️',
    habits: [
      { name: 'Call a Friend', category: 'personal', goal: 0, why: ['Maintain connections', 'Mental health'] },
      { name: 'No Social Media', category: 'personal', goal: 0, why: ['Less comparison', 'More presence'] },
      { name: 'Compliment Someone', category: 'personal', goal: 0, why: ['Spread positivity', 'Build relationships'] },
    ],
  },
];

export const CATEGORIES = [
  { id: 'health', name: 'Health', icon: '💪', color: '#FCE7F3' },
  { id: 'work', name: 'Work', icon: '💼', color: '#DBEAFE' },
  { id: 'personal', name: 'Personal', icon: '🌟', color: '#D1FAE5' },
  { id: 'learning', name: 'Learning', icon: '📚', color: '#EDE9FE' },
  { id: 'finance', name: 'Finance', icon: '💰', color: '#FEF3C7' },
];
