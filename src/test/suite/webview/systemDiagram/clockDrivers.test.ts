import type { SystemGraph, SystemPin } from '../../../../domain/systemGraph';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import { UNRELEASED_RESET_COLOR } from '../../../../webview/systemDiagram/clocks/domainView';
import { buildPhysicalNets } from '../../../../webview/systemDiagram/clocks/physicalNets';
import { resetCheck } from '../../../../webview/systemDiagram/clocks/treeChecks';
import { edgeMarks } from '../../../../webview/systemDiagram/clocks/edgeView';
import { nodePinMarks } from '../../../../webview/systemDiagram/clocks/nodeView';
import { loadVersalClockGraph, loadVersalGraphWithUnknownIp } from './fixtureGraph';

const WIZARD = '/clk_wizard_0';
const OUT1 = '/::clk_wizard_0_clk_out1';
const OUT2 = '/::clk_wizard_0_clk_out2';

/** The Versal fixture with the clocking wizard turned into an IP no rule knows. */
function unknownWizardGraph(): SystemGraph {
  return loadVersalGraphWithUnknownIp('clk_wizard');
}

function pinOf(graph: SystemGraph, instance: string, name: string): SystemPin {
  return graph.instances[instance].pins.find((pin) => pin.name === name)!;
}

function declareOutput(pin: SystemPin, source: SystemPin['directionSource'] = 'definition'): void {
  pin.direction = 'out';
  pin.directionSource = source;
}

describe('driver of a clock or reset net: no endpoint order', () => {
  const graph = loadVersalClockGraph();
  const physical = buildPhysicalNets(graph);

  it('lists the loads of the clocking wizard output before it, as Vivado does', () => {
    const endpoints = graph.nets.find((net) => net.id === OUT1)!.endpoints;
    expect(endpoints[0].pin).toBe('s_axi_aclk');
    expect(endpoints.findIndex((ref) => ref.pin === 'clk_out1')).toBeGreaterThan(0);
  });

  it('takes the driver by a clock output rule', () => {
    expect(physical.ofNet(OUT1)?.driver).toEqual({
      level: '/',
      instance: WIZARD,
      pin: 'clk_out1',
    });
    expect(physical.ofNet(OUT1)?.driverNet?.id).toBe(OUT1);
    expect(physical.ofNet(OUT2)?.driver?.pin).toBe('clk_out2');
    expect(physical.ofNet('/::ps_cips_pl0_ref_clk')?.driver).toEqual({
      level: '/',
      instance: '/ps_cips',
      pin: 'pl0_ref_clk',
    });
  });

  it('takes the driver of a reset by a reset source rule', () => {
    expect(physical.ofNet('/::ps_cips_pl0_resetn')?.driver?.pin).toBe('pl0_resetn');
    expect(physical.ofNet('/::rst_clk_out2_peripheral_aresetn')?.driver).toEqual({
      level: '/',
      instance: '/rst_clk_out2',
      pin: 'peripheral_aresetn',
    });
  });

  it('names the domains and the resets after the pin that drives them', () => {
    const analysis = analyzeClocks(graph);
    expect(analysis.domains.map((domain) => domain.label)).toEqual([
      'clk_wizard_0/clk_out1',
      'clk_wizard_0/clk_out2',
      'ps_cips/pl0_ref_clk',
    ]);
    expect(analysis.domains[0].sourceRef).toEqual({ instance: WIZARD, pin: 'clk_out1' });
    expect(analysis.domains.map((domain) => domain.loads)).toEqual([5, 2, 1]);
    expect(analysis.resets.map((reset) => reset.label)).toEqual([
      'ps_cips/pl0_resetn',
      'rst_clk_out1/peripheral_aresetn',
      'rst_clk_out2/peripheral_aresetn',
    ]);
  });

  it('keeps the first member net of a data net when no end is known to drive it', () => {
    const edited = loadVersalClockGraph();
    for (const [instance, name] of [
      ['/stream_src', 'M_AXIS'],
      ['/stream_sink', 'S_AXIS'],
    ]) {
      const pin = pinOf(edited, instance, name);
      pin.direction = 'unknown';
      pin.directionSource = 'unknown';
    }
    // The first endpoint of the net is stream_sink/S_AXIS: data keeps the endpoint-order guess.
    expect(buildPhysicalNets(edited).ofNet('/::stream_src_M_AXIS')?.driver?.pin).toBe('S_AXIS');
    expect(physical.ofNet('/::stream_src_M_AXIS')?.driver?.pin).toBe('M_AXIS');
  });
});

