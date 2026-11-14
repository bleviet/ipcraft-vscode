/* eslint-disable @typescript-eslint/no-unsafe-call -- the helpers edit parsed JSON of the fixtures */
import type { SystemGraph } from '../../../../domain/systemGraph';
import type {
  InstanceChange,
  PinChange,
  SystemGraphDiff,
} from '../../../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../../services/systemDiagram/readSystemDesign';
import {
  buildChangeMarks,
  isNewWire,
  boundaryMark,
  markedNodeIds,
  shownInside,
  type ChangeMarks,
  markName,
  markSign,
  pinChangeAttributes,
  wireEndLabel,
} from '../../../../webview/systemDiagram/changeMarks';
import * as fs from 'fs';
import * as path from 'path';
import type { SegmentChange } from '../../../../domain/systemGraphDiff';
import {
  moveDiff,
  moveGraph,
  renameDiff,
  renameGraph,
  zynqDiff,
  zynqGraph,
} from './compareFixtures';
import { systemBd, twoClockGroups, withoutGpio0Net, withoutNestedSlave } from './systemBdEdit';

const bd = systemBd;

const ps7 = (pin: string) => ({ instance: '/sys_ps7', pin });
const gpio0 = (pin: string) => ({ instance: '/axi_gpio_0', pin });
const periph = (pin: string) => ({ instance: '/axi_periph', pin });

/** `axi_gpio_0/s_axi_aclk` leaves the net `fclk` for a net with `FCLK_CLK1`. */
const rewire = (d: any) => {
  d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => p !== 'axi_gpio_0/s_axi_aclk');
  d.nets.other = { ports: ['axi_gpio_0/s_axi_aclk', 'sys_ps7/FCLK_CLK1'] };
};

describe('buildChangeMarks: blocks', () => {
  const [graph, diff] = [zynqGraph('current'), zynqDiff()];
  const marks = buildChangeMarks(diff, graph);

  it('gives each kind its status and title', () => {
    expect(marks.blocks.get('/axis_data_fifo_0')).toMatchObject({
      status: 'added',
      title: 'Added',
    });
    expect(marks.blocks.get('/sys_ps7')).toMatchObject({
      status: 'changed',
      title: 'Changed: 1 parameter',
    });
    // Its address segment changed too: the block is promoted to changed, the text is appended.
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')?.status).toBe('changed');
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')?.title).toMatch(
      /^Changed: xilinx\.com:ip:axi_gpio:\S+ → xilinx\.com:ip:axi_gpio:\S+, address changed$/
    );
  });

  it('marks nothing for a block without a change, or one that is removed', () => {
    expect(marks.blocks.has('/axi_periph')).toBe(false);
    expect(marks.blocks.has('/axi_gpio_0')).toBe(false);
  });

  it('counts the changes below a hierarchy that has none of its own', () => {
    expect(marks.blocks.get('/gpio_block')).toEqual({ pins: {}, inside: 1 });
  });

  it('gives a renamed block its old name', () => {
    const renamed = buildChangeMarks(renameDiff(), renameGraph());
    expect(renamed.blocks.get('/axi_gpio_main')).toMatchObject({
      status: 'renamed',
      title: 'Renamed from axi_gpio_0',
    });
    expect(renamed.blocks.get('/sys_ps7')?.status).toBe('changed');
  });

  it('marks a moved block with the level it came from, and its rewired pins', () => {
    const moved = buildChangeMarks(moveDiff(), moveGraph());
    expect(moved.blocks.get('/gpio_block/axi_gpio_0')).toMatchObject({
      status: 'moved',
      title: 'Moved from /',
      pins: { S_AXI: 'changed', s_axi_aclk: 'changed' },
    });
    // It is not removed: the base's block is the same block.
    expect(moved.removed.size).toBe(0);
    const [from, to] = [moveDiff().instances, moveGraph()];
    const inHier = buildChangeMarks(
      {
        ...moveDiff(),
        instances: from.map((i) =>
          i.status === 'moved' ? { ...i, basePath: '/axi_periph/axi_gpio_0' } : i
        ),
      },
      to
    );
    expect(inHier.blocks.get('/gpio_block/axi_gpio_0')?.title).toBe('Moved from /axi_periph');
  });

  it('counts what only the base has, per level', () => {
    // axi_gpio_0 and the port led_o
    expect(marks.removed.get('/')).toBe(2);
    expect(marks.removed.get('/gpio_block')).toBeUndefined();
  });

  it('names the signs and words from the Changes tab', () => {
    expect(
      ['added', 'changed', 'renamed', 'moved', 'version'].map((s) => markSign(s as never))
    ).toEqual(['+', '~', '→', '»', 'v']);
    expect(markName('moved')).toBe('Moved');
    expect(markName('version')).toBe('Version only');
  });
});

