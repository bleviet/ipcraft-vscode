import type {
  PinDirection,
  PinRef,
  SignalType,
  SystemGraph,
  SystemPin,
} from '../../../../domain/systemGraph';
import { directionForRole, endpointRole } from '../../../../domain/systemGraphRoles';
import { classifyNets, inferPinDirections } from '../../../../parser/system/systemGraphInference';

function mkPin(name: string, extra: Partial<SystemPin> = {}): SystemPin {
  return {
    name,
    isInterface: false,
    direction: 'unknown',
    directionSource: 'unknown',
    parameters: {},
    ...extra,
  };
}

interface NetSpec {
  name: string;
  isInterface?: boolean;
  endpoints: PinRef[];
}

function mkGraph(
  instances: Record<string, SystemPin[]>,
  boundary: SystemPin[],
  nets: NetSpec[]
): SystemGraph {
  return {
    name: 't',
    source: { fileName: 't.tcl', format: 'vivado-bd-tcl' },
    levels: { '/': { path: '/', name: 't', boundaryPins: boundary, instances: [] } },
    instances: Object.fromEntries(
      Object.entries(instances).map(([name, pins]) => [
        `/${name}`,
        { path: `/${name}`, name, parent: '/', kind: 'ip', parameters: {}, pins, line: 1 },
      ])
    ),
    nets: nets.map((n) => ({
      id: `/::${n.name}`,
      name: n.name,
      level: '/',
      isInterface: n.isInterface ?? false,
      category: 'signal',
      categorySource: 'default',
      endpoints: n.endpoints,
      line: 1,
    })),
    addressSegments: [],
    capabilities: {
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'complete',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
      unconnectedPins: 'unavailable',
    },
    diagnostics: [],
  };
}

const ref = (instance: string | null, pin: string): PinRef => ({
  instance: instance === null ? null : `/${instance}`,
  pin,
});

describe('endpointRole', () => {
  it.each<[PinDirection, boolean, string]>([
    ['out', false, 'source'],
    ['master', false, 'source'],
    ['in', false, 'sink'],
    ['slave', false, 'sink'],
    ['in', true, 'source'],
    ['slave', true, 'source'],
    ['out', true, 'sink'],
    ['master', true, 'sink'],
    ['inout', false, 'none'],
    ['unknown', true, 'none'],
  ])('%s boundary=%s is %s', (direction, isBoundary, role) => {
    expect(endpointRole(direction, isBoundary)).toBe(role);
  });

  it('directionForRole inverts endpointRole', () => {
    for (const isInterface of [false, true]) {
      for (const isBoundary of [false, true]) {
        for (const role of ['source', 'sink'] as const) {
          expect(endpointRole(directionForRole(role, isInterface, isBoundary), isBoundary)).toBe(
            role
          );
        }
      }
    }
  });
});

