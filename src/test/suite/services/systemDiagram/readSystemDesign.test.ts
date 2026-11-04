import { readSystemDesign } from '../../../../services/systemDiagram/readSystemDesign';
import { fixtureText, qsysFixtureText } from '../../webview/systemDiagram/fixtureGraph';

describe('readSystemDesign', () => {
  it('reads a .qsys file with the Platform Designer reader', () => {
    const graph = readSystemDesign('/p/nios.qsys', 'nios.qsys', qsysFixtureText);
    expect(graph?.source).toEqual({ fileName: 'nios.qsys', format: 'qsys' });
  });

  it('reads a block design Tcl script with the Tcl reader', () => {
    const graph = readSystemDesign('/p/zynq.tcl', 'zynq.tcl', fixtureText);
    expect(graph?.source.format).toBe('vivado-bd-tcl');
    expect(graph?.source.fileName).toBe('zynq.tcl');
  });

  it('returns undefined for files that are not system designs', () => {
    expect(readSystemDesign('/p/build.tcl', 'build.tcl', 'puts hello')).toBeUndefined();
    expect(readSystemDesign('/p/x.qsys', 'x.qsys', '<project/>')).toBeUndefined();
  });
});