describe('buildChangeMarks: ports', () => {
  it('marks an added and a changed port, and counts a removed one', () => {
    const [base, current] = [
      bd(),
      bd((d) => {
        d.ports.irq_o = { direction: 'O', left: '3', right: '0' };
        d.ports.led_o.left = '15';
      }),
    ];
    const marks = buildChangeMarks(diffSystemGraphs(base, current), current);
    expect(marks.ports.get('irq_o')).toEqual({ status: 'added', title: 'Added' });
    expect(marks.ports.get('led_o')).toEqual({ status: 'changed', title: 'Changed: 1 attribute' });
    const reverse = buildChangeMarks(diffSystemGraphs(current, base), base);
    expect(reverse.ports.has('irq_o')).toBe(false);
    expect(reverse.removed.get('/')).toBe(1);
  });

  it('marks a port that moved with its connections', () => {
    const [base, current] = [
      bd(),
      bd((d) => {
        d.nets.ext_rst.ports = ['sync_0/rst_n_in', 'ghost_ctrl/rst_n'];
        d.nets.other = { ports: ['sys_rst_n', 'sys_ps7/FCLK_CLK1'] };
      }),
    ];
    const marks = buildChangeMarks(diffSystemGraphs(base, current), current);
    expect(marks.ports.get('sys_rst_n')?.title).toBe('Changed: connections');
  });
});

describe('buildChangeMarks: pins', () => {
  it('marks the changed pin of a changed block, and a new pin', () => {
    const [base, current] = [bd(), bd(rewire)];
    const marks = buildChangeMarks(diffSystemGraphs(base, current), current);
    expect(marks.blocks.get('/axi_gpio_0')).toMatchObject({
      status: 'changed',
      title: 'Changed: 1 pin',
      pins: { s_axi_aclk: 'changed' },
    });
    const first = bd(withoutGpio0Net);
    const added = buildChangeMarks(diffSystemGraphs(first, bd()), bd());
    expect(added.blocks.get('/axi_periph')?.pins).toEqual({ M00_AXI: 'added' });
  });

  it('does not mark the pins of an added block', () => {
    const marks = buildChangeMarks(zynqDiff(), zynqGraph('current'));
    expect(marks.blocks.get('/axis_data_fifo_0')?.pins).toEqual({});
  });

  it('marks the inside view of a hierarchy pin, apart from the outside view', () => {
    const [base, current] = [bd(twoClockGroups(false)), bd(twoClockGroups(true))];
    const diff = diffSystemGraphs(base, current);
    const marks = buildChangeMarks(diff, current);
    const block = marks.blocks.get('/gpio_block');
    expect(block?.insidePins).toEqual({ clk: 'changed', clk2: 'changed' });
    expect(block?.pins).toEqual({});
    expect(block?.title).toBe('Changed: 2 pins inside');
    // The inside pins are not counted in `inside`.
    expect(block?.inside).toBe(0);
    // Inside the hierarchy, the boundary pin `clk` gained the clock pins of the other group.
    expect(
      isNewWire(
        marks,
        '/gpio_block',
        { instance: null, pin: 'clk' },
        {
          instance: '/gpio_block/axi_gpio_3',
          pin: 's_axi_aclk',
        }
      )
    ).toBe(true);
    expect(
      isNewWire(
        marks,
        '/gpio_block',
        { instance: null, pin: 'clk' },
        {
          instance: '/gpio_block/axi_gpio_1',
          pin: 's_axi_aclk',
        }
      )
    ).toBe(false);
  });
});

