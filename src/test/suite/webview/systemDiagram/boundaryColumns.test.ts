import type { ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type { PinDirection, SystemPin } from '../../../../domain/systemGraph';
import {
  boundaryColumnOptions,
  boundarySide,
  rightColumnDrivers,
} from '../../../../webview/systemDiagram/layout/boundaryColumns';

const pin = (name: string, direction: PinDirection): SystemPin => ({
  name,
  isInterface: false,
  direction,
  directionSource: 'declared',
  parameters: {},
});
const edge = (from: string, to: string): ElkExtendedEdge => ({
  id: `${from}-${to}`,
  sources: [`/::${from}::${from}`],
  targets: [`/::${to}::${to}`],
});
const id = (name: string) => `/::${name}`;

describe('boundarySide', () => {
  it('puts an input on the east side and every other port on the west side', () => {
    expect(boundarySide(pin('i', 'in'))).toBe('east');
    for (const direction of ['out', 'inout', 'unknown'] as const) {
      expect(boundarySide(pin('p', direction))).toBe('west');
    }
  });
});

describe('boundaryColumnOptions', () => {
  it('constrains an input to the first separate layer, left aligned', () => {
    expect(boundaryColumnOptions(pin('i', 'in'))).toEqual({
      'elk.layered.layering.layerConstraint': 'FIRST_SEPARATE',
      'elk.alignment': 'LEFT',
    });
  });

  it('constrains every other port to the last separate layer, right aligned', () => {
    expect(boundaryColumnOptions(pin('o', 'out'))).toEqual({
      'elk.layered.layering.layerConstraint': 'LAST_SEPARATE',
      'elk.alignment': 'RIGHT',
    });
  });

  it('uses LAST for a leaf driver and no constraint for a chain driver', () => {
    expect(boundaryColumnOptions(pin('o', 'inout'), 'leaf')).toEqual({
      'elk.layered.layering.layerConstraint': 'LAST',
      'elk.alignment': 'RIGHT',
    });
    expect(boundaryColumnOptions(pin('o', 'inout'), 'chain')).toEqual({});
  });

  it('keeps an input in its column whatever the drive', () => {
    expect(boundaryColumnOptions(pin('i', 'in'), 'chain')).toMatchObject({
      'elk.layered.layering.layerConstraint': 'FIRST_SEPARATE',
    });
  });
});

describe('rightColumnDrivers', () => {
  const pins = [pin('a', 'inout'), pin('b', 'inout'), pin('c', 'inout'), pin('i', 'in')];

  it('marks the source of an edge to another right-column port as a leaf driver', () => {
    expect([...rightColumnDrivers(pins, '/', [edge('a', 'b')])]).toEqual([[id('a'), 'leaf']]);
  });

  it('marks a driver of a driver as a chain', () => {
    const result = rightColumnDrivers(pins, '/', [edge('a', 'b'), edge('b', 'c')]);
    expect(result.get(id('a'))).toBe('chain');
    expect(result.get(id('b'))).toBe('leaf');
  });

  it('ignores edges from or to an input or an instance', () => {
    expect(rightColumnDrivers(pins, '/', [edge('i', 'a'), edge('a', 'u')]).size).toBe(0);
  });
});
