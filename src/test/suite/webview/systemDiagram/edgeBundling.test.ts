import {
  COMB_OFFSET,
  bundleKey,
  bundleLabel,
  endBranches,
  planBundles,
  type BundleCandidate,
  type PortSpot,
  type PortYs,
} from '../../../../webview/systemDiagram/layout/edgeBundling';
import { PIN_ROW_HEIGHT } from '../../../../webview/systemDiagram/layout/pinRows';

const candidate = (
  index: number,
  over: Partial<BundleCandidate> = {},
  handles?: { source?: string; target?: string }
): BundleCandidate => ({
  edgeId: `/::n${index}#1`,
  netId: `/::n${index}`,
  sourceNode: '/a',
  targetNode: '/b',
  category: 'axis',
  isInterface: true,
  sourcePin: `m${index}`,
  targetPin: `s${index}`,
  sourceHandle: handles?.source ?? `m${index}`,
  targetHandle: handles?.target ?? `s${index}`,
  ...over,
});

/** Ports at consecutive rows from y = 50, named by `prefix` and index. */
const rows = (prefix: string, count: number, from = 0, side: PortSpot['side'] = 'east') =>
  new Map<string, PortSpot>(
    Array.from({ length: count }, (_, i) => [
      `${prefix}${from + i}`,
      { y: 50 + i * PIN_ROW_HEIGHT, side },
    ])
  );

const ports = (count: number): PortYs =>
  new Map([
    ['/a', rows('m', count)],
    ['/b', rows('s', count)],
  ]);
const none = new Set<string>();
const three = [0, 1, 2].map((i) => candidate(i));

