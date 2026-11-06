import { readQsys } from '../../../../../parser/system/QsysReader';
import { graftSubsystem } from '../../../../../services/systemDiagram/enrichment/graftSubsystem';

const source = { fileName: 'lib/sub_system.qsys', uri: 'file:///ws/lib/sub_system.qsys' };

const parentXml = `<system name="top">
 <module name="clk_0" kind="clock_source" version="1" />
 <module name="sub_0" kind="sub_system" version="1.0" />
 <connection kind="clock" start="clk_0.clk" end="sub_0.clk" />
 <connection kind="avalon" start="clk_0.m" end="sub_0.s0">
  <parameter name="baseAddress" value="0x10" />
 </connection>
 <connection kind="avalon" start="clk_0.m" end="sub_0.s1" />
</system>`;

const childXml = `<system name="sub_system">
 <interface name="clk" internal="bridge.clk" type="clock" dir="end" />
 <interface name="s0" internal="bridge.s0" type="avalon" dir="end" />
 <module name="bridge" kind="altera_avalon_mm_bridge" version="1" />
 <module name="mem" kind="altera_avalon_onchip_memory2" version="1" />
 <connection kind="avalon" start="bridge.m0" end="mem.s1">
  <parameter name="baseAddress" value="0x0" />
 </connection>
 <connection kind="clock" start="bridge.clk" end="mem.clk1" />
</system>`;

const parent = () => readQsys(parentXml, 'top.qsys');
const child = () => readQsys(childXml, 'sub_system.qsys');

describe('graftSubsystem', () => {
  it('turns the instance into a hier level holding the prefixed child instances', () => {
    const graph = graftSubsystem(parent(), '/sub_0', child(), source);
    expect(graph.instances['/sub_0']).toMatchObject({
      kind: 'hier',
      component: 'sub_system',
      version: '1.0',
    });
    expect(graph.instances['/sub_0/bridge']).toMatchObject({
      path: '/sub_0/bridge',
      name: 'bridge',
      parent: '/sub_0',
    });
    expect(graph.levels['/sub_0']).toMatchObject({
      path: '/sub_0',
      name: 'sub_0',
      instances: ['/sub_0/bridge', '/sub_0/mem'],
      source,
    });
    expect(graph.levels['/'].source).toBeUndefined();
  });

  it('uses the exported child pins, keeps unexported connected pins and warns once', () => {
    const original = parent();
    const graph = graftSubsystem(original, '/sub_0', child(), source);
    const names = graph.instances['/sub_0'].pins.map((pin) => pin.name);
    expect(names).toEqual(['clk', 's0', 's1']);
    expect(graph.levels['/sub_0'].boundaryPins.map((pin) => pin.name)).toEqual(names);
    const warnings = graph.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings).toEqual([
      {
        severity: 'warning',
        message: 'sub_0 connects to s1, which lib/sub_system.qsys does not export.',
        lines: [original.instances['/sub_0'].line],
      },
    ]);
  });

  it('prefixes nets, address segments and diagnostics of the child', () => {
    const c = child();
    c.diagnostics.push({ severity: 'info', message: 'inner', lines: [3] });
    const graph = graftSubsystem(parent(), '/sub_0', c, source);
    const net = graph.nets.find(
      (candidate) => candidate.level === '/sub_0' && candidate.name === 'bridge.m0'
    );
    expect(net).toMatchObject({ id: '/sub_0::bridge.m0' });
    expect(net?.endpoints).toEqual([
      { instance: '/sub_0/bridge', pin: 'm0' },
      { instance: '/sub_0/mem', pin: 's1' },
    ]);
    const exported = graph.nets.find((candidate) => candidate.id === '/sub_0::s0');
    expect(exported?.endpoints).toContainEqual({ instance: null, pin: 's0' });
    expect(graph.addressSegments).toContainEqual(
      expect.objectContaining({
        addressSpace: 'sub_0/bridge.m0',
        segment: 'sub_0/mem.s1',
        masterInstance: '/sub_0/bridge',
        slaveInstance: '/sub_0/mem',
        offset: '0x0',
      })
    );
    expect(graph.diagnostics).toContainEqual({
      severity: 'info',
      message: 'inner',
      lines: [3],
      level: '/sub_0',
    });
  });

  it('keeps a nested level, its own source and prefixes diagnostics levels', () => {
    const inner = { fileName: 'inner.qsys', uri: 'file:///ws/inner.qsys' };
    const mid = graftSubsystem(
      readQsys(
        `<system name="mid"><module name="leaf_0" kind="leaf" version="1" /></system>`,
        'mid.qsys'
      ),
      '/leaf_0',
      readQsys(
        `<system name="leaf"><module name="x" kind="k" version="1" /></system>`,
        'leaf.qsys'
      ),
      inner
    );
    mid.diagnostics.push({ severity: 'info', message: 'deep', level: '/leaf_0' });
    const graph = graftSubsystem(parent(), '/sub_0', mid, source);
    expect(graph.levels['/sub_0/leaf_0']).toMatchObject({
      path: '/sub_0/leaf_0',
      instances: ['/sub_0/leaf_0/x'],
      source: inner,
    });
    expect(graph.instances['/sub_0/leaf_0/x'].parent).toBe('/sub_0/leaf_0');
    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({ message: 'deep', level: '/sub_0/leaf_0' })
    );
  });

  it('defaults a nested level without a source to the subsystem file', () => {
    const c = child();
    c.levels['/deep'] = { path: '/deep', name: 'deep', boundaryPins: [], instances: [] };
    expect(graftSubsystem(parent(), '/sub_0', c, source).levels['/sub_0/deep'].source).toEqual(
      source
    );
  });

  it('takes the weaker capability of parent and child', () => {
    const c = child();
    c.capabilities.hierarchy = 'unavailable';
    c.capabilities.connections = 'partial';
    const p = parent();
    p.capabilities.addressMap = 'partial';
    const graph = graftSubsystem(p, '/sub_0', c, source);
    expect(graph.capabilities).toMatchObject({
      hierarchy: 'unavailable',
      connections: 'partial',
      addressMap: 'partial',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
    });
  });

  it('does not mutate its inputs', () => {
    const p = parent();
    const c = child();
    const before = [JSON.stringify(p), JSON.stringify(c)];
    graftSubsystem(p, '/sub_0', c, source);
    expect([JSON.stringify(p), JSON.stringify(c)]).toEqual(before);
  });
});
