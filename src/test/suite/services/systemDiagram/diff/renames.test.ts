/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- the helpers edit parsed JSON of the fixtures */
import * as fs from 'fs';
import * as plainDiff from '../../../../../services/systemDiagram/diff/diffWithoutRenames';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { diffWithoutRenames } from '../../../../../services/systemDiagram/diff/diffWithoutRenames';
import { diffAndCheck, expectMatchesRenamedBase } from './renameReference';
import { renameInstance } from '../../../../../services/systemDiagram/diff/renames';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';

const BASE_TEXT = fs.readFileSync(
  path.resolve(__dirname, '../../../../fixtures/system-design/diff/zynq_gpio_base.bd'),
  'utf8'
);

/** Writes `from` as `to` wherever the fixture names a block (whole words only). */
const renamed = (text: string, from: string, to: string): string =>
  text.replace(new RegExp(`\\b${from}\\b`, 'g'), to);

/** Reads the fixture after `rename` changed its text and `edit` its parsed `design` object. */
function bd(rename: (text: string) => string = (t) => t, edit: (design: any) => void = () => {}) {
  const root = JSON.parse(rename(BASE_TEXT));
  edit(root.design);
  return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root, null, 2))!;
}

const reverse = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());

const toMain = (t: string) => renamed(t, 'axi_gpio_0', 'axi_gpio_main');
const hierToMain = (t: string) => renamed(t, 'gpio_block', 'gpio_main');
const NONE = { added: 0, removed: 0, changed: 0, version: 0, renamed: 0 };

const renames = (diff: SystemGraphDiff) => diff.instances.filter((i) => i.status === 'renamed');
const statusOf = (diff: SystemGraphDiff, p: string) => diff.instances.find((i) => i.path === p);

/** The detected diff equals the plain diff of the renamed base, and the renames are real candidates. */
function expectNothingHidden(base: SystemGraph, current: SystemGraph): void {
  diffAndCheck(base, current);
}

describe('renameInstance', () => {
  it('equals the graph read from the design in which the block is written under the new name', () => {
    expect(renameInstance(bd(), '/axi_gpio_0', '/axi_gpio_main')).toEqual(bd(toMain));
  });

  it('renames a hierarchy with its children, inner nets and address segments', () => {
    const g = renameInstance(bd(), '/gpio_block', '/gpio_main');
    expect(g).toEqual(bd(hierToMain));
    expect(Object.keys(g.instances)).toContain('/gpio_main/axi_gpio_1');
    expect(g.instances['/gpio_main/axi_gpio_1']).toMatchObject({
      name: 'axi_gpio_1',
      parent: '/gpio_main',
    });
    expect(g.levels['/gpio_main']).toMatchObject({
      path: '/gpio_main',
      name: 'gpio_main',
      instances: ['/gpio_main/axi_gpio_1'],
    });
    expect(g.nets.filter((n) => n.level === '/gpio_main').map((n) => n.id)).toEqual(
      expect.arrayContaining(['/gpio_main::block_clk'])
    );
    expect(g.addressSegments.map((s) => s.segment)).toContain('gpio_main/axi_gpio_1/S_AXI/Reg');
  });

  it('renames the leading path of address space and segment texts, and the instances they name', () => {
    const g = renameInstance(bd(), '/axi_gpio_0', '/axi_gpio_main');
    const segment = g.addressSegments.find((s) => s.segment === 'axi_gpio_main/S_AXI/Mem');
    expect(segment).toMatchObject({
      addressSpace: 'sys_ps7/Data',
      slaveInstance: '/axi_gpio_main',
    });
    const master = renameInstance(bd(), '/sys_ps7', '/ps7_main');
    expect(master.addressSegments[0]).toMatchObject({
      addressSpace: 'ps7_main/Data',
      masterInstance: '/ps7_main',
    });
  });

  it('keeps the position of the block in the child list of its parent', () => {
    const before = bd();
    const index = before.levels['/'].instances.indexOf('/axi_gpio_0');
    expect(index).toBeGreaterThan(0);
    const after = renameInstance(before, '/axi_gpio_0', '/axi_gpio_main');
    expect(after.levels['/'].instances.indexOf('/axi_gpio_main')).toBe(index);
    expect(Object.keys(after.instances).indexOf('/axi_gpio_main')).toBe(
      Object.keys(before.instances).indexOf('/axi_gpio_0')
    );
  });

  it('does not change its input', () => {
    const g = bd();
    const copy = JSON.parse(JSON.stringify(g));
    renameInstance(g, '/gpio_block', '/gpio_main');
    renameInstance(g, '/axi_gpio_0', '/axi_gpio_main');
    expect(g).toEqual(copy);
  });
});

