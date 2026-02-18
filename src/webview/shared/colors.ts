/**
 * Shared color definitions for bit field visualization.
 * Provides 32 distinct colors for up to 32-bit field visualization.
 */

export const FIELD_COLORS: Record<string, string> = {
  // Primary colors
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#10b981",
  yellow: "#eab308",
  purple: "#a855f7",
  pink: "#ec4899",
  cyan: "#06b6d4",
  orange: "#f97316",

  // Secondary variations
  indigo: "#6366f1",
  violet: "#8b5cf6",
  fuchsia: "#d946ef",
  rose: "#f43f5e",
  sky: "#0ea5e9",
  teal: "#14b8a6",
  emerald: "#059669",
  lime: "#84cc16",

  // Tertiary variations
  amber: "#f59e0b",
  coral: "#ff6b6b",
  mint: "#4ade80",
  lavender: "#c084fc",
  peach: "#fb923c",
  aqua: "#22d3ee",
  salmon: "#fb7185",
  olive: "#a3e635",

  // Additional colors
  plum: "#9333ea",
  turquoise: "#2dd4bf",
  crimson: "#dc2626",
  chartreuse: "#bef264",
  periwinkle: "#818cf8",
  tangerine: "#f97316",
  jade: "#22c55e",
  magenta: "#e879f9",
};

export const FIELD_COLOR_KEYS = Object.keys(FIELD_COLORS);

/**
 * Get a stable color for a field based on its name only.
 * This ensures fields maintain their color when reordered.
 *
 * @param fieldName The name of the field
 * @param _bitOffset Deprecated, ignored for stability during repositioning
 * @returns A color name from FIELD_COLORS
 */
export function getFieldColor(fieldName: string, _bitOffset?: number): string {
  // Simple hash function for string - uses only name for stability
  let hash = 0;
  for (let i = 0; i < fieldName.length; i++) {
    hash = (hash << 5) - hash + fieldName.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  return FIELD_COLOR_KEYS[Math.abs(hash) % FIELD_COLOR_KEYS.length];
}