describe('driver by a known direction', () => {
  it('takes the one end that a definition says is an output', () => {
    const graph = unknownWizardGraph();
    declareOutput(pinOf(graph, WIZARD, 'clk_out1'));
    const net = buildPhysicalNets(graph).ofNet(OUT1)!;
    expect(net.driver).toEqual({ level: '/', instance: WIZARD, pin: 'clk_out1' });
    expect(analyzeClocks(graph).domainOfNet(OUT1)?.sourceRef?.pin).toBe('clk_out1');
  });

  it('takes a declared root input port', () => {
    const withPort = (graph: SystemGraph): string => {
      graph.levels['/'].boundaryPins.push({
        name: 'sys_clk',
        isInterface: false,
        direction: 'in',
        directionSource: 'declared',
        signalType: 'clk',
        parameters: {},
      });
      const net = graph.nets.find((candidate) => candidate.id === '/::ps_cips_pl0_ref_clk')!;
      net.endpoints.unshift({ instance: null, pin: 'sys_clk' });
      return net.id;
    };
    const driverOf = (graph: SystemGraph) => {
      const netId = withPort(graph);
      return buildPhysicalNets(graph).ofNet(netId)?.driver;
    };
    // The port and the CIPS clock output both drive the net: two outputs, so no driver.
    expect(driverOf(loadVersalClockGraph())).toBeUndefined();
    expect(driverOf(loadVersalGraphWithUnknownIp('versal_cips'))).toEqual({
      level: '/',
      instance: null,
      pin: 'sys_clk',
    });
  });

  it('takes the output that a rule marked, as a known direction', () => {
    const graph = loadVersalClockGraph();
    expect(pinOf(graph, WIZARD, 'locked')).toMatchObject({
      direction: 'out',
      directionSource: 'rule',
    });
    // `locked` is no clock output, but its net is named like a clock: the rule direction still names the driver.
    expect(buildPhysicalNets(graph).ofNet('/::clk_wizard_0_locked')?.driver).toEqual({
      level: '/',
      instance: WIZARD,
      pin: 'locked',
    });
  });

  it('does not take a guess from a name as a known direction', () => {
    const graph = unknownWizardGraph();
    declareOutput(pinOf(graph, WIZARD, 'clk_out1'), 'name');
    expect(buildPhysicalNets(graph).ofNet(OUT1)?.driver).toBeUndefined();
  });
});

