import {
  buildPortSwapProjection,
  needsBitReverse,
  needsLaneSwap,
} from '../../../../generator/resolvers/endiannessPolicy';
import type { BusPortProjectionMetadata } from '../../../../generator/types';
import { BYTE_LANE_WIDTH } from '../../../../shared/busContracts';

const BYTE_LANES: BusPortProjectionMetadata = {
  endianness: 'big',
  laneWidth: BYTE_LANE_WIDTH,
  laneKind: 'byte',
};

describe('needsLaneSwap', () => {
  it.each([
    ['little-endian never swaps', 'little', 32, BYTE_LANE_WIDTH, 'in', false, false],
    ['a multi-lane payload swaps', 'big', 32, BYTE_LANE_WIDTH, 'in', false, true],
    ['an output payload swaps', 'big', 32, BYTE_LANE_WIDTH, 'out', false, true],
    ['a single-lane payload does not', 'big', 8, BYTE_LANE_WIDTH, 'in', false, false],
    ['a narrower-than-lane payload does not', 'big', 4, BYTE_LANE_WIDTH, 'in', false, false],
    ['a partial trailing lane does not', 'big', 24, 16, 'in', false, false],
    ['a symbol lane width still swaps', 'big', 21, 7, 'in', false, true],
    ['a zero lane width cannot swap', 'big', 32, 0, 'in', false, false],
    ['an inout port never swaps', 'big', 32, BYTE_LANE_WIDTH, 'inout', false, false],
    ['a parameterized width defers to runtime', 'big', 32, BYTE_LANE_WIDTH, 'in', true, true],
    ['a symbolic width defers to runtime', 'big', 'DATA_W', BYTE_LANE_WIDTH, 'in', false, true],
    ['a symbolic lane width defers to runtime', 'big', 32, 'SYMBOL_W', 'in', false, true],
    ['a null width cannot be measured', 'big', null, BYTE_LANE_WIDTH, 'in', false, false],
  ] as const)('%s', (_label, endianness, width, laneWidth, direction, parameterized, expected) => {
    expect(needsLaneSwap(endianness, width, laneWidth, direction, parameterized)).toBe(expected);
  });
});

describe('needsBitReverse', () => {
  it.each([
    ['little-endian never reverses', 'little', 4, 'in', false, false],
    ['a multi-bit qualifier reverses', 'big', 4, 'in', false, true],
    ['an output qualifier reverses', 'big', 4, 'out', false, true],
    ['a single-bit qualifier does not', 'big', 1, 'in', false, false],
    ['an inout qualifier never reverses', 'big', 4, 'inout', false, false],
    ['a parameterized qualifier defers to runtime', 'big', 1, 'in', true, true],
    ['a symbolic width alone is not enough', 'big', 'DATA_W/8', 'in', false, false],
    ['a null width cannot be measured', 'big', null, 'in', false, false],
  ] as const)('%s', (_label, endianness, width, direction, parameterized, expected) => {
    expect(needsBitReverse(endianness, width, direction, parameterized)).toBe(expected);
  });
});

describe('buildPortSwapProjection', () => {
  it('projects a data payload as a lane swap carrying the interface lane width', () => {
    expect(buildPortSwapProjection('data', 'in', 32, false, BYTE_LANES)).toEqual({
      role: 'data',
      swapKind: 'lane',
      laneWidth: BYTE_LANE_WIDTH,
      laneKind: 'byte',
      needsSwap: true,
    });
  });

  it('carries a symbol lane width through for Avalon-ST payloads', () => {
    expect(
      buildPortSwapProjection('data', 'out', 21, false, {
        endianness: 'big',
        laneWidth: 7,
        laneKind: 'symbol',
      })
    ).toEqual({
      role: 'data',
      swapKind: 'lane',
      laneWidth: 7,
      laneKind: 'symbol',
      needsSwap: true,
    });
  });

  it('projects a byte qualifier as a one-bit-per-lane reverse', () => {
    expect(buildPortSwapProjection('byteQualifier', 'in', 4, false, BYTE_LANES)).toEqual({
      role: 'byteQualifier',
      swapKind: 'bit',
      laneWidth: 1,
      laneKind: 'byte',
      needsSwap: true,
    });
  });

  it('keeps the reflow shape while reporting no swap on a little-endian interface', () => {
    expect(
      buildPortSwapProjection('data', 'in', 32, false, {
        endianness: 'little',
        laneWidth: BYTE_LANE_WIDTH,
        laneKind: 'byte',
      })
    ).toEqual({
      role: 'data',
      swapKind: 'lane',
      laneWidth: BYTE_LANE_WIDTH,
      laneKind: 'byte',
      needsSwap: false,
    });
  });

  it.each([['control'], ['clock'], ['reset'], [undefined]])(
    'leaves a %s port untouched at the boundary',
    (role) => {
      expect(buildPortSwapProjection(role, 'in', 32, false, BYTE_LANES)).toEqual({
        needsSwap: false,
      });
    }
  );
});
