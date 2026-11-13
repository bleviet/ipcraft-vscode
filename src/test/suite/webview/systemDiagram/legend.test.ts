import {
  changeLegendEntries,
  legendEntries,
  REVIEW_LEGEND,
} from '../../../../webview/systemDiagram/legend';

describe('legendEntries', () => {
  it('lists only the present categories in legend order, once each', () => {
    const entries = legendEntries([
      { category: 'reset' },
      { category: 'aximm' },
      { category: 'reset' },
      { category: 'signal' },
      { category: 'axis' },
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      'AXI memory-mapped',
      'AXI4-Stream',
      'Reset',
      'Signal',
    ]);
  });

  it('draws interface categories thick and scalar ones thin', () => {
    const entries = legendEntries([
      { category: 'interface' },
      { category: 'avalonmm' },
      { category: 'avalonst' },
      { category: 'interrupt' },
      { category: 'clock' },
    ]);
    expect(entries.map((entry) => [entry.label, entry.thick])).toEqual([
      ['Avalon-MM', true],
      ['Avalon-ST', true],
      ['Other interface', true],
      ['Interrupt', false],
      ['Clock', false],
    ]);
  });

  it('is empty without edges', () => {
    expect(legendEntries([])).toEqual([]);
  });

  it('counts hidden clock and reset nets drawn only as badges', () => {
    const entries = legendEntries(
      [{ category: 'aximm' }],
      [{ category: 'clock' }, { category: 'reset' }]
    );
    expect(entries.map((entry) => [entry.label, entry.thick])).toEqual([
      ['AXI memory-mapped', true],
      ['Clock', false],
      ['Reset', false],
    ]);
  });
});

describe('REVIEW_LEGEND', () => {
  it('names the undriven, unused, and unchecked marks', () => {
    expect(REVIEW_LEGEND.map((entry) => entry.label)).toEqual([
      'Undriven pin',
      'Unused pin',
      'Block not checked',
    ]);
    expect(REVIEW_LEGEND[2].dashed).toBe(true);
  });
});

describe('changeLegendEntries', () => {
  it('names the kinds present, with the signs and words of the Changes tab', () => {
    expect(changeLegendEntries(['added', 'renamed', 'version'])).toEqual([
      { status: 'added', sign: '+', label: 'Added' },
      { status: 'renamed', sign: '→', label: 'Renamed' },
      { status: 'version', sign: 'v', label: 'Version only' },
    ]);
    expect(changeLegendEntries([])).toEqual([]);
  });
});
