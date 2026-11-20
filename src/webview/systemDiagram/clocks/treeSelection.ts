/** The clock, reset, or connection tree a selected net belongs to. */

import type { Selection } from '../model';
import type { ClockAnalysis } from './analyzeClocks';
import type { ClockDomain, ResetSource } from './clockTypes';
import type { PhysicalNet } from './physicalNets';

export type SelectedTree =
  | { kind: 'clock'; domain: ClockDomain; netIds: ReadonlySet<string> }
  | { kind: 'reset'; reset: ResetSource; netIds: ReadonlySet<string> }
  /** A data or bus net that spans hierarchy levels. */
  | { kind: 'data'; physical: PhysicalNet; netIds: ReadonlySet<string> };

/** The whole tree of the selected net, on every level; undefined for another selection or a net that stays on one level. */
export function selectedTree(
  analysis: ClockAnalysis,
  selection: Selection | null
): SelectedTree | undefined {
  if (selection?.kind !== 'net') {
    return undefined;
  }
  const domain = analysis.domainOfNet(selection.id);
  if (domain) {
    return { kind: 'clock', domain, netIds: new Set(domain.netIds) };
  }
  const reset = analysis.resetOfNet(selection.id);
  if (reset) {
    return { kind: 'reset', reset, netIds: new Set(reset.netIds) };
  }
  const physical = analysis.physicalOfNet(selection.id);
  return physical && physical.nets.length > 1
    ? { kind: 'data', physical, netIds: new Set(physical.nets.map((member) => member.id)) }
    : undefined;
}