describe('a clock net whose driver is not known', () => {
  const graph = unknownWizardGraph();
  const analysis = analyzeClocks(graph);

  it('has no driver when no rule and no direction names one', () => {
    const physical = buildPhysicalNets(graph);
    expect(physical.ofNet(OUT1)?.driver).toBeUndefined();
    expect(physical.ofNet(OUT1)?.driverNet).toBeUndefined();
  });

  it('is still a domain, named after its first net, with no frequency', () => {
    const domain = analysis.domainOfNet(OUT1)!;
    expect(domain.name).toBe('clk_wizard_0_clk_out1');
    expect(domain.label).toBe('clk_wizard_0_clk_out1');
    expect(domain.sourceRef).toBeUndefined();
    expect(domain.sourceNetId).toBe(OUT1);
    expect(domain.sourceLevel).toBe('/');
    expect(domain.hz).toBeUndefined();
    expect(domain.frequencyFrom).toBeUndefined();
    expect(domain.portClock).toBe(false);
    expect(domain.loads).toBe(6);
    expect(domain.line).toBe(graph.nets.find((net) => net.id === OUT1)!.line);
    expect(analysis.domainOfPin('/', { instance: '/stream_src', pin: 'aclk' })).toBe(domain);
  });

  it('is no driver when several ends are known outputs', () => {
    const edited = unknownWizardGraph();
    declareOutput(pinOf(edited, WIZARD, 'clk_out1'));
    declareOutput(pinOf(edited, '/stream_src', 'aclk'));
    expect(buildPhysicalNets(edited).ofNet(OUT1)?.driver).toBeUndefined();
  });

  it('qualifies the label with the level of the first net, so equal net names stay apart', () => {
    const hierarchy = (name: string) => [
      `proc create_hier_cell_${name} { parentCell nameHier } {`,
      '  set parentObj [get_bd_cells $parentCell]',
      '  set oldCurInst [current_bd_instance .]',
      '  current_bd_instance $parentObj',
      '  set hier_obj [create_bd_cell -type hier $nameHier]',
      '  current_bd_instance $hier_obj',
      '  create_bd_pin -dir I -type clk clk',
      '  set b [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 b ]',
      '  connect_bd_net -net clk_1 [get_bd_pins clk] [get_bd_pins b/clk]',
      '  current_bd_instance $oldCurInst',
      '}',
    ];
    const design = (names: string[]) =>
      readBdTcl(
        [
          ...names.flatMap(hierarchy),
          'proc create_root_design { parentCell } {',
          '  set parentObj [get_bd_cells $parentCell]',
          '  current_bd_instance $parentObj',
          ...names.map((name) => `  create_hier_cell_${name} [current_bd_instance .] ${name}`),
          ...names.map((name) => `  connect_bd_net -net ${name}_clk [get_bd_pins ${name}/clk]`),
          '}',
          'create_root_design ""',
        ].join('\n'),
        'd.tcl'
      );
    const [one] = analyzeClocks(design(['h1'])).domains;
    expect([one.name, one.label, one.sourceLevel]).toEqual(['clk_1', 'h1/clk_1', '/h1']);
    const two = analyzeClocks(design(['h1', 'h2'])).domains;
    expect(two.map((domain) => [domain.name, domain.label])).toEqual([
      ['h1/clk_1', 'h1/clk_1'],
      ['h2/clk_1', 'h2/clk_1'],
    ]);
  });
});

describe('a reset net whose driver is not known', () => {
  const edited = loadVersalGraphWithUnknownIp('versal_cips');
  const analysis = analyzeClocks(edited);
  const RESET = '/::ps_cips_pl0_resetn';
  const sinkVerdicts = () =>
    analysis.crossings
      .filter((x): x is PinCrossing => x.kind === 'reset' && x.from.sourceUnknown === true)
      .map((x) => [x.to.label, x.status, x.reason]);

  it('is still a reset source, named after its first net, with every pin a sink', () => {
    const reset = analysis.resetOfNet(RESET)!;
    expect(reset).toMatchObject({
      label: 'ps_cips_pl0_resetn',
      level: '/',
      netId: RESET,
      async: false,
    });
    expect(reset.source).toBeUndefined();
    expect(reset.domain).toBeUndefined();
    expect(reset.sinks.map((sink) => `${sink.instance}::${sink.pin}`).sort()).toEqual([
      '/clk_wizard_0::resetn',
      '/ps_cips::pl0_resetn',
      '/rst_clk_out1::ext_reset_in',
      '/rst_clk_out2::ext_reset_in',
    ]);
    expect(analysis.resetOfPin('/', { instance: '/rst_clk_out1', pin: 'ext_reset_in' })).toBe(
      reset
    );
  });

  it('accepts an asynchronous input and does not check any other sink', () => {
    expect(sinkVerdicts()).toEqual([
      [
        'ps_cips/pl0_resetn',
        'unchecked',
        'The source of ps_cips_pl0_resetn is not known, so the clock that releases it is not known',
      ],
      ['clk_wizard_0/resetn', 'ok', 'The input accepts an asynchronous reset'],
      ['rst_clk_out1/ext_reset_in', 'ok', 'The input accepts an asynchronous reset'],
      ['rst_clk_out2/ext_reset_in', 'ok', 'The input accepts an asynchronous reset'],
    ]);
  });

  it('keeps the wire muted in the domain mode, like an asynchronous reset', () => {
    const edge = { id: `${RESET}#0`, data: { netId: RESET, category: 'reset' as const } };
    const context = {
      analysis,
      domainMode: true,
      tree: undefined,
      crossingEdgeIds: new Set<string>(),
    };
    expect(edgeMarks(context, edge)).toEqual({ dotted: true, domainColor: UNRELEASED_RESET_COLOR });
  });
});

