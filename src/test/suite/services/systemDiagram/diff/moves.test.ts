/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- the helpers edit parsed JSON of the fixtures */
import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import * as plainDiff from '../../../../../services/systemDiagram/diff/diffWithoutRenames';
import { findMoves } from '../../../../../services/systemDiagram/diff/moves';
import { relocateInstances } from '../../../../../services/systemDiagram/diff/relocate';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';
import { expectMatchesMovedBase, moveDiffAndCheck } from './moveReference';
import { renameOneByOne } from './renameReference';

const FIXTURES = path.resolve(__dirname, '../../../../fixtures/system-design/diff');
const text = (file: string) => fs.readFileSync(path.join(FIXTURES, file), 'utf8');

/** Reads a fixture after `edit` changed its parsed `design` object. */
function bd(file = 'zynq_gpio_base.bd', edit: (design: any) => void = () => {}): SystemGraph {
  const root = JSON.parse(text(file));
  edit(root.design);
  return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root, null, 2))!;
}

const renamed = (t: string, from: string, to: string): string =>
  t.replace(new RegExp(`\\b${from}\\b`, 'g'), to);

const NONE = { added: 0, removed: 0, changed: 0, version: 0, renamed: 0, moved: 0 };
const FIFO = {
  vlnv: 'xilinx.com:ip:axis_data_fifo:2.0',
  parameters: { FIFO_DEPTH: { value: '1024' } },
};
const moves = (diff: SystemGraphDiff) => diff.instances.filter((i) => i.status === 'moved');
const statusOf = (diff: SystemGraphDiff, p: string) => diff.instances.find((i) => i.path === p);
const outline = (diff: SystemGraphDiff) => diff.instances.map((i) => [i.path, i.status]);

/** Adds the empty hierarchies `hier_a`, `hier_b` and `hier_c` (a hierarchy is a component without a VLNV). */
const withHierarchies =
  (edit: (design: any) => void = () => {}) =>
  (d: any) => {
    for (const name of ['hier_a', 'hier_b', 'hier_c']) {
      d.components[name] = { components: { filler: FIFO } };
    }
    edit(d);
  };

/** A block that moved with the design file `zynq_gpio_move_current.bd`: into `gpio_block`, with its nets rewired. */
const base = () => bd();
const moved = () => bd('zynq_gpio_move_current.bd');