describe('buildChangeMarks: changes inside', () => {
  const change = (path: string, status: InstanceChange['status']): InstanceChange => ({
    path,
    level: path.slice(0, path.lastIndexOf('/')) || '/',
    status,
    parameters: [],
    pins: [],
  });
  const exists = (...paths: string[]) =>
    ({ instances: Object.fromEntries(paths.map((p) => [p, {}])) }) as unknown as SystemGraph;
  const diffOf = (instances: InstanceChange[]): SystemGraphDiff =>
    ({ instances, ports: [], segments: [] }) as unknown as SystemGraphDiff;

  it('counts each block below at any depth once, removed ones included', () => {
    const graph = exists('/a', '/a/b', '/a/b/c', '/a/d', '/e');
    const marks = buildChangeMarks(
      diffOf([
        change('/a/b/c', 'changed'),
        change('/a/b/gone', 'removed'),
        change('/a/d', 'version'),
        change('/a/new', 'added'),
        change('/e', 'changed'),
      ]),
      graph
    );
    // /a/new is not in the graph: it is not marked, but it is a change below /a.
    expect(marks.blocks.get('/a')?.inside).toBe(4);
    expect(marks.blocks.get('/a/b')?.inside).toBe(2);
    expect(marks.blocks.get('/a/b/c')).toMatchObject({ status: 'changed', inside: 0 });
    expect(marks.blocks.get('/e')).toMatchObject({ status: 'changed', inside: 0 });
    expect(marks.removed.get('/a/b')).toBe(1);
  });

  it('counts a change below a hierarchy that is itself changed or renamed', () => {
    const graph = exists('/h', '/h/x');
    const marks = buildChangeMarks(
      diffOf([change('/h', 'changed'), change('/h/x', 'changed')]),
      graph
    );
    expect(marks.blocks.get('/h')).toMatchObject({ status: 'changed', inside: 1 });
    // A renamed hierarchy is one change: its children are not listed.
    const renamed = buildChangeMarks(
      diffOf([{ ...change('/r', 'renamed'), basePath: '/q' }]),
      exists('/r', '/r/x')
    );
    expect(renamed.blocks.get('/r')).toMatchObject({ status: 'renamed', inside: 0 });
    expect(renamed.blocks.has('/r/x')).toBe(false);
  });

  it('does not count towards a hierarchy that is not in the current graph', () => {
    const marks = buildChangeMarks(diffOf([change('/gone/x', 'removed')]), exists());
    expect(marks.blocks.size).toBe(0);
    expect(marks.removed.get('/gone')).toBe(1);
  });
});

