import type { NetCategory } from '../../domain/systemGraph';

const CATEGORY_COLORS: Record<NetCategory, string> = {
  aximm: 'var(--vscode-charts-blue)',
  axis: 'var(--vscode-charts-green)',
  avalonmm: 'var(--vscode-charts-blue)',
  avalonst: 'var(--vscode-charts-green)',
  interface: 'var(--vscode-descriptionForeground)',
  clock: 'var(--vscode-charts-orange)',
  reset: 'var(--vscode-charts-red)',
  interrupt: 'var(--vscode-charts-purple)',
  signal: 'var(--vscode-descriptionForeground)',
};

export function categoryColor(category: NetCategory | undefined): string {
  return CATEGORY_COLORS[category ?? 'signal'];
}

/**
 * A wire at rest: its color mixed toward the canvas, so blocks carry the visual
 * weight. Selected, highlighted, crossing and dimmed (already faded) wires
 * keep the full color.
 */
export function restingWireColor(color: string): string {
  return `color-mix(in srgb, ${color} 65%, var(--vscode-editor-background))`;
}