describe('relocateInstances (moves)', () => {
  const pairs = new Map([['/axi_gpio_0', '/gpio_block/axi_gpio_0']]);

  it('gives the block its new path, parent and place in the child lists of both levels', () => {
    const [before, after] = [base(), relocateInstances(base(), pairs)];
    expect(after.instances['/axi_gpio_0']).toBeUndefined();
    expect(after.instances['/gpio_block/axi_gpio_0']).toMatchObject({
      path: '/gpio_block/axi_gpio_0',
      name: 'axi_gpio_0',
      parent: '/gpio_block',
    });
    expect(after.levels['/'].instances).toEqual(
      before.levels['/'].instances.filter((p) => p !== '/axi_gpio_0')
    );
    expect(after.levels['/gpio_block'].instances).toEqual([
      ...before.levels['/gpio_block'].instances,
      '/gpio_block/axi_gpio_0',
    ]);
  });

  it('leaves the nets on their levels, and lets endpoints and address segments follow the block', () => {
    const [before, after] = [base(), relocateInstances(base(), pairs)];
    expect(after.nets.map((n) => [n.id, n.level])).toEqual(before.nets.map((n) => [n.id, n.level]));
    const ends = after.nets.flatMap((n) => n.endpoints.map((e) => e.instance));
    expect(ends).toContain('/gpio_block/axi_gpio_0');
    expect(ends).not.toContain('/axi_gpio_0');
    expect(after.addressSegments.map((s) => s.segment)).toContain(
      'gpio_block/axi_gpio_0/S_AXI/Mem'
    );
  });

  it('moves a hierarchy with its children, its levels and its inner nets', () => {
    const g = relocateInstances(
      bd(undefined, withHierarchies()),
      new Map([['/gpio_block', '/hier_b/gpio_block']])
    );
    expect(g.instances['/hier_b/gpio_block/axi_gpio_1']).toMatchObject({
      parent: '/hier_b/gpio_block',
    });
    expect(g.levels['/hier_b/gpio_block']).toMatchObject({
      path: '/hier_b/gpio_block',
      name: 'gpio_block',
      instances: ['/hier_b/gpio_block/axi_gpio_1'],
    });
    expect(g.levels['/hier_b'].instances).toEqual(['/hier_b/filler', '/hier_b/gpio_block']);
    expect(g.nets.filter((n) => n.level === '/hier_b/gpio_block').map((n) => n.id)).toEqual(
      expect.arrayContaining(['/hier_b/gpio_block::block_clk'])
    );
  });

  it('equals the one-at-a-time oracle for several moves and renames at once', () => {
    const several: [string, string][] = [
      ['/axi_gpio_0', '/hier_c/axi_gpio_0'],
      ['/gpio_block', '/hier_b/gpio_block'],
      ['/sys_ps7', '/ps7_main'],
    ];
    const g = bd(undefined, withHierarchies());
    expect(relocateInstances(g, new Map(several))).toEqual(renameOneByOne(g, several));
  });

  it('rewrites the instance.pin texts of a Platform Designer block that moves, with or without a subsystem prefix', () => {
    const qsys = readSystemDesign(
      'x.qsys',
      'x.qsys',
      fs.readFileSync(path.join(FIXTURES, 'nios_rename_base.qsys'), 'utf8')
    )!;
    const slave: [string, string][] = [['/pio_0', '/sub/pio_0']];
    const moved = relocateInstances(qsys, new Map(slave));
    expect(moved.addressSegments.map((x) => x.segment)).toContain('sub/pio_0.s1');
    expect(moved.addressSegments.map((x) => x.segment)).not.toContain('pio_0.s1');
    expect(moved).toEqual(renameOneByOne(qsys, slave));
    const master: [string, string][] = [['/nios2_gen2_0', '/sub/nios2_gen2_0']];
    expect(
      relocateInstances(qsys, new Map(master)).addressSegments.every((x) =>
        x.addressSpace.startsWith('sub/nios2_gen2_0.')
      )
    ).toBe(true);
    // A grafted subsystem's own prefix is replaced by the new path.
    const grafted = {
      ...qsys,
      addressSegments: [
        {
          addressSpace: 'sub/cpu.data_master',
          segment: 'sub/uart.s1',
          masterInstance: '/sub/cpu',
          slaveInstance: '/sub/uart',
          line: 1,
        },
      ],
    };
    const out = relocateInstances(grafted, new Map([['/sub/uart', '/other/uart']]));
    expect(out.addressSegments[0]).toMatchObject({
      addressSpace: 'sub/cpu.data_master',
      segment: 'other/uart.s1',
      slaveInstance: '/other/uart',
    });
  });

  it('does not change its input', () => {
    const g = base();
    const copy = JSON.parse(JSON.stringify(g));
    relocateInstances(g, pairs);
    expect(g).toEqual(copy);
  });
});

/** `gpio_block` into `hier_b`; the nets of the top level name it by its new path. */
const intoHierB = (d: any) => {
  d.components.hier_b.components.gpio_block = d.components.gpio_block;
  delete d.components.gpio_block;
  d.interface_nets.periph_block.interface_ports = ['axi_periph/M01_AXI', 'hier_b/gpio_block/S_AXI'];
  d.nets.fclk.ports = d.nets.fclk.ports.map((p: string) =>
    p === 'gpio_block/clk' ? 'hier_b/gpio_block/clk' : p
  );
  for (const seg of Object.values<any>(d.addressing['/sys_ps7'].address_spaces.Data.segments)) {
    seg.address_block = seg.address_block.replace('/gpio_block/', '/hier_b/gpio_block/');
  }
};

