import {
  buildLibraryMap,
  normalizeLibraryName,
  type Claim,
} from '../../../../services/vhdlLsConfig/buildLibraryMap';
import { scanVhdl } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

const claim = (file: string, rank: Claim['rank'], source: string, library?: string): Claim => ({
  file,
  rank,
  library,
  source,
});

function build(
  files: Record<string, string | undefined>,
  claims: Claim[] = [],
  userLibraries: { name: string; files: string[]; exclude: string[] }[] = []
) {
  const scans = new Map(
    Object.entries(files).map(([file, text]) => [
      file,
      text === undefined ? undefined : scanVhdl(text),
    ])
  );
  return buildLibraryMap({ claims, vhdlFiles: Object.keys(files), scans, userLibraries });
}

describe('buildLibraryMap', () => {
  it('maps vendor default names to defaultlib', () => {
    expect(normalizeLibraryName('XIL_DEFAULTLIB')).toBe('defaultlib');
    expect(normalizeLibraryName('Work')).toBe('defaultlib');
    expect(normalizeLibraryName('Dsp_Lib')).toBe('dsp_lib');
  });

  it('puts files without a stated library into defaultlib with provenance', () => {
    const map = build({ 'a.vhd': '', 'b.vhd': '' }, [claim('a.vhd', 3, 'core_hw.tcl')]);
    expect(map.libraries).toEqual([
      {
        name: 'defaultlib',
        files: [
          { path: 'a.vhd', provenance: 'core_hw.tcl' },
          { path: 'b.vhd', provenance: 'unlisted' },
        ],
        excluded: [],
      },
    ]);
  });

  it('lets the lowest-rank library-stating claim decide', () => {
    const map = build({ 'a.vhd': '' }, [
      claim('a.vhd', 4, 'x.ip.yml', 'ip_lib'),
      claim('a.vhd', 1, 'p.xpr', 'xpr_lib'),
      claim('a.vhd', 2, 'component.xml', 'xml_lib'),
    ]);
    expect(map.libraries.map((l) => [l.name, l.files[0].provenance])).toEqual([
      ['xpr_lib', 'p.xpr'],
    ]);
  });

  it('lists a file in each library stated at the deciding rank', () => {
    const map = build({ 'a.vhd': '' }, [
      claim('a.vhd', 1, 'p2.qsf', 'lib_b'),
      claim('a.vhd', 1, 'p1.qsf', 'lib_a'),
      claim('a.vhd', 1, 'p3.qsf', 'lib_a'),
    ]);
    expect(map.libraries.map((l) => [l.name, l.files[0].provenance])).toEqual([
      ['lib_a', 'p1.qsf'],
      ['lib_b', 'p2.qsf'],
    ]);
  });

  it('ignores claims that state nothing when a lower-priority one states a library', () => {
    const map = build({ 'a.vhd': '' }, [
      claim('a.vhd', 2, 'component.xml'),
      claim('a.vhd', 4, 'x.ip.yml', 'ip_lib'),
    ]);
    expect(map.libraries.map((l) => l.name)).toEqual(['ip_lib']);
  });

  it('keeps the declared copy over an unlisted duplicate', () => {
    const src = 'entity fifo is\nend;';
    const map = build({ 'gen/fifo_copy.vhd': src, 'rtl/fifo.vhd': src }, [
      claim('rtl/fifo.vhd', 3, 'core_hw.tcl'),
    ]);
    const lib = map.libraries[0];
    expect(lib.files.map((f) => f.path)).toEqual(['rtl/fifo.vhd']);
    expect(lib.excluded).toEqual([
      { path: 'gen/fifo_copy.vhd', reason: 'duplicate of entity fifo in rtl/fifo.vhd' },
    ]);
  });

  it('breaks rank ties by path length, then path', () => {
    const src = 'package p is\nend;';
    const map = build({ 'd/long_name.vhd': src, 'd/a.vhd': src, 'd/b.vhd': src });
    expect(map.libraries[0].files.map((f) => f.path)).toEqual(['d/a.vhd']);
    expect(map.libraries[0].excluded.map((f) => f.path)).toEqual(['d/b.vhd', 'd/long_name.vhd']);
  });

  it('splits colliding unlisted units into per-folder libraries with shared files', () => {
    const map = build({
      'uart/tb/ctrl.vhd': 'entity testctrl is\nend;',
      'uart/tb/top.vhd':
        'entity tbuart is\nend;\narchitecture a of tbuart is\nbegin\nu: testctrl port map (x);\nend;',
      'uart/tb/extra.vhd': 'entity testctrl is\nend;',
      'uart/cases/t1.vhd': 'use work.util.all;\narchitecture t1 of testctrl is\nend;',
      'axi/tb/ctrl.vhd': 'entity testctrl is\nend;',
      'common/util.vhd': 'package util is\nend;',
    });
    expect(map.libraries.map((l) => l.name)).toEqual([
      'defaultlib',
      'defaultlib_axi_tb',
      'defaultlib_uart_tb',
    ]);
    const [def, axi, uart] = map.libraries;
    expect(def.files.map((f) => f.path)).toEqual(['common/util.vhd']);
    expect(axi.files.map((f) => f.path)).toEqual(['axi/tb/ctrl.vhd']);
    expect(uart.files.map((f) => [f.path, f.provenance])).toEqual([
      ['common/util.vhd', 'shared from defaultlib'],
      ['uart/cases/t1.vhd', 'unlisted'],
      ['uart/tb/ctrl.vhd', 'unlisted'],
      ['uart/tb/top.vhd', 'unlisted'],
    ]);
    expect(uart.excluded.map((f) => f.path)).toEqual(['uart/tb/extra.vhd']);
  });

  it('lists a user-library file in defaultlib when a defaultlib file uses its unit', () => {
    const map = build(
      {
        'tests/tb.vhd': 'use work.dict_pkg.all;\nentity tb is\nend;',
        'lib/dict_pkg.vhd': 'package dict_pkg is\nend;',
      },
      [],
      [{ name: 'vunit_lib', files: ['lib/*.vhd'], exclude: [] }]
    );
    expect(map.libraries.map((l) => l.name)).toEqual(['defaultlib']);
    expect(map.libraries[0].files.map((f) => [f.path, f.provenance])).toEqual([
      ['lib/dict_pkg.vhd', 'shared from vunit_lib'],
      ['tests/tb.vhd', 'unlisted'],
    ]);
  });

  it('does not take a file removed by a user library exclude as a source', () => {
    const map = build(
      {
        'tests/tb.vhd': 'use work.dict_pkg.all;\nentity tb is\nend;',
        'lib/dict_pkg.vhd': 'package dict_pkg is\nend;',
      },
      [],
      [{ name: 'vunit_lib', files: ['lib/*.vhd'], exclude: ['lib/dict_pkg.vhd'] }]
    );
    expect(map.libraries[0].files.map((f) => [f.path, f.provenance])).toEqual([
      ['lib/dict_pkg.vhd', 'unlisted'],
      ['tests/tb.vhd', 'unlisted'],
    ]);
  });

  it('reports a library named by a shared user-library file as missing', () => {
    const map = build(
      {
        'tests/tb.vhd': 'use work.dict_pkg.all;\nentity tb is\nend;',
        'lib/dict_pkg.vhd': 'library foo;\nuse foo.bar.all;\npackage dict_pkg is\nend;',
      },
      [],
      [{ name: 'vunit_lib', files: ['lib/*.vhd'], exclude: [] }]
    );
    expect(map.missing.map((m) => [m.name, m.firstUse.file])).toEqual([
      ['foo', 'lib/dict_pkg.vhd'],
    ]);
  });

  it('does not share into a manifest library', () => {
    const map = build(
      {
        'dsp/f.vhd': 'use work.y.all;\nentity f is\nend;',
        'common/y.vhd': 'package y is\nend;',
      },
      [claim('dsp/f.vhd', 1, 'p.xpr', 'dsp_lib')]
    );
    const dsp = map.libraries.find((l) => l.name === 'dsp_lib');
    expect(dsp?.files.map((f) => f.path)).toEqual(['dsp/f.vhd']);
  });

  it('treats unit names as kind-independent and keeps unscanned files', () => {
    const map = build({
      'a.vhd': 'entity x is\nend;',
      'b.vhd': 'package x is\nend;',
      'big.vhd': undefined,
    });
    expect(map.libraries[0].files.map((f) => f.path)).toEqual(['a.vhd', 'big.vhd']);
    expect(map.libraries[0].excluded[0].reason).toBe('duplicate of entity x in a.vhd');
  });

  it('does not collide units across libraries', () => {
    const src = 'entity e is\nend;';
    const map = build({ 'a.vhd': src, 'b.vhd': src }, [
      claim('a.vhd', 1, 'p.qsf', 'lib_a'),
      claim('b.vhd', 1, 'p.qsf', 'lib_b'),
    ]);
    expect(map.libraries.map((l) => l.excluded.length)).toEqual([0, 0]);
  });

  it('gives user-section libraries precedence: matched files removed, same-name library dropped', () => {
    const map = build(
      { 'ext/osvvm/a.vhd': '', 'rtl/b.vhd': '', 'rtl/c.vhd': '' },
      [claim('rtl/b.vhd', 1, 'p.qsf', 'mine'), claim('rtl/c.vhd', 1, 'p.qsf', 'defaultlib')],
      [
        { name: 'osvvm', files: ['ext/osvvm/*.vhd'], exclude: [] },
        { name: 'mine', files: [], exclude: [] },
      ]
    );
    expect(map.libraries.map((l) => [l.name, l.files.map((f) => f.path)])).toEqual([
      ['defaultlib', ['rtl/c.vhd']],
    ]);
  });

  it('reports missing libraries with first use, other files and candidate directories', () => {
    const map = build({
      'libs/dsp/fir_pkg.vhd': 'package fir_pkg is\nend;',
      'rtl/a.vhd': 'library ieee, dsp_lib, work;\nuse dsp_lib.fir_pkg.all;\nentity a is\nend;',
      'rtl/b.vhd': 'library dsp_lib, osvvm;\nuse dsp_lib.fir_pkg.all;\nentity b is\nend;',
    });
    expect(map.missing).toEqual([
      {
        name: 'dsp_lib',
        firstUse: { file: 'rtl/a.vhd', line: 2 },
        otherFiles: 1,
        candidates: ['libs/dsp/*.vhd'],
      },
      { name: 'osvvm', firstUse: { file: 'rtl/b.vhd', line: 1 }, otherFiles: 0, candidates: [] },
    ]);
  });

  it('finds candidate directories from both use clauses and direct instantiations', () => {
    const map = build({
      'rtl/core/pkg.vhd': 'package pkg is\nend;',
      'sim/other.vhd': 'entity other is\nend;',
      'rtl/a.vhd': 'library lib;\nuse lib.pkg.all;\nentity a is\nend;',
      'rtl/b.vhd':
        'library lib;\nentity b is\nend;\narchitecture r of b is\nbegin\n  u: entity lib.other port map (x => y);\nend;',
    });
    expect(map.missing).toEqual([
      {
        name: 'lib',
        firstUse: { file: 'rtl/a.vhd', line: 2 },
        otherFiles: 1,
        candidates: ['rtl/core/*.vhd', 'sim/*.vhd'],
      },
    ]);
  });

  it('does not report generated, user or built-in libraries as missing', () => {
    const map = build(
      {
        'a.vhd': 'library ieee, std, work, defaultlib, other, mine;\nentity a is\nend;',
        'b.vhd': '',
      },
      [claim('b.vhd', 1, 'p.qsf', 'other')],
      [{ name: 'mine', files: ['zzz/*.vhd'], exclude: [] }]
    );
    expect(map.missing).toEqual([]);
  });

  it('does not report `library work;` as missing when no defaultlib is generated', () => {
    const map = build({ 'a.vhd': 'library work;\nentity a is\nend;' }, [
      claim('a.vhd', 1, 'p.xpr', 'mylib'),
    ]);
    expect(map.libraries.map((l) => l.name)).toEqual(['mylib']);
    expect(map.missing).toEqual([]);
  });

  it('reports xil_defaultlib as missing even though defaultlib is generated', () => {
    const map = build({
      'libs/pk.vhd': 'package pk is\nend;',
      'a.vhd': 'library xil_defaultlib;\nuse xil_defaultlib.pk.all;\nentity a is\nend;',
    });
    expect(map.missing).toEqual([
      {
        name: 'xil_defaultlib',
        firstUse: { file: 'a.vhd', line: 2 },
        otherFiles: 0,
        candidates: ['libs/*.vhd'],
      },
    ]);
  });

  it('is deterministic regardless of input order', () => {
    const files = { 'b.vhd': 'entity b is\nend;', 'a.vhd': 'entity a is\nend;' };
    const claims = [claim('b.vhd', 1, 'x.qsf', 'z'), claim('a.vhd', 1, 'x.qsf', 'y')];
    const one = build(files, claims);
    const two = build(Object.fromEntries(Object.entries(files).reverse()), [...claims].reverse());
    expect(two).toEqual(one);
  });
});
