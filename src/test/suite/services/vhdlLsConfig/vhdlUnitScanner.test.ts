import { scanVhdl, workReferences } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

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

  it('records direct entity and configuration instantiations as uses', () => {
    const scan = scanVhdl(
      [
        'u0: entity mylib.foo port map (a => b);',
        'u1: entity mylib.bar(rtl) port map (a => b);',
        'u2: configuration mylib.cfg_x;',
        'u3: ENTITY  MyLib . Foo',
        '  port map (a => b);',
        'for all : comp use entity mylib.ent(rtl);',
      ].join('\n')
    );
    expect(scan.uses).toEqual([
      { library: 'mylib', unit: 'foo', line: 1 },
      { library: 'mylib', unit: 'bar', line: 2 },
      { library: 'mylib', unit: 'cfg_x', line: 3 },
      { library: 'mylib', unit: 'foo', line: 4 },
      { library: 'mylib', unit: 'ent', line: 6 },
    ]);
  });

  it('does not record entity declarations, end statements, comments or strings as uses', () => {
    const scan = scanVhdl(
      [
        'entity foo is',
        'end entity foo;',
        '-- u0: entity mylib.foo',
        '/* entity mylib.foo */',
        'constant s : string := "entity mylib.foo";',
      ].join('\n')
    );
    expect(scan.uses).toEqual([]);
  });

  it('records local references: architecture, package body, configuration, component instances', () => {
    const scan = scanVhdl(
      [
        'architecture Rtl of Foo is',
        'begin',
        '  u1 : Bar generic map (a => 1) port map (x => y);',
        '  u2 : component Baz port map (x => y);',
        '  u3 : entity work.skip port map (x => y);',
        '  -- u4 : Hidden port map (x => y);',
        'end;',
        'package body Pk is',
        'end;',
        'configuration Cfg of Top is',
        'end;',
      ].join('\n')
    );
    expect(scan.localRefs).toEqual([
      { name: 'foo', kind: 'architecture', line: 1 },
      { name: 'bar', kind: 'instantiation', line: 3 },
      { name: 'baz', kind: 'instantiation', line: 4 },
      { name: 'pk', kind: 'body', line: 8 },
      { name: 'top', kind: 'configuration', line: 10 },
    ]);
    expect(scan.uses).toEqual([{ library: 'work', unit: 'skip', line: 5 }]);

    const src = [
      'architecture Rtl of Foo is',
      'begin',
      '  u1 : Bar port map (x => y);',
      '  u3 : entity work.skip port map (x => y);',
      'end;',
    ].join('\n');
    const all = new Set(['architecture', 'body', 'configuration', 'instantiation'] as const);
    const noInst = new Set(['architecture', 'body', 'configuration'] as const);
    expect([...workReferences(scanVhdl(src), all)].sort()).toEqual(['bar', 'foo', 'skip']);
    expect([...workReferences(scanVhdl(src), noInst)].sort()).toEqual(['foo', 'skip']);
    expect(workReferences(undefined, all).size).toBe(0);
  });

  it('flags ${...} placeholders in code but not in comments or strings', () => {
    expect(scanVhdl('package p is\n  constant c : integer := ${X};\nend;').hasPlaceholders).toBe(
      true
    );
    expect(scanVhdl('-- ${X}\n/* ${Y} */\npackage p is\nend;').hasPlaceholders).toBe(false);
    expect(scanVhdl('package p is\n  constant s : string := "${X}";\nend;').hasPlaceholders).toBe(
      false
    );
  });

  it('blanks extended identifiers so `${` inside them is not a placeholder', () => {
    const scan = scanVhdl('package p is\n  signal \\a${b}\\ : bit;\nend;');
    expect(scan.hasPlaceholders).toBe(false);
    expect(scan.units.map((u) => u.name)).toEqual(['p']);
  });
});
