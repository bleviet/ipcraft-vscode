/** How the domain mode and a selected clock tree restyle a drawn wire. */

import type { NetCategory } from '../../../domain/systemGraph';
import type { ClockAnalysis } from './analyzeClocks';
import { UNRELEASED_RESET_COLOR } from './domainView';
import type { SelectedTree } from './treeSelection';

/** Style overrides of one wire; absent fields keep the wire's category look. */
export interface EdgeMarks {
  /** Stroke color: the clock's domain, or the domain that releases a reset. */
  domainColor?: string;
  dotted?: true;
  /** Drawn as a clock or reset domain crossing: dashed, in the warning color. */
  crossing?: true;
  /** Drawn faint, as it is neither a clock nor a reset. */
  dimmed?: true;
}

export interface EdgeViewContext {
  analysis: ClockAnalysis;
  domainMode: boolean;
  tree: SelectedTree | undefined;
  /** Ids of the drawn wires that belong to a flagged crossing. */
  crossingEdgeIds: ReadonlySet<string>;
}

export function edgeMarks(
  { analysis, domainMode, tree, crossingEdgeIds }: EdgeViewContext,
  edge: { id: string; data: { netId: string; category: NetCategory } }
): EdgeMarks {
  const { netId, category } = edge.data;
  if (domainMode && crossingEdgeIds.has(edge.id)) {
    return { crossing: true };
  }
  if (tree?.kind === 'clock' && tree.netIds.has(netId)) {
    return { domainColor: tree.domain.color };
  }
  if (!domainMode) {
    return {};
  }
  if (category === 'clock') {
    // A clock-named net on no domain (a `locked` output) is an ordinary net.
    const domain = analysis.domainOfNet(netId);
    return domain ? { domainColor: domain.color } : { dimmed: true };
  }
  if (category === 'reset') {
    const reset = analysis.resetOfNet(netId);
    return {
      dotted: true,
      ...(reset && { domainColor: reset.domain?.color ?? UNRELEASED_RESET_COLOR }),
    };
  }
  return { dimmed: true };
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
    ...(members.every((marks) => marks.dotted) && { dotted: true as const }),
    ...(members.every((marks) => marks.dimmed) && { dimmed: true as const }),
  };
}
