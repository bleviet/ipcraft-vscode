import {
  capabilityRows,
  designEyebrow,
  formatLabel,
} from '../../../../webview/systemDiagram/detailsLabels';

describe('details labels', () => {
  it('names the source formats', () => {
    expect(formatLabel('vivado-bd-tcl')).toBe('Vivado block design script');
    expect(formatLabel('vivado-bd')).toBe('Vivado block design');
    expect(formatLabel('qsys')).toBe('Platform Designer system');
    expect(formatLabel('qsys-tcl')).toBe('Platform Designer script');
    expect(designEyebrow('vivado-bd-tcl')).toBe('Block design');
    expect(designEyebrow('vivado-bd')).toBe('Block design');
    expect(designEyebrow('qsys-tcl')).toBe('Platform Designer system');
  });

  it('labels every capability in a fixed order with its state', () => {
    const rows = capabilityRows({
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'partial',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
      unconnectedPins: 'partial',
    });
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ['Hierarchy', 'complete'],
      ['Connections', 'complete'],
      ['Address map', 'partial'],
      ['User-set parameters', 'complete'],
      ['Default and propagated parameters', 'unavailable'],
      ['Unconnected pins', 'partial'],
    ]);
  });
});
