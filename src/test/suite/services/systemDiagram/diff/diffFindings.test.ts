/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- the helpers edit parsed JSON of the fixtures */
import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import type { Finding, FindingsDiff } from '../../../../../domain/systemGraphDiff';
import { readBdTcl } from '../../../../../parser/system/BdTclReader';
import { diffFindings } from '../../../../../services/systemDiagram/diff/diffFindings';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';

const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design');
const BD_TEXT = fs.readFileSync(path.join(fixtures, 'zynq_gpio_system.bd'), 'utf8');

/** Reads the fixture `.bd` after `edit` changed its parsed `design` object. */
function bd(edit: (design: any) => void = () => undefined): SystemGraph {
  const root = JSON.parse(BD_TEXT);
  edit(root.design);
  return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root, null, 2))!;
}

const compare = (base: SystemGraph, current: SystemGraph): FindingsDiff =>
  diffFindings(base, current, diffSystemGraphs(base, current));

const unconnected = (findings: Finding[]) =>
  findings.map((f) => ('label' in f ? `${f.kind} ${f.level} ${f.label}` : `${f.kind} ${f.from}`));

/** Two blocks on two clock generators; `bOn` is the generator of `b`, `resetNet` the name of the reset net. */
function twoClocks(bOn: 'a' | 'b', resetNet = 'rst_n'): SystemGraph {
  return readBdTcl(
    [
      'create_bd_design "d"',
      'set a [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 a ]',
      'set b [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 b ]',
      'set ca [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 ca ]',
      'set cb [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 cb ]',
      'set rst [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 rst ]',
      'set_property CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {100} $ca',
      'set_property CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {50} $cb',
      'connect_bd_intf_net -intf_net n1 [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      `connect_bd_net -net clk_a [get_bd_pins ca/clk_out1] [get_bd_pins a/clk] [get_bd_pins rst/slowest_sync_clk]${bOn === 'a' ? ' [get_bd_pins b/clk]' : ''}`,
      `connect_bd_net -net clk_b [get_bd_pins cb/clk_out1]${bOn === 'b' ? ' [get_bd_pins b/clk]' : ''}`,
      `connect_bd_net -net ${resetNet} [get_bd_pins rst/peripheral_aresetn] [get_bd_pins a/rst_n] [get_bd_pins b/rst_n]`,
    ].join('\n'),
    'two_clocks.tcl'
  );
}