describe('inferPinDirections', () => {
  it('turns unknown endpoints into sinks when a source exists', () => {
    const drv = mkPin('q', { direction: 'out', directionSource: 'declared' });
    const a = mkPin('d');
    const g = mkGraph(
      { a: [drv], b: [a] },
      [],
      [{ name: 'n', endpoints: [ref('a', 'q'), ref('b', 'd')] }]
    );
    inferPinDirections(g);
    expect(a).toMatchObject({ direction: 'in', directionSource: 'connection' });
  });

  it('reverses boundary pins: a boundary input drives the net', () => {
    const port = mkPin('p', { direction: 'in', directionSource: 'declared' });
    const a = mkPin('d');
    const g = mkGraph(
      { a: [a] },
      [port],
      [{ name: 'n', endpoints: [ref(null, 'p'), ref('a', 'd')] }]
    );
    inferPinDirections(g);
    expect(a.direction).toBe('in');
  });

  it('infers a single unknown endpoint as the source when only sinks exist', () => {
    const port = mkPin('p', { direction: 'out', directionSource: 'declared' });
    const a = mkPin('q');
    const g = mkGraph(
      { a: [a] },
      [port],
      [{ name: 'n', endpoints: [ref('a', 'q'), ref(null, 'p')] }]
    );
    inferPinDirections(g);
    expect(a).toMatchObject({ direction: 'out', directionSource: 'connection' });
  });

  it('keeps pins unknown when several are unknown and no source exists', () => {
    const sink = mkPin('s', { direction: 'in', directionSource: 'declared' });
    const a = mkPin('a');
    const b = mkPin('b');
    const g = mkGraph(
      { x: [sink], a: [a], b: [b] },
      [],
      [{ name: 'n', endpoints: [ref('x', 's'), ref('a', 'a'), ref('b', 'b')] }]
    );
    inferPinDirections(g);
    expect(a.direction).toBe('unknown');
    expect(b.direction).toBe('unknown');
  });

  it('gives an unknown boundary pin the role-consistent direction', () => {
    const drv = mkPin('q', { direction: 'out', directionSource: 'declared' });
    const port = mkPin('p');
    const g = mkGraph(
      { a: [drv] },
      [port],
      [{ name: 'n', endpoints: [ref('a', 'q'), ref(null, 'p')] }]
    );
    inferPinDirections(g);
    expect(port.direction).toBe('out');
  });

  it('propagates to a fixpoint across nets', () => {
    // a.q is declared out; b.d/b.q unknown. n1: a.q -> b.d makes b.d a sink.
    // n2: b.q (unknown) -> c.d (declared in) only resolves b.q once n1 is done.
    const q = mkPin('q', { direction: 'out', directionSource: 'declared' });
    const bd = mkPin('d');
    const bq = mkPin('q');
    const cd = mkPin('d', { direction: 'in', directionSource: 'declared' });
    const g = mkGraph(
      { a: [q], b: [bd, bq], c: [cd] },
      [],
      [
        { name: 'n2', endpoints: [ref('b', 'q'), ref('c', 'd')] },
        { name: 'n1', endpoints: [ref('a', 'q'), ref('b', 'd')] },
      ]
    );
    inferPinDirections(g);
    expect(bd.direction).toBe('in');
    expect(bq.direction).toBe('out');
  });

  describe('known IP outputs', () => {
    const ipGraph = (pins: SystemPin[], vlnv: string) => {
      const g = mkGraph({ a: pins }, [], []);
      g.instances['/a'].vlnv = vlnv;
      return g;
    };

    it('marks an unknown output pin of a known IP before the connections run', () => {
      // Two unknown ends and no source: only the rule can resolve this net.
      const out = mkPin('clk_out1');
      const load = mkPin('clk');
      const g = mkGraph(
        { a: [out], b: [load] },
        [],
        [{ name: 'n', endpoints: [ref('a', 'clk_out1'), ref('b', 'clk')] }]
      );
      g.instances['/a'].vlnv = 'xilinx.com:ip:clk_wiz:6.0';
      inferPinDirections(g);
      expect(out).toMatchObject({ direction: 'out', directionSource: 'rule' });
      expect(load).toMatchObject({ direction: 'in', directionSource: 'connection' });
    });

    it('marks the pin even when no net touches it', () => {
      const out = mkPin('locked');
      inferPinDirections(ipGraph([out], 'xilinx.com:ip:clk_wizard:1.0'));
      expect(out).toMatchObject({ direction: 'out', directionSource: 'rule' });
    });

    it('does not touch a pin whose direction is already known', () => {
      const declared = mkPin('clk_out1', { direction: 'in', directionSource: 'declared' });
      const defined = mkPin('clk_out2', { direction: 'in', directionSource: 'definition' });
      inferPinDirections(ipGraph([declared, defined], 'xilinx.com:ip:clk_wiz:6.0'));
      expect(declared).toMatchObject({ direction: 'in', directionSource: 'declared' });
      expect(defined).toMatchObject({ direction: 'in', directionSource: 'definition' });
    });

    it('does not touch an interface pin, an input pin, or a pin of another IP', () => {
      const intf = mkPin('clk_out1', { isInterface: true });
      const input = mkPin('clk_in1');
      inferPinDirections(ipGraph([intf, input], 'xilinx.com:ip:clk_wiz:6.0'));
      expect(intf.directionSource).not.toBe('rule');
      expect(input).toMatchObject({ direction: 'unknown', directionSource: 'unknown' });

      const other = mkPin('clk_out1');
      inferPinDirections(ipGraph([other], 'acme.com:ip:other:1.0'));
      expect(other.direction).toBe('unknown');
    });

    it('does not touch a Platform Designer pin', () => {
      const clk = mkPin('clk');
      const g = mkGraph({ a: [clk] }, [], []);
      g.instances['/a'].component = 'clock_source';
      inferPinDirections(g);
      expect(clk.direction).toBe('unknown');
    });
  });

  it('uses names for interface pins, then connections again', () => {
    const m = mkPin('M00_AXI', { isInterface: true });
    const s = mkPin('S_AXI', { isInterface: true });
    const other = mkPin('weird', { isInterface: true });
    const peer = mkPin('x', { isInterface: true });
    const g = mkGraph(
      { a: [m], b: [s], c: [other], d: [peer] },
      [],
      [
        { name: 'n1', isInterface: true, endpoints: [ref('a', 'M00_AXI'), ref('b', 'S_AXI')] },
        { name: 'n2', isInterface: true, endpoints: [ref('c', 'weird'), ref('d', 'x')] },
        { name: 'n3', isInterface: true, endpoints: [ref('a', 'M00_AXI'), ref('c', 'weird')] },
      ]
    );
    inferPinDirections(g);
    expect(m).toMatchObject({ direction: 'master', directionSource: 'name' });
    expect(s).toMatchObject({ direction: 'slave', directionSource: 'name' });
    // n3: M00_AXI is a source, so 'weird' becomes a slave via the second connection pass.
    expect(other).toMatchObject({ direction: 'slave', directionSource: 'connection' });
    // n2: 'weird' is now a sink and 'x' the only unknown endpoint, so it becomes the source.
    expect(peer.direction).toBe('master');
  });
});

