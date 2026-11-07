import type {
  NetCategory,
  PinDirection,
  SystemGraph,
  SystemInstance,
  SystemNet,
  SystemPin,
} from '../../../../domain/systemGraph';

export const pin = (name: string, direction: PinDirection, isInterface = false): SystemPin => ({
  name,
  isInterface,
  direction,
  directionSource: 'declared',
  parameters: {},
});

const instance = (name: string, pins: SystemPin[]): SystemInstance => ({
  path: `/${name}`,
  name,
  parent: '/',
  kind: 'ip',
  parameters: {},
  pins,
  line: 1,
});

const net = (
  name: string,
  category: NetCategory,
  endpoints: [string, string][],
  isInterface = false
): SystemNet => ({
  id: `/::${name}`,
  name,
  level: '/',
  isInterface,
  category,
  categorySource: 'declared',
  endpoints: endpoints.map(([instancePath, pinName]) => ({ instance: instancePath, pin: pinName })),
  line: 1,
});

/** `hub` has 28 master pins `M00_AXI`..`M27_AXI` and a clock `aclk`, wired to 28 `tNN` blocks. */
export function foldingGraph(count = 28): SystemGraph {
  const indices = Array.from({ length: count }, (_, i) => String(i).padStart(2, '0'));
  const hub = instance('hub', [
    pin('aclk', 'in'),
    ...indices.map((i) => pin(`M${i}_AXI`, 'master', true)),
  ]);
  const targets = indices.map((i) =>
    instance(`t${i}`, [pin('S_AXI', 'slave', true), pin('aclk', 'in')])
  );
  const nets = [
    ...indices.map((i) =>
      net(
        `n${i}`,
        'aximm',
        [
          ['/hub', `M${i}_AXI`],
          [`/t${i}`, 'S_AXI'],
        ],
        true
      )
    ),
    net('clk', 'clock', [
      ['/hub', 'aclk'],
      ...indices.map((i): [string, string] => [`/t${i}`, 'aclk']),
    ]),
  ];
  return {
    name: 'folding',
    source: { fileName: 'folding.tcl', format: 'vivado-bd-tcl' },
    levels: {
      '/': {
        path: '/',
        name: 'folding',
        boundaryPins: [],
        instances: [hub.path, ...targets.map((t) => t.path)],
      },
    },
    instances: Object.fromEntries([hub, ...targets].map((i) => [i.path, i])),
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