describe('renamed blocks in diffSystemGraphs', () => {
  it('reports a pure rename as one renamed block, without segments or pins of other blocks', () => {
    const [base, current] = [bd(), bd(toMain)];
    const diff = diffSystemGraphs(base, current);
    expect(diff.instances).toEqual([
      {
        path: '/axi_gpio_main',
        basePath: '/axi_gpio_0',
        level: '/',
        status: 'renamed',
        baseType: 'xilinx.com:ip:axi_gpio:2.0',
        currentType: 'xilinx.com:ip:axi_gpio:2.0',
        parameters: [],
        pins: [],
      },
    ]);
    expect(diff.ports).toEqual([]);
    expect(diff.segments).toEqual([]);
    expect(diff.summary).toEqual({ ...NONE, renamed: 1 });
    expectNothingHidden(base, current);
  });

  it('keeps removed plus added for a rename with a changed parameter', () => {
    const diff = diffSystemGraphs(
      bd(),
      bd(toMain, (d) => {
        d.components.axi_gpio_main.parameters.C_GPIO_WIDTH.value = '16';
      })
    );
    expect(diff.instances.map((i) => i.status)).toEqual(['removed', 'added']);
    expect(statusOf(diff, '/axi_gpio_0')?.status).toBe('removed');
    expect(statusOf(diff, '/axi_gpio_main')?.status).toBe('added');
  });

  it('keeps removed plus added for a rename with a rewired pin', () => {
    const current = bd(toMain, (d) => {
      // The same pins, but the clock pin sits on another net.
      d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => p !== 'axi_gpio_main/s_axi_aclk');
      d.nets.ext_rst.ports.push('axi_gpio_main/s_axi_aclk');
    });
    const diff = diffSystemGraphs(bd(), current);
    expect(diff.instances.map((i) => i.status)).toEqual(['removed', 'added']);
    expectNothingHidden(bd(), current);
  });

  it('keeps removed plus added for a rename with a changed version', () => {
    const diff = diffSystemGraphs(
      bd(),
      bd(toMain, (d) => {
        d.components.axi_gpio_main.vlnv = 'xilinx.com:ip:axi_gpio:2.1';
      })
    );
    expect(diff.instances.map((i) => i.status)).toEqual(['removed', 'added']);
  });

  it('does not pair two identical removed blocks with two identical added ones', () => {
    const twins = (a: string, b: string) => (d: any) => {
      for (const name of [a, b]) {
        d.components[name] = {
          vlnv: 'xilinx.com:ip:axis_data_fifo:2.0',
          parameters: { FIFO_DEPTH: { value: '1024' } },
        };
      }
    };
    const diff = diffSystemGraphs(
      bd(undefined, twins('f_a', 'f_b')),
      bd(undefined, twins('f_c', 'f_d'))
    );
    expect(diff.summary).toMatchObject({ added: 2, removed: 2, renamed: 0 });
  });

  it('pairs two different renames that are connected to each other', () => {
    const both = (t: string) =>
      renamed(renamed(t, 'sys_ps7', 'ps7_main'), 'axi_gpio_0', 'gpio_main');
    const [base, current] = [bd(), bd(both)];
    const diff = diffSystemGraphs(base, current);
    expect(renames(diff).map((r) => [r.basePath, r.path])).toEqual([
      ['/axi_gpio_0', '/gpio_main'],
      ['/sys_ps7', '/ps7_main'],
    ]);
    expect(diff.summary).toEqual({ ...NONE, renamed: 2 });
    expect(diff.segments).toEqual([]);
    expectNothingHidden(base, current);
  });

  it('reports a renamed hierarchy once, and nothing for its children', () => {
    const [base, current] = [bd(), bd(hierToMain)];
    const diff = diffSystemGraphs(base, current);
    expect(diff.instances.map((i) => [i.status, i.basePath, i.path])).toEqual([
      ['renamed', '/gpio_block', '/gpio_main'],
    ]);
    expect(diff.summary).toEqual({ ...NONE, renamed: 1 });
    expect(diff.segments).toEqual([]);
    expectNothingHidden(base, current);
  });

  it('does not pair a renamed hierarchy whose child changed', () => {
    const diff = diffSystemGraphs(
      bd(),
      bd(hierToMain, (d) => {
        d.components.gpio_main.components.axi_gpio_1.parameters.C_ALL_OUTPUTS.value = '0';
      })
    );
    expect(diff.summary.renamed).toBe(0);
    expect(statusOf(diff, '/gpio_block')?.status).toBe('removed');
    expect(statusOf(diff, '/gpio_main')?.status).toBe('added');
  });

  describe('blocks of different levels', () => {
    const fifo = {
      vlnv: 'xilinx.com:ip:axis_data_fifo:2.0',
      parameters: { FIFO_DEPTH: { value: '1024' } },
    };

    it('does not pair a block moved into another level under the same name', () => {
      const diff = diffSystemGraphs(
        bd(undefined, (d) => (d.components.mover = fifo)),
        bd(undefined, (d) => (d.components.gpio_block.components.mover = fifo))
      );
      expect(diff.summary).toMatchObject({ added: 1, removed: 1, renamed: 0 });
      expect(statusOf(diff, '/mover')?.status).toBe('removed');
      expect(statusOf(diff, '/gpio_block/mover')?.status).toBe('added');
    });

    it('does not pair a removed and an added block of the same type in different levels', () => {
      const diff = diffSystemGraphs(
        bd(undefined, (d) => (d.components.one = fifo)),
        bd(undefined, (d) => (d.components.gpio_block.components.two = fifo))
      );
      expect(diff.summary).toMatchObject({ added: 1, removed: 1, renamed: 0 });
    });
  });

  it('leaves the unrelated changes as the diff without detection reports them', () => {
    const unrelated = (d: any) => {
      d.components.sys_ps7.parameters.PCW_USE_M_AXI_GP0.value = '0';
      delete d.ports.led_o;
    };
    const [base, current] = [bd(), bd(toMain, unrelated)];
    const diff = diffSystemGraphs(base, current);
    const only = diffSystemGraphs(base, bd(undefined, unrelated));
    expect(renames(diff)).toHaveLength(1);
    expect(diff.instances.filter((i) => i.status !== 'renamed')).toEqual(only.instances);
    expect(diff.ports).toEqual(only.ports);
    expect(diff.segments).toEqual(only.segments);
    expect(diff.summary).toEqual({ ...only.summary, renamed: 1 });
    expectNothingHidden(base, current);
  });

  it('reports the same renames, with the paths swapped, when base and current swap', () => {
    const [a, b] = [
      bd(),
      bd(toMain, (d) => (d.components.sys_ps7.parameters.PCW_USE_M_AXI_GP0.value = '0')),
    ];
    const [forward, backward] = [diffSystemGraphs(a, b), diffSystemGraphs(b, a)];
    expect(renames(backward).map((r) => [r.path, r.basePath])).toEqual(
      renames(forward).map((r) => [r.basePath, r.path])
    );
    expect(backward.summary).toEqual({
      added: forward.summary.removed,
      removed: forward.summary.added,
      changed: forward.summary.changed,
      version: forward.summary.version,
      renamed: forward.summary.renamed,
    });
  });

  it('finds no change between a graph and itself', () => {
    const g = bd();
    const diff = diffSystemGraphs(g, g);
    expect([diff.instances, diff.ports, diff.segments]).toEqual([[], [], []]);
    expect(diff.summary).toEqual(NONE);
  });

  it('does not depend on the order of instances, nets, endpoints and ports', () => {
    const shuffle = (d: any) => {
      d.components = reverse(d.components);
      d.nets = reverse(d.nets);
      d.interface_nets = reverse(d.interface_nets);
      d.ports = reverse(d.ports);
      for (const net of Object.values<any>(d.nets)) {
        net.ports.reverse();
      }
    };
    const expected = diffSystemGraphs(bd(), bd(hierToMain));
    expect(diffSystemGraphs(bd(undefined, shuffle), bd(hierToMain, shuffle))).toEqual(expected);
    expect(diffSystemGraphs(bd(), bd(hierToMain, shuffle))).toEqual(expected);
  });
});

