/**
 * What the marks of a comparison add to the drawn level (issue #302): per node its status, pin
 * marks and count of changes inside, the ids of the new wires, and the legend. Pure; the canvas
 * merges the result into its React Flow nodes and edges, as it does for {@link clockDecor}.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import {
  isNewWire,
  boundaryMark,
  shownInside,
  type ChangeMarks,
  type MarkStatus,
  type NodeChange,
  type PinChangeMark,
  type WireEnd,
} from './changeMarks';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';
import { netDriver, parseBoundaryId } from './model';

/** Everything the canvas needs to draw the marks; null while Marks is off or without a comparison. */
export interface ChangeContext {
  marks: ChangeMarks;
  graph: SystemGraph;
  levelPath: string;
}

/** What the legend adds while the marks are on. */
export interface ChangeLegend {
  /** The kinds among the drawn nodes, in display order. */
  kinds: readonly MarkStatus[];
  newWire: boolean;
  /** Instances and ports only the base has, on the level and in the hierarchies expanded in it. */
  removed: number;
}

export interface ChangeDecor {
  /** Marks by node id; only the nodes that carry any. */
  nodes: ReadonlyMap<string, NodeChange>;
  /** Ids of the drawn wires that are new. */
  newEdgeIds: ReadonlySet<string>;
  legend: ChangeLegend;
}

const KIND_ORDER: readonly MarkStatus[] = ['added', 'changed', 'renamed', 'version'];

/** The mark of an instance node or a frame. */
function blockChange(marks: ChangeMarks, id: string, frame: boolean): NodeChange | undefined {
  const block = marks.blocks.get(id);
  if (!block) {
    return undefined;
  }
  const pins: Record<string, PinChangeMark> = {};
  for (const [pin, kind] of Object.entries(frame ? (block.insidePins ?? {}) : {})) {
    pins[pin] = { kind, inside: true };
  }
  for (const [pin, kind] of Object.entries(block.pins)) {
    pins[pin] = { kind };
  }
  return {
    ...(block.status && { status: block.status, title: block.title }),
    ...(shownInside(block) > 0 && { inside: shownInside(block) }),
    ...(Object.keys(pins).length > 0 && { pins }),
  };
}

function nodeChange(marks: ChangeMarks, node: DiagramFlowNode): NodeChange | undefined {
  if (node.type !== 'boundary') {
    return blockChange(marks, node.id, node.type === 'frame');
  }
  const { level, pin } = parseBoundaryId(node.id);
  return boundaryMark(marks, level, pin);
}

/** The two ends of a drawn wire (`${net id}#${endpoint index}`): the net's driver and the endpoint. */
function wireEnds(
  context: ChangeContext,
  nets: ReadonlyMap<string, SystemGraph['nets'][number]>,
  edge: DiagramFlowEdge
): { level: string; ends: [WireEnd, WireEnd] } | undefined {
  const net = nets.get(edge.data.netId);
  const driver = net && netDriver(context.graph, net);
  const sink = net?.endpoints[Number(edge.id.slice(edge.id.lastIndexOf('#') + 1))];
  return net && driver && sink ? { level: net.level, ends: [driver, sink] } : undefined;
}

export function changeDecor(
  layout: { nodes: readonly DiagramFlowNode[]; edges: readonly DiagramFlowEdge[] } | null,
  context: ChangeContext
): ChangeDecor {
  const { marks, graph, levelPath } = context;
  const nodes = new Map<string, NodeChange>();
  const kinds = new Set<MarkStatus>();
  const shownLevels = new Set([levelPath]);
  for (const node of layout?.nodes ?? []) {
    const change = nodeChange(marks, node);
    if (change) {
      nodes.set(node.id, change);
      if (change.status) {
        kinds.add(change.status);
      }
    }
    if (node.type === 'frame') {
      shownLevels.add(node.id);
    }
  }
  const nets = new Map(graph.nets.map((net) => [net.id, net]));
  const newEdgeIds = new Set<string>();
  for (const edge of layout?.edges ?? []) {
    const wire = wireEnds(context, nets, edge);
    if (wire && isNewWire(marks, wire.level, ...wire.ends)) {
      newEdgeIds.add(edge.id);
    }
  }
  return {
    nodes,
    newEdgeIds,
    legend: {
      kinds: KIND_ORDER.filter((kind) => kinds.has(kind)),
      newWire: newEdgeIds.size > 0,
      removed: [...shownLevels].reduce((sum, level) => sum + (marks.removed.get(level) ?? 0), 0),
    },
  };
}
