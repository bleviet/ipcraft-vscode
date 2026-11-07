import type { SystemGraph } from '../../../../domain/systemGraph';
import { designOf, instance, net } from './bundlingGraph';
import { pin } from './foldingGraph';

/**
 * `src` -> `dst` over three AXI-Stream wires, one AXI memory-mapped wire and an interrupt, both
 * clocked by `clk`; `sub` is a hierarchy block whose inner level is `a -> b -> c` plus `lone`.
 */
export function archGraph(): SystemGraph {
  const src = instance('src', [
    pin('clk', 'in'),
    pin('m_a', 'master', true),
    pin('m_b', 'master', true),
    pin('m_c', 'master', true),
    pin('M_AXI', 'master', true),
    pin('irq', 'out'),
  ]);
  const dst = instance('dst', [
    pin('clk', 'in'),
    pin('s_a', 'slave', true),
    pin('s_b', 'slave', true),
    pin('s_c', 'slave', true),
    pin('S_AXI', 'slave', true),
    pin('irq_in', 'in'),
  ]);
  const sub = instance('sub', [pin('x', 'in')], 'hier');
  const inner = [
    instance('c', [pin('i', 'in')], 'ip', '/sub'),
    instance('a', [pin('o', 'out')], 'ip', '/sub'),
    instance('lone', [pin('p', 'in')], 'ip', '/sub'),
    instance('b', [pin('i', 'in'), pin('o', 'out')], 'ip', '/sub'),
  ];
  const nets = [
    ...['a', 'b', 'c'].map((l) =>
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
    net(
      'axi',
      'aximm',
      [
        ['/src', 'M_AXI'],
        ['/dst', 'S_AXI'],
      ],
      true
    ),
    net('irq', 'interrupt', [
      ['/src', 'irq'],
      ['/dst', 'irq_in'],
    ]),
    net('clk', 'clock', [
      ['/src', 'clk'],
      ['/dst', 'clk'],
    ]),
    net(
      'a_b',
      'signal',
      [
        ['/sub/a', 'o'],
        ['/sub/b', 'i'],
      ],
      false,
      '/sub'
    ),
    net(
      'b_c',
      'signal',
      [
        ['/sub/b', 'o'],
        ['/sub/c', 'i'],
      ],
      false,
      '/sub'
    ),
  ];
  return designOf([src, dst, sub, ...inner], nets, {
    '/': { path: '/', name: 'design', boundaryPins: [], instances: [src.path, dst.path, sub.path] },
    '/sub': {
      path: '/sub',
      name: 'sub',
      boundaryPins: [],
      instances: inner.map((i) => i.path),
    },
  });
}
