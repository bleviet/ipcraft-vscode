import type { NetCategory, SystemGraph } from '../../../../domain/systemGraph';
import { instance, net } from './bundlingGraph';
import { pin } from './foldingGraph';

const INTERFACE_CATEGORIES: NetCategory[] = ['aximm', 'axis', 'avalonmm', 'avalonst', 'interface'];

/**
 * One level `/` of blocks named by single letters, wired by `wires`: each is
 * `[from, to, category]` and drives a net from a fresh output pin of `from` to
 * a fresh input pin of `to` (master / slave pins for interface categories).
 */
export function chainGraph(blocks: string[], wires: [string, string, NetCategory][]): SystemGraph {
  const pins = new Map(blocks.map((block) => [block, [] as ReturnType<typeof pin>[]]));
  const nets = wires.map(([from, to, category], index) => {
    const isInterface = INTERFACE_CATEGORIES.includes(category);
    const outName = `o${index}`;
    const inName = `i${index}`;
    pins.get(from)?.push(pin(outName, isInterface ? 'master' : 'out', isInterface));
    pins.get(to)?.push(pin(inName, isInterface ? 'slave' : 'in', isInterface));
    return net(
      `n${index}`,
      category,
      [
        [`/${from}`, outName],
        [`/${to}`, inName],
      ],
      isInterface
    );
  });
  const instances = blocks.map((block) => instance(block, pins.get(block) ?? []));
  return {
    name: 'chain',
    source: { fileName: 'chain.tcl', format: 'vivado-bd-tcl' },
    levels: {
      '/': { path: '/', name: 'chain', boundaryPins: [], instances: instances.map((i) => i.path) },
    },
    instances: Object.fromEntries(instances.map((i) => [i.path, i])),
    nets,
    addressSegments: [],
    capabilities: {
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'complete',
      userParameters: 'complete',
      propagatedParameters: 'complete',
      unconnectedPins: 'complete',
    },
    diagnostics: [],
  };
}
