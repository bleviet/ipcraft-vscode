import type {
  NetCategory,
  SystemGraph,
  SystemInstance,
  SystemNet,
  SystemPin,
} from '../../../../domain/systemGraph';
import { pin } from './foldingGraph';

export const instance = (
  name: string,
  pins: SystemPin[],
  kind: SystemInstance['kind'] = 'ip',
  parent = '/'
): SystemInstance => ({
  path: `${parent === '/' ? '' : parent}/${name}`,
  name,
  parent,
  kind,
  parameters: {},
  pins,
  line: 1,
});

export const net = (
  name: string,
  category: NetCategory,
  endpoints: [string, string][],
  isInterface = false,
  level = '/'
): SystemNet => ({
  id: `${level}::${name}`,
  name,
  level,
  isInterface,
  category,
  categorySource: 'declared',
  endpoints: endpoints.map(([path, pinName]) => ({ instance: path, pin: pinName })),
  line: 1,
});

export interface BundlingGraphOptions {
  /** Number of parallel AXI-Stream connections from `src` to `dst`; default 3. */
  count?: number;
  /** An unconnected pin row on `src` after this many stream pins: breaks the contiguity of that end. */
  gapAfter?: number;
  /** Name the pins `m_00`, `s_01`, ... so that Compact pins folds them (four or more). */
  numbered?: boolean;
}

const letter = (index: number, numbered: boolean) =>
  numbered ? String(index).padStart(2, '0') : String.fromCharCode(97 + index);

/**
 * `src` streams `m_a`, `m_b`, ... to `dst` `s_a`, `s_b`, ... over nets `n_a`, `n_b`, ...
 * (one parallel bundle), and both share the clock `clk`. Names carry no digit unless `numbered`,
 * so they do not fold.
 */
export function bundlingGraph({
  count = 3,
  gapAfter,
  numbered = false,
}: BundlingGraphOptions = {}): SystemGraph {
  const letters = Array.from({ length: count }, (_, i) => letter(i, numbered));
  const masters = letters.flatMap((l, i) => [
    pin(`m_${l}`, 'master', true),
    ...(gapAfter === i + 1 ? [pin('gap', 'master', true)] : []),
  ]);
  const src = instance('src', [pin('clk', 'in'), ...masters]);
  const dst = instance('dst', [
    pin('clk', 'in'),
    ...letters.map((l) => pin(`s_${l}`, 'slave', true)),
  ]);
  const nets = [
    ...letters.map((l) =>
      net(
        `n_${l}`,
        'axis',
        [
          ['/src', `m_${l}`],
          ['/dst', `s_${l}`],
        ],
        true
      )
    ),
    net('clk', 'clock', [
      ['/src', 'clk'],
      ['/dst', 'clk'],
    ]),
  ];
  return {
    name: 'bundling',
    source: { fileName: 'bundling.tcl', format: 'vivado-bd-tcl' },
    levels: {
      '/': { path: '/', name: 'bundling', boundaryPins: [], instances: [src.path, dst.path] },
    },
    instances: { [src.path]: src, [dst.path]: dst },
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

/** A one-level design (or more, with `levels`) of `instances` wired by `nets`. */
export function designOf(
  instances: SystemInstance[],
  nets: SystemNet[],
  levels: SystemGraph['levels'] = {
    '/': {
      path: '/',
      name: 'design',
      boundaryPins: [],
      instances: instances.filter((i) => i.parent === '/').map((i) => i.path),
    },
  }
): SystemGraph {
  return {
    ...bundlingGraph({ count: 0 }),
    name: 'design',
    levels,
    instances: Object.fromEntries(instances.map((i) => [i.path, i])),
    nets,
  };
}
