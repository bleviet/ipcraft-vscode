import {
  matchDefinitions,
  type HdlFileKey,
  type IpFileKey,
} from '../../../../../services/systemDiagram/enrichment/matchDefinitions';
import { bdGraph, qsysGraph } from './definitionFixtures';

const DESIGN = '/ws/design.tcl';
const run = <I extends IpFileKey, H extends HdlFileKey>(
  graph: Parameters<typeof matchDefinitions>[0],
  ipFiles: readonly I[],
  hdlFiles: readonly H[],
  designFile = DESIGN
) => matchDefinitions(graph, ipFiles, hdlFiles, designFile);

const ip = (name: string, version: string, file = `${name}-${version}.ip.yml`): IpFileKey => ({
  file: `/ws/${file}`,
  displayName: file,
  vlnv: { vendor: 'Acme.com', library: 'ip', name, version },
});
const hdl = (file: string, vhdlEntities: string[], verilogModules: string[] = []): HdlFileKey => ({
  file: `/ws/${file}`,
  displayName: file,
  vhdlEntities,
  verilogModules,
});

describe('matchDefinitions', () => {
  it('matches a Vivado VLNV case-insensitively', () => {
    const match = run(bdGraph, [ip('My_Core', '1.0'), ip('My_Core', '2.0')], []);
    expect(match.ip.get('/my_core_0')?.vlnv.version).toBe('1.0');
    expect(match.ip.has('/other_0')).toBe(false);
  });

  it('matches a Platform Designer component by lower-cased name, using the version to break ties', () => {
    const single = run(qsysGraph, [ip('My_Core', '1.0')], []);
    expect(single.ip.get('/cpu')?.vlnv.version).toBe('1.0');
    const both = run(qsysGraph, [ip('My_Core', '1.0'), ip('my_core', '2.0')], []);
    expect(both.ip.get('/cpu')?.vlnv.version).toBe('2.0');
    expect(both.diagnostics).toEqual([]);
  });

  it('reports an ambiguity and matches none', () => {
    const match = run(
      qsysGraph,
      [ip('my_core', '3.0', 'a.ip.yml'), ip('MY_CORE', '4.0', 'b.ip.yml')],
      []
    );
    expect(match.ip.size).toBe(0);
    expect(match.diagnostics).toEqual([
      {
        severity: 'info',
        message: 'Several definitions match cpu: a.ip.yml, b.ip.yml',
        lines: [qsysGraph.instances['/cpu'].line],
      },
    ]);
  });

  it('matches module references to VHDL entities case-insensitively and Verilog modules exactly', () => {
    expect(run(bdGraph, [], [hdl('a.vhd', ['Pulse_Gen'])]).hdl.get('/pulse_0')?.file).toBe(
      '/ws/a.vhd'
    );
    expect(run(bdGraph, [], [hdl('a.v', [], ['pulse_gen'])]).hdl.size).toBe(1);
    expect(run(bdGraph, [], [hdl('a.v', [], ['Pulse_Gen'])]).hdl.size).toBe(0);
  });

  it('reports several HDL files declaring the module', () => {
    const match = run(bdGraph, [], [hdl('a.vhd', ['pulse_gen']), hdl('b.v', [], ['pulse_gen'])]);
    expect(match.hdl.size).toBe(0);
    expect(match.diagnostics[0].message).toBe('Several definitions match pulse_0: a.vhd, b.v');
  });

  describe('nearest definition to the design file', () => {
    const design = '/ws/proj/bd/design.tcl';

    it('prefers the closer Vivado VLNV candidate and stays ambiguous on a tie', () => {
      const near = ip('My_Core', '1.0', 'proj/ip/near.ip.yml');
      const far = ip('My_Core', '1.0', 'other/far.ip.yml');
      expect(run(bdGraph, [far, near], [], design).ip.get('/my_core_0')).toBe(near);
      const tie = run(
        bdGraph,
        [ip('My_Core', '1.0', 'x/a.ip.yml'), ip('My_Core', '1.0', 'y/b.ip.yml')],
        [],
        design
      );
      expect(tie.ip.size).toBe(0);
      expect(tie.diagnostics).toHaveLength(1);
    });

    it('prefers the closer Platform Designer candidate when the version does not decide', () => {
      const near = ip('my_core', '3.0', 'proj/near.ip.yml');
      const far = ip('MY_CORE', '4.0', 'other/far.ip.yml');
      expect(run(qsysGraph, [far, near], [], design).ip.get('/cpu')).toBe(near);
    });

    it('prefers the original over a Vivado import_files copy in the project tree', () => {
      const original = hdl('proj/rtl/pulse_gen.vhd', ['pulse_gen']);
      const copy = hdl('proj/proj.srcs/sources_1/imports/rtl/pulse_gen.vhd', ['pulse_gen']);
      const match = run(bdGraph, [], [copy, original], '/ws/proj/bd/system.tcl');
      expect(match.hdl.get('/pulse_0')).toBe(original);
      expect(match.diagnostics).toEqual([]);
    });

    it('prefers the same directory over a subdirectory', () => {
      const same = ip('My_Core', '1.0', 'proj/bd/same.ip.yml');
      const deeper = ip('My_Core', '1.0', 'proj/bd/sub/deeper.ip.yml');
      expect(run(bdGraph, [deeper, same], [], '/ws/proj/bd/system.tcl').ip.get('/my_core_0')).toBe(
        same
      );
    });

    it('stays ambiguous when two candidates are equally far', () => {
      const match = run(
        bdGraph,
        [ip('My_Core', '1.0', 'x/a.ip.yml'), ip('My_Core', '1.0', 'y/b.ip.yml')],
        [],
        '/ws/z/design.tcl'
      );
      expect(match.ip.size).toBe(0);
      expect(match.diagnostics).toHaveLength(1);
    });

    it('prefers the closer module reference candidate', () => {
      const near = hdl('proj/rtl/pulse_gen.vhd', ['pulse_gen']);
      const far = hdl('other/pulse_gen.v', [], ['pulse_gen']);
      expect(run(bdGraph, [], [far, near], design).hdl.get('/pulse_0')).toBe(near);
    });
  });
});
