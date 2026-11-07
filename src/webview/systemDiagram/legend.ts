/** Pure legend model: which wire categories a level shows, in a fixed order. */

import type { NetCategory } from '../../domain/systemGraph';
import type { ClockDomain } from './clocks/clockTypes';
import { UNRELEASED_RESET_COLOR } from './clocks/domainView';
import { nameWithFrequency } from './clocks/frequency';

export interface LegendEntry {
  category: NetCategory;
  label: string;
  /** Short name for a bundle badge, e.g. `AXI` in `x12 AXI`. */
  short: string;
  /** Interface categories draw a thick bar, scalar ones a thin bar. */
  thick: boolean;
}

const LEGEND_ORDER: LegendEntry[] = [
  { category: 'aximm', label: 'AXI memory-mapped', short: 'AXI', thick: true },
  { category: 'axis', label: 'AXI4-Stream', short: 'AXIS', thick: true },
  { category: 'avalonmm', label: 'Avalon-MM', short: 'AVMM', thick: true },
  { category: 'avalonst', label: 'Avalon-ST', short: 'AVST', thick: true },
  { category: 'interface', label: 'Other interface', short: 'IF', thick: true },
  { category: 'interrupt', label: 'Interrupt', short: 'IRQ', thick: false },
  { category: 'clock', label: 'Clock', short: 'CLK', thick: false },
  { category: 'reset', label: 'Reset', short: 'RST', thick: false },
  { category: 'signal', label: 'Signal', short: 'SIG', thick: false },
];

/** Human label of a net category, as the legend names it. */
export function categoryLabel(category: NetCategory): string {
  return LEGEND_ORDER.find((entry) => entry.category === category)?.label ?? category;
}

/** Short name of a net category for a bundle badge. */
export function categoryShort(category: NetCategory): string {
  return LEGEND_ORDER.find((entry) => entry.category === category)?.short ?? category;
}

/** Position of a net category in the legend order (unknown categories last). */
export function categoryRank(category: NetCategory): number {
  const index = LEGEND_ORDER.findIndex((entry) => entry.category === category);
  return index < 0 ? LEGEND_ORDER.length : index;
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
      label: nameWithFrequency(domain),
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
