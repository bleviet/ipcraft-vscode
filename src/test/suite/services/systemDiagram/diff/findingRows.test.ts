import type { Finding, FindingsDiff } from '../../../../../domain/systemGraphDiff';
import { cellText } from '../../../../../services/systemDiagram/diff/changeRows';
import { findingRows } from '../../../../../services/systemDiagram/diff/findingRows';

const undriven: Finding = {
  kind: 'undriven',
  level: '/',
  instance: '/a',
  pin: 'clk',
  label: 'a/clk',
};
const unusedOnLevel: Finding = {
  kind: 'unused',
  level: '/h',
  instance: null,
  pin: 'led',
  label: 'led',
};
const crossing: Finding = {
  kind: 'dataCrossing',
  level: '/dsp',
  from: 'a/M',
  to: 'b/S',
  fromInstance: '/dsp/a',
  toInstance: '/dsp/b',
  fromClock: 'clkA',
  toClock: 'clkB',
  reason: 'no synchronizer',
};
const resetUnknown: Finding = {
  kind: 'resetCrossing',
  level: '/',
  from: 'rst/out',
  to: 'b/rst_n',
  fromInstance: '/rst',
  toInstance: '/b',
  toClock: 'clkB',
  reason: 'released on clkA',
};

describe('findingRows', () => {
  const rows = findingRows({ new: [undriven, crossing], resolved: [unusedOnLevel, resetUnknown] });

  it('lists the new findings, then the resolved ones, each in its own order', () => {
    expect(rows.map((r) => [r.sign, r.finding])).toEqual([
      ['New', undriven],
      ['New', crossing],
      ['Resolved', unusedOnLevel],
      ['Resolved', resetUnknown],
    ]);
  });

  it('names the kind of finding', () => {
    expect(rows.map((r) => r.kind)).toEqual([
      'undriven pin',
      'data crossing',
      'unused pin',
      'reset crossing',
    ]);
  });

  it('writes the label of an unconnected pin as code, with no detail', () => {
    expect(rows[0].where).toEqual([[{ text: 'a/clk', code: true }]]);
    expect(rows[0].detail).toEqual([]);
  });

  it('adds the level as a code part when it is not the root', () => {
    expect(rows[2].where).toEqual([
      [{ text: 'led', code: true }, { text: ' on level ' }, { text: '/h', code: true }],
    ]);
    expect(cellText(rows[1].where)).toBe('a/M → b/S on level /dsp');
  });

  it('gives a crossing the clocks and the reason as two items', () => {
    expect(rows[1].detail).toEqual([
      [{ text: 'clkA', code: true }, { text: ' → ' }, { text: 'clkB', code: true }],
      [{ text: 'no synchronizer' }],
    ]);
    expect(cellText(rows[1].detail)).toBe('clkA → clkB · no synchronizer');
  });

  it('writes a clock that is not known as plain text', () => {
    expect(rows[3].detail[0]).toEqual([
      { text: 'unknown clock' },
      { text: ' → ' },
      { text: 'clkB', code: true },
    ]);
  });

  it('has no rows for no findings', () => {
    const none: FindingsDiff = { new: [], resolved: [] };
    expect(findingRows(none)).toEqual([]);
  });
});