describe('nets on a status output of a clock IP', () => {
  const graph = loadVersalClockGraph();
  const analysis = analyzeClocks(graph);
  const LOCKED = '/::clk_wizard_0_locked';

  it('is classified as a clock by its name, which the model does not follow', () => {
    expect(graph.nets.find((net) => net.id === LOCKED)?.category).toBe('clock');
    expect(analysis.domainOfNet(LOCKED)).toBeUndefined();
    expect(analysis.domains.every((domain) => !domain.netIds.includes(LOCKED))).toBe(true);
  });

  it('is no load of a clock: the pins on it are not clock inputs', () => {
    expect(analysis.clockInputs('/rst_clk_out1').map((pin) => pin.name)).toEqual([
      'slowest_sync_clk',
    ]);
    expect(analysis.clockInputs(WIZARD).map((pin) => pin.name)).toEqual(['clk_in1']);
    expect(analysis.instanceDomains('/rst_clk_out1').map((domain) => domain.name)).toEqual([
      'clk_out1',
    ]);
    expect(
      analysis.domainOfPin('/', { instance: '/rst_clk_out1', pin: 'dcm_locked' })
    ).toBeUndefined();
  });

  it('is in no crossing and no block span, and draws no domain mark', () => {
    expect(analysis.crossings.some((crossing) => crossing.netIds.includes(LOCKED))).toBe(false);
    expect(analysis.crossings.some((crossing) => crossing.kind === 'block')).toBe(false);
    const marks = nodePinMarks(
      { graph, analysis, domainMode: true, tree: undefined, crossingKeys: new Set() },
      '/rst_clk_out1'
    );
    expect(marks?.dcm_locked).toBeUndefined();
    const edge = { id: `${LOCKED}#0`, data: { netId: LOCKED, category: 'clock' as const } };
    const context = {
      analysis,
      domainMode: true,
      tree: undefined,
      crossingEdgeIds: new Set<string>(),
    };
    expect(edgeMarks(context, edge)).toEqual({ dimmed: true });
    expect(marks?.slowest_sync_clk?.color).toBe(analysis.domains[0].color);
  });
});