describe('moved blocks in diffSystemGraphs', () => {
  it('reports a block moved into a hierarchy once, with the pins whose connections changed', () => {
    const diff = moveDiffAndCheck(base(), moved());
    expect(moves(diff)).toEqual([
      {
        path: '/gpio_block/axi_gpio_0',
        basePath: '/axi_gpio_0',
        level: '/gpio_block',
        status: 'moved',
        baseType: 'xilinx.com:ip:axi_gpio:2.0',
        currentType: 'xilinx.com:ip:axi_gpio:2.0',
        parameters: [],
        pins: [
          {
            pin: 'S_AXI',
            status: 'changed',
            basePeers: ['axi_periph/M00_AXI'],
            currentPeers: ['S_AXI_0'],
            gained: ['S_AXI_0'],
            lost: ['axi_periph/M00_AXI'],
          },
          {
            pin: 's_axi_aclk',
            status: 'changed',
            basePeers: ['axi_periph/ACLK', 'gpio_block/clk', 'sys_ps7/FCLK_CLK0'],
            currentPeers: ['axi_gpio_1/s_axi_aclk', 'clk'],
            gained: ['axi_gpio_1/s_axi_aclk', 'clk'],
            lost: ['axi_periph/ACLK', 'gpio_block/clk', 'sys_ps7/FCLK_CLK0'],
          },
        ],
      },
    ]);
    // The neighbours report the rewiring from their side; the moved block is not also removed and added.
    expect(outline(diff)).toEqual([
      ['/axi_periph', 'changed'],
      ['/gpio_block', 'changed'],
      ['/gpio_block/axi_gpio_0', 'moved'],
    ]);
    expect(diff.summary).toEqual({ ...NONE, changed: 2, moved: 1 });
    expect(diff.segments).toEqual([]);
  });

  it('reports a block moved out of a hierarchy, the same pair the other way round', () => {
    const diff = moveDiffAndCheck(moved(), base());
    expect(moves(diff).map((m) => [m.basePath, m.path, m.level])).toEqual([
      ['/gpio_block/axi_gpio_0', '/axi_gpio_0', '/'],
    ]);
    expect(diff.summary).toEqual({ ...NONE, changed: 2, moved: 1 });
  });

  it('reports a block moved between two hierarchies', () => {
    const [before, after] = [
      bd(
        undefined,
        withHierarchies((d) => (d.components.hier_a.components.mover = FIFO))
      ),
      bd(
        undefined,
        withHierarchies((d) => (d.components.gpio_block.components.mover = FIFO))
      ),
    ];
    const diff = moveDiffAndCheck(before, after);
    expect(moves(diff)).toEqual([
      expect.objectContaining({
        basePath: '/hier_a/mover',
        path: '/gpio_block/mover',
        level: '/gpio_block',
        pins: [],
      }),
    ]);
    expect(diff.summary).toEqual({ ...NONE, moved: 1 });
  });

  it('reports a block moved to the top level, and one moved into a hierarchy, with no pins', () => {
    const [out, into] = [
      moveDiffAndCheck(
        bd(undefined, (d) => (d.components.gpio_block.components.mover = FIFO)),
        bd(undefined, (d) => (d.components.mover = FIFO))
      ),
      moveDiffAndCheck(
        bd(undefined, (d) => (d.components.mover = FIFO)),
        bd(undefined, (d) => (d.components.gpio_block.components.mover = FIFO))
      ),
    ];
    expect(outline(out)).toEqual([['/mover', 'moved']]);
    expect(outline(into)).toEqual([['/gpio_block/mover', 'moved']]);
    expect(moves(into)[0]).toMatchObject({ basePath: '/mover', level: '/gpio_block', pins: [] });
  });

  it('reports a moved hierarchy once, and nothing for its children', () => {
    const diff = moveDiffAndCheck(
      bd(undefined, withHierarchies()),
      bd(undefined, withHierarchies(intoHierB))
    );
    expect(diff.instances.map((i) => [i.status, i.basePath, i.path])).toEqual([
      ['moved', '/gpio_block', '/hier_b/gpio_block'],
    ]);
    expect(moves(diff)[0].pins).toEqual([]);
    expect(diff.summary).toEqual({ ...NONE, moved: 1 });
    expect(diff.segments).toEqual([]);
  });

  it('keeps removed plus added for a move with a changed parameter', () => {
    const diff = moveDiffAndCheck(
      base(),
      bd('zynq_gpio_move_current.bd', (d) => {
        d.components.gpio_block.components.axi_gpio_0.parameters.C_GPIO_WIDTH.value = '16';
      })
    );
    expect(diff.summary.moved).toBe(0);
    expect(statusOf(diff, '/axi_gpio_0')?.status).toBe('removed');
    expect(statusOf(diff, '/gpio_block/axi_gpio_0')?.status).toBe('added');
  });

  it('keeps removed plus added for a move with a changed version', () => {
    const diff = moveDiffAndCheck(
      base(),
      bd('zynq_gpio_move_current.bd', (d) => {
        d.components.gpio_block.components.axi_gpio_0.vlnv = 'xilinx.com:ip:axi_gpio:2.1';
      })
    );
    expect(diff.summary.moved).toBe(0);
    expect(statusOf(diff, '/axi_gpio_0')?.status).toBe('removed');
  });

  it('keeps removed plus added for a block that is moved and renamed', () => {
    const diff = moveDiffAndCheck(
      base(),
      bd('zynq_gpio_move_current.bd', (d) => {
        const hier = d.components.gpio_block;
        hier.components.axi_gpio_x = hier.components.axi_gpio_0;
        delete hier.components.axi_gpio_0;
        hier.interface_nets.gpio_axi_0.interface_ports = ['S_AXI_0', 'axi_gpio_x/S_AXI'];
        hier.nets.block_clk.ports = ['clk', 'axi_gpio_1/s_axi_aclk', 'axi_gpio_x/s_axi_aclk'];
      })
    );
    expect(diff.summary).toMatchObject({ renamed: 0, moved: 0 });
    expect(statusOf(diff, '/axi_gpio_0')?.status).toBe('removed');
    expect(statusOf(diff, '/gpio_block/axi_gpio_x')?.status).toBe('added');
  });

  it('keeps removed plus added when a child of a moved hierarchy changed', () => {
    const diff = diffSystemGraphs(
      bd(undefined, withHierarchies()),
      bd(
        undefined,
        withHierarchies((d) => {
          intoHierB(d);
          d.components.hier_b.components.gpio_block.components.axi_gpio_1.parameters.C_ALL_OUTPUTS.value =
            '0';
        })
      )
    );
    expect(diff.summary.moved).toBe(0);
    expect(statusOf(diff, '/gpio_block')?.status).toBe('removed');
    expect(statusOf(diff, '/hier_b/gpio_block')?.status).toBe('added');
  });

  it('does not pair two identical removed blocks with two identical added ones', () => {
    const diff = diffSystemGraphs(
      bd(
        undefined,
        withHierarchies((d) => {
          d.components.hier_a.components.twin = FIFO;
          d.components.hier_b.components.twin = FIFO;
        })
      ),
      bd(
        undefined,
        withHierarchies((d) => {
          d.components.hier_c.components.twin = FIFO;
          d.components.twin = FIFO;
        })
      )
    );
    expect(diff.summary).toMatchObject({ moved: 0, removed: 2, added: 2 });
  });

  it('does not pair one removed block with two added blocks of the same signature', () => {
    const diff = diffSystemGraphs(
      bd(
        undefined,
        withHierarchies((d) => (d.components.twin = FIFO))
      ),
      bd(
        undefined,
        withHierarchies((d) => {
          d.components.hier_a.components.twin = FIFO;
          d.components.hier_b.components.twin = FIFO;
        })
      )
    );
    expect(diff.summary).toMatchObject({ moved: 0, removed: 1, added: 2 });
  });

  it('reports the same move, with the paths swapped, when base and current swap', () => {
    const from = bd(undefined, (d) => (d.components.mover = FIFO));
    const to = bd(undefined, (d) => (d.components.gpio_block.components.mover = FIFO));
    const [forward, backward] = [diffSystemGraphs(from, to), diffSystemGraphs(to, from)];
    expect(moves(forward)).toHaveLength(1);
    expect(moves(backward).map((m) => [m.path, m.basePath])).toEqual(
      moves(forward).map((m) => [m.basePath, m.path])
    );
    expect(backward.summary).toEqual(forward.summary);
  });

  it('finds no move between a graph and itself', () => {
    expect(diffSystemGraphs(moved(), moved()).summary).toEqual(NONE);
  });

  it('does not depend on the order of instances, nets, endpoints and ports', () => {
    const reverse = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
    const shuffle = (d: any) => {
      d.components = reverse(d.components);
      d.nets = reverse(d.nets);
      d.interface_nets = reverse(d.interface_nets);
    };
    const expected = diffSystemGraphs(base(), moved());
    expect(
      diffSystemGraphs(bd(undefined, shuffle), bd('zynq_gpio_move_current.bd', shuffle))
    ).toEqual(expected);
  });
});

