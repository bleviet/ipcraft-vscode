import { applyDefinitions } from '../../../../../services/systemDiagram/enrichment/applyDefinitions';
import {
  definitionFromHdl,
  type InstanceDefinition,
} from '../../../../../services/systemDiagram/enrichment/instanceDefinition';
import { bdGraph, ipDefinition } from './definitionFixtures';

const defs = (path: string, definition: InstanceDefinition) => new Map([[path, definition]]);
const pinOf = (graph: typeof bdGraph, instance: string, name: string) =>
  graph.instances[instance].pins.find((pin) => pin.name === name)!;

describe('applyDefinitions with an ip.yml definition', () => {
  const result = applyDefinitions(bdGraph, defs('/my_core_0', ipDefinition));

  it('sets the definition link and matches pins by name, then case-insensitively', () => {
    expect(result.instances['/my_core_0'].definition).toEqual({
      kind: 'ip.yml',
      file: '/ws/my_core.ip.yml',
      uri: 'file:///ws/my_core.ip.yml',
      displayName: 'my_core.ip.yml',
    });
    expect(pinOf(result, '/my_core_0', 'S_AXI')).toMatchObject({
      definedBy: 'ip.yml',
      direction: 'slave',
      directionSource: 'definition',
      interfaceType: 'ipcraft:busif:axi4_lite:1.0',
    });
    const data = pinOf(result, '/my_core_0', 'DATA_OUT');
    expect(data).toMatchObject({
      definedBy: 'ip.yml',
      direction: 'out',
      width: { from: 7, to: 0 },
    });
    expect(
      result.instances['/my_core_0'].pins.filter((p) => p.name.toLowerCase() === 'data_out')
    ).toHaveLength(1);
  });

  it('keeps existing vlnv, signal type and width over the definition', () => {
    const graph = JSON.parse(JSON.stringify(bdGraph)) as typeof bdGraph;
    const pin = pinOf(graph, '/my_core_0', 'S_AXI');
    pin.vlnv = 'xilinx.com:interface:aximm_rtl:1.0';
    const out = applyDefinitions(graph, defs('/my_core_0', ipDefinition));
    expect(pinOf(out, '/my_core_0', 'S_AXI').vlnv).toBe('xilinx.com:interface:aximm_rtl:1.0');
  });

  it('appends unmatched definition pins without nets', () => {
    const flag = pinOf(result, '/my_core_0', 'flag');
    expect(flag).toEqual({
      name: 'flag',
      isInterface: false,
      direction: 'in',
      directionSource: 'definition',
      parameters: {},
      definedBy: 'ip.yml',
    });
    expect(result.nets).toEqual(bdGraph.nets);
  });

  it('lists connected pins that the definition lacks in one info diagnostic', () => {
    const added = result.diagnostics.filter((d) =>
      d.message.startsWith('Pins not in their definition')
    );
    expect(added).toEqual([
      {
        severity: 'info',
        message:
          'Pins not in their definition (the definition may be out of date): my_core_0/stale_pin',
        lines: [bdGraph.instances['/my_core_0'].line],
      },
    ]);
    expect(pinOf(result, '/my_core_0', 'stale_pin').definedBy).toBeUndefined();
  });

  it('names out-of-date pins by the instance path so equal names in different levels differ', () => {
    const graph = JSON.parse(JSON.stringify(bdGraph)) as typeof bdGraph;
    graph.instances['/dsp/my_core_0'] = {
      ...graph.instances['/my_core_0'],
      path: '/dsp/my_core_0',
    };
    const out = applyDefinitions(graph, new Map([['/dsp/my_core_0', ipDefinition]]));
    const message = out.diagnostics.find((d) => d.message.startsWith('Pins not in'))!.message;
    expect(message).toContain('dsp/my_core_0/stale_pin');
  });

  it('groups out-of-date pins per level, root first, so each diagnostic has one file', () => {
    const graph = JSON.parse(JSON.stringify(bdGraph)) as typeof bdGraph;
    graph.instances['/dsp/my_core_0'] = {
      ...graph.instances['/my_core_0'],
      path: '/dsp/my_core_0',
      parent: '/dsp',
      line: 99,
    };
    const out = applyDefinitions(
      graph,
      new Map([
        ['/dsp/my_core_0', ipDefinition],
        ['/my_core_0', ipDefinition],
      ])
    );
    const notes = out.diagnostics.filter((d) => d.message.startsWith('Pins not in'));
    expect(notes).toHaveLength(2);
    expect(notes[0].level).toBeUndefined();
    expect(notes[0].message).toContain('my_core_0/stale_pin');
    expect(notes[0].message).not.toContain('dsp/');
    expect(notes[0].lines).toEqual([graph.instances['/my_core_0'].line]);
    expect(notes[1]).toMatchObject({ level: '/dsp', lines: [99] });
    expect(notes[1].message).toContain('dsp/my_core_0/stale_pin');
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(bdGraph);
    applyDefinitions(bdGraph, defs('/my_core_0', ipDefinition));
    expect(JSON.stringify(bdGraph)).toBe(before);
    expect(result).not.toBe(bdGraph);
  });

  it('marks unconnected pins partial when some instances lack a definition, complete when all have one', () => {
    expect(bdGraph.capabilities.unconnectedPins).toBe('unavailable');
    expect(result.capabilities.unconnectedPins).toBe('partial');
    expect(applyDefinitions(bdGraph, new Map()).capabilities.unconnectedPins).toBe('unavailable');
    const all = new Map([
      ['/my_core_0', ipDefinition],
      ['/other_0', { ...ipDefinition, pins: [] }],
      ['/pulse_0', { ...ipDefinition, pins: [] }],
    ]);
    expect(applyDefinitions(bdGraph, all).capabilities.unconnectedPins).toBe('complete');
  });

  it('ignores definitions for unknown instances', () => {
    const out = applyDefinitions(bdGraph, defs('/ghost', ipDefinition));
    expect(out.instances['/ghost']).toBeUndefined();
  });
});

describe('applyDefinitions with an HDL definition', () => {
  const hdl = definitionFromHdl(
    [
      { name: 'S_AXI_awaddr', direction: 'in', type: 'std_logic_vector', width: 32 },
      { name: 'S_AXI_wvalid', direction: 'in', type: 'std_logic' },
      { name: 'clk', direction: 'in', type: 'std_logic' },
      { name: 'dout', direction: 'out', type: 'std_logic_vector', width: 4 },
    ],
    '/ws/core.vhd',
    'file:///ws/core.vhd',
    'core.vhd'
  );
  const result = applyDefinitions(bdGraph, defs('/my_core_0', hdl));

  it('skips ports that belong to an existing interface pin by prefix', () => {
    const names = result.instances['/my_core_0'].pins.map((pin) => pin.name);
    expect(names).not.toContain('S_AXI_awaddr');
    expect(names).not.toContain('S_AXI_wvalid');
    expect(pinOf(result, '/my_core_0', 'clk')).toMatchObject({
      definedBy: 'hdl',
      signalType: 'clk',
    });
    expect(pinOf(result, '/my_core_0', 'dout').width).toEqual({ from: 3, to: 0 });
  });

  it('marks an interface pin whose prefixed ports are defined as defined by the HDL', () => {
    expect(pinOf(result, '/my_core_0', 'S_AXI').definedBy).toBe('hdl');
  });

  it('does not report an interface pin as missing when its prefixed ports are defined', () => {
    const message = result.diagnostics.find((d) => d.message.startsWith('Pins not in'))!.message;
    expect(message).not.toContain('S_AXI');
    expect(message).toContain('my_core_0/stale_pin');
  });
});
