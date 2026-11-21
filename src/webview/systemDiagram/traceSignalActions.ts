/** The Trace Signal action of the canvas: expands the blocks of the wire's path, then selects its net. */

import type { SystemGraph } from '../../domain/systemGraph';
import { parseBoundaryId, type RevealZoom } from './model';
import { traceSignal } from './traceSignal';

export function traceSignalActions(
  graph: SystemGraph,
  expandBlocks: (paths: readonly string[]) => void,
  selectNet: (netId: string, focus: { nodeId: string; pin: string }, zoom: RevealZoom) => void
) {
  const traceOf = (portId: string) => {
    const { level, pin } = parseBoundaryId(portId);
    return traceSignal(graph, level, pin);
  };
  return {
    traceable: (portId: string) => traceOf(portId) !== undefined,
    onTraceSignal: (portId: string) => {
      const trace = traceOf(portId);
      if (!trace) {
        return;
      }
      const climbed = trace.expand.length > 0;
      if (climbed) {
        expandBlocks(trace.expand);
      }
      selectNet(trace.netId, trace.focus, climbed ? 'whole' : 'readable');
    },
  };
}