describe('moves next to renames', () => {
  const rename = (t: string) => renamed(t, 'sys_ps7', 'ps7_main');
  const renamedMoved = () =>
    readSystemDesign('x.bd', 'x.bd', rename(text('zynq_gpio_move_current.bd')))!;

  it('reports a rename and a move together', () => {
    const diff = moveDiffAndCheck(base(), renamedMoved());
    expect(diff.instances.map((i) => [i.status, i.basePath, i.path])).toEqual([
      ['changed', undefined, '/axi_periph'],
      ['changed', undefined, '/gpio_block'],
      ['moved', '/axi_gpio_0', '/gpio_block/axi_gpio_0'],
      ['renamed', '/sys_ps7', '/ps7_main'],
    ]);
    expect(diff.summary).toEqual({ ...NONE, changed: 2, renamed: 1, moved: 1 });
    // The peer written with its base name on the base side of the moved block.
    expect(moves(diff)[0].pins.find((p) => p.pin === 's_axi_aclk')?.basePeers).toContain(
      'sys_ps7/FCLK_CLK0'
    );
    moveDiffAndCheck(renamedMoved(), base());
  });

  describe('a renamed block that a move would change', () => {
    const IO = {
      ...FIFO,
      interface_ports: {
        S_AXIS: { mode: 'Slave', vlnv: 'xilinx.com:interface:axis_rtl:1.0' },
        M_AXIS: { mode: 'Master', vlnv: 'xilinx.com:interface:axis_rtl:1.0' },
      },
    };
    const LONELY = { ...IO, parameters: { FIFO_DEPTH: { value: '64' } } };
    // Not like `mover`, or the rename would be ambiguous in `hier_a` (see the concept document).
    const RENAMED = { ...IO, parameters: { FIFO_DEPTH: { value: '32' } } };
    const before = () =>
      bd(undefined, (d) => {
        d.components.hier_a = { components: { r0: RENAMED, filler: IO } };
        d.components.mover = IO;
        d.components.lonely = LONELY;
        d.components.hier_b = { components: { f: IO } };
      });
    const after = (connect: boolean) =>
      bd(undefined, (d) => {
        d.components.hier_a = {
          components: { r: RENAMED, filler: IO, mover: IO },
          ...(connect && {
            interface_nets: { n: { interface_ports: ['r/M_AXIS', 'mover/S_AXIS'] } },
          }),
        };
        d.components.hier_b = { components: { f: IO, lonely: LONELY } };
      });

    it('drops only the moves connected to it; an unrelated move stays', () => {
      const diff = moveDiffAndCheck(before(), after(true));
      expect(diff.summary).toMatchObject({ renamed: 1, moved: 1 });
      expect(diff.instances.map((i) => [i.status, i.basePath, i.path])).toEqual(
        expect.arrayContaining([
          ['renamed', '/hier_a/r0', '/hier_a/r'],
          ['moved', '/lonely', '/hier_b/lonely'],
          ['removed', undefined, '/mover'],
          ['added', undefined, '/hier_a/mover'],
        ])
      );
      moveDiffAndCheck(after(true), before());
    });

    it('keeps both moves when the renamed block is not connected to them', () => {
      const diff = moveDiffAndCheck(before(), after(false));
      expect(diff.summary).toMatchObject({ renamed: 1, moved: 2 });
    });
  });

  it('keeps removed plus added for a child moved into a hierarchy that is renamed', () => {
    // The whole design text names `gpio_main` instead of `gpio_block`, as a real rename does.
    const toMain = (edit: (design: any) => void = () => {}) => {
      const root = JSON.parse(renamed(text('zynq_gpio_base.bd'), 'gpio_block', 'gpio_main'));
      edit(root.design);
      return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root, null, 2))!;
    };
    const withMover = (d: any) => (d.components.gpio_main.components.mover = FIFO);
    const plainBase = bd(undefined, (d) => (d.components.mover = FIFO));
    // The rename alone is a rename.
    const alone = moveDiffAndCheck(base(), toMain());
    expect(alone.summary).toEqual({ ...NONE, renamed: 1 });
    // With a child moved into it, the hierarchy changed: removed plus added, the child too.
    const to = toMain(withMover);
    for (const diff of [moveDiffAndCheck(plainBase, to), moveDiffAndCheck(to, plainBase)]) {
      expect(diff.summary.moved).toBe(0);
      expect(diff.summary.renamed).toBe(0);
    }
  });

  it('drops the moves next to a renamed block, as findMoves does on its own', () => {
    const [from, to] = [base(), moved()];
    const plain = plainDiff.diffWithoutRenames(from, to);
    expect(findMoves(from, to, plain, new Map()).moves).toHaveLength(1);
    // `axi_periph` is a neighbour of the moved block: if it were a renamed block, the move changes it,
    // and it is the only move.
    const renames = new Map([['/axi_periph', '/axi_periph_old']]);
    const found = findMoves(from, to, plain, renames);
    expect(found.moves).toEqual([]);
    expect(found.diff).toBe(plain);
  });
});