const FIFO = {
  vlnv: 'xilinx.com:ip:axis_data_fifo:2.0',
  parameters: { FIFO_DEPTH: { value: '1024' } },
};
const outline = (diff: SystemGraphDiff) => diff.instances.map((i) => [i.path, i.status]);

describe('renames that must not be paired, or that must', () => {
  it('does not pair a renamed hierarchy whose pin attribute changed, it stays removed plus added', () => {
    const diff = diffSystemGraphs(
      bd(),
      bd(hierToMain, (d) => (d.components.gpio_main.ports.rst_n.direction = 'O'))
    );
    expect(outline(diff)).toEqual([
      ['/gpio_block', 'removed'],
      ['/gpio_block/axi_gpio_1', 'removed'],
      ['/gpio_main', 'added'],
      ['/gpio_main/axi_gpio_1', 'added'],
    ]);
  });

  it.each([
    ['a child added', (d: any) => (d.components.gpio_main.components.extra = FIFO)],
    [
      'an inner net rewired',
      (d: any) => {
        const inner = d.components.gpio_main.nets;
        inner.block_clk.ports = ['clk'];
        inner.block_rst.ports.push('axi_gpio_1/s_axi_aclk');
      },
    ],
    [
      'an inner feed-through',
      (d: any) => (d.components.gpio_main.nets.through = { ports: ['clk', 'rst_n'] }),
    ],
  ])('keeps removed plus added for a renamed hierarchy with %s', (_name, edit) => {
    const [base, current] = [bd(), bd(hierToMain, edit)];
    const diff = diffSystemGraphs(base, current);
    expect(diff.summary.renamed).toBe(0);
    expect(statusOf(diff, '/gpio_block')?.status).toBe('removed');
    expect(statusOf(diff, '/gpio_main')?.status).toBe('added');
    expectNothingHidden(base, current);
  });

  it('pairs a child renamed inside an unchanged hierarchy', () => {
    const [base, current] = [bd(), bd((t) => renamed(t, 'axi_gpio_1', 'axi_gpio_x'))];
    const diff = diffSystemGraphs(base, current);
    expect(diff.instances).toEqual([
      expect.objectContaining({
        path: '/gpio_block/axi_gpio_x',
        basePath: '/gpio_block/axi_gpio_1',
        level: '/gpio_block',
        status: 'renamed',
      }),
    ]);
    expect(diff.segments).toEqual([]);
    expectNothingHidden(base, current);
  });

  it('pairs a renamed block whose address moved, and shows the segment under the new name', () => {
    const [base, current] = [
      bd(),
      bd(toMain, (d) => {
        d.addressing['/sys_ps7'].address_spaces.Data.segments.SEG_axi_gpio_0_Reg.offset =
          '0x41300000';
      }),
    ];
    const diff = diffSystemGraphs(base, current);
    expect(renames(diff).map((r) => r.path)).toEqual(['/axi_gpio_main']);
    expect(diff.segments).toEqual([
      {
        addressSpace: 'sys_ps7/Data',
        segment: 'axi_gpio_main/S_AXI/Reg',
        status: 'changed',
        base: { offset: '0x41200000', range: '0x00010000' },
        current: { offset: '0x41300000', range: '0x00010000' },
      },
    ]);
    expectNothingHidden(base, current);
  });

  it('pairs a renamed block and reports the changed attribute of the port connected to it', () => {
    const syncMain = (t: string) => renamed(t, 'sync_0', 'sync_main');
    const [base, current] = [bd(), bd(syncMain, (d) => (d.ports.sys_rst_n.type = 'data'))];
    const diff = diffSystemGraphs(base, current);
    expect(renames(diff).map((r) => [r.basePath, r.path])).toEqual([['/sync_0', '/sync_main']]);
    expect(diff.instances).toHaveLength(1);
    expect(diff.ports.map((p) => [p.pin, p.status])).toEqual([['sys_rst_n', 'changed']]);
    expect(diff.ports[0].basePeers).toEqual(diff.ports[0].currentPeers);
    expectNothingHidden(base, current);
  });

  it('pairs a renamed module reference and a renamed black box', () => {
    const [base, module] = [bd(), bd((t) => renamed(t, 'sync_0', 'sync_main'))];
    expect(renames(diffSystemGraphs(base, module)).map((r) => r.currentType)).toEqual([
      'reset_synchronizer',
    ]);
    const ghost = bd((t) => renamed(t, 'ghost_ctrl', 'ghost_main'));
    expect(base.instances['/ghost_ctrl'].kind).toBe('blackbox');
    const diff = diffSystemGraphs(base, ghost);
    expect(diff.instances.map((i) => [i.basePath, i.path, i.status])).toEqual([
      ['/ghost_ctrl', '/ghost_main', 'renamed'],
    ]);
    expect(diff.summary).toEqual({ ...NONE, renamed: 1 });
  });

  it('does not pair a block when its old name is taken by a different block', () => {
    const diff = diffSystemGraphs(
      bd(),
      bd(toMain, (d) => (d.components.axi_gpio_0 = FIFO))
    );
    expect(statusOf(diff, '/axi_gpio_0')?.status).toBe('changed');
    expect(statusOf(diff, '/axi_gpio_main')?.status).toBe('added');
    expect(diff.summary.renamed).toBe(0);
  });
});

