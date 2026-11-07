/** The clock or reset tree a selected net belongs to. */

import type { Selection } from '../model';
import type { ClockAnalysis } from './analyzeClocks';
import type { ClockDomain, ResetSource } from './clockTypes';

export type SelectedTree =
  | { kind: 'clock'; domain: ClockDomain; netIds: ReadonlySet<string> }
  | { kind: 'reset'; reset: ResetSource; netIds: ReadonlySet<string> };

/** The whole tree of the selected net, on every level; undefined for another selection or a net of neither kind. */
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
  return reset && { kind: 'reset', reset, netIds: new Set(reset.netIds) };
}
