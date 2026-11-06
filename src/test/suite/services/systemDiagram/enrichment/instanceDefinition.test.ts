import * as fs from 'fs';
import * as path from 'path';
import type { IpCore } from '../../../../../domain/ipcore.types';
import { parseIpCore } from '../../../../../domain/parse';
import {
  definitionFromHdl,
  definitionFromIpCore,
} from '../../../../../services/systemDiagram/enrichment/instanceDefinition';
import { ipDefinition } from './definitionFixtures';

describe('definitionFromIpCore', () => {
  it('orders bus interfaces, clocks, resets, interrupts, then ports', () => {
    expect(ipDefinition.pins.map((pin) => pin.name)).toEqual([
      'S_AXI',
      'M_ST',
      's_axi_aclk',
      'aux_clk',
      's_axi_aresetn',
      'irq',
      'data_out',
      'flag',
    ]);
    expect(ipDefinition).toMatchObject({ kind: 'ip.yml', file: '/ws/my_core.ip.yml' });
  });

  it('maps bus interface mode and type', () => {
    const pin = (name: string) => ipDefinition.pins.find((p) => p.name === name)!;
    expect(pin('S_AXI')).toMatchObject({
      isInterface: true,
      direction: 'slave',
      interfaceType: 'ipcraft:busif:axi4_lite:1.0',
    });
    expect(pin('S_AXI').vlnv).toBeUndefined();
    expect(pin('M_ST')).toMatchObject({ direction: 'master', interfaceType: 'AXIS' });
    expect(pin('M_ST').vlnv).toBeUndefined();
  });

  it('maps scalar pins with default directions, signal types and widths', () => {
    const pin = (name: string) => ipDefinition.pins.find((p) => p.name === name)!;
    expect(pin('s_axi_aclk')).toMatchObject({
      direction: 'in',
      signalType: 'clk',
      isInterface: false,
    });
    expect(pin('s_axi_aresetn')).toMatchObject({ direction: 'in', signalType: 'rst' });
    expect(pin('irq')).toMatchObject({ direction: 'out', signalType: 'intr' });
    expect(pin('data_out')).toMatchObject({ direction: 'out', width: { from: 7, to: 0 } });
    expect(pin('data_out').signalType).toBeUndefined();
    expect(pin('aux_clk').width).toBeUndefined();
    expect(pin('flag').width).toBeUndefined();
  });
});

describe('definitionFromIpCore bus interfaces', () => {
  const define = (yaml: string) =>
    definitionFromIpCore(parseIpCore(yaml), '/ws/x.ip.yml', 'file:///ws/x.ip.yml', 'x.ip.yml');
  const header = 'vlnv: { vendor: a.com, library: ip, name: x, version: "1.0" }\nbusInterfaces:\n';

  it('compares the mode case-insensitively', () => {
    // Built by hand: parseIpCore may already normalise the mode.
    const ipCore = {
      vlnv: { vendor: 'a.com', library: 'ip', name: 'x', version: '1.0' },
      busInterfaces: [
        { name: 'M', type: 'AXIS', mode: 'Master' },
        { name: 'S', type: 'AXIS', mode: 'SLAVE' },
      ],
    } as unknown as IpCore;
    const definition = definitionFromIpCore(ipCore, '/ws/x.ip.yml', 'file:///ws/x.ip.yml', 'x');
    expect(definition.pins.map((pin) => pin.direction)).toEqual(['master', 'slave']);
  });

  it('keeps only a vendor VLNV as vlnv, not an IPCraft bus type', () => {
    const definition = define(
      `${header}  - { name: V, type: "xilinx.com:interface:aximm_rtl:1.0", mode: master }\n` +
        `  - { name: I, type: "ipcraft:busif:axi_stream:1.0", mode: master }`
    );
    expect(definition.pins[0]).toMatchObject({ vlnv: 'xilinx.com:interface:aximm_rtl:1.0' });
    expect(definition.pins[0].interfaceType).toBeUndefined();
    expect(definition.pins[1]).toMatchObject({ interfaceType: 'ipcraft:busif:axi_stream:1.0' });
    expect(definition.pins[1].vlnv).toBeUndefined();
  });

  it('emits one pin per expanded name of an arrayed interface', () => {
    const definition = define(
      `${header}  - name: M_AXIS\n    type: "ipcraft:busif:axi_stream:1.0"\n    mode: master\n` +
        `    array: { count: 2, indexStart: 1, namingPattern: "M_AXIS_CH{index}", physicalPrefixPattern: "m_axis_ch{index}_" }\n`
    );
    expect(definition.pins.map((pin) => pin.name)).toEqual(['M_AXIS_CH1', 'M_AXIS_CH2']);
  });

  it('expands the arrayed interfaces of comprehensive_axi', () => {
    const file = path.join(
      __dirname,
      '../../../../../../ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.ip.yml'
    );
    const definition = definitionFromIpCore(
      parseIpCore(fs.readFileSync(file, 'utf8')),
      file,
      `file://${file}`,
      'comprehensive_axi.ip.yml'
    );
    const names = definition.pins.map((pin) => pin.name);
    expect(names).toEqual(expect.arrayContaining(['M_AXIS_CH1', 'M_AXIS_CH2']));
    expect(names).not.toContain('M_AXIS');
  });
});