describe('what move detection costs', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds no plain diff when there is no candidate pair', () => {
    const spy = jest.spyOn(plainDiff, 'diffWithoutRenames');
    diffSystemGraphs(
      bd(),
      bd(undefined, (d) => (d.components.sys_ps7.parameters = {}))
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is one plain diff plus one per round when a move is accepted', () => {
    const spy = jest.spyOn(plainDiff, 'diffWithoutRenames');
    expect(diffSystemGraphs(base(), moved()).summary.moved).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('the reference check', () => {
  const detected = diffSystemGraphs(base(), moved());
  const mutated = (mutate: (copy: SystemGraphDiff) => void): SystemGraphDiff => {
    const copy = JSON.parse(JSON.stringify(detected)) as SystemGraphDiff;
    mutate(copy);
    return copy;
  };
  const entry = (d: SystemGraphDiff) => d.instances.find((i) => i.status === 'moved')!;

  it('accepts the detected diff', () => {
    expectMatchesMovedBase(base(), moved(), detected);
  });

  it.each([
    ['dropping the pins of the moved block', (d: SystemGraphDiff) => (entry(d).pins = [])],
    ['changing its base path', (d: SystemGraphDiff) => (entry(d).basePath = '/sync_0')],
    ['changing its level', (d: SystemGraphDiff) => (entry(d).level = '/')],
    ['counting it as changed', (d: SystemGraphDiff) => (d.summary.changed += 1)],
    ['setting the status to renamed', (d: SystemGraphDiff) => (entry(d).status = 'renamed')],
    [
      'adding a fake moved entry',
      (d: SystemGraphDiff) =>
        d.instances.push({
          path: '/gpio_block/sync_0',
          basePath: '/sync_0',
          level: '/gpio_block',
          status: 'moved',
          parameters: [],
          pins: [],
        }),
    ],
  ])('fails after %s', (_name, mutate) => {
    expect(() => expectMatchesMovedBase(base(), moved(), mutated(mutate))).toThrow();
  });
});
