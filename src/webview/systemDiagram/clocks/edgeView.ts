/** How the domain mode and a selected clock tree restyle a drawn wire. */

import type { SelectedTree } from './treeSelection';

/**
 * Style overrides of one wire; absent fields keep the wire's category look.
 * Clock and reset nets are badges, not wires, so only data wires get these.
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
  edge: { id: string; data: { netId: string } }
): EdgeMarks {
  const { netId } = edge.data;
  if (domainMode && crossingEdgeIds.has(edge.id)) {
    return { crossing: true };
  }
  if (tree?.kind === 'clock' && tree.netIds.has(netId)) {
    return { domainColor: tree.domain.color };
  }
  return domainMode ? { dimmed: true } : {};
}

/**
 * Marks of a bundled wire from the marks of its members. A crossing member
 * makes the whole wire a crossing (a finding is never hidden); any other mark
 * shows only when every member has it, a color when they all share it.
 */
export function bundleMarks(members: readonly EdgeMarks[]): EdgeMarks {
  if (members.some((marks) => marks.crossing)) {
    return { crossing: true };
  }
  const colors = new Set(members.map((marks) => marks.domainColor));
  const [color] = colors;
  return {
    ...(colors.size === 1 && color !== undefined && { domainColor: color }),
    ...(members.every((marks) => marks.dimmed) && { dimmed: true as const }),
  };
}
