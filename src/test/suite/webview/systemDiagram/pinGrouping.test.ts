import {
  foldSide,
  groupLabel,
  pinStem,
  rowName,
  type SideRow,
} from '../../../../webview/systemDiagram/layout/pinGrouping';
import { pin } from './foldingGraph';

const masters = (...names: string[]) => names.map((name) => pin(name, 'master', true));
const range = (prefix: string, from: number, to: number, suffix = '') =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}${suffix}`);
const none = () => false;
const closed = () => false;

describe('pinStem', () => {
  it.each([
    ['M00_AXI', 'M', '00', '_AXI'],
    ['In0', 'In', '0', ''],
    ['S_AXI_P11', 'S_AXI_P', '11', ''],
    ['M_AXIS_ADC_0', 'M_AXIS_ADC_', '0', ''],
    ['adc0_ch3', 'adc0_ch', '3', ''],
  ])('splits %s at its last run of digits', (name, prefix, digits, suffix) => {
    expect(pinStem(name)).toEqual({ prefix, digits, suffix });
  });

  it('has no stem for a name without digits', () => {
    expect(pinStem('aclk')).toBeUndefined();
  });
});

describe('foldSide', () => {
  it('folds an array of four or more pins into one row, not three', () => {
    expect(foldSide(masters(...range('In', 0, 2)), none, closed).map((r) => r.kind)).toEqual([
      'pin',
      'pin',
      'pin',
    ]);
    const rows = foldSide(masters(...range('In', 0, 3)), none, closed);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('folded');
  });

  it('never folds a name without digits', () => {
    const rows = foldSide(masters('a', 'b', 'c', 'd', 'e'), none, closed);
    expect(rows.every((row) => row.kind === 'pin')).toBe(true);
  });

  it('puts a group at its first member and orders members by index', () => {
    const pins = masters('first', 'M10', 'mid', 'M2', 'M1', 'M3');
    const rows = foldSide(pins, none, closed);
    expect(rows.map(rowName)).toEqual(['first', 'M*|master|i', 'mid']);
    const group = (rows[1] as Extract<SideRow, { kind: 'folded' }>).group;
    expect(group.members.map((m) => m.name)).toEqual(['M1', 'M2', 'M3', 'M10']);
    expect(group.label).toBe('M1..M10 [4]');
  });

  it('keeps excluded pins as single rows', () => {
    const pins = masters(...range('rst', 0, 4));
    const rows = foldSide(pins, (p) => p.name === 'rst0', closed);
    expect(rows.map((row) => row.kind)).toEqual(['pin', 'folded']);
    expect(rows[0]).toMatchObject({ pin: { name: 'rst0' } });
    // Removing the excluded pin leaves three: no group.
    const three = foldSide(pins, (p) => p.name === 'rst0' || p.name === 'rst1', closed);
    expect(three.every((row) => row.kind === 'pin')).toBe(true);
  });

  it('forms separate groups per direction and per interface kind', () => {
    const pins = [
      ...range('X', 0, 3).map((n) => pin(n, 'master', true)),
      ...range('X', 4, 7).map((n) => pin(n, 'out', true)),
      ...range('X', 8, 11).map((n) => pin(n, 'master', false)),
    ];
    const ids = foldSide(pins, none, closed).map(rowName);
    expect(new Set(ids).size).toBe(3);
  });

  it('gives an open group a header followed by its pins, and an id free of :: ', () => {
    const pins = masters(...range('M', 0, 3, '_AXI'));
    const rows = foldSide(pins, none, (id) => id === 'M*_AXI|master|i');
    expect(rows.map((row) => row.kind)).toEqual(['header', 'pin', 'pin', 'pin', 'pin']);
    expect(rowName(rows[0])).not.toContain('::');
    expect(pins.map((p) => p.name)).not.toContain(rowName(rows[0]));
  });
});

describe('groupLabel', () => {
  it('writes the first and last index as written', () => {
    expect(
      groupLabel(
        { prefix: 'M', digits: '00', suffix: '_AXI' },
        { prefix: 'M', digits: '27', suffix: '_AXI' },
        28
      )
    ).toBe('M00..M27_AXI [28]');
    expect(
      groupLabel(
        { prefix: 'In', digits: '0', suffix: '' },
        { prefix: 'In', digits: '15', suffix: '' },
        16
      )
    ).toBe('In0..In15 [16]');
  });
});
