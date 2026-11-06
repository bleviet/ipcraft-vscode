/** Pure legend model: which wire categories a level shows, in a fixed order. */

import type { NetCategory } from '../../domain/systemGraph';

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