describe('classifyNets', () => {
  const scalar = (name: string, pinName: string, signalType?: SignalType) => {
    const p = mkPin(pinName, signalType ? { signalType } : {});
    const g = mkGraph({ a: [p] }, [], [{ name, endpoints: [ref('a', pinName)] }]);
    classifyNets(g);
    return g;
  };

  it('prefers declared signal types over names', () => {
    const g = scalar('my_reset', 'p', 'clk');
    expect(g.nets[0]).toMatchObject({ category: 'clock', categorySource: 'declared' });
    expect(g.diagnostics).toEqual([]);
  });

  it('classifies scalar nets by name in reset, clock, interrupt order', () => {
    expect(scalar('x', 'clk_rst').nets[0].category).toBe('reset');
    expect(scalar('x_clock', 'p').nets[0].category).toBe('clock');
    expect(scalar('x', 'my_irq').nets[0].category).toBe('interrupt');
    expect(scalar('x', 'p').nets[0]).toMatchObject({
      category: 'signal',
      categorySource: 'default',
    });
  });

  it('adds the name-classification info once', () => {
    const g = scalar('some_clk', 'p');
    expect(g.diagnostics).toHaveLength(1);
    expect(g.diagnostics[0].severity).toBe('info');
  });

  it('classifies interface nets: axis vlnv, aximm vlnv, names, default', () => {
    const mk = (vlnv: string | undefined, name: string) => {
      const p = mkPin(name, { isInterface: true, ...(vlnv && { vlnv }) });
      const g = mkGraph(
        { a: [p] },
        [],
        [{ name: 'n', isInterface: true, endpoints: [ref('a', name)] }]
      );
      classifyNets(g);
      return [g.nets[0].category, g.nets[0].categorySource];
    };
    expect(mk('xilinx.com:interface:axis_rtl:1.0', 'p')).toEqual(['axis', 'declared']);
    expect(mk('xilinx.com:interface:aximm_rtl:1.0', 'p')).toEqual(['aximm', 'declared']);
    expect(mk('xilinx.com:interface:ddrx_rtl:1.0', 'M_AXIS_X')).toEqual(['axis', 'name']);
    expect(mk(undefined, 'S00_AXI')).toEqual(['aximm', 'name']);
    expect(mk('xilinx.com:interface:gpio_rtl:1.0', 'GPIO')).toEqual(['interface', 'default']);
  });

  it('prefers an axis vlnv over an aximm vlnv on another endpoint', () => {
    const a = mkPin('a', { isInterface: true, vlnv: 'x:interface:aximm_rtl:1.0' });
    const b = mkPin('b', { isInterface: true, vlnv: 'x:interface:axis_rtl:1.0' });
    const g = mkGraph(
      { a: [a], b: [b] },
      [],
      [{ name: 'n', isInterface: true, endpoints: [ref('a', 'a'), ref('b', 'b')] }]
    );
    classifyNets(g);
    expect(g.nets[0].category).toBe('axis');
  });
});
