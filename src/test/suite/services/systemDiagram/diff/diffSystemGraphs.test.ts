/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- the helpers edit parsed JSON of the fixtures */
import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';

const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design');
const BD_TEXT = fs.readFileSync(path.join(fixtures, 'zynq_gpio_system.bd'), 'utf8');
const QSYS_TEXT = fs.readFileSync(path.join(fixtures, 'nios_avalon_system.qsys'), 'utf8');

/** Reads the fixture `.bd` after `edit` changed its parsed `design` object. */
function bd(edit: (design: any) => void = () => undefined, indent = 2): SystemGraph {
  const root = JSON.parse(BD_TEXT);
  edit(root.design);
  return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root, null, indent))!;
}

/** Reads the fixture `.qsys` after replacing `from` by `to` (each must occur). */
function qsys(...replacements: [string, string][]): SystemGraph {
  let text = QSYS_TEXT;
  for (const [from, to] of replacements) {
    expect(text).toContain(from);
    text = text.replace(from, to);
  }
  return readSystemDesign('x.qsys', 'x.qsys', text)!;
}

const instance = (diff: SystemGraphDiff, p: string): InstanceChange | undefined =>
  diff.instances.find((i) => i.path === p);

const FCLK_PEERS = [
  'axi_gpio_0/s_axi_aclk',
  'axi_periph/ACLK',
  'gpio_block/clk',
  'sys_ps7/FCLK_CLK0',
];

const EMPTY = { added: 0, removed: 0, changed: 0, version: 0, renamed: 0 };

const AXI_GPIO = 'xilinx.com:ip:axi_gpio:2.0';

/** A block design script with a hierarchy `h` (boundary pins clk, clk2) and `body` in its cell proc. */
function tclDesign(hierBody: string, rootBody: string): SystemGraph {
  const text = `create_bd_design "t"
proc create_hier_cell_h { parentCell nameHier } {
  set parentObj [get_bd_cells $parentCell]
  set oldCurInst [current_bd_instance .]
  current_bd_instance $parentObj
  set hier_obj [create_bd_cell -type hier $nameHier]
  current_bd_instance $hier_obj
  create_bd_pin -dir I clk
  create_bd_pin -dir I clk2
${hierBody}
  current_bd_instance $oldCurInst
}
proc create_root_design { parentCell } {
  set parentObj [get_bd_cells /]
  current_bd_instance $parentObj
${rootBody}
}
create_root_design ""
`;
  return readSystemDesign('x.tcl', 'x.tcl', text)!;
}

const ip = (name: string) => `  create_bd_cell -type ip -vlnv ${AXI_GPIO} ${name}`;
const net = (name: string, ...pins: string[]) =>
  `  connect_bd_net -net ${name} ${pins.map((p) => `[get_bd_pins ${p}]`).join(' ')}`;

/** Two inner clock nets of `h`; `swap` exchanges the boundary pins that drive them. */
function twoClockTcl(swap: boolean): SystemGraph {
  const [a, b] = swap ? ['clk2', 'clk'] : ['clk', 'clk2'];
  return tclDesign(
    [
      ip('g1'),
      ip('g2'),
      ip('g3'),
      ip('g4'),
      net('hclk', a, 'g1/s_axi_aclk', 'g2/s_axi_aclk'),
      net('hclk2', b, 'g3/s_axi_aclk', 'g4/s_axi_aclk'),
    ].join('\n'),
    '  create_hier_cell_h [current_bd_instance .] h'
  );
}

/** Root level: a, b, c on net n, optionally with the pin z of the instance g1 inside h. */
function crossLevelTcl(withZ: boolean): SystemGraph {
  return tclDesign(
    [ip('g1'), net('hclk', 'clk', 'g1/s_axi_aclk')].join('\n'),
    [
      '  create_hier_cell_h [current_bd_instance .] h',
      ip('a'),
      ip('b'),
      ip('c'),
      net('n', 'a/x', 'b/y', 'c/y', ...(withZ ? ['h/g1/z'] : [])),
    ].join('\n')
  );
}

function addFifo(design: any): void {
  design.components.fifo_0 = {
    vlnv: 'xilinx.com:ip:axis_data_fifo:2.0',
    parameters: { FIFO_DEPTH: { value: '1024' } },
  };
  design.nets.fclk.ports.push('fifo_0/s_axis_aclk');
}