describe('definitionFromIpCore clock associations and frequencies', () => {
  const define = (yaml: string) =>
    definitionFromIpCore(parseIpCore(yaml), '/ws/x.ip.yml', 'file:///ws/x.ip.yml', 'x.ip.yml');
  const header = 'vlnv: { vendor: a.com, library: ip, name: x, version: "1.0" }\n';
  const pin = (definition: ReturnType<typeof define>, name: string) =>
    definition.pins.find((candidate) => candidate.name === name)!;

  it('takes the clock of a bus interface from associatedClock', () => {
    const definition = define(
      `${header}busInterfaces:\n` +
        '  - { name: S_AXI, type: "ipcraft:busif:axi4_lite:1.0", mode: slave, associatedClock: s_clk }\n' +
        '  - { name: M_AXIS, type: AXIS, mode: master }\n'
    );
    expect(pin(definition, 'S_AXI').associatedClock).toBe('s_clk');
    expect(pin(definition, 'M_AXIS').associatedClock).toBeUndefined();
    expect('associatedClock' in pin(definition, 'M_AXIS')).toBe(false);
  });

  it('gives every expanded name of an arrayed interface the clock', () => {
    const definition = define(
      `${header}busInterfaces:\n  - name: M_AXIS\n    type: "ipcraft:busif:axi_stream:1.0"\n    mode: master\n` +
        '    associatedClock: m_clk\n' +
        '    array: { count: 2, indexStart: 1, namingPattern: "M_AXIS_CH{index}", physicalPrefixPattern: "m_axis_ch{index}_" }\n'
    );
    expect(definition.pins.map((p) => [p.name, p.associatedClock])).toEqual([
      ['M_AXIS_CH1', 'm_clk'],
      ['M_AXIS_CH2', 'm_clk'],
    ]);
  });

  it('keeps the expected frequency of a clock as written', () => {
    const definition = define(
      `${header}clocks:\n  - { name: clk, frequency: 100MHz }\n  - { name: aux }\n  - { name: raw, frequency: 50000000 }\n`
    );
    expect(pin(definition, 'clk').frequency).toBe('100MHz');
    expect(pin(definition, 'aux').frequency).toBeUndefined();
    expect('frequency' in pin(definition, 'aux')).toBe(false);
    expect(pin(definition, 'raw').frequency).toBe('50000000');
  });

  it('takes the clock of a reset from the reset itself', () => {
    const definition = define(
      `${header}clocks:\n  - { name: clk, associatedReset: rst_n }\n  - { name: other }\n` +
        'resets:\n  - { name: rst_n, associatedClock: other }\n'
    );
    expect(pin(definition, 'rst_n').associatedClock).toBe('other');
  });

  it('else from the clock whose associatedReset names the reset', () => {
    const definition = define(
      `${header}clocks:\n  - { name: clk, associatedReset: rst_n }\n  - { name: other }\n` +
        'resets:\n  - { name: rst_n }\n  - { name: free_rst }\n'
    );
    expect(pin(definition, 'rst_n').associatedClock).toBe('clk');
    expect(pin(definition, 'free_rst').associatedClock).toBeUndefined();
  });

  it('sets neither on an HDL definition', () => {
    const definition = definitionFromHdl(
      [
        { name: 'clk', direction: 'in', type: 'std_logic' },
        { name: 'rst_n', direction: 'in', type: 'std_logic' },
      ],
      '/ws/a.vhd',
      'file:///ws/a.vhd',
      'a.vhd'
    );
    for (const p of definition.pins) {
      expect(p.associatedClock).toBeUndefined();
      expect(p.frequency).toBeUndefined();
    }
  });
});

describe('definitionFromHdl', () => {
  it('maps directions, clock/reset classification and widths', () => {
    const definition = definitionFromHdl(
      [
        { name: 'clk', direction: 'in', type: 'std_logic', width: 1 },
        { name: 'rst_n', direction: 'in', type: 'std_logic', width: 1 },
        { name: 'q', direction: 'out', type: 'std_logic_vector', width: 16 },
        { name: 'io', direction: 'inout', type: 'std_logic' },
        { name: 'weird', direction: 'buffer', type: 'std_logic' },
      ],
      '/ws/pulse_gen.vhd',
      'file:///ws/pulse_gen.vhd',
      'pulse_gen.vhd'
    );
    expect(definition.kind).toBe('hdl');
    expect(definition.pins).toEqual([
      { name: 'clk', isInterface: false, direction: 'in', signalType: 'clk' },
      { name: 'rst_n', isInterface: false, direction: 'in', signalType: 'rst' },
      { name: 'q', isInterface: false, direction: 'out', width: { from: 15, to: 0 } },
      { name: 'io', isInterface: false, direction: 'inout' },
      { name: 'weird', isInterface: false, direction: 'unknown' },
    ]);
  });
});