describe('planBundles', () => {
  it('groups parallel connections of one category between two blocks', () => {
    const { bundles, rest } = planBundles(three, ports(3), none);
    expect(rest).toEqual([]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({
      key: 'bundle:/a->/b|axis|i',
      sourceNode: '/a',
      targetNode: '/b',
      category: 'axis',
      isInterface: true,
      sourceHandles: ['m0', 'm1', 'm2'],
      targetHandles: ['s0', 's1', 's2'],
    });
    expect(bundles[0].members.map((member) => member.edgeId)).toEqual(three.map((c) => c.edgeId));
    expect(bundles[0].members[1]).toEqual({
      edgeId: '/::n1#1',
      netId: '/::n1',
      sourcePin: 'm1',
      targetPin: 's1',
      sourceHandle: 'm1',
      targetHandle: 's1',
    });
  });

  it('needs two connections', () => {
    const plan = planBundles([three[0]], ports(3), none);
    expect(plan.bundles).toEqual([]);
    expect(plan.rest).toEqual([three[0]]);
  });

  it('keys on the category, the interface-ness and both blocks', () => {
    const mixed = [
      candidate(0),
      candidate(1),
      candidate(2, { category: 'aximm' }),
      candidate(3, { category: 'aximm' }),
      candidate(4, { isInterface: false }),
      candidate(5, { isInterface: false }),
      candidate(6, { targetNode: '/c' }),
    ];
    const plan = planBundles(
      mixed,
      new Map([
        ['/a', rows('m', 7)],
        ['/b', rows('s', 7)],
        ['/c', rows('s', 7)],
      ]),
      none
    );
    expect(plan.bundles.map((bundle) => bundle.key).sort()).toEqual([
      'bundle:/a->/b|aximm|i',
      'bundle:/a->/b|axis|i',
      'bundle:/a->/b|axis|s',
    ]);
    expect(plan.rest.map((c) => c.edgeId)).toEqual(['/::n6#1']);
  });

  it('never bundles clock and reset connections', () => {
    const clocks = [0, 1].map((i) => candidate(i, { category: 'clock' }));
    const resets = [2, 3].map((i) => candidate(i, { category: 'reset' }));
    const plan = planBundles([...clocks, ...resets], ports(4), none);
    expect(plan.bundles).toEqual([]);
    expect(plan.rest).toHaveLength(4);
  });

  it('skips a key the user unbundled', () => {
    const plan = planBundles(three, ports(3), new Set([bundleKey(three[0])]));
    expect(plan.bundles).toEqual([]);
    expect(plan.rest).toEqual(three);
  });

  it('leaves a pair on a block without ports (an expanded frame) unbundled', () => {
    const plan = planBundles(three, new Map([['/a', rows('m', 3)]]), none);
    expect(plan.bundles).toEqual([]);
    expect(plan.rest).toHaveLength(3);
  });

  describe('contiguity', () => {
    it('bundles member pins on consecutive rows in any order', () => {
      const shuffled = [candidate(2), candidate(0), candidate(1)];
      expect(planBundles(shuffled, ports(3), none).bundles[0].sourceHandles).toEqual([
        'm0',
        'm1',
        'm2',
      ]);
    });

    it('does not bundle when a row separates the pins at the source end', () => {
      const gap: PortYs = new Map([
        [
          '/a',
          new Map([
            ['m0', { y: 50, side: 'east' as const }],
            ['m1', { y: 50 + PIN_ROW_HEIGHT, side: 'east' as const }],
            ['m2', { y: 50 + 3 * PIN_ROW_HEIGHT, side: 'east' as const }],
          ]),
        ],
        ['/b', rows('s', 3)],
      ]);
      const plan = planBundles(three, gap, none);
      expect(plan.bundles).toEqual([]);
      expect(plan.rest).toEqual(three);
    });

    it('does not bundle when a row separates the pins at the target end', () => {
      const gap: PortYs = new Map([
        ['/a', rows('m', 3)],
        [
          '/b',
          new Map([
            ['s0', { y: 50, side: 'east' as const }],
            ['s1', { y: 50 + PIN_ROW_HEIGHT, side: 'east' as const }],
            ['s2', { y: 50 + 3 * PIN_ROW_HEIGHT, side: 'east' as const }],
          ]),
        ],
      ]);
      expect(planBundles(three, gap, none).bundles).toEqual([]);
    });

    it('does not bundle when a west pin sits between east pins at the source end', () => {
      const mixed: PortYs = new Map([
        [
          '/a',
          new Map<string, PortSpot>([
            ['m0', { y: 50, side: 'east' }],
            ['m1', { y: 50 + PIN_ROW_HEIGHT, side: 'west' }],
            ['m2', { y: 50 + 2 * PIN_ROW_HEIGHT, side: 'east' }],
          ]),
        ],
        ['/b', rows('s', 3)],
      ]);
      const plan = planBundles(three, mixed, none);
      expect(plan.bundles).toEqual([]);
      expect(plan.rest).toEqual(three);
    });

    it('does not bundle when the target pins are on both sides', () => {
      const mixed: PortYs = new Map([
        ['/a', rows('m', 3)],
        [
          '/b',
          new Map<string, PortSpot>([
            ['s0', { y: 50, side: 'west' }],
            ['s1', { y: 50 + PIN_ROW_HEIGHT, side: 'east' }],
            ['s2', { y: 50 + 2 * PIN_ROW_HEIGHT, side: 'west' }],
          ]),
        ],
      ]);
      expect(planBundles(three, mixed, none).bundles).toEqual([]);
    });

    it('bundles pins that all sit on the west side', () => {
      const west: PortYs = new Map([
        ['/a', rows('m', 3, 0, 'west')],
        ['/b', rows('s', 3)],
      ]);
      expect(planBundles(three, west, none).bundles).toHaveLength(1);
    });

    it('dedupes shared ports: a fan-out driver is one port', () => {
      const fanOut = [0, 1, 2].map((i) => candidate(i, {}, { source: 'm0' }));
      const { bundles } = planBundles(fanOut, ports(3), none);
      expect(bundles[0].sourceHandles).toEqual(['m0']);
      expect(bundles[0].sourceHandle).toBe('m0');
      expect(bundles[0].targetHandles).toEqual(['s0', 's1', 's2']);
    });

    it('treats a single port at both ends as contiguous', () => {
      const same = [0, 1].map((i) => candidate(i, {}, { source: 'm0', target: 's0' }));
      expect(planBundles(same, ports(3), none).bundles).toHaveLength(1);
    });
  });

  describe('representative port', () => {
    it('is the median row for an odd count', () => {
      const { bundles } = planBundles(three, ports(3), none);
      expect([bundles[0].sourceHandle, bundles[0].targetHandle]).toEqual(['m1', 's1']);
    });

    it('is the lower median for an even count', () => {
      const four = [0, 1, 2, 3].map((i) => candidate(i));
      const { bundles } = planBundles(four, ports(4), none);
      expect([bundles[0].sourceHandle, bundles[0].targetHandle]).toEqual(['m1', 's1']);
    });
  });

  it('gives each bundle a unique id that does not look like a net edge id', () => {
    const odd = '/x::y/#1';
    const mixed = [
      candidate(0, { sourceNode: odd }),
      candidate(1, { sourceNode: odd }),
      candidate(2),
      candidate(3),
    ];
    const plan = planBundles(
      mixed,
      new Map([
        [odd, rows('m', 4)],
        ['/a', rows('m', 4, 2)],
        ['/b', rows('s', 4)],
      ]),
      none
    );
    const keys = plan.bundles.map((bundle) => bundle.key);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      expect(key).not.toMatch(/#\d+$/);
    }
  });
});

describe('bundleLabel', () => {
  it('is the count and the short category name', () => {
    expect(bundleLabel('aximm', 12)).toBe('×12 AXI');
    expect(bundleLabel('axis', 8)).toBe('×8 AXIS');
    expect(bundleLabel('interrupt', 16)).toBe('×16 IRQ');
  });
});

describe('endBranches', () => {
  const centres = new Map([
    ['m0', { x: 100, y: 60 }],
    ['m1', { x: 100, y: 78 }],
    ['m2', { x: 100, y: 96 }],
  ]);

  it('runs each other pin out to the comb outside an east border, then to the trunk y', () => {
    const branches = endBranches({ side: 'east', borderX: 104, centres }, ['m0', 'm1', 'm2'], 'm1');
    const combX = 104 + COMB_OFFSET;
    expect(branches).toEqual([
      [
        { x: 100, y: 60 },
        { x: combX, y: 60 },
        { x: combX, y: 78 },
      ],
      [
        { x: 100, y: 96 },
        { x: combX, y: 96 },
        { x: combX, y: 78 },
      ],
    ]);
  });

  it('puts the comb left of a west border', () => {
    const branches = endBranches({ side: 'west', borderX: 96, centres }, ['m0', 'm1'], 'm1');
    expect(branches).toEqual([
      [
        { x: 100, y: 60 },
        { x: 96 - COMB_OFFSET, y: 60 },
        { x: 96 - COMB_OFFSET, y: 78 },
      ],
    ]);
  });

  it('has no branch at an end with one port', () => {
    expect(endBranches({ side: 'east', borderX: 104, centres }, ['m1'], 'm1')).toEqual([]);
  });
});
