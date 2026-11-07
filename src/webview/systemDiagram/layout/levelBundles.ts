/**
 * Bus bundling of the current level, on both sides of the ELK layout: the
 * bundles chosen from the level's edges (to emit one ELK edge each) and the
 * bundled flow edges drawn after layout, with their comb branches. Both sides
 * plan from the same inputs, so they agree on the bundles.
 */

import type { ElkEdgeSection, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { SystemGraph } from '../../../domain/systemGraph';
import type { DiagramFlowEdge, IsolationSubset } from './diagramTypes';
import {
  bundleLabel,
  endBranches,
  planBundles,
  type Bundle,
  type BundleCandidate,
  type BundleEnd,
  type BundlePlan,
  type BusBundling,
  type Point,
  type PortSpot,
  type PortYs,
} from './edgeBundling';
import { extendRouteEnds } from './edgePoints';
import { foldedEdges, type PortEdge } from './foldedEdges';
import { instanceRows, portCentres, type InstanceRows } from './instanceElk';
import { levelEdges, portId } from './levelEdges';
import { clockResetNetsByEndpoint } from './netBadges';
import type { PinFolding } from './pinGrouping';
import { PORT_SIZE } from './pinRows';
import { boundaryId } from '../model';

/** A boundary node has one port, so its position never decides a bundle. */
const BOUNDARY_PORT: PortSpot = { y: 0, side: 'east' };

/** Pin name, or folded group id, of a port id `${nodeId}::${handle}`. */
const handleOf = (node: string, port: string) => port.slice(node.length + 2);

function candidates(graph: SystemGraph, ported: readonly PortEdge[]): BundleCandidate[] {
  const nets = new Map(graph.nets.map((net) => [net.id, net]));
  return ported.flatMap(({ edge, from, to }) => {
    const netId = edge.id.slice(0, edge.id.lastIndexOf('#'));
    const net = nets.get(netId);
    return net
      ? [
          {
            edgeId: edge.id,
            netId,
            category: edge.category,
            isInterface: net.isInterface,
            sourceNode: edge.sourceNode,
            targetNode: edge.targetNode,
            sourcePin: edge.sourcePin,
            targetPin: edge.targetPin,
            sourceHandle: handleOf(edge.sourceNode, from),
            targetHandle: handleOf(edge.targetNode, to),
          },
        ]
      : [];
  });
}

/** Port centres of the collapsed blocks and boundary pins of the level, before layout. */
function inputPortYs(
  graph: SystemGraph,
  levelPath: string,
  rows: ReadonlyMap<string, InstanceRows>
): PortYs {
  const ys = new Map<string, ReadonlyMap<string, PortSpot>>();
  for (const [path, instanceRows] of rows) {
    ys.set(path, portCentres(instanceRows));
  }
  for (const pin of graph.levels[levelPath]?.boundaryPins ?? []) {
    ys.set(boundaryId(levelPath, pin.name), new Map([[pin.name, BOUNDARY_PORT]]));
  }
  return ys;
}

/** The bundles of the level's edges, which `rows` (its collapsed blocks) hold the ports of. */
export function planInputBundles(
  graph: SystemGraph,
  levelPath: string,
  ported: readonly PortEdge[],
  rows: ReadonlyMap<string, InstanceRows>,
  bundling: BusBundling
): BundlePlan {
  return planBundles(
    candidates(graph, ported),
    inputPortYs(graph, levelPath, rows),
    bundling.unbundled
  );
}

/** The ELK edge of a bundle: its trunk, between the representative ports. */
export function bundleElkEdge(bundle: Bundle): ElkExtendedEdge {
  return {
    id: bundle.key,
    sources: [portId(bundle.sourceNode, bundle.sourceHandle)],
    targets: [portId(bundle.targetNode, bundle.targetHandle)],
  };
}

/** A laid-out collapsed block: its box and the centres of its ports, absolute and within it. */
export interface NodeGeometry {
  x: number;
  width: number;
  centres: Map<string, Point>;
  ys: Map<string, PortSpot>;
}

/** Geometry of the collapsed blocks and boundary nodes among the children of `parent`. */
function levelGeometry(parent: ElkNode): Map<string, NodeGeometry> {
  const geometry = new Map<string, NodeGeometry>();
  for (const child of parent.children ?? []) {
    if (child.children) {
      continue;
    }
    const node: NodeGeometry = {
      x: child.x ?? 0,
      width: child.width ?? 0,
      centres: new Map(),
      ys: new Map(),
    };
    for (const port of child.ports ?? []) {
      const handle = handleOf(child.id, port.id);
      const x = (port.x ?? 0) + (port.width ?? 0) / 2;
      const y = (port.y ?? 0) + (port.height ?? 0) / 2;
      node.centres.set(handle, { x: node.x + x, y: (child.y ?? 0) + y });
      node.ys.set(handle, { y, side: x > node.width / 2 ? 'east' : 'west' });
    }
    geometry.set(child.id, node);
  }
  return geometry;
}

/** The edges of the laid-out level, as {@link planInputBundles} saw them: isolation, then pin folding. */
export interface LaidOutOptions {
  pinFolding?: PinFolding;
  isolate?: IsolationSubset;
  bundling: BusBundling;
}

/**
 * Bundles of the laid-out level, replanned from the same inputs the ELK input
 * was built from: the flow edge of each bundle, from its routed ELK section.
 */
export function laidOutBundleEdges(
  graph: SystemGraph,
  levelPath: string,
  layoutResult: ElkNode,
  options: LaidOutOptions
): Map<string, (section: ElkEdgeSection) => DiagramFlowEdge> {
  const clockReset = clockResetNetsByEndpoint(graph, levelPath);
  const rows = new Map<string, InstanceRows>();
  for (const child of layoutResult.children ?? []) {
    const instance = graph.instances[child.id];
    if (instance && !child.children) {
      rows.set(child.id, instanceRows(instance, clockReset, options.pinFolding));
    }
  }
  const edges = levelEdges(graph, levelPath).filter(
    (edge) => options.isolate?.edgeIds.has(edge.id) ?? true
  );
  const geometry = levelGeometry(layoutResult);
  const ys = new Map([...geometry].map(([id, node]) => [id, node.ys]));
  const ported = foldedEdges(graph, edges, rows);
  const { bundles } = planBundles(candidates(graph, ported), ys, options.bundling.unbundled);
  return new Map(
    bundles.map((bundle) => [
      bundle.key,
      (section: ElkEdgeSection) => bundleFlowEdge(bundle, section, geometry),
    ])
  );
}

function bundleEnd(
  node: NodeGeometry | undefined,
  handles: readonly string[]
): BundleEnd | undefined {
  if (!node) {
    return undefined;
  }
  const east = node.ys.get(handles[0])?.side === 'east';
  return {
    side: east ? 'east' : 'west',
    borderX: east ? node.x + node.width : node.x,
    centres: node.centres,
  };
}

/** The React Flow edge of a bundle: the trunk routed by ELK, its badge label and comb branches. */
export function bundleFlowEdge(
  bundle: Bundle,
  section: ElkEdgeSection,
  geometry: ReadonlyMap<string, NodeGeometry>
): DiagramFlowEdge {
  const source = bundleEnd(geometry.get(bundle.sourceNode), bundle.sourceHandles);
  const target = bundleEnd(geometry.get(bundle.targetNode), bundle.targetHandles);
  return {
    id: bundle.key,
    type: 'elk',
    source: bundle.sourceNode,
    target: bundle.targetNode,
    sourceHandle: bundle.sourceHandle,
    targetHandle: bundle.targetHandle,
    data: {
      points: extendRouteEnds(
        [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
        PORT_SIZE / 2,
        PORT_SIZE / 2
      ),
      netId: bundle.members[0].netId,
      category: bundle.category,
      isInterface: bundle.isInterface,
      bundle: {
        key: bundle.key,
        label: bundleLabel(bundle.category, bundle.members.length),
        members: bundle.members,
        branches: [
          ...(source ? endBranches(source, bundle.sourceHandles, bundle.sourceHandle) : []),
          ...(target ? endBranches(target, bundle.targetHandles, bundle.targetHandle) : []),
        ],
      },
    },
  };
}