describe('diffSystemGraphs', () => {
  describe('no difference', () => {
    it('reports nothing for a graph against itself', () => {
      const g = bd();
      expect(diffSystemGraphs(g, g)).toMatchObject({
        instances: [],
        ports: [],
        segments: [],
        summary: EMPTY,
        formatsDiffer: false,
      });
    });

    it('ignores net names', () => {
      const renamed = bd((d) => {
        d.nets.renamed = d.nets.ext_rst;
        delete d.nets.ext_rst;
        d.interface_nets.renamed_axi = d.interface_nets.ps_axi;
        delete d.interface_nets.ps_axi;
      });
      expect(diffSystemGraphs(bd(), renamed).summary).toEqual(EMPTY);
    });

    it('ignores the order of instances, nets, endpoints and pins', () => {
      const reordered = bd((d) => {
        const reverse = (o: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(o).reverse());
        d.components = reverse(d.components);
        d.nets = reverse(d.nets);
        d.interface_nets = reverse(d.interface_nets);
        d.ports = reverse(d.ports);
        for (const net of Object.values<any>(d.nets)) {
          net.ports.reverse();
        }
      });
      const diff = diffSystemGraphs(bd(), reordered);
      expect(diff.summary).toEqual(EMPTY);
      expect(diffSystemGraphs(reordered, bd()).summary).toEqual(EMPTY);
    });

    it('ignores line numbers', () => {
      expect(diffSystemGraphs(bd(undefined, 2), bd(undefined, 0)).summary).toEqual(EMPTY);
      const g = bd(undefined, 0);
      expect(g.instances['/axi_gpio_0'].line).not.toBe(bd().instances['/axi_gpio_0'].line);
    });
  });

  describe('instances', () => {
    it('lists an added instance with its type and parameters', () => {
      const diff = diffSystemGraphs(bd(), bd(addFifo));
      expect(instance(diff, '/fifo_0')).toEqual({
        path: '/fifo_0',
        level: '/',
        status: 'added',
        currentType: 'xilinx.com:ip:axis_data_fifo:2.0',
        parameters: [{ key: 'CONFIG.FIFO_DEPTH', current: '1024' }],
        pins: [{ pin: 's_axis_aclk', status: 'added', currentPeers: FCLK_PEERS }],
      });
      expect(diff.summary.added).toBe(1);
    });

    it('lists a removed instance, mirroring the added one', () => {
      const diff = diffSystemGraphs(bd(addFifo), bd());
      expect(instance(diff, '/fifo_0')).toEqual({
        path: '/fifo_0',
        level: '/',
        status: 'removed',
        baseType: 'xilinx.com:ip:axis_data_fifo:2.0',
        parameters: [{ key: 'CONFIG.FIFO_DEPTH', base: '1024' }],
        pins: [{ pin: 's_axis_aclk', status: 'removed', basePeers: FCLK_PEERS }],
      });
      expect(diff.summary.removed).toBe(1);
    });

    it('reports a version-only change of a VLNV as version', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.components.axi_gpio_0.vlnv = 'xilinx.com:ip:axi_gpio:2.1';
        })
      );
      expect(diff.instances).toEqual([
        {
          path: '/axi_gpio_0',
          level: '/',
          status: 'version',
          baseType: 'xilinx.com:ip:axi_gpio:2.0',
          currentType: 'xilinx.com:ip:axi_gpio:2.1',
          parameters: [],
          pins: [],
        },
      ]);
      expect(diff.summary).toEqual({ ...EMPTY, version: 1 });
    });

    it('reports a version-only change of a Platform Designer module as version', () => {
      const diff = diffSystemGraphs(
        qsys(),
        qsys([
          '<module name="pio_0" kind="altera_avalon_pio" version="18.1"',
          '<module name="pio_0" kind="altera_avalon_pio" version="19.1"',
        ])
      );
      expect(diff.instances).toHaveLength(1);
      expect(diff.instances[0]).toMatchObject({
        path: '/pio_0',
        status: 'version',
        baseType: 'altera_avalon_pio:18.1',
        currentType: 'altera_avalon_pio:19.1',
      });
    });

    it('reports a changed IP type as changed, not version', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.components.axi_gpio_0.vlnv = 'xilinx.com:ip:axi_iic:2.0';
        })
      );
      expect(instance(diff, '/axi_gpio_0')).toMatchObject({
        status: 'changed',
        baseType: 'xilinx.com:ip:axi_gpio:2.0',
        currentType: 'xilinx.com:ip:axi_iic:2.0',
      });
    });

    it('reports a changed Platform Designer module kind as changed', () => {
      const diff = diffSystemGraphs(
        qsys(),
        qsys([
          'kind="altera_avalon_pio" version="18.1"',
          'kind="altera_avalon_uart" version="18.1"',
        ])
      );
      expect(instance(diff, '/pio_0')).toMatchObject({
        status: 'changed',
        baseType: 'altera_avalon_pio:18.1',
        currentType: 'altera_avalon_uart:18.1',
      });
    });

    it('reports a changed instance kind as changed', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          delete d.components.sync_0.reference_info;
          d.components.sync_0.vlnv = 'xilinx.com:module_ref:reset_synchronizer:1.0';
        })
      );
      expect(instance(diff, '/sync_0')).toMatchObject({
        status: 'changed',
        baseType: 'reset_synchronizer',
        currentType: 'xilinx.com:module_ref:reset_synchronizer:1.0',
      });
    });

    it('reports parameters added, removed and changed, sorted by key', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          const p = d.components.gpio_block.components.axi_gpio_1.parameters;
          p.C_ALL_OUTPUTS.value = '0';
          p.C_DOUT_DEFAULT = { value: '5' };
          delete d.components.axi_gpio_0.parameters.C_GPIO_WIDTH;
        })
      );
      expect(instance(diff, '/gpio_block/axi_gpio_1')?.parameters).toEqual([
        { key: 'CONFIG.C_ALL_OUTPUTS', base: '1', current: '0' },
        { key: 'CONFIG.C_DOUT_DEFAULT', current: '5' },
      ]);
      expect(instance(diff, '/axi_gpio_0')?.parameters).toEqual([
        { key: 'CONFIG.C_GPIO_WIDTH', base: '8' },
      ]);
    });

    it('reports a change inside a hierarchy on the child with its level', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.components.gpio_block.components.axi_gpio_1.parameters.C_ALL_OUTPUTS.value = '0';
        })
      );
      expect(diff.instances).toHaveLength(1);
      expect(diff.instances[0]).toMatchObject({
        path: '/gpio_block/axi_gpio_1',
        level: '/gpio_block',
        status: 'changed',
      });
    });
  });

  describe('pins', () => {
    const withoutGpio0Net = (d: any) => {
      delete d.interface_nets.periph_gpio0;
    };

    it('reports a pin that disappears with its last connection', () => {
      const diff = diffSystemGraphs(bd(), bd(withoutGpio0Net));
      expect(instance(diff, '/axi_periph')?.pins).toEqual([
        { pin: 'M00_AXI', status: 'removed', basePeers: ['axi_gpio_0/S_AXI'] },
      ]);
      expect(instance(diff, '/axi_gpio_0')?.pins).toEqual([
        {
          pin: 'S_AXI',
          status: 'changed',
          basePeers: ['axi_periph/M00_AXI'],
          currentPeers: [],
          lost: ['axi_periph/M00_AXI'],
        },
      ]);
    });

    it('reports a pin that appears with its first connection', () => {
      const diff = diffSystemGraphs(bd(withoutGpio0Net), bd());
      expect(instance(diff, '/axi_periph')?.pins).toEqual([
        { pin: 'M00_AXI', status: 'added', currentPeers: ['axi_gpio_0/S_AXI'] },
      ]);
    });

    it('reports a rewired pin with both peer lists', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.nets.fclk.ports = d.nets.fclk.ports.filter(
            (p: string) => p !== 'axi_gpio_0/s_axi_aclk'
          );
          d.nets.other = { ports: ['axi_gpio_0/s_axi_aclk', 'sys_ps7/FCLK_CLK1'] };
        })
      );
      expect(instance(diff, '/axi_gpio_0')?.pins).toEqual([
        {
          pin: 's_axi_aclk',
          status: 'changed',
          basePeers: ['axi_periph/ACLK', 'gpio_block/clk', 'sys_ps7/FCLK_CLK0'],
          currentPeers: ['sys_ps7/FCLK_CLK1'],
          gained: ['sys_ps7/FCLK_CLK1'],
          lost: ['axi_periph/ACLK', 'gpio_block/clk', 'sys_ps7/FCLK_CLK0'],
        },
      ]);
    });

    it('mirrors gained and lost when base and current are swapped', () => {
      const rewired = (d: any) => {
        d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => p !== 'axi_gpio_0/s_axi_aclk');
        d.nets.other = { ports: ['axi_gpio_0/s_axi_aclk', 'sys_ps7/FCLK_CLK1'] };
      };
      const [a, b] = [bd(), bd(rewired)];
      const pinOf = (diff: SystemGraphDiff) => instance(diff, '/axi_gpio_0')?.pins[0];
      const [forward, back] = [pinOf(diffSystemGraphs(a, b)), pinOf(diffSystemGraphs(b, a))];
      expect(forward?.gained).toEqual(back?.lost);
      expect(forward?.lost).toEqual(back?.gained);
      expect(forward?.gained).toEqual(['sys_ps7/FCLK_CLK1']);
    });

    it('lists a pin that joined a net as gained only', () => {
      const diff = diffSystemGraphs(bd(withoutGpio0Net), bd());
      expect(instance(diff, '/axi_gpio_0')?.pins).toEqual([
        {
          pin: 'S_AXI',
          status: 'changed',
          basePeers: [],
          currentPeers: ['axi_periph/M00_AXI'],
          gained: ['axi_periph/M00_AXI'],
        },
      ]);
    });

    it('writes a boundary peer as the pin name', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.components.gpio_block.nets.block_clk.ports = ['clk'];
        })
      );
      expect(instance(diff, '/gpio_block/axi_gpio_1')?.pins).toEqual([
        {
          pin: 's_axi_aclk',
          status: 'removed',
          basePeers: ['clk'],
        },
      ]);
    });
  });

  describe('external ports', () => {
    it('reports an added and a removed port with their attributes', () => {
      const edit = (d: any) => {
        delete d.ports.led_o;
        d.ports.irq_o = { direction: 'O', left: '3', right: '0' };
      };
      const diff = diffSystemGraphs(bd(), bd(edit));
      expect(diff.ports).toEqual([
        {
          pin: 'irq_o',
          status: 'added',
          currentPeers: [],
          attributes: [
            { key: 'direction', current: 'out' },
            { key: 'width', current: '3:0' },
          ],
        },
        {
          pin: 'led_o',
          status: 'removed',
          basePeers: [],
          attributes: [
            { key: 'direction', base: 'out' },
            { key: 'width', base: '7:0' },
          ],
        },
      ]);
      expect(diff.summary).toEqual({ ...EMPTY, added: 1, removed: 1 });
    });

    it('reports a changed attribute with identical peers as changed', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.ports.led_o.left = '15';
        })
      );
      expect(diff.ports).toEqual([
        {
          pin: 'led_o',
          status: 'changed',
          basePeers: [],
          currentPeers: [],
          attributes: [{ key: 'width', base: '7:0', current: '15:0' }],
        },
      ]);
    });

    it('does not report a port whose only difference is the pin that left its net', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.nets.ext_rst.ports = ['sys_rst_n', 'sync_0/rst_n_in'];
        })
      );
      expect(diff.ports).toEqual([]);
      expect(instance(diff, '/ghost_ctrl')?.pins).toEqual([
        {
          pin: 'rst_n',
          status: 'removed',
          basePeers: ['sync_0/rst_n_in', 'sys_rst_n'],
        },
      ]);
      expect(diff.instances.map((i) => i.path)).toEqual(['/ghost_ctrl']);
    });

    it('reports a port that is the pin that moved', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.nets.ext_rst.ports = ['sync_0/rst_n_in', 'ghost_ctrl/rst_n'];
          d.nets.other = { ports: ['sys_rst_n', 'sys_ps7/FCLK_CLK1'] };
        })
      );
      expect(diff.ports).toEqual([
        {
          pin: 'sys_rst_n',
          status: 'changed',
          basePeers: ['ghost_ctrl/rst_n', 'sync_0/rst_n_in'],
          currentPeers: ['sys_ps7/FCLK_CLK1'],
          gained: ['sys_ps7/FCLK_CLK1'],
          lost: ['ghost_ctrl/rst_n', 'sync_0/rst_n_in'],
          attributes: [],
        },
      ]);
    });
  });

  describe('which pins are reported', () => {
    /** The reported pins as `path pin status`, over instances and ports. */
    const reported = (diff: SystemGraphDiff) =>
      [
        ...diff.instances
          .filter((i) => i.status === 'changed')
          .flatMap((i) => i.pins.map((p) => `${i.path} ${p.pin} ${p.status}`)),
        ...diff.ports.map((p) => `port ${p.pin} ${p.status}`),
      ].sort();
    const changedInstances = (diff: SystemGraphDiff) => diff.instances.map((i) => i.path);

    const scenarios: Record<string, [(d: any) => void, (d: any) => void]> = {
      join: [
        () => undefined,
        (d) => {
          d.nets.ext_rst.ports.push('axi_gpio_0/s_axi_aresetn');
        },
      ],
      leave: [
        () => undefined,
        (d) => {
          d.nets.ext_rst.ports = ['sys_rst_n', 'ghost_ctrl/rst_n'];
        },
      ],
      rewire: [
        () => undefined,
        (d) => {
          d.interface_nets.ps_axi.interface_ports = ['sys_ps7/M_AXI_GP0', 'gpio_block/GPIO'];
        },
      ],
      merge: [
        () => undefined,
        (d) => {
          delete d.interface_nets.periph_gpio0;
          d.interface_nets.ps_axi.interface_ports.push('axi_periph/M00_AXI', 'axi_gpio_0/S_AXI');
        },
      ],
      removeFromFanout: [
        () => undefined,
        (d) => {
          delete d.components.axi_gpio_0;
          delete d.interface_nets.periph_gpio0;
          d.nets.fclk.ports = d.nets.fclk.ports.filter((p: string) => !p.startsWith('axi_gpio_0/'));
          const segments = d.addressing['/sys_ps7'].address_spaces.Data.segments;
          for (const key of Object.keys(segments)) {
            if (key.startsWith('SEG_axi_gpio_0')) {
              delete segments[key];
            }
          }
        },
      ],
      addToDriver: [() => undefined, addFifo],
      connectedOnlyToRemoved: [
        (d) => {
          d.components.fifo_0 = {
            vlnv: 'xilinx.com:ip:axis_data_fifo:2.0',
            interface_ports: {
              M_AXIS: { mode: 'Master', vlnv: 'xilinx.com:interface:axis_rtl:1.0' },
            },
          };
          d.interface_nets.fifo_out = { interface_ports: ['gpio_block/GPIO', 'fifo_0/M_AXIS'] };
        },
        () => undefined,
      ],
    };
    const diffOf = (name: string) => {
      const [before, after] = scenarios[name];
      return diffSystemGraphs(bd(before), bd(after));
    };

    it('reports only the pin that joined a net of two other pins', () => {
      const diff = diffOf('join');
      expect(reported(diff)).toEqual(['/axi_gpio_0 s_axi_aresetn added']);
      expect(instance(diff, '/axi_gpio_0')?.pins[0].currentPeers).toEqual([
        'ghost_ctrl/rst_n',
        'sync_0/rst_n_in',
        'sys_rst_n',
      ]);
      expect(changedInstances(diff)).toEqual(['/axi_gpio_0']);
    });

    it('reports only the pin that left a net of three pins', () => {
      const diff = diffOf('leave');
      expect(reported(diff)).toEqual(['/sync_0 rst_n_in removed']);
      expect(diff.ports).toEqual([]);
    });

    it('reports both ends and the open pin of a point-to-point rewire', () => {
      // M_AXI_GP0 -- S00_AXI becomes M_AXI_GP0 -- GPIO; S00_AXI is left open (and, being
      // undeclared, vanishes) and GPIO was open before.
      expect(reported(diffOf('rewire'))).toEqual([
        '/axi_periph S00_AXI removed',
        '/gpio_block GPIO changed',
        '/sys_ps7 M_AXI_GP0 changed',
      ]);
    });

    it('reports all four pins of two merged two-pin nets', () => {
      expect(reported(diffOf('merge'))).toEqual([
        '/axi_gpio_0 S_AXI changed',
        '/axi_periph M00_AXI changed',
        '/axi_periph S00_AXI changed',
        '/sys_ps7 M_AXI_GP0 changed',
      ]);
    });

    it('reports no pin change on the members left after a block left a fan-out net', () => {
      const diff = diffOf('removeFromFanout');
      expect(changedInstances(diff)).toEqual(['/axi_gpio_0']);
      expect(diff.instances[0].status).toBe('removed');
      expect(diff.instances[0].pins).toEqual([
        { pin: 'S_AXI', status: 'removed', basePeers: ['axi_periph/M00_AXI'] },
        {
          pin: 's_axi_aclk',
          status: 'removed',
          basePeers: ['axi_periph/ACLK', 'gpio_block/clk', 'sys_ps7/FCLK_CLK0'],
        },
      ]);
      expect(diff.ports).toEqual([]);
    });

    it('reports no pin change on the driver of an added block, and lists the added block pins', () => {
      const diff = diffOf('addToDriver');
      expect(changedInstances(diff)).toEqual(['/fifo_0']);
      expect(diff.instances[0].pins).toEqual([
        { pin: 's_axis_aclk', status: 'added', currentPeers: FCLK_PEERS },
      ]);
      expect(diff.summary).toEqual({ ...EMPTY, added: 1 });
    });

    it('does not report a pin that was only connected to a removed block', () => {
      const diff = diffOf('connectedOnlyToRemoved');
      expect(changedInstances(diff)).toEqual(['/fifo_0']);
      expect(diff.instances[0]).toMatchObject({ status: 'removed' });
      expect(diff.instances[0].pins).toEqual([
        { pin: 'M_AXIS', status: 'removed', basePeers: ['gpio_block/GPIO'] },
      ]);
      expect(diff.summary).toEqual({ ...EMPTY, removed: 1 });
    });

    it.each(Object.keys(scenarios))(
      'mirrors the summary of %s when base and current swap',
      (name) => {
        const [before, after] = scenarios[name];
        const forward = diffSystemGraphs(bd(before), bd(after));
        const backward = diffSystemGraphs(bd(after), bd(before));
        expect(backward.summary).toEqual({
          added: forward.summary.removed,
          removed: forward.summary.added,
          changed: forward.summary.changed,
          version: forward.summary.version,
          renamed: forward.summary.renamed,
        });
        expect(reported(backward).length).toBe(reported(forward).length);
      }
    );
  });

  describe('hierarchies and cross-level connections', () => {
    const twoClockHier = (d: any) => {
      const g = d.components.gpio_block;
      g.ports.clk2 = { type: 'clk', direction: 'I' };
      for (const n of ['axi_gpio_2', 'axi_gpio_3', 'axi_gpio_4']) {
        g.components[n] = { vlnv: AXI_GPIO };
      }
      g.nets.block_clk.ports = ['clk', 'axi_gpio_1/s_axi_aclk', 'axi_gpio_2/s_axi_aclk'];
      g.nets.block_clk2 = { ports: ['clk2', 'axi_gpio_3/s_axi_aclk', 'axi_gpio_4/s_axi_aclk'] };
      d.nets.fclk1 = { ports: ['sys_ps7/FCLK_CLK1', 'gpio_block/clk2'] };
    };
    const pinsOf = (diff: SystemGraphDiff) =>
      diff.instances.flatMap((i) =>
        i.pins.map((p) => `${i.path} ${p.pin}${p.inside ? ' (inside)' : ''} ${p.status}`)
      );
    /** Asserts the reported pins of a→b and, with the mirrored statuses, of b→a. */
    const expectBothWays = (a: SystemGraph, b: SystemGraph, expected: string[]) => {
      expect(pinsOf(diffSystemGraphs(a, b))).toEqual(expected);
      expect(pinsOf(diffSystemGraphs(b, a))).toEqual(expected);
    };

    it('reports a pin that gains a pin of an added hierarchy, which is not classified', () => {
      // The added hierarchy h2 connects its pin k to /a/x from inside. An added hierarchy
      // lists no inside pins, so /h2:k is not classified and must not make /a/x a host:
      // the row on /a/x is the only trace of the new connection.
      const design = (hier: string, call: string) =>
        readSystemDesign(
          't.tcl',
          't.tcl',
          `create_bd_design "t"
${hier}proc create_root_design { parentCell } {
  set parentObj [get_bd_cells /]
  current_bd_instance $parentObj
  create_bd_cell -type ip -vlnv ${AXI_GPIO} a
  create_bd_cell -type ip -vlnv ${AXI_GPIO} b
  create_bd_cell -type ip -vlnv ${AXI_GPIO} c
${call}  connect_bd_net -net n [get_bd_pins a/x] [get_bd_pins b/y] [get_bd_pins c/y]
}
create_root_design ""
`
        ) as SystemGraph;
      const base = design('', '');
      const current = design(
        `proc create_hier_cell_h2 { parentCell nameHier } {
  set parentObj [get_bd_cells $parentCell]
  set oldCurInst [current_bd_instance .]
  current_bd_instance $parentObj
  set hier_obj [create_bd_cell -type hier $nameHier]
  current_bd_instance $hier_obj
  create_bd_pin -dir I k
  connect_bd_net -net hk [get_bd_pins k] [get_bd_pins /a/x]
  current_bd_instance $oldCurInst
}
`,
        '  create_hier_cell_h2 [current_bd_instance .] h2\n'
      );
      const diff = diffSystemGraphs(base, current);
      expect(diff.instances.map((i) => `${i.path} ${i.status}`)).toEqual([
        '/a changed',
        '/h2 added',
      ]);
      expect(diff.instances[0].pins).toEqual([
        {
          pin: 'x',
          status: 'changed',
          basePeers: ['b/y', 'c/y'],
          currentPeers: ['/h2:k', 'b/y', 'c/y'],
          gained: ['/h2:k'],
        },
      ]);
      expect(pinsOf(diffSystemGraphs(current, base))).toEqual(['/a x changed']);
    });

    it('reports the boundary pins that moved when the clocks of a hierarchy are swapped', () => {
      // Inside gpio_block, clk drove g1 and g2 and clk2 drove g3 and g4; now the other way
      // round. clk and clk2 kept nothing, so their inside views are the movers; each child
      // clock pin kept its sibling, and the pin that left or joined kept less, so the four
      // child pins are hosts.
      const swapped = (d: any) => {
        twoClockHier(d);
        const g = d.components.gpio_block;
        g.nets.block_clk.ports[0] = 'clk2';
        g.nets.block_clk2.ports[0] = 'clk';
      };
      const [a, b] = [bd(twoClockHier), bd(swapped)];
      expectBothWays(a, b, [
        '/gpio_block clk (inside) changed',
        '/gpio_block clk2 (inside) changed',
      ]);
      expect(diffSystemGraphs(a, b).instances[0].pins[0]).toEqual({
        pin: 'clk',
        status: 'changed',
        inside: true,
        basePeers: ['axi_gpio_1/s_axi_aclk', 'axi_gpio_2/s_axi_aclk'],
        currentPeers: ['axi_gpio_3/s_axi_aclk', 'axi_gpio_4/s_axi_aclk'],
        gained: ['axi_gpio_3/s_axi_aclk', 'axi_gpio_4/s_axi_aclk'],
        lost: ['axi_gpio_1/s_axi_aclk', 'axi_gpio_2/s_axi_aclk'],
      });
    });

    it('reports the movers when boundary pins join and leave the nets', () => {
      // rst_n now also drives the fan-out net of axi_gpio_3/4 and leaves block_rst, clk
      // moves from block_clk to block_rst. Inside views: clk and rst_n kept nothing (movers);
      // clk2 kept two pins and gained rst_n, which kept nothing (host). axi_gpio_1/2/3/4
      // s_axi_aclk are hosts too. axi_gpio_1 s_axi_aresetn kept nothing and moved.
      const joined = (d: any) => {
        twoClockHier(d);
        const g = d.components.gpio_block;
        g.nets.block_clk2.ports.push('rst_n');
        g.nets.block_rst.ports = ['axi_gpio_1/s_axi_aresetn', 'clk'];
        g.nets.block_clk.ports = ['axi_gpio_1/s_axi_aclk', 'axi_gpio_2/s_axi_aclk'];
      };
      expectBothWays(bd(twoClockHier), bd(joined), [
        '/gpio_block clk (inside) changed',
        '/gpio_block rst_n (inside) changed',
        '/gpio_block/axi_gpio_1 s_axi_aresetn changed',
      ]);
    });

    describe('feed-throughs and the inside of a hierarchy', () => {
      const feedThrough = (d: any) => {
        const g = d.components.gpio_block;
        g.ports.fin = { direction: 'I' };
        g.ports.fout = { direction: 'O' };
        g.ports.fout2 = { direction: 'O' };
        d.nets.fin_n = { ports: ['sys_ps7/FCLK_CLK2', 'gpio_block/fin'] };
        d.nets.fout_n = { ports: ['gpio_block/fout', 'sync_0/clk'] };
        d.nets.fout2_n = { ports: ['gpio_block/fout2', 'axi_periph/ARESETN'] };
      };
      const withInsideNet = (ports?: string[]) => (d: any) => {
        feedThrough(d);
        if (ports) {
          d.components.gpio_block.nets.ft = { ports };
        }
      };

      it('reports both pins of a feed-through that is added', () => {
        expectBothWays(bd(withInsideNet()), bd(withInsideNet(['fin', 'fout'])), [
          '/gpio_block fin (inside) changed',
          '/gpio_block fout (inside) changed',
        ]);
      });

      it('reports the three pins of a feed-through that is rewired', () => {
        expectBothWays(bd(withInsideNet(['fin', 'fout'])), bd(withInsideNet(['fin', 'fout2'])), [
          '/gpio_block fin (inside) changed',
          '/gpio_block fout (inside) changed',
          '/gpio_block fout2 (inside) changed',
        ]);
      });

      it('reports only the pin that joined a feed-through', () => {
        expectBothWays(
          bd(withInsideNet(['fin', 'fout'])),
          bd(withInsideNet(['fin', 'fout', 'fout2'])),
          ['/gpio_block fout2 (inside) changed']
        );
      });

      it('reports the two pins of a feed-through added in a nested hierarchy', () => {
        const nested = (d: any) => {
          feedThrough(d);
          const g = d.components.gpio_block;
          g.components.inner = { ports: { a: { direction: 'I' }, b: { direction: 'O' } } };
          g.nets.to_inner = { ports: ['fin', 'inner/a'] };
          g.nets.from_inner = { ports: ['inner/b', 'fout'] };
        };
        expectBothWays(
          bd(nested),
          bd((d) => {
            nested(d);
            d.components.gpio_block.components.inner.nets = { ft: { ports: ['a', 'b'] } };
          }),
          ['/gpio_block/inner a (inside) changed', '/gpio_block/inner b (inside) changed']
        );
      });

      it('explains a boundary pin that only gained an added child, and lists it on the child', () => {
        const withChild = (d: any) => {
          feedThrough(d);
          const g = d.components.gpio_block;
          g.components.newc = { vlnv: 'x:y:z:1.0' };
          g.nets.nc = { ports: ['fin', 'newc/i'] };
        };
        const diff = diffSystemGraphs(bd(feedThrough), bd(withChild));
        expect(diff.instances).toEqual([
          {
            path: '/gpio_block/newc',
            level: '/gpio_block',
            status: 'added',
            currentType: 'x:y:z:1.0',
            parameters: [],
            pins: [{ pin: 'i', status: 'added', currentPeers: ['fin'] }],
          },
        ]);
        const back = diffSystemGraphs(bd(withChild), bd(feedThrough));
        expect(back.instances).toEqual([
          {
            path: '/gpio_block/newc',
            level: '/gpio_block',
            status: 'removed',
            baseType: 'x:y:z:1.0',
            parameters: [],
            pins: [{ pin: 'i', status: 'removed', basePeers: ['fin'] }],
          },
        ]);
      });

      it('reports a boundary pin and a child pin when the net between them is cut', () => {
        const diff = diffSystemGraphs(
          bd(),
          bd((d) => {
            delete d.components.gpio_block.nets.block_rst;
          })
        );
        expect(diff.instances.map((i) => [i.path, i.pins])).toEqual([
          [
            '/gpio_block',
            [
              {
                pin: 'rst_n',
                status: 'changed',
                inside: true,
                basePeers: ['axi_gpio_1/s_axi_aresetn'],
                currentPeers: [],
                lost: ['axi_gpio_1/s_axi_aresetn'],
              },
            ],
          ],
          [
            '/gpio_block/axi_gpio_1',
            [{ pin: 's_axi_aresetn', status: 'removed', basePeers: ['rst_n'] }],
          ],
        ]);
      });

      it('does not report a direction that was inferred from the connections', () => {
        const inferred = (inner: string) => (d: any) => {
          const g = d.components.gpio_block;
          g.interface_ports.X = { vlnv: 'xilinx.com:interface:aximm_rtl:1.0' };
          g.components.p = { vlnv: 'x:y:p:1.0' };
          g.components.q = { vlnv: 'x:y:q:1.0' };
          g.interface_nets.xi = { interface_ports: ['X', inner] };
          d.interface_nets.xo = { interface_ports: ['gpio_block/X', 'axi_periph/xx'] };
        };
        const diff = diffSystemGraphs(bd(inferred('p/S_AXI')), bd(inferred('q/M_AXI')));
        const block = diff.instances.find((i) => i.path === '/gpio_block');
        expect(block?.pins).toEqual([
          {
            pin: 'X',
            status: 'changed',
            inside: true,
            basePeers: ['p/S_AXI'],
            currentPeers: ['q/M_AXI'],
            gained: ['q/M_AXI'],
            lost: ['p/S_AXI'],
          },
        ]);
      });
    });

    it('reports the movers of a swap in a script, relative to the level of the hierarchy', () => {
      const [a, b] = [twoClockTcl(false), twoClockTcl(true)];
      expectBothWays(a, b, ['/h clk (inside) changed', '/h clk2 (inside) changed']);
      expect(diffSystemGraphs(a, b).instances[0].pins[0]).toMatchObject({
        basePeers: ['g1/s_axi_aclk', 'g2/s_axi_aclk'],
        currentPeers: ['g3/s_axi_aclk', 'g4/s_axi_aclk'],
      });
    });

    it('finds the peers of a pin on nets of another level, in absolute form', () => {
      const diff = diffSystemGraphs(crossLevelTcl(false), crossLevelTcl(true));
      expect(diff.instances).toHaveLength(1);
      expect(diff.instances[0]).toMatchObject({ path: '/h/g1', level: '/h', status: 'changed' });
      expect(diff.instances[0].pins).toEqual([
        { pin: 'z', status: 'added', currentPeers: ['/a/x', '/b/y', '/c/y'] },
      ]);
      expect(diffSystemGraphs(crossLevelTcl(true), crossLevelTcl(false)).instances[0].pins).toEqual(
        [{ pin: 'z', status: 'removed', basePeers: ['/a/x', '/b/y', '/c/y'] }]
      );
    });

    it('compares the parameters of an external port', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.ports.sys_clk.parameters.FREQ_HZ.value = '100000000';
        })
      );
      expect(diff.ports).toEqual([
        {
          pin: 'sys_clk',
          status: 'changed',
          basePeers: [],
          currentPeers: [],
          attributes: [{ key: 'CONFIG.FREQ_HZ', base: '125000000', current: '100000000' }],
        },
      ]);
    });

    const hierPin = (edit: (g: any) => void) =>
      diffSystemGraphs(
        bd(),
        bd((d) => edit(d.components.gpio_block))
      ).instances;

    it('compares the width of a hierarchy pin', () => {
      const [change] = hierPin((g) => {
        g.ports.rst_n.left = '3';
        g.ports.rst_n.right = '0';
      });
      expect(change).toMatchObject({ path: '/gpio_block', status: 'changed' });
      expect(change.pins).toEqual([
        {
          pin: 'rst_n',
          status: 'changed',
          basePeers: [],
          currentPeers: [],
          attributes: [{ key: 'width', current: '3:0' }],
        },
      ]);
    });

    it('compares the direction of a hierarchy pin', () => {
      const [change] = hierPin((g) => {
        g.ports.rst_n.direction = 'O';
      });
      expect(change.pins[0].attributes).toEqual([{ key: 'direction', base: 'in', current: 'out' }]);
    });

    it('compares the parameters of a hierarchy pin', () => {
      const [change] = hierPin((g) => {
        g.ports.clk.parameters = { FREQ_HZ: { value: '5' } };
      });
      expect(change.pins[0]).toMatchObject({
        pin: 'clk',
        attributes: [{ key: 'CONFIG.FREQ_HZ', current: '5' }],
      });
    });

    it('compares the interface type of a hierarchy pin', () => {
      const [change] = hierPin((g) => {
        g.interface_ports.GPIO.vlnv = 'xilinx.com:interface:iic_rtl:1.0';
      });
      expect(change.pins[0].attributes).toEqual([
        {
          key: 'vlnv',
          base: 'xilinx.com:interface:gpio_rtl:1.0',
          current: 'xilinx.com:interface:iic_rtl:1.0',
        },
      ]);
    });

    it('does not compare attributes of the pins of other instances', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          d.components.sys_ps7.interface_ports.M_AXI_GP0.vlnv = 'xilinx.com:interface:iic_rtl:1.0';
        })
      );
      expect(diff.instances).toEqual([]);
    });

    describe('a pin of a block that is in neither graph', () => {
      // `sub` comes from a hierarchy proc that is not in the file, so `sub/inner/clk` is a
      // net endpoint whose owner no caller reports: it must not suppress the pins on the net.
      const withSub = (...pins: string[]) =>
        readSystemDesign(
          't.tcl',
          't.tcl',
          `create_bd_design "t"
proc create_root_design { parentCell } {
  set parentObj [get_bd_cells /]
  current_bd_instance $parentObj
${ip('a')}
${ip('b')}
  create_hier_cell_sub [current_bd_instance .] sub
${net('clk', ...pins)}
}
create_root_design ""
`
        ) as SystemGraph;
      const [without, withInner] = [
        withSub('a/clk', 'b/clk'),
        withSub('a/clk', 'b/clk', 'sub/inner/clk'),
      ];

      it('reports the pins it joins', () => {
        const diff = diffSystemGraphs(without, withInner);
        expect(diff.instances.map((i) => `${i.path} ${i.status}`)).toEqual([
          '/a changed',
          '/b changed',
        ]);
        expect(pinsOf(diff)).toEqual(['/a clk changed', '/b clk changed']);
      });

      it('reports the pins it leaves', () => {
        expect(pinsOf(diffSystemGraphs(withInner, without))).toEqual([
          '/a clk changed',
          '/b clk changed',
        ]);
      });
    });
  });

  describe('address segments', () => {
    const segments = (d: any) => d.addressing['/sys_ps7'].address_spaces.Data.segments;

    it('reports an added, a removed and a moved segment, sorted', () => {
      const diff = diffSystemGraphs(
        bd(),
        bd((d) => {
          const s = segments(d);
          delete s.SEG_axi_gpio_0_Mem;
          s.SEG_axi_gpio_1_Reg.offset = '0x41230000';
          s.SEG_new = { address_block: '/axi_gpio_0/S_AXI/New', offset: '0x42000000', range: '4K' };
        })
      );
      expect(diff.segments).toEqual([
        {
          addressSpace: 'sys_ps7/Data',
          segment: 'axi_gpio_0/S_AXI/Mem',
          status: 'removed',
          base: { offset: '0x00000000', range: '0x100000000' },
        },
        {
          addressSpace: 'sys_ps7/Data',
          segment: 'axi_gpio_0/S_AXI/New',
          status: 'added',
          current: { offset: '0x42000000', range: '0x00001000' },
        },
        {
          addressSpace: 'sys_ps7/Data',
          segment: 'gpio_block/axi_gpio_1/S_AXI/Reg',
          status: 'changed',
          base: { offset: '0x41210000', range: '0x00010000' },
          current: { offset: '0x41230000', range: '0x00010000' },
        },
      ]);
    });

    it('compares offsets case-insensitively', () => {
      const edit = (offset: string) => (d: any) => {
        segments(d).SEG_axi_gpio_1_Reg.offset = offset;
      };
      const diff = diffSystemGraphs(bd(edit('0x4121ABCD')), bd(edit('0x4121abcd')));
      expect(diff.segments).toEqual([]);
    });
  });

  describe('result as a whole', () => {
    const pair: [SystemGraph, SystemGraph] = [
      bd(),
      bd((d) => {
        addFifo(d);
        delete d.ports.led_o;
        d.components.gpio_block.components.axi_gpio_1.vlnv = 'xilinx.com:ip:axi_gpio:2.1';
        segments(d).SEG_axi_gpio_1_Reg.offset = '0x41230000';
      }),
    ];

    function segments(d: any) {
      return d.addressing['/sys_ps7'].address_spaces.Data.segments;
    }

    it('is antisymmetric', () => {
      const forward = diffSystemGraphs(...pair);
      const backward = diffSystemGraphs(pair[1], pair[0]);
      const paths = (diff: SystemGraphDiff, status: string) =>
        diff.instances.filter((i) => i.status === status).map((i) => i.path);
      expect(paths(forward, 'added')).toEqual(paths(backward, 'removed'));
      expect(paths(forward, 'removed')).toEqual(paths(backward, 'added'));
      expect(forward.summary.added).toBe(backward.summary.removed);
      expect(forward.summary.removed).toBe(backward.summary.added);
      expect(forward.summary.changed).toBe(backward.summary.changed);
      expect(forward.summary.version).toBe(backward.summary.version);
      expect(forward.summary.added).toBeGreaterThan(0);
      expect(forward.summary.removed).toBeGreaterThan(0);
    });

    it('sorts instances by path and counts every status once', () => {
      const diff = diffSystemGraphs(...pair);
      const paths = diff.instances.map((i) => i.path);
      expect(paths).toEqual([...paths].sort());
      const all = [...diff.instances, ...diff.ports, ...diff.segments];
      const count = (status: string) => all.filter((c) => c.status === status).length;
      expect(diff.summary).toEqual({
        added: count('added'),
        removed: count('removed'),
        changed: count('changed'),
        version: count('version'),
        renamed: count('renamed'),
      });
      expect(diff.summary.removed).toBeGreaterThan(0);
    });

    it('names both sides and notes whether the formats differ', () => {
      const same = diffSystemGraphs(...pair);
      expect(same.base).toEqual({ name: 'zynq_gpio_system', format: 'vivado-bd' });
      expect(same.formatsDiffer).toBe(false);
      const other = diffSystemGraphs(bd(), qsys());
      expect(other.formatsDiffer).toBe(true);
      expect(other.current.format).toBe('qsys');
    });
  });
});