describe('isNewWire', () => {
  it('is new when a block at one end is added', () => {
    const marks = buildChangeMarks(zynqDiff(), zynqGraph('current'));
    const fifo = { instance: '/axis_data_fifo_0', pin: 's_axis_aclk' };
    expect(isNewWire(marks, '/', ps7('FCLK_CLK1'), fifo)).toBe(true);
    expect(isNewWire(marks, '/', fifo, ps7('FCLK_CLK1'))).toBe(true);
    expect(isNewWire(marks, '/', ps7('FCLK_CLK0'), periph('ACLK'))).toBe(false);
  });

  describe('for a rewired pin', () => {
    const [base, current] = [bd(), bd(rewire)];
    const diff = diffSystemGraphs(base, current);
    const marks = buildChangeMarks(diff, current);

    it('is new when a pin gained the other, in both orientations', () => {
      expect(isNewWire(marks, '/', gpio0('s_axi_aclk'), ps7('FCLK_CLK1'))).toBe(true);
      expect(isNewWire(marks, '/', ps7('FCLK_CLK1'), gpio0('s_axi_aclk'))).toBe(true);
    });

    it('is not new for a pin that kept its peers, or one that only lost a peer', () => {
      expect(isNewWire(marks, '/', ps7('FCLK_CLK0'), periph('ACLK'))).toBe(false);
      expect(isNewWire(marks, '/', ps7('FCLK_CLK0'), gpio0('s_axi_aclk'))).toBe(false);
      const lost = diffSystemGraphs(bd(), bd(withoutGpio0Net));
      const onlyLost = buildChangeMarks(lost, bd(withoutGpio0Net));
      expect(isNewWire(onlyLost, '/', gpio0('S_AXI'), periph('M00_AXI'))).toBe(false);
    });

    it('writes the labels as the engine writes them', () => {
      const pin = diff.instances.find((i) => i.path === '/axi_gpio_0')?.pins[0] as PinChange;
      expect(pin.gained).toEqual([wireEndLabel('/', ps7('FCLK_CLK1'))]);
      expect(pin.lost).toContain(wireEndLabel('/', ps7('FCLK_CLK0')));
      expect(pin.lost).toContain(wireEndLabel('/', periph('ACLK')));
      expect(pin.lost).toContain(wireEndLabel('/', { instance: '/gpio_block', pin: 'clk' }));
    });
  });

  it('takes the pin of a port as a boundary end of the root level', () => {
    const [base, current] = [
      bd(),
      bd((d) => {
        d.nets.ext_rst.ports = ['sync_0/rst_n_in', 'ghost_ctrl/rst_n'];
        d.nets.other = { ports: ['sys_rst_n', 'sys_ps7/FCLK_CLK1'] };
      }),
    ];
    const marks = buildChangeMarks(diffSystemGraphs(base, current), current);
    const port = { instance: null, pin: 'sys_rst_n' };
    expect(isNewWire(marks, '/', port, ps7('FCLK_CLK1'))).toBe(true);
    expect(wireEndLabel('/', port)).toBe('sys_rst_n');
  });

  it('is not new next to a renamed block', () => {
    const marks = buildChangeMarks(renameDiff(), renameGraph());
    expect(
      isNewWire(marks, '/', { instance: '/axi_gpio_main', pin: 's_axi_aclk' }, periph('ACLK'))
    ).toBe(false);
  });

  it('writes a peer of another level in absolute form, as the engine does', () => {
    const tcl = (withZ: boolean) =>
      readSystemDesign(
        'x.tcl',
        'x.tcl',
        `create_bd_design "t"
proc create_hier_cell_h { parentCell nameHier } {
  set parentObj [get_bd_cells $parentCell]
  set oldCurInst [current_bd_instance .]
  current_bd_instance $parentObj
  set hier_obj [create_bd_cell -type hier $nameHier]
  current_bd_instance $hier_obj
  create_bd_pin -dir I clk
  create_bd_cell -type ip -vlnv xilinx.com:ip:axi_gpio:2.0 g1
  connect_bd_net -net hclk [get_bd_pins clk] [get_bd_pins g1/s_axi_aclk]
  current_bd_instance $oldCurInst
}
proc create_root_design { parentCell } {
  set parentObj [get_bd_cells /]
  current_bd_instance $parentObj
  create_hier_cell_h [current_bd_instance .] h
  create_bd_cell -type ip -vlnv xilinx.com:ip:axi_gpio:2.0 a
  create_bd_cell -type ip -vlnv xilinx.com:ip:axi_gpio:2.0 b
  connect_bd_net -net n [get_bd_pins a/x] [get_bd_pins b/y]${withZ ? ' [get_bd_pins h/g1/z]' : ''}
}
create_root_design ""
`
      )!;
    const current = tcl(true);
    const diff = diffSystemGraphs(tcl(false), current);
    const marks = buildChangeMarks(diff, current);
    const z = { instance: '/h/g1', pin: 'z' };
    // The pin z of /h/g1 is new, on the net of /a/x and /b/y of the root level, which its level sees in absolute form.
    expect(diff.instances.find((i) => i.path === '/h/g1')?.pins[0].currentPeers).toEqual([
      wireEndLabel('/h', { instance: '/a', pin: 'x' }),
      wireEndLabel('/h', { instance: '/b', pin: 'y' }),
    ]);
    expect(isNewWire(marks, '/h', z, { instance: '/a', pin: 'x' })).toBe(true);
  });
});

