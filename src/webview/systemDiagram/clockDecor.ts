/**
 * What the clock and reset analysis adds to the drawn level (issue #243): wire
 * styles, pin marks, node domain strips and the legend entries.
 * Pure; the canvas merges the result into its React Flow nodes and edges.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { crossingEdgeIds } from './clocks/crossingEdges';
import { crossingEndKeys, levelDomains } from './clocks/crossingSummary';
import { nodeDomains, type NodeDomains } from './clocks/domainView';
import { edgeMarks, type EdgeMarks } from './clocks/edgeView';
import { nodePinMarks, type PinMarks } from './clocks/nodeView';
import { selectedTree, type SelectedTree } from './clocks/treeSelection';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';
import { domainLegend, type DomainLegendEntry } from './legend';
import type { Selection } from './model';

/** Everything the canvas needs to draw the clock and reset analysis. */
export interface ClockContext {
  graph: SystemGraph;
  analysis: ClockAnalysis;
  levelPath: string;
  /** The domain decorations are on: Clocks and resets is on and the unconnected-pin review is off. */
  domainMode: boolean;
}

export interface ClockDecor {
  /** The clock or reset tree of the selected net. */
  tree: SelectedTree | undefined;
  /** Wire style overrides by edge id. */
  edges: ReadonlyMap<string, EdgeMarks>;
  /** Pin marks by node id. */
  pinMarks: ReadonlyMap<string, PinMarks>;
  /** Domain strip and crossing counts by node id (blocks only); empty outside the domain mode. */
  domains: ReadonlyMap<string, NodeDomains>;
  /** Legend entries to append; null outside the domain mode. */
  legend: readonly DomainLegendEntry[] | null;
}

export function clockDecor(
  layout: { nodes: readonly DiagramFlowNode[]; edges: readonly DiagramFlowEdge[] } | null,
  context: ClockContext,
  selection: Selection | null
): ClockDecor {
  const { graph, analysis, levelPath, domainMode } = context;
  const tree = selectedTree(analysis, selection);
  if (!domainMode && !tree) {
    return {
      tree,
      edges: new Map(),
      pinMarks: new Map(),
      domains: new Map(),
      legend: null,
    };
  }
  const nodes = layout?.nodes ?? [];
  const edges = layout?.edges ?? [];
  const edgeContext = {
    domainMode,
    tree,
    crossingEdgeIds: domainMode
      ? crossingEdgeIds(graph, edges, analysis.crossings)
      : new Set<string>(),
  };
  const pinContext = {
    graph,
    analysis,
    domainMode,
    tree,
    crossingKeys: domainMode ? crossingEndKeys(analysis.crossings) : new Set<string>(),
  };
  const marksOf = new Map<string, EdgeMarks>();
  for (const edge of edges) {
    const marks = edgeMarks(edgeContext, edge);
    if (Object.keys(marks).length > 0) {
      marksOf.set(edge.id, marks);
    }
  }
  const pinMarks = new Map<string, PinMarks>();
  const domains = new Map<string, NodeDomains>();
  for (const node of nodes) {
    const marks = nodePinMarks(pinContext, node.id);
    if (marks) {
      pinMarks.set(node.id, marks);
    }
    if (domainMode && node.type !== 'boundary') {
      domains.set(node.id, nodeDomains(analysis, graph, node.id));
    }
  }
  return {
    tree,
    edges: marksOf,
    pinMarks,
    domains,
    legend: domainMode ? domainLegend(levelDomains(analysis, graph, levelPath)) : null,
  };
}
