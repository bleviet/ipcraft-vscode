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

  it('reads Platform Designer Tcl with the qsys-script reader', () => {
    const graph = readSystemDesign('/p/sys.tcl', 'sys.tcl', 'create_system s\nadd_instance a c');
    expect(graph?.source).toEqual({ fileName: 'sys.tcl', format: 'qsys-tcl' });
  });

  it('prefers the block design reader when both Tcl patterns match', () => {
    const graph = readSystemDesign('/p/s.tcl', 's.tcl', 'create_system x\ncreate_bd_design y');
    expect(graph?.source.format).toBe('vivado-bd-tcl');
  });

  it('reads a .bd file with the JSON reader', () => {
    const graph = readSystemDesign('/p/s.bd', 's.bd', '{"design":{"components":{}}}');
    expect(graph?.source).toEqual({ fileName: 's.bd', format: 'vivado-bd' });
  });

  it('throws the reader error for an XML .bd file', () => {
    expect(() => readSystemDesign('/p/s.bd', 's.bd', '<?xml version="1.0"?>')).toThrow(
      /XML format of Vivado 2018.2/
    );
  });

  it('returns undefined for files that are not system designs', () => {
    expect(readSystemDesign('/p/build.tcl', 'build.tcl', 'puts hello')).toBeUndefined();
    expect(readSystemDesign('/p/x.qsys', 'x.qsys', '<project/>')).toBeUndefined();
    expect(readSystemDesign('/p/x.bd', 'x.bd', '{}')).toBeUndefined();
  });
});
