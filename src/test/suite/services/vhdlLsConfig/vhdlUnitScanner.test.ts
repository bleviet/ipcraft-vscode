import { scanVhdl } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

describe('scanVhdl', () => {
  it('finds primary units with kinds and 1-based lines, case-insensitively', () => {
    const scan = scanVhdl(
      'ENTITY Foo IS\nEND;\n\nPackage bar_pkg is\nend;\nconfiguration cfg of foo is\nend;\ncontext ctx is\nend;'
    );
    expect(scan.units).toEqual([
      { kind: 'entity', name: 'foo', line: 1 },
      { kind: 'package', name: 'bar_pkg', line: 4 },
      { kind: 'configuration', name: 'cfg', line: 6 },
      { kind: 'context', name: 'ctx', line: 8 },
    ]);
  });

  it('ignores package bodies, entity instantiations and comments', () => {
    const scan = scanVhdl(
      [
        '-- entity hidden is',
        '/* package blocked is',
        '   entity also_hidden is */',
        'package body real_pkg is',
        'u1: entity work.inst port map (a => b);',
        'package real_pkg is',
      ].join('\n')
    );
    expect(scan.units).toEqual([{ kind: 'package', name: 'real_pkg', line: 6 }]);
  });

  it('ignores keywords inside string and character literals', () => {
    const scan = scanVhdl(
      [
        'constant s : string := "entity fake is ""package x is""";',
        "constant c : character := ';';",
        'library real_lib;',
        'entity top is',
      ].join('\n')
    );
    expect(scan.units).toEqual([{ kind: 'entity', name: 'top', line: 4 }]);
    expect(scan.libraries).toEqual([{ name: 'real_lib', line: 3 }]);
  });

  it('counts a generic package instantiation as a unit', () => {
    expect(scanVhdl('package inst is new work.generic_pkg generic map (n => 1);').units).toEqual([
      { kind: 'package', name: 'inst', line: 1 },
    ]);
  });

  it('splits multi-name library and use clauses', () => {
    const scan = scanVhdl(
      'library ieee, osvvm , Dsp_Lib;\nuse ieee.std_logic_1164.all, dsp_lib.fir_pkg.all;\nuse osvvm.AlertLogPkg.ALL;'
    );
    expect(scan.libraries).toEqual([
      { name: 'ieee', line: 1 },
      { name: 'osvvm', line: 1 },
      { name: 'dsp_lib', line: 1 },
    ]);
    expect(scan.uses).toEqual([
      { library: 'ieee', unit: 'std_logic_1164', line: 2 },
      { library: 'dsp_lib', unit: 'fir_pkg', line: 2 },
      { library: 'osvvm', unit: 'alertlogpkg', line: 3 },
    ]);
  });

  it('records context references as uses', () => {
    const scan = scanVhdl('library uvvm_util;\ncontext uvvm_util.uvvm_util_context;');
    expect(scan.uses).toEqual([{ library: 'uvvm_util', unit: 'uvvm_util_context', line: 2 }]);
    expect(scan.units).toEqual([]);
  });
});