describe('diffFindings: unconnected pins', () => {
  // Of the fixture, only the pins of `sync_0`, `gpio_block` and the external ports are reviewed.
  const connectClock = (design: any) => {
    design.nets.fclk.ports.push('sync_0/clk');
  };

  it('reports a pin that becomes undriven as new', () => {
    const result = compare(bd(connectClock), bd());
    expect(result.new).toEqual([
      { kind: 'undriven', level: '/', instance: '/sync_0', pin: 'clk', label: 'sync_0/clk' },
    ]);
    expect(result.resolved).toEqual([]);
  });

  it('reports a pin that gets connected as resolved', () => {
    const result = compare(bd(), bd(connectClock));
    expect(unconnected(result.resolved)).toEqual(['undriven / sync_0/clk']);
    expect(result.new).toEqual([]);
  });

  it('reports neither for a pin that stays unconnected', () => {
    expect(compare(bd(), bd())).toEqual({ new: [], resolved: [] });
  });

  it('reports an external port that becomes unused as new, labelled with its name', () => {
    const base = bd((design) => {
      design.nets.sysclk = { ports: ['sys_clk', 'sync_0/clk'] };
    });
    const result = compare(base, bd());
    expect(result.new).toContainEqual({
      kind: 'unused',
      level: '/',
      instance: null,
      pin: 'sys_clk',
      label: 'sys_clk',
    });
  });

  it('keeps the findings of a renamed block: neither new nor resolved', () => {
    const base = bd();
    const current = bd((design) => {
      design.components.sync_main = design.components.sync_0;
      delete design.components.sync_0;
      for (const net of Object.values<any>(design.nets)) {
        net.ports = net.ports.map((p: string) => p.replace(/^sync_0\//, 'sync_main/'));
      }
    });
    expect(diffSystemGraphs(base, current).summary.renamed).toBe(1);
    // Without the renames of the diff, the block's pin is one resolved and one new finding.
    const unpaired = diffFindings(base, current, diffSystemGraphs(base, base));
    expect(unconnected(unpaired.new)).toContain('undriven / sync_main/clk');
    expect(unconnected(unpaired.resolved)).toContain('undriven / sync_0/clk');
    expect(compare(base, current)).toEqual({ new: [], resolved: [] });
  });

  it('sorts by kind, then label', () => {
    const base = bd((design) => {
      design.nets.ext_rst.ports.push('gpio_block/rst_n');
      design.nets.fclk.ports.push('sync_0/clk');
      design.nets.sysclk = { ports: ['sys_clk', 'sync_0/rst_n'] };
    });
    expect(unconnected(compare(base, bd()).new)).toEqual([
      'undriven / gpio_block/rst_n',
      'undriven / sync_0/clk',
      'unused / sync_0/rst_n',
      'unused / sys_clk',
    ]);
  });

  it('sorts by level before label within a kind', () => {
    const base = bd((design) => {
      design.nets.sysclk = { ports: ['sys_clk', 'sync_0/clk'] };
    });
    const current = bd((design) => {
      design.components.gpio_block.nets.block_clk.ports = ['axi_gpio_1/s_axi_aclk'];
    });
    // `clk` would sort before `sys_clk` by label; the root level comes first.
    expect(unconnected(compare(base, current).new)).toEqual([
      'undriven / sync_0/clk',
      'unused / sys_clk',
      'unused /gpio_block clk',
    ]);
  });
});

describe('diffFindings: crossings', () => {
  it('reports a new data crossing with its clocks and reason, and the reset crossing with it', () => {
    const result = compare(twoClocks('a'), twoClocks('b'));
    expect(result.resolved).toEqual([]);
    expect(result.new).toEqual([
      {
        kind: 'dataCrossing',
        level: '/',
        from: 'a/M_AXIS',
        to: 'b/S_AXIS',
        fromClock: 'ca/clk_out1',
        toClock: 'cb/clk_out1',
        reason:
          'a/M_AXIS is on ca/clk_out1 and b/S_AXIS on cb/clk_out1; no synchronizer is known between them',
      },
      {
        kind: 'resetCrossing',
        level: '/',
        from: 'rst/peripheral_aresetn',
        to: 'b/rst_n',
        fromClock: 'ca/clk_out1',
        toClock: 'cb/clk_out1',
        reason:
          'b/rst_n is clocked by cb/clk_out1 but its reset rst/peripheral_aresetn is released on ca/clk_out1',
      },
    ]);
  });

  it('reports a crossing that no longer exists as resolved', () => {
    const result = compare(twoClocks('b'), twoClocks('a'));
    expect(result.new).toEqual([]);
    expect(result.resolved.map((f) => f.kind)).toEqual(['dataCrossing', 'resetCrossing']);
  });

  it('reports neither for a crossing that stays', () => {
    expect(compare(twoClocks('b'), twoClocks('b'))).toEqual({ new: [], resolved: [] });
  });

  it('keeps a reset crossing when only the name of its net changes', () => {
    const result = compare(twoClocks('b', 'rst_n'), twoClocks('b', 'reset_net'));
    expect(result).toEqual({ new: [], resolved: [] });
  });
});

describe('diffFindings: fixtures', () => {
  const dir = path.join(fixtures, 'diff');
  const designs = fs.readdirSync(dir).filter((f) => /\.(bd|qsys|tcl)$/.test(f));

  it.each(designs)('finds no difference of %s with itself', (file) => {
    const g = readSystemDesign(file, file, fs.readFileSync(path.join(dir, file), 'utf8'))!;
    expect(diffFindings(g, g, diffSystemGraphs(g, g))).toEqual({ new: [], resolved: [] });
  });
});