describe('resets driven by a constant or by logic', () => {
  /** Two blocks on one PS clock, their reset pins listed before the driver, as Vivado lists them. */
  function resetDesign(ip: string, pin: string, format?: SystemGraph['source']['format']) {
    const graph = readBdTcl(
      [
        'create_bd_design "d"',
        `set d [ create_bd_cell -type ip -vlnv xilinx.com:ip:${ip}:1.0 d ]`,
        'set ps [ create_bd_cell -type ip -vlnv xilinx.com:ip:processing_system7:5.5 ps ]',
        'set a [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 a ]',
        'set b [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 b ]',
        'connect_bd_net -net clk_0 [get_bd_pins a/clk] [get_bd_pins b/clk] [get_bd_pins ps/FCLK_CLK0]',
        `connect_bd_net -net rst_x [get_bd_pins a/rst_n] [get_bd_pins b/rst_n] [get_bd_pins d/${pin}]`,
      ].join('\n'),
      'd.tcl'
    );
    if (format) {
      graph.source.format = format;
    }
    return analyzeClocks(graph);
  }
  const rows = (analysis: ReturnType<typeof resetDesign>) =>
    analysis.crossings.map((x) => {
      const pin = x as PinCrossing;
      return [pin.from.label, pin.to.label, pin.status, pin.reason];
    });

  it('takes the output of a constant as the driver, and its sinks are ok without a clock', () => {
    const analysis = resetDesign('xlconstant', 'dout');
    const [reset] = analysis.resets;
    expect(analysis.resets).toHaveLength(1);
    expect(reset).toMatchObject({
      label: 'd/dout',
      constant: true,
      async: false,
      from: 'xlconstant, tied to a constant',
    });
    expect(reset.source).toMatchObject({ instance: '/d', pin: 'dout' });
    expect(reset.domain).toBeUndefined();
    expect(reset.sinks.map((sink) => sink.instance)).toEqual(['/a', '/b']);
    expect(rows(analysis)).toEqual([
      ['d/dout', 'a/rst_n', 'ok', 'Tied to a constant'],
      ['d/dout', 'b/rst_n', 'ok', 'Tied to a constant'],
    ]);
  });

  it('is ok for a constant whatever clocks the sinks, and in Platform Designer too', () => {
    const unclocked = readBdTcl(
      [
        'create_bd_design "d"',
        'set d [ create_bd_cell -type ip -vlnv xilinx.com:ip:xlconstant:1.1 d ]',
        'set a [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 a ]',
        'connect_bd_net -net rst_x [get_bd_pins a/rst_n] [get_bd_pins d/dout]',
      ].join('\n'),
      'd.tcl'
    );
    expect(rows(analyzeClocks(unclocked))).toEqual([
      ['d/dout', 'a/rst_n', 'ok', 'Tied to a constant'],
    ]);
    expect(rows(resetDesign('xlconstant', 'dout', 'qsys'))).toEqual([
      ['d/dout', 'a/rst_n', 'ok', 'Tied to a constant'],
      ['d/dout', 'b/rst_n', 'ok', 'Tied to a constant'],
    ]);
  });

  it.each([
    ['util_vector_logic', 'Res'],
    ['util_reduced_logic', 'Res'],
    ['axi_gpio', 'gpio_io_o'],
    ['axi_gpio', 'gpio2_io_o'],
  ])('takes %s %s as the driver, and does not check its sinks', (ip, pin) => {
    const analysis = resetDesign(ip, pin);
    const [reset] = analysis.resets;
    expect(analysis.resets).toHaveLength(1);
    expect(reset.source).toMatchObject({ instance: '/d', pin });
    expect(reset).toMatchObject({ label: `d/${pin}`, async: false });
    expect(reset.constant).toBeUndefined();
    expect(reset.domain).toBeUndefined();
    // One row per sink, none for the driver itself.
    expect(rows(analysis)).toEqual([
      [`d/${pin}`, 'a/rst_n', 'unchecked', `No rule says which clock d/${pin} is synchronized to`],
      [`d/${pin}`, 'b/rst_n', 'unchecked', `No rule says which clock d/${pin} is synchronized to`],
    ]);
  });

  it('keeps the unknown source for any other IP', () => {
    const analysis = resetDesign('other_logic', 'Res');
    expect(analysis.resets[0].source).toBeUndefined();
    expect(analysis.crossings.map((x) => x.status)).toEqual([
      'unchecked',
      'unchecked',
      'unchecked',
    ]);
  });

  it('shows a constant reset as tied to a constant in the tree checks', () => {
    const analysis = resetDesign('xlconstant', 'dout');
    const [crossing] = analysis.crossings as PinCrossing[];
    expect(resetCheck(crossing)).toEqual({
      tone: 'ok',
      text: '✓ tied to a constant',
      title: 'Tied to a constant',
    });
  });
});
