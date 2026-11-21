/**
 * Where "Trace Signal" on a boundary port goes: the net of the port's wire on the
 * highest level it reaches through the hierarchy pins above the port, and the pin
 * the climb passed through there. The hierarchy blocks the climb went through are listed for the
 * caller to draw expanded in place, so the whole path is visible.
 */

import type { SystemGraph, SystemNet } from '../../domain/systemGraph';
import { boundaryId, endpointKey, netsByEndpoint } from './model';

export interface SignalTrace {
  netId: string;
  focus: { nodeId: string; pin: string };
  /** The hierarchy blocks the climb passed through, outermost first; empty when the wire stays on its level. */
  expand: string[];
}

interface Climb {
  net: SystemNet;
  focus: SignalTrace['focus'];
  height: number;
}

/**
 * The highest net the wire reaches above hierarchy pin `pin` of block `level`: the nets on the
 * parent level that touch it, and from each boundary pin of those nets, what lies above that.
 * The first of equal heights wins. Undefined when no net touches the pin on the parent level.
 */
function climb(graph: SystemGraph, level: string, pin: string): Climb | undefined {
  const block = graph.instances[level];
  if (!block) {
    return undefined;
  }
  let best: Climb | undefined;
  const consider = (candidate: Climb) => {
    if (!best || candidate.height > best.height) {
      best = candidate;
    }
  };
  for (const net of netsByEndpoint(graph, block.parent).get(
    endpointKey({ instance: level, pin })
  ) ?? []) {
    consider({ net, focus: { nodeId: level, pin }, height: 1 });
    for (const ref of net.endpoints) {
      const above = ref.instance === null ? climb(graph, block.parent, ref.pin) : undefined;
      if (above) {
        consider({ ...above, height: above.height + 1 });
      }
    }
  }
  return best;
}

/**
 * Where Trace Signal goes for boundary pin `pin` of `level`; undefined when the pin is on no net.
 * Goes to the highest level the wire reaches through the hierarchy pins above the port, trying
 * every boundary pin and net on the way. The focus is the pin the climb passed through; when the
 * wire does not leave the level, the net of the port and the port itself (and nothing to expand).
 */
export function traceSignal(
  graph: SystemGraph,
  level: string,
  pin: string
): SignalTrace | undefined {
  const above = climb(graph, level, pin);
  if (above) {
    const expand: string[] = [];
    for (let path = level; path !== above.focus.nodeId; path = graph.instances[path].parent) {
      expand.unshift(path);
    }
    expand.unshift(above.focus.nodeId);
    return { netId: above.net.id, focus: above.focus, expand };
  }
  const net = netsByEndpoint(graph, level).get(endpointKey({ instance: null, pin }))?.[0];
  return net && { netId: net.id, focus: { nodeId: boundaryId(level, pin), pin }, expand: [] };
}
