import { readBdTcl } from '../../../../../parser/system/BdTclReader';
import type { PinDirection, SystemGraph, SystemPin } from '../../../../../domain/systemGraph';
import { applyExportDirections } from '../../../../../services/systemDiagram/enrichment/exportDirections';

const pin = (name: string, overrides: Partial<SystemPin> = {}): SystemPin => ({
  name,
  isInterface: true,
  direction: 'unknown',
  directionSource: 'unknown',
  parameters: {},
  ...overrides,
});

const conduitExport = (name: string, direction: PinDirection) =>
  pin(name, { direction, directionSource: 'declared', interfaceType: 'conduit' });

/** A root level with one instance `/u` and one boundary pin `x` joined to `/u.<instancePin>` per net. */
function graphOf(
  boundary: SystemPin,
  instancePins: SystemPin[],
  nets: [string, string][] = [['x', instancePins[0].name]]
): SystemGraph {
  return {
    levels: { '/': { path: '/', name: 's', boundaryPins: [boundary], instances: ['/u', '/v'] } },
    instances: {
      '/u': {
        path: '/u',
        name: 'u',
        parent: '/',
        kind: 'ip',
        parameters: {},
        pins: instancePins.map((instancePin) => ({ ...instancePin })),
        line: 1,
      },
      '/v': {
        path: '/v',
        name: 'v',
        parent: '/',
        kind: 'ip',
        parameters: {},
        pins: instancePins.map((instancePin) => ({ ...instancePin })),
        line: 1,
      },
    },
    nets: nets.map(([boundaryName, pinName], index) => ({
      id: `/::n${index}`,
      name: `n${index}`,
      level: '/',
      isInterface: true,
      category: 'interface',
      categorySource: 'declared',
      endpoints: [
        { instance: null, pin: boundaryName },
        { instance: '/u', pin: pinName },
      ],
      line: 1,
    })),
  } as unknown as SystemGraph;
}

const defined = (name: string, direction: PinDirection) =>
  pin(name, { direction, directionSource: 'definition' });
const boundaryOf = (graph: SystemGraph) => graph.levels['/'].boundaryPins[0];

