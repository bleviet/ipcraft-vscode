/** The drawn connections of one level: one edge per net sink, from the net driver. */

import type { NetCategory, SystemGraph } from '../../../domain/systemGraph';
import { boundaryId, netDriver, netsOfLevel } from '../model';

export interface LevelEdge {
  /** `${net.id}#${endpointIndex}`; also the id of the ELK and React Flow edge. */
  id: string;
  /** Category of the net the edge belongs to. */
  category: NetCategory;
  sourceNode: string;
  sourcePin: string;
  targetNode: string;
  targetPin: string;
}

export function portId(nodeId: string, pinName: string): string {
  return `${nodeId}::${pinName}`;
}

/** Ids of the ports of every node shown on `levelPath` (level instances and boundary pins). */
function knownPorts(graph: SystemGraph, levelPath: string): Set<string> {
  const level = graph.levels[levelPath];
  const ports = new Set<string>();
  for (const path of level?.instances ?? []) {
    for (const pin of graph.instances[path]?.pins ?? []) {
      ports.add(portId(path, pin.name));
    }
  }
  for (const pin of level?.boundaryPins ?? []) {
    const id = boundaryId(levelPath, pin.name);
    ports.add(portId(id, pin.name));
  }
  return ports;
}

/** Every edge of the level, clock and reset nets included, between nodes that exist. */
export function levelEdges(graph: SystemGraph, levelPath: string): LevelEdge[] {
  const known = knownPorts(graph, levelPath);
  const edges: LevelEdge[] = [];
  for (const net of netsOfLevel(graph, levelPath)) {
    const driver = netDriver(graph, net);
    if (!driver) {
      continue;
    }
    const sourceNode = driver.instance ?? boundaryId(levelPath, driver.pin);
    const fromPort = portId(sourceNode, driver.pin);
    net.endpoints.forEach((ref, index) => {
      const targetNode = ref.instance ?? boundaryId(levelPath, ref.pin);
      const toPort = portId(targetNode, ref.pin);
      if (toPort === fromPort || !known.has(fromPort) || !known.has(toPort)) {
        return;
      }
      edges.push({
        id: `${net.id}#${index}`,
        category: net.category,
        sourceNode,
        sourcePin: driver.pin,
        targetNode,
        targetPin: ref.pin,
      });
    });
  }
  return edges;
}

/**
 * Edges of an expanded block's inner level, with the boundary pins re-pointed
 * at the block's own pins: boundary pin `p` of `levelPath` is port `p` of the
 * node `levelPath` (the hierarchy instance shares its path with its level).
 */
export function remapBoundaryEnds(edges: readonly LevelEdge[], levelPath: string): LevelEdge[] {
  const remap = (node: string, pin: string) =>
    node === boundaryId(levelPath, pin) ? levelPath : node;
  return edges
    .map((edge) => ({
      ...edge,
      sourceNode: remap(edge.sourceNode, edge.sourcePin),
      targetNode: remap(edge.targetNode, edge.targetPin),
    }))
    .filter(
      (edge) => portId(edge.sourceNode, edge.sourcePin) !== portId(edge.targetNode, edge.targetPin)
    );
}