describe('renames that depend on each other', () => {
  /** Two renamed blocks, one net rewired from one to a new block and a new block on the other. */
  const edit = (d: any) => {
    d.components.new_slave = { vlnv: 'xilinx.com:ip:axi_gpio:2.0' };
    d.components.new_master = { vlnv: 'xilinx.com:ip:axi_gpio:2.0' };
    d.interface_nets.ps_axi.interface_ports = ['aa_ps/M_AXI_GP0', 'new_slave/S_AXI'];
    d.interface_nets.new_axi = { interface_ports: ['new_master/M_AXI', 'zz_periph/S00_AXI'] };
  };
  const rename = (t: string) => renamed(renamed(t, 'sys_ps7', 'aa_ps'), 'axi_periph', 'zz_periph');

  it('pairs neither block, whichever way the revisions are compared', () => {
    const [a, b] = [bd(), bd(rename, edit)];
    const [forward, backward] = [diffSystemGraphs(a, b), diffSystemGraphs(b, a)];
    expect(forward.summary.renamed).toBe(0);
    expect(backward.summary).toEqual({
      added: forward.summary.removed,
      removed: forward.summary.added,
      changed: forward.summary.changed,
      version: forward.summary.version,
      renamed: 0,
    });
    expect(statusOf(forward, '/sys_ps7')?.status).toBe('removed');
    expect(statusOf(forward, '/axi_periph')?.status).toBe('removed');
    expectNothingHidden(a, b);
    expectNothingHidden(b, a);
  });
});