describe('applyExportDirections', () => {
  it('turns a conduit end export of an all-output conduit into an output', () => {
    const input = graphOf(conduitExport('x', 'slave'), [defined('c', 'master')]);
    const result = applyExportDirections(input);
    expect(boundaryOf(result)).toMatchObject({
      direction: 'master',
      directionSource: 'definition',
    });
    expect(boundaryOf(input).direction).toBe('slave');
  });

  it('keeps an all-input conduit export an input and a conduit start of an all-input conduit an input', () => {
    expect(
      boundaryOf(
        applyExportDirections(graphOf(conduitExport('x', 'slave'), [defined('c', 'slave')]))
      )
    ).toMatchObject({ direction: 'slave', directionSource: 'definition' });
    expect(
      boundaryOf(
        applyExportDirections(graphOf(conduitExport('x', 'master'), [defined('c', 'slave')]))
      )
    ).toMatchObject({ direction: 'slave', directionSource: 'definition' });
  });

  it('leaves the convention for a mixed, inout or undefined conduit', () => {
    for (const instancePin of [
      defined('c', 'unknown'),
      defined('c', 'inout'),
      pin('c', { direction: 'slave', directionSource: 'declared', interfaceType: 'conduit' }),
    ]) {
      const result = applyExportDirections(graphOf(conduitExport('x', 'slave'), [instancePin]));
      expect(boundaryOf(result)).toMatchObject({ direction: 'slave', directionSource: 'declared' });
    }
  });

  it('gives an unknown-direction boundary pin a defined direction', () => {
    const result = applyExportDirections(
      graphOf(pin('x', { isInterface: false }), [defined('o', 'out')])
    );
    // The instance drives the net, so the pin is a design output.
    expect(boundaryOf(result)).toMatchObject({ direction: 'out', directionSource: 'definition' });
    const sink = applyExportDirections(
      graphOf(pin('x', { isInterface: false }), [defined('i', 'in')])
    );
    expect(boundaryOf(sink)).toMatchObject({ direction: 'in' });
  });

  it('never changes a declared Vivado port', () => {
    const port = pin('x', { isInterface: false, direction: 'in', directionSource: 'declared' });
    expect(boundaryOf(applyExportDirections(graphOf(port, [defined('o', 'out')])))).toEqual(port);
  });

  it('leaves the pin alone when its endpoints disagree', () => {
    const result = applyExportDirections(
      graphOf(
        conduitExport('x', 'slave'),
        [defined('a', 'master'), defined('b', 'slave')],
        [
          ['x', 'a'],
          ['x', 'b'],
        ]
      )
    );
    expect(boundaryOf(result)).toMatchObject({ direction: 'slave', directionSource: 'declared' });
  });

  it('resolves a root export of a hierarchy pin that is resolved on the inner level, in one pass', () => {
    const inner = (name: string, extra: Partial<SystemPin>) => pin(name, { ...extra });
    const graph = {
      levels: {
        '/': {
          path: '/',
          name: 's',
          boundaryPins: [conduitExport('e', 'slave')],
          instances: ['/h'],
        },
        '/h': {
          path: '/h',
          name: 'h',
          boundaryPins: [conduitExport('c', 'slave')],
          instances: ['/h/x'],
        },
      },
      instances: {
        '/h': {
          path: '/h',
          name: 'h',
          parent: '/',
          kind: 'hier',
          parameters: {},
          pins: [conduitExport('c', 'slave')],
          line: 1,
        },
        '/h/x': {
          path: '/h/x',
          name: 'x',
          parent: '/h',
          kind: 'ip',
          parameters: {},
          pins: [
            inner('p', { direction: 'master', directionSource: 'definition', isInterface: true }),
          ],
          line: 1,
        },
      },
      nets: [
        {
          id: '/::n',
          name: 'n',
          level: '/',
          isInterface: true,
          category: 'interface',
          categorySource: 'declared',
          endpoints: [
            { instance: null, pin: 'e' },
            { instance: '/h', pin: 'c' },
          ],
          line: 1,
        },
        {
          id: '/h::m',
          name: 'm',
          level: '/h',
          isInterface: true,
          category: 'interface',
          categorySource: 'declared',
          endpoints: [
            { instance: null, pin: 'c' },
            { instance: '/h/x', pin: 'p' },
          ],
          line: 1,
        },
      ],
    } as unknown as SystemGraph;
    const result = applyExportDirections(graph);
    const resolved = { direction: 'master', directionSource: 'definition' };
    expect(result.levels['/h'].boundaryPins[0]).toMatchObject(resolved);
    expect(result.instances['/h'].pins[0]).toMatchObject(resolved);
    expect(result.levels['/'].boundaryPins[0]).toMatchObject(resolved);
  });

  it('gives a Vivado Monitor interface port the direction of a defined instance pin, not a declared Master', () => {
    const graph = readBdTcl(
      [
        'create_bd_design "d"',
        'set u [ create_bd_cell -type module -reference blk u ]',
        'set mon [ create_bd_intf_port -mode Monitor -vlnv a:b:c:1.0 mon ]',
        'set mst [ create_bd_intf_port -mode Master -vlnv a:b:c:1.0 mst ]',
        'connect_bd_intf_net [get_bd_intf_ports mon] [get_bd_intf_pins u/m]',
        'connect_bd_intf_net [get_bd_intf_ports mst] [get_bd_intf_pins u/n]',
      ].join('\n'),
      'd.tcl'
    );
    const pins = graph.levels['/'].boundaryPins;
    expect(pins.find((p) => p.name === 'mon')?.direction).toBe('unknown');
    for (const name of ['m', 'n']) {
      const instancePin = graph.instances['/u'].pins.find((p) => p.name === name)!;
      instancePin.direction = 'slave';
      instancePin.directionSource = 'definition';
    }
    const result = applyExportDirections(graph).levels['/'].boundaryPins;
    // A defined slave pin is driven by the port: the port is an input of the design.
    expect(result.find((p) => p.name === 'mon')).toMatchObject({
      direction: 'slave',
      directionSource: 'definition',
    });
    expect(result.find((p) => p.name === 'mst')).toEqual(pins.find((p) => p.name === 'mst'));
  });
});