describe('markedNodeIds and pinChangeAttributes', () => {
  it('lists the marked blocks and ports of a level', () => {
    const [graph, marks] = [
      zynqGraph('current'),
      buildChangeMarks(zynqDiff(), zynqGraph('current')),
    ];
    expect(markedNodeIds(marks, graph, '/').sort()).toEqual(
      ['/axis_data_fifo_0', '/gpio_block', '/sys_ps7'].sort()
    );
    expect(markedNodeIds(marks, graph, '/gpio_block')).toEqual(['/gpio_block/axi_gpio_1']);
  });

  it('lists an external port with a change', () => {
    const [graph, marks] = [
      zynqGraph('base'),
      buildChangeMarks(
        diffSystemGraphs(zynqGraph('current'), zynqGraph('base')),
        zynqGraph('base')
      ),
    ];
    expect(markedNodeIds(marks, graph, '/')).toContain('/::led_o');
  });

  it('gives a pin its kind and title, or nothing', () => {
    expect(pinChangeAttributes({ kind: 'added' })).toEqual({
      'data-change': 'added',
      title: 'New pin',
    });
    expect(pinChangeAttributes({ kind: 'changed' }).title).toBe('Connection changed');
    expect(pinChangeAttributes({ kind: 'changed', inside: true }).title).toBe(
      'Connection inside changed'
    );
    expect(pinChangeAttributes(undefined)).toEqual({});
  });
});

