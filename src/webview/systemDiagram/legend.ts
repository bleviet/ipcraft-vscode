/** Pure legend model: which wire categories a level shows, in a fixed order. */

import type { NetCategory } from '../../domain/systemGraph';
import type { ClockDomain } from './clocks/clockTypes';
import { UNRELEASED_RESET_COLOR } from './clocks/domainView';
import { formatHz } from './clocks/frequency';

export interface LegendEntry {
  category: NetCategory;
  label: string;
  /** Interface categories draw a thick bar, scalar ones a thin bar. */
  thick: boolean;
}

const LEGEND_ORDER: LegendEntry[] = [
  { category: 'aximm', label: 'AXI memory-mapped', thick: true },
  { category: 'axis', label: 'AXI4-Stream', thick: true },
  { category: 'avalonmm', label: 'Avalon-MM', thick: true },
  { category: 'avalonst', label: 'Avalon-ST', thick: true },
  { category: 'interface', label: 'Other interface', thick: true },
  { category: 'interrupt', label: 'Interrupt', thick: false },
  { category: 'clock', label: 'Clock', thick: false },
  { category: 'reset', label: 'Reset', thick: false },
  { category: 'signal', label: 'Signal', thick: false },
];

/** Human label of a net category, as the legend names it. */
export function categoryLabel(category: NetCategory): string {
  return LEGEND_ORDER.find((entry) => entry.category === category)?.label ?? category;
}

/**
 * Entries for the categories among `edges`, in legend order. `hiddenNets` are
 * the clock and reset nets drawn only as badges; their categories count too.
 */
export function legendEntries(
  edges: readonly { category: NetCategory }[],
  hiddenNets: readonly { category: NetCategory }[] = []
): LegendEntry[] {
  const present = new Set([...edges, ...hiddenNets].map((net) => net.category));
  return LEGEND_ORDER.filter((entry) => present.has(entry.category));
}

export interface ReviewLegendEntry {
  key: 'undriven' | 'unused' | 'unchecked';
  label: string;
  color?: string;
  dashed?: true;
}

/** Entries appended to the legend while the unconnected-pin review is on. */
export const REVIEW_LEGEND: readonly ReviewLegendEntry[] = [
  { key: 'undriven', label: 'Undriven pin', color: 'var(--vscode-editorWarning-foreground)' },
  { key: 'unused', label: 'Unused pin', color: 'var(--vscode-descriptionForeground)' },
  { key: 'unchecked', label: 'Block not checked', dashed: true },
];

export interface DomainLegendEntry {
  key: string;
  label: string;
  color: string;
  /** Absent: a solid bar. */
  line?: 'dotted' | 'dashed';
}

/** Entries appended to the legend in the domain mode: one per domain on the level, then the reset and crossing marks. */
export function domainLegend(domains: readonly ClockDomain[]): DomainLegendEntry[] {
  return [
    ...domains.map((domain) => ({
      key: domain.id,
      label: `${domain.name} · ${formatHz(domain.hz)}`,
      color: domain.color,
    })),
    {
      key: 'reset',
      label: 'Reset, colored by the domain that releases it',
      color: UNRELEASED_RESET_COLOR,
      line: 'dotted' as const,
    },
    {
      key: 'crossing',
      label: 'Clock or reset domain crossing',
      color: 'var(--vscode-editorWarning-foreground)',
      line: 'dashed' as const,
    },
  ];
}