describe('what rename detection shows and costs', () => {
  it('shows a disconnection that the diff without detection attributed to the renamed block', () => {
    const net = (names: string[]) => (d: any) => (d.nets.extra = { ports: names });
    const base = bd(undefined, net(['sync_0/clk', 'axi_gpio_0/gpio_io_o', 'axi_gpio_0/gpio_io_t']));
    const current = bd(toMain, net(['axi_gpio_main/gpio_io_o', 'axi_gpio_main/gpio_io_t']));
    const plain = diffWithoutRenames(base, current);
    expect(plain.instances.find((i) => i.path === '/sync_0')).toBeUndefined();
    const diff = diffSystemGraphs(base, current);
    expect(renames(diff).map((r) => r.path)).toEqual(['/axi_gpio_main']);
    expect(statusOf(diff, '/sync_0')).toMatchObject({
      status: 'changed',
      pins: [
        {
          pin: 'clk',
          status: 'changed',
          basePeers: ['axi_gpio_0/gpio_io_o', 'axi_gpio_0/gpio_io_t'],
          currentPeers: [],
        },
      ],
    });
    expectNothingHidden(base, current);
  });

  describe('plain diffs taken', () => {
    afterEach(() => jest.restoreAllMocks());

    it('is one when there is no candidate pair', () => {
      const spy = jest.spyOn(plainDiff, 'diffWithoutRenames');
      diffSystemGraphs(
        bd(),
        bd(undefined, (d) => (d.components.sys_ps7.parameters = {}))
      );
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('is the plain one plus one per round when a rename is accepted', () => {
      const spy = jest.spyOn(plainDiff, 'diffWithoutRenames');
      const diff = diffSystemGraphs(bd(), bd(toMain));
      expect(diff.summary.renamed).toBe(1);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('a dropped pair next to an accepted one', () => {
  const edit = (d: any) => {
    d.components.gpio_main.components.axi_gpio_1.parameters.C_ALL_OUTPUTS.value = '0';
    d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => p !== 'axi_periph/ACLK');
  };

  it('accepts the block, drops the changed hierarchy, and reports the disconnected neighbour', () => {
    const [base, current] = [bd(), bd((t) => hierToMain(toMain(t)), edit)];
    const diff = diffAndCheck(base, current);
    expect(renames(diff).map((r) => [r.basePath, r.path])).toEqual([
      ['/axi_gpio_0', '/axi_gpio_main'],
    ]);
    expect(statusOf(diff, '/sys_ps7')).toBeUndefined();
    expect(statusOf(diff, '/gpio_block')?.status).toBe('removed');
    expect(statusOf(diff, '/gpio_main')?.status).toBe('added');
    const pin = statusOf(diff, '/axi_periph')?.pins.find((p) => p.pin === 'ACLK');
    expect(pin).toMatchObject({ status: 'changed', currentPeers: [] });
    expect(pin?.basePeers).toContain('axi_gpio_0/s_axi_aclk');
    expect(pin?.basePeers?.join()).not.toContain('axi_gpio_main');
    diffAndCheck(current, base);
  });
});

describe('the reference check', () => {
  const base = bd();
  const current = bd(toMain, (d) => {
    d.components.sys_ps7.parameters.PCW_FPGA0_PERIPHERAL_FREQMHZ.value = '150';
    d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => p !== 'axi_periph/ACLK');
    d.addressing['/sys_ps7'].address_spaces.Data.segments.SEG_axi_gpio_0_Reg.offset = '0x41300000';
  });
  const detected = diffSystemGraphs(base, current);
  const mutated = (mutate: (copy: SystemGraphDiff) => void): SystemGraphDiff => {
    const copy = JSON.parse(JSON.stringify(detected)) as SystemGraphDiff;
    mutate(copy);
    return copy;
  };
  const instance = (diff: SystemGraphDiff, p: string) => diff.instances.find((i) => i.path === p)!;

  it('accepts the detected diff', () => {
    expect(renames(detected)).toHaveLength(1);
    expect(instance(detected, '/sys_ps7').parameters).toHaveLength(1);
    expect(instance(detected, '/axi_periph').pins).toHaveLength(1);
    expect(detected.segments).toHaveLength(1);
    expectMatchesRenamedBase(base, current, detected);
  });

  it.each([
    [
      'clearing the parameters of a changed block',
      (d: SystemGraphDiff) => (instance(d, '/sys_ps7').parameters = []),
    ],
    [
      'setting a status to version',
      (d: SystemGraphDiff) => (instance(d, '/sys_ps7').status = 'version'),
    ],
    ['deleting the changed segment of a renamed block', (d: SystemGraphDiff) => (d.segments = [])],
    [
      'adding a fake renamed entry',
      (d: SystemGraphDiff) =>
        d.instances.push({
          path: '/sync_main',
          basePath: '/sync_0',
          level: '/',
          status: 'renamed',
          parameters: [],
          pins: [],
        }),
    ],
    ['deleting a pin change', (d: SystemGraphDiff) => (instance(d, '/axi_periph').pins = [])],
    [
      'a self-rename of an unchanged block',
      (d: SystemGraphDiff) => {
        d.instances.push({
          path: '/sync_0',
          basePath: '/sync_0',
          level: '/',
          status: 'renamed',
          baseType: 'reset_synchronizer',
          currentType: 'reset_synchronizer',
          parameters: [],
          pins: [],
        });
        d.instances.sort((x, y) => (x.path < y.path ? -1 : 1));
        d.summary.renamed += 1;
      },
    ],
    [
      'changing the type stated on a renamed entry',
      (d: SystemGraphDiff) => (instance(d, '/axi_gpio_main').baseType = 'other'),
    ],
    [
      'changing the level stated on a renamed entry',
      (d: SystemGraphDiff) => (instance(d, '/axi_gpio_main').level = '/gpio_block'),
    ],
    [
      'giving a renamed entry a pin change',
      (d: SystemGraphDiff) =>
        instance(d, '/axi_gpio_main').pins.push({ pin: 'S_AXI', status: 'changed' }),
    ],
  ])('fails after %s', (_name, mutate) => {
    expect(() => expectMatchesRenamedBase(base, current, mutated(mutate))).toThrow();
  });
});

describe('base names in the base peers', () => {
  const peersOf = (diff: SystemGraphDiff, p: string, pin: string) =>
    diff.instances.find((i) => i.path === p)?.pins.find((x) => x.pin === pin);

  it('writes a renamed neighbour with its base name on the base side of a rewired pin', () => {
    const diff = diffSystemGraphs(
      bd(),
      bd(toMain, (d) => {
        d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => p !== 'axi_periph/ACLK');
      })
    );
    const pin = peersOf(diff, '/axi_periph', 'ACLK');
    expect(pin?.basePeers).toEqual(
      expect.arrayContaining(['axi_gpio_0/s_axi_aclk', 'gpio_block/clk'])
    );
    expect(pin?.currentPeers).toEqual([]);
    expect(renames(diff).map((r) => r.path)).toEqual(['/axi_gpio_main']);
  });

  it('writes the base name for a removed block that was connected to the renamed one', () => {
    const diff = diffSystemGraphs(
      bd(undefined, (d) => {
        d.components.old_blk = FIFO;
        d.nets.fclk.ports.push('old_blk/s_axis_aclk');
      }),
      bd(toMain)
    );
    const pin = peersOf(diff, '/old_blk', 's_axis_aclk');
    expect(pin?.basePeers).toContain('axi_gpio_0/s_axi_aclk');
    expect(pin?.basePeers?.join()).not.toContain('axi_gpio_main');
    expect(renames(diff)).toHaveLength(1);
  });

  it('writes the base path of a peer below a renamed hierarchy', () => {
    const diff = diffSystemGraphs(
      bd(undefined, (d) => {
        d.components.old_blk = FIFO;
        d.nets.low = { ports: ['old_blk/s_axis_aclk', 'gpio_block/axi_gpio_1/s_axi_aclk'] };
      }),
      bd(hierToMain)
    );
    const pin = peersOf(diff, '/old_blk', 's_axis_aclk');
    expect(pin?.basePeers).toEqual(['/gpio_block/axi_gpio_1/s_axi_aclk']);
    expect(renames(diff).map((r) => r.path)).toEqual(['/gpio_main']);
  });
});

describe('renamed blocks of a Vivado Tcl script', () => {
  const script = (ps: string, gpio: string, slash: string) =>
    readSystemDesign(
      'x.tcl',
      'x.tcl',
      `create_bd_design "t"
proc create_root_design { parentCell } {
  set parentObj [get_bd_cells /]
  current_bd_instance $parentObj
  create_bd_cell -type ip -vlnv xilinx.com:ip:processing_system7:5.5 ${ps}
  create_bd_cell -type ip -vlnv xilinx.com:ip:axi_gpio:2.0 ${gpio}
  connect_bd_intf_net -intf_net n [get_bd_intf_pins ${ps}/M_AXI_GP0] [get_bd_intf_pins ${gpio}/S_AXI]
  assign_bd_address -offset 0x41200000 -range 0x10000 -target_address_space [get_bd_addr_spaces ${slash}${ps}/Data] [get_bd_addr_segs ${slash}${gpio}/S_AXI/Reg]
}
create_root_design ""
`
    )!;

  it.each([
    ['without', ''],
    ['with', '/'],
  ])(
    'pairs master and slave with no segment change, %s a leading slash in the texts',
    (_n, slash) => {
      const [base, current] = [script('ps', 'gpio', slash), script('ps_main', 'gpio_main', slash)];
      expect(base.addressSegments).toHaveLength(1);
      expect(base.addressSegments[0].addressSpace.startsWith('/')).toBe(slash === '/');
      const diff = diffSystemGraphs(base, current);
      expect(diff.segments).toEqual([]);
      expect(diff.instances.map((i) => [i.basePath, i.path, i.status])).toEqual([
        ['/gpio', '/gpio_main', 'renamed'],
        ['/ps', '/ps_main', 'renamed'],
      ]);
    }
  );
});

describe('renamed blocks of Platform Designer systems', () => {
  const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design');
  const qsys = (file: string) =>
    readSystemDesign(file, 'x.qsys', fs.readFileSync(path.join(fixtures, 'diff', file), 'utf8'))!;
  const unchanged = (diff: SystemGraphDiff, renamedPaths: string[]) => {
    expect(diff.segments).toEqual([]);
    expect(diff.ports).toEqual([]);
    expect(diff.instances.filter((i) => i.status !== 'renamed')).toEqual([]);
    expect(renames(diff).map((r) => r.path)).toEqual(renamedPaths);
  };

  it('pairs a master and a slave module that are renamed together, with no segment change', () => {
    const [base, current] = [qsys('nios_rename_base.qsys'), qsys('nios_rename_current.qsys')];
    expect(base.addressSegments.length).toBeGreaterThan(0);
    const diff = diffSystemGraphs(base, current);
    unchanged(diff, ['/cpu_main', '/pio_main']);
    expect(renames(diff).map((r) => r.basePath)).toEqual(['/nios2_gen2_0', '/pio_0']);
    expect(diff.summary).toEqual({ ...NONE, renamed: 2 });
    expectNothingHidden(base, current);
  });

  it('rewrites the instance.pin texts of a master and of a slave', () => {
    const base = qsys('nios_rename_base.qsys');
    const slave = renameInstance(base, '/pio_0', '/pio_main').addressSegments;
    expect(slave.map((x) => x.segment)).toContain('pio_main.s1');
    expect(slave.map((x) => x.segment)).not.toContain('pio_0.s1');
    expect(slave.map((x) => x.addressSpace)).toEqual(
      base.addressSegments.map((x) => x.addressSpace)
    );
    const master = renameInstance(base, '/nios2_gen2_0', '/cpu_main').addressSegments;
    expect(master.map((x) => x.addressSpace).every((t) => t.startsWith('cpu_main.'))).toBe(true);
    expect(master.map((x) => x.segment)).toEqual(base.addressSegments.map((x) => x.segment));
  });

  it('does not touch the texts of a module whose name starts like the renamed one', () => {
    const segment = (space: string, seg: string, master: string, slave: string) => ({
      addressSpace: space,
      segment: seg,
      masterInstance: master,
      slaveInstance: slave,
      line: 1,
    });
    const g = {
      ...qsys('nios_rename_base.qsys'),
      addressSegments: [
        segment('cpu.data_master', 'uart.s1', '/cpu', '/uart'),
        segment('cpu2.data_master', 'uart_0.s1', '/cpu2', '/uart_0'),
        segment('cpu.x.data_master', 'uart.s1', '/cpu.x', '/uart'),
      ],
    };
    const after = renameInstance(g, '/uart', '/serial').addressSegments;
    expect(after.map((x) => x.segment)).toEqual(['serial.s1', 'uart_0.s1', 'serial.s1']);
    const cpu = renameInstance(g, '/cpu', '/core').addressSegments;
    expect(cpu.map((x) => x.addressSpace)).toEqual([
      'core.data_master',
      'cpu2.data_master',
      'cpu.x.data_master',
    ]);
  });

  it('rewrites the texts of a grafted subsystem, which are prefixed with the subsystem name', () => {
    const g = {
      ...qsys('nios_rename_base.qsys'),
      addressSegments: [
        {
          addressSpace: 'sub/cpu.data_master',
          segment: 'sub/uart.s1',
          masterInstance: '/sub/cpu',
          slaveInstance: '/sub/uart',
          line: 1,
        },
        {
          addressSpace: 'sub/cpu.data_master',
          segment: 'sub/uart_0.s1',
          masterInstance: '/sub/cpu',
          slaveInstance: '/sub/uart_0',
          line: 2,
        },
      ],
    };
    const after = renameInstance(g, '/sub/uart', '/sub/serial').addressSegments;
    expect(after.map((x) => [x.addressSpace, x.segment, x.slaveInstance])).toEqual([
      ['sub/cpu.data_master', 'sub/serial.s1', '/sub/serial'],
      ['sub/cpu.data_master', 'sub/uart_0.s1', '/sub/uart_0'],
    ]);
    const master = renameInstance(g, '/sub/cpu', '/sub/core').addressSegments;
    expect(master.map((x) => x.addressSpace)).toEqual([
      'sub/core.data_master',
      'sub/core.data_master',
    ]);
  });

  it('pairs renamed modules of a qsys-script system with no segment change', () => {
    const text = fs.readFileSync(path.join(fixtures, 'niosv_hps_system.tcl'), 'utf8');
    const read = (t: string) => readSystemDesign('x.tcl', 'x.tcl', t)!;
    const rename = (t: string) => renamed(renamed(t, 'led_pio', 'led_main'), 'niosv', 'cpu_main');
    const [base, current] = [read(text), read(rename(text))];
    expect(base.addressSegments.length).toBeGreaterThan(0);
    const diff = diffSystemGraphs(base, current);
    unchanged(diff, ['/cpu_main', '/led_main']);
    expectNothingHidden(base, current);
  });
});