describe('buildChangeMarks: address segments', () => {
  const nios = (side: 'base' | 'current') =>
    readSystemDesign(
      `nios_${side}.qsys`,
      'nios_system.qsys',
      fs.readFileSync(
        path.resolve(__dirname, `../../../fixtures/system-design/diff/nios_${side}.qsys`),
        'utf8'
      )
    )!;

  it('marks the slave block of a changed segment as changed, and counts it once', () => {
    const current = nios('current');
    const diff = diffSystemGraphs(nios('base'), current);
    const marks = buildChangeMarks(diff, current);
    expect(marks.blocks.get('/jtag_uart_0')).toMatchObject({
      status: 'changed',
      title: 'Address changed',
    });
    expect(markedNodeIds(marks, current, '/')).toContain('/jtag_uart_0');
  });

  const segment = (status: SegmentChange['status'], text: string): SegmentChange => ({
    addressSpace: 'sys_ps7/Data',
    segment: text,
    status,
  });
  const diffOf = (segments: SegmentChange[], instances: SystemGraphDiff['instances'] = []) =>
    ({ instances, ports: [], segments }) as unknown as SystemGraphDiff;

  it('marks the slave of an added segment, found in the current graph', () => {
    const graph = zynqGraph('current');
    const marks = buildChangeMarks(
      diffOf([segment('added', 'gpio_block/axi_gpio_1/S_AXI/Reg')]),
      graph
    );
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')).toMatchObject({
      status: 'changed',
      title: 'Address segment added',
    });
    expect(marks.blocks.get('/gpio_block')?.inside).toBe(1);
  });

  it('finds the slave of a removed segment by its text, the longest block it starts with', () => {
    const graph = zynqGraph('current');
    const marks = buildChangeMarks(
      diffOf([segment('removed', 'gpio_block/axi_gpio_1/S_AXI/Mem')]),
      graph
    );
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')).toMatchObject({
      status: 'changed',
      title: 'Address segment removed',
    });
    expect(marks.blocks.has('/gpio_block')).toBe(true);
    // Its slave is gone from the current graph: nothing to mark.
    expect(
      buildChangeMarks(diffOf([segment('removed', 'axi_gpio_0/S_AXI/Reg')]), graph).blocks.size
    ).toBe(0);
  });

  it('promotes a version-only block to changed and keeps the version in the title', () => {
    const graph = zynqGraph('current');
    const marks = buildChangeMarks(
      diffOf(
        [segment('changed', 'gpio_block/axi_gpio_1/S_AXI/Reg')],
        zynqDiff().instances.filter((i) => i.path === '/gpio_block/axi_gpio_1')
      ),
      graph
    );
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')).toMatchObject({
      status: 'changed',
      pins: {},
    });
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')?.title).toMatch(
      /^Changed: xilinx\.com:ip:axi_gpio:\S+ → xilinx\.com:ip:axi_gpio:\S+, address changed$/
    );
    expect(marks.blocks.get('/gpio_block')?.inside).toBe(1);
  });

  it('promotes a renamed block to changed and keeps the old name in the title', () => {
    const graph = renameGraph();
    const marks = buildChangeMarks(
      diffOf(
        [segment('changed', 'axi_gpio_main/S_AXI/Reg')],
        renameDiff().instances.filter((i) => i.path === '/axi_gpio_main')
      ),
      graph
    );
    expect(marks.blocks.get('/axi_gpio_main')).toMatchObject({
      status: 'changed',
      title: 'Changed: renamed from axi_gpio_0, address changed',
      pins: {},
    });
  });

  it('promotes a moved block to changed and keeps the old level in the title', () => {
    const graph = moveGraph();
    const marks = buildChangeMarks(
      diffOf(
        [segment('changed', 'gpio_block/axi_gpio_0/S_AXI/Reg')],
        moveDiff().instances.filter((i) => i.status === 'moved')
      ),
      graph
    );
    expect(marks.blocks.get('/gpio_block/axi_gpio_0')).toMatchObject({
      status: 'changed',
      title: 'Changed: moved from /, address changed',
    });
    expect(marks.blocks.get('/gpio_block')?.inside).toBe(1);
  });

  it('joins the texts of several segment changes on a promoted block and counts it once', () => {
    const graph = zynqGraph('current');
    const renamed = {
      path: '/gpio_block/axi_gpio_1',
      basePath: '/gpio_block/axi_gpio_old',
      level: '/gpio_block',
      status: 'renamed',
      parameters: [],
      pins: [],
    } as unknown as SystemGraphDiff['instances'][number];
    const marks = buildChangeMarks(
      diffOf(
        [
          segment('changed', 'gpio_block/axi_gpio_1/S_AXI/Reg'),
          segment('removed', 'gpio_block/axi_gpio_1/S_AXI/Mem'),
        ],
        [renamed]
      ),
      graph
    );
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')).toMatchObject({
      status: 'changed',
      title: 'Changed: renamed from axi_gpio_old, address changed, address segment removed',
    });
    expect(marks.blocks.get('/gpio_block')?.inside).toBe(1);
  });

  it('capitalizes only the first of several segment texts on an otherwise unchanged block', () => {
    const marks = buildChangeMarks(
      diffOf([
        segment('changed', 'gpio_block/axi_gpio_1/S_AXI/Reg'),
        segment('removed', 'gpio_block/axi_gpio_1/S_AXI/Mem'),
      ]),
      zynqGraph('current')
    );
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')?.title).toBe(
      'Address changed, address segment removed'
    );
  });
});

