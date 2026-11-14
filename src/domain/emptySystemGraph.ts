import type { SystemGraph } from './systemGraph';

/**
 * A design with nothing in it: the base of a comparison when the file did not exist there, so
 * that every block, port and address segment of the other side is added.
 */
export function emptySystemGraph(
  name: string,
  format: SystemGraph['source']['format']
): SystemGraph {
  return {
    name,
    source: { fileName: name, format },
    levels: { '/': { path: '/', name, boundaryPins: [], instances: [] } },
    instances: {},
    nets: [],
    addressSegments: [],
    capabilities: {
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'complete',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
      unconnectedPins: 'unavailable',
    },
    diagnostics: [],
  };
}
