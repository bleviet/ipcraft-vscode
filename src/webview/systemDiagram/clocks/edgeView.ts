/** How the domain mode and a selected clock tree restyle a drawn wire. */

import type { NetCategory } from '../../../domain/systemGraph';
import { isClockOrReset } from '../model';
import type { SelectedTree } from './treeSelection';

/**
 * Style overrides of one wire; absent fields keep the wire's category look.
 * A clock or reset wire gets them like a data wire, except that it is never
 * dimmed: the leads of a net overlap and would add up, and the pins of these
 * nets carry the domain colors.
 */
export interface EdgeMarks {
  /** Stroke color: the domain of the selected clock tree the wire's net is on. */
  domainColor?: string;
  /** Drawn as a clock domain crossing: dashed, in the warning color. */
  crossing?: true;
  /** Drawn faint in the domain mode, as it is no crossing. */
  dimmed?: true;
}

export interface EdgeViewContext {
  domainMode: boolean;
  tree: SelectedTree | undefined;
  /** Ids of the drawn wires that belong to a flagged crossing. */
  crossingEdgeIds: ReadonlySet<string>;
}

export function edgeMarks(
  { domainMode, tree, crossingEdgeIds }: EdgeViewContext,
  edge: { id: string; data: { netId: string; category: NetCategory } }
): EdgeMarks {
  const { netId } = edge.data;
  if (domainMode && crossingEdgeIds.has(edge.id)) {
    return { crossing: true };
  }
  if (tree?.kind === 'clock' && tree.netIds.has(netId)) {
    return { domainColor: tree.domain.color };
  }
  return domainMode && !isClockOrReset(edge.data) ? { dimmed: true } : {};
}