describe('buildChangeMarks: a removed segment and its owner', () => {
  it('belongs to no block when its slave was removed, not to the surviving parent hierarchy', () => {
    const [base, current] = [systemBd(), systemBd(withoutNestedSlave)];
    const diff = diffSystemGraphs(base, current);
    const removedSegment = diff.segments.find((s) => s.status === 'removed');
    expect(removedSegment?.segment).toBe('gpio_block/axi_gpio_1/S_AXI/Reg');
    const marks = buildChangeMarks(diff, current);
    expect(marks.blocks.get('/gpio_block')).toEqual({ pins: {}, inside: 1 });
    expect(markedNodeIds(marks, current, '/')).toEqual(['/gpio_block']);
    expect(marks.removed.get('/gpio_block')).toBe(1);
  });

  it('keeps the surviving slave of a removed segment', () => {
    const [base, current] = [
      systemBd(),
      systemBd((d) => {
        delete d.addressing['/sys_ps7'].address_spaces.Data.segments.SEG_axi_gpio_1_Reg;
      }),
    ];
    const marks = buildChangeMarks(diffSystemGraphs(base, current), current);
    expect(marks.blocks.get('/gpio_block/axi_gpio_1')).toMatchObject({
      status: 'changed',
      title: 'Address segment removed',
    });
    expect(marks.blocks.get('/gpio_block')?.status).toBeUndefined();
  });

  it('belongs to the block under its current name when its slave was renamed', () => {
    const [base, current] = [
      systemBd(),
      systemBd(
        (d) => {
          delete d.addressing['/sys_ps7'].address_spaces.Data.segments.SEG_axi_gpio_0_Mem;
        },
        ['axi_gpio_0', 'axi_gpio_main']
      ),
    ];
    const diff = diffSystemGraphs(base, current);
    expect(diff.instances.map((i) => [i.path, i.status])).toContainEqual([
      '/axi_gpio_main',
      'renamed',
    ]);
    const removed = diff.segments.find((s) => s.status === 'removed');
    // The diff writes a removed segment of a renamed block under its new name.
    expect(removed?.segment).toBe('axi_gpio_main/S_AXI/Mem');
    const marks = buildChangeMarks(diff, current);
    expect(marks.blocks.get('/axi_gpio_main')).toMatchObject({ status: 'changed' });
    expect(marks.blocks.get('/axi_gpio_main')?.title).toBe(
      'Changed: renamed from axi_gpio_0, address segment removed'
    );
  });
});

describe('inside views, added hierarchies and the mirror of gained and lost', () => {
  it('titles a new pin inside a hierarchy', () => {
    expect(pinChangeAttributes({ kind: 'added', inside: true }).title).toBe('New pin inside');
  });

  it('marks the boundary pins of the level of a hierarchy from its inside pins', () => {
    const [base, current] = [bd(twoClockGroups(false)), bd(twoClockGroups(true))];
    const marks = buildChangeMarks(diffSystemGraphs(base, current), current);
    expect(boundaryMark(marks, '/gpio_block', 'clk')).toEqual({
      status: 'changed',
      title: 'Connection inside changed',
    });
    expect(boundaryMark(marks, '/gpio_block', 'rst_n')).toBeUndefined();
    expect(boundaryMark(marks, '/', 'sys_clk')).toBeUndefined();
    expect(markedNodeIds(marks, current, '/gpio_block')).toEqual(
      expect.arrayContaining(['/gpio_block::clk', '/gpio_block::clk2'])
    );
  });

  it('shows no count of changes inside an added hierarchy, which its ancestors still count', () => {
    const marks = {
      blocks: new Map([
        ['/h', { status: 'added', title: 'Added', pins: {}, inside: 4 }],
        ['/g', { status: 'changed', title: 'Changed', pins: {}, inside: 2 }],
      ]),
    } as unknown as ChangeMarks;
    expect(shownInside(marks.blocks.get('/h'))).toBe(0);
    expect(shownInside(marks.blocks.get('/g'))).toBe(2);
    expect(shownInside(undefined)).toBe(0);
  });
});
