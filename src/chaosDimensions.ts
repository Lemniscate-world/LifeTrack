/** Accent colors for chaos dimensions — data-only color, not decoration. */
export const DIMENSION_COLORS: Record<string, string> = {
  social: '#3b82f6',
  financial: '#10b981',
  physical: '#ef4444',
  structural: '#f59e0b',
  spiritual: '#8b5cf6',
  emotional: '#ec4899',
  energy: '#06b6d4',
  startup: '#6366f1',
};

export function getDimensionAccent(dimensionId: string): string {
  return DIMENSION_COLORS[dimensionId] ?? 'var(--primary)';
}
