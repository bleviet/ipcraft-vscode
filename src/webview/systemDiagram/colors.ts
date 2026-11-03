import type { NetCategory } from '../../domain/systemGraph';

const CATEGORY_COLORS: Record<NetCategory, string> = {
  aximm: 'var(--vscode-charts-blue)',
  axis: 'var(--vscode-charts-green)',
  interface: 'var(--vscode-descriptionForeground)',
  clock: 'var(--vscode-charts-orange)',
  reset: 'var(--vscode-charts-red)',
  interrupt: 'var(--vscode-charts-purple)',
  signal: 'var(--vscode-descriptionForeground)',
};

export function categoryColor(category: NetCategory | undefined): string {
  return CATEGORY_COLORS[category ?? 'signal'];
}
