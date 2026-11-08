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
      ['tests/tb.vhd', 'unlisted'],
    ]);
    expect(map.libraries[0].excluded).toEqual([
      { path: 'lib/dict_pkg.vhd', reason: 'excluded by libraries.vunit_lib' },
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

  it('excludes template files before the duplicate check so they take no unit name', () => {
    const map = build(
      {
        'a/pkg_template.vhd': 'package pkg is\n  constant c : integer := ${DELAY};\nend;',
        'b/long/pkg.vhd': 'package pkg is\nend;',
        'c/ok.vhd': '-- ${NOT_CODE}\npackage ok is\nend;',
      },
      ['a/pkg_template.vhd', 'b/long/pkg.vhd', 'c/ok.vhd'].map((f) => claim(f, 1, 'p.qsf', 'lib'))
    );
    expect(map.libraries[0].files.map((f) => f.path)).toEqual(['b/long/pkg.vhd', 'c/ok.vhd']);
    expect(map.libraries[0].excluded).toEqual([
      { path: 'a/pkg_template.vhd', reason: 'template: contains ${...} placeholders' },
    ]);
  });

  it('prefers the duplicate copy that needs no unknown library', () => {
    const map = build({
      'src/x_nvc.vhd': 'library nvc;\npackage x is\nend;',
      'src/x_default.vhd': 'package x is\nend;',
    });
    expect(map.libraries[0].files.map((f) => f.path)).toEqual(['src/x_default.vhd']);
    expect(map.libraries[0].excluded[0].path).toBe('src/x_nvc.vhd');
  });

  it('proposes only files outside user-section libraries and lists excludes', () => {
    const map = build(
      {
        'vendor/pkg.vhd': 'package pkg is\nend;',
        'libs/pkg.vhd': 'package pkg is\nend;',
        'libs/pkg_template.vhd': 'package tpl is\n  c : ${X};\nend;',
        'rtl/a.vhd': 'library lib;\nuse lib.pkg.all;\nentity a is\nend;',
      },
      [],
      [{ name: 'mine', files: ['vendor/*.vhd'], exclude: [] }]
    );
    expect(map.missing).toEqual([
      expect.objectContaining({
        name: 'lib',
        candidates: ['libs/*.vhd'],
        exclude: ['libs/pkg_template.vhd'],
      }),
    ]);
  });

  it('keeps a manifest-named copy over one with fewer unknown libraries', () => {
    const map = build(
      {
        'src/x_nvc.vhd': 'library nvc;\npackage x is\nend;',
        'src/x_default.vhd': 'package x is\nend;',
      },
      [claim('src/x_nvc.vhd', 1, 'p.qsf', 'lib'), claim('src/x_default.vhd', 3, 'p.qsf', 'lib')]
    );
    expect(map.libraries[0].files.map((f) => f.path)).toEqual(['src/x_nvc.vhd']);
  });

  it('keeps a file that still contributes a unit although another of its units is taken', () => {
    const map = build(
      {
        'aaa/pq.vhd': 'package p is\nend;\npackage q is\nend;',
        'b/q.vhd': 'package q is\nend;\npackage r is\nend;',
        'c/q2.vhd': 'package q is\nend;',
      },
      ['aaa/pq.vhd', 'b/q.vhd', 'c/q2.vhd'].map((f) => claim(f, 3, 'p.qsf', 'lib'))
    );
    expect(map.libraries[0].files.map((f) => f.path)).toEqual(['aaa/pq.vhd', 'b/q.vhd']);
    expect(map.libraries[0].excluded).toEqual([
      { path: 'c/q2.vhd', reason: 'duplicate of package q in b/q.vhd' },
    ]);
  });

  it('counts a library as available when a workspace file declares the units used from it', () => {
    const map = build({
      'libs/c.vhd': 'package cpkg is\nend;',
      'src/api_u.vhd': 'library unisim;\npackage api is\nend;',
      'src/api_oc_long.vhd':
        'library osvvm_common;\nuse osvvm_common.cpkg.all;\npackage api is\nend;',
      'rtl/a.vhd': 'library lib;\nuse lib.api.all;\nentity a is\nend;',
    });
    expect(map.libraries[0].excluded.map((e) => e.path)).toEqual(['src/api_u.vhd']);
    const lib = map.missing.find((m) => m.name === 'lib');
    expect(lib?.candidates).toEqual(['src/*.vhd']);
    expect(lib?.exclude).toEqual(['src/api_u.vhd']);
  });

  it('does not map an unlisted file removed by a user library exclude', () => {
    const map = build(
      {
        'wb/m_v0.vhd': 'package m is\nend;',
        'wb/other.vhd': 'package o is\nend;',
        'wb/listed.vhd': 'package l is\nend;',
      },
      [claim('wb/listed.vhd', 1, 'p.qsf', 'mine')],
      [{ name: 'osvvm_wb', files: ['wb/*.vhd'], exclude: ['wb/m_v0.vhd', 'wb/listed.vhd'] }]
    );
    expect(map.libraries.map((l) => [l.name, l.files.map((f) => f.path)])).toEqual([
      ['defaultlib', []],
      ['mine', ['wb/listed.vhd']],
    ]);
    expect(map.libraries[0].excluded).toEqual([
      { path: 'wb/m_v0.vhd', reason: 'excluded by libraries.osvvm_wb' },
    ]);
  });

  it('drops user-excluded entries silently when the user section defines defaultlib', () => {
    const map = build(
      { 'wb/m.vhd': 'package m is\nend;', 'wb/o.vhd': 'package o is\nend;' },
      [],
      [{ name: 'defaultlib', files: ['wb/*.vhd'], exclude: ['wb/m.vhd'] }]
    );
    expect(map.libraries).toEqual([]);
  });

  it('names the first library by name when several user excludes remove a file', () => {
    const map = build(
      { 'wb/m.vhd': 'package m is\nend;' },
      [],
      [
        { name: 'zlib', files: ['wb/*.vhd'], exclude: ['wb/m.vhd'] },
        { name: 'alib', files: ['wb/*.vhd'], exclude: ['wb/m.vhd'] },
      ]
    );
    expect(map.libraries[0].excluded).toEqual([
      { path: 'wb/m.vhd', reason: 'excluded by libraries.alib' },
    ]);
  });

  it('does not propose files a user exclude removed, and lists them as excludes', () => {
    const map = build(
      {
        'src/p.vhd': 'package p is\nend;',
        'src/p_old.vhd': 'package p is\nend;',
        'rtl/a.vhd': 'library lib;\nuse lib.p.all;\nentity a is\nend;',
      },
      [],
      [{ name: 'mine', files: ['src/p_old.vhd'], exclude: ['src/p_old.vhd'] }]
    );
    const lib = map.missing.find((m) => m.name === 'lib');
    expect(lib?.candidates).toEqual(['src/*.vhd']);
    expect(lib?.exclude).toEqual(['src/p_old.vhd']);
  });

  describe('unlisted copies of units a user library provides', () => {
    const user = [{ name: 'osvvm', files: ['osvvm/*.vhd'], exclude: [] }];
    const pkg = (n: string): string => `package ${n} is\nend;`;

    it('excludes them from defaultlib and causes no scope split', () => {
      const map = build(
        {
          'osvvm/CoveragePkg.vhd': pkg('CoveragePkg'),
          'osvvm/deprecated/CoveragePkg_xilinx.vhd': pkg('CoveragePkg'),
          'rtl/a.vhd': 'entity a is\nend;',
        },
        [],
        user
      );
      expect(map.libraries.map((l) => l.name)).toEqual(['defaultlib']);
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['rtl/a.vhd']);
      expect(map.libraries[0].excluded.map((e) => [e.path, e.reason])).toEqual([
        [
          'osvvm/deprecated/CoveragePkg_xilinx.vhd',
          'duplicate of package coveragepkg in osvvm/CoveragePkg.vhd (libraries.osvvm)',
        ],
      ]);
    });

    it('keeps a file that also declares a unit the user library lacks', () => {
      const map = build(
        {
          'osvvm/CoveragePkg.vhd': pkg('CoveragePkg'),
          'osvvm/deprecated/mixed.vhd': `${pkg('CoveragePkg')}\n${pkg('OnlyHere')}`,
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['osvvm/deprecated/mixed.vhd']);
    });

    it('keeps a manifest-named copy', () => {
      const map = build(
        {
          'osvvm/CoveragePkg.vhd': pkg('CoveragePkg'),
          'osvvm/deprecated/CoveragePkg_x.vhd': pkg('CoveragePkg'),
        },
        [claim('osvvm/deprecated/CoveragePkg_x.vhd', 1, 'p.qsf')],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual([
        'osvvm/deprecated/CoveragePkg_x.vhd',
      ]);
    });

    it('keeps a copy that a defaultlib file uses through work (VUnit shape)', () => {
      const map = build(
        {
          'lib/event_pkg.vhd': pkg('event_pkg'),
          'docs/event_pkg.vhd': pkg('event_pkg'),
          'docs/tb_event.vhd': 'use work.event_pkg.all;\nentity tb_event is\nend;',
        },
        [],
        [{ name: 'vunit_lib', files: ['lib/*.vhd'], exclude: [] }]
      );
      expect(map.libraries.map((l) => [l.name, l.files.map((f) => f.path)])).toEqual([
        ['defaultlib', ['docs/event_pkg.vhd', 'docs/tb_event.vhd']],
      ]);
    });

    it('still excludes copies that only refer to each other', () => {
      const map = build(
        {
          'osvvm/A.vhd': pkg('A'),
          'osvvm/B.vhd': pkg('B'),
          'osvvm/deprecated/A.vhd': `use work.b.all;\n${pkg('A')}`,
          'osvvm/deprecated/B.vhd': `use work.a.all;\n${pkg('B')}`,
        },
        [],
        user
      );
      expect(map.libraries[0].files).toEqual([]);
      expect(map.libraries[0].excluded.map((e) => e.path)).toEqual([
        'osvvm/deprecated/A.vhd',
        'osvvm/deprecated/B.vhd',
      ]);
    });

    it('excludes a copy referenced only by a component instantiation in a sibling', () => {
      const map = build(
        {
          'osvvm/C.vhd': 'entity c is\nend;',
          'x/C.vhd': 'entity c is\nend;',
          'x/top.vhd':
            'entity top is\nend;\narchitecture a of top is\nbegin\n  u: c port map (x => y);\nend;',
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['x/top.vhd']);
    });

    it('keeps a copy used by a direct entity work instantiation', () => {
      const map = build(
        {
          'osvvm/C.vhd': 'entity c is\nend;',
          'x/C.vhd': 'entity c is\nend;',
          'x/top.vhd':
            'entity top is\nend;\narchitecture a of top is\nbegin\n  u: entity work.c port map (x => y);\nend;',
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['x/C.vhd', 'x/top.vhd']);
    });

    it('is not revived by its own architecture-only companion', () => {
      const map = build(
        {
          'osvvm/M_e.vhd': 'entity m is\nend;',
          'old/M_e.vhd': 'entity m is\nend;',
          'old/M_a.vhd': 'architecture a of m is\nbegin\nend;',
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['old/M_a.vhd', 'osvvm/M_e.vhd']);
      expect(map.libraries[0].excluded.map((e) => e.path)).toEqual(['old/M_e.vhd']);
    });

    it('leaves copies declared in several unlisted folders to the per-folder split', () => {
      const map = build(
        {
          'osvvm/C.vhd': 'entity c is\nend;',
          'x/C.vhd': 'entity c is\nend;',
          'y/C.vhd': 'entity c is\nend;',
        },
        [],
        user
      );
      expect(map.libraries.map((l) => l.name)).toEqual(['defaultlib_x', 'defaultlib_y']);
    });

    it('keeps a copy that a file uses through a missing library', () => {
      const map = build(
        {
          'osvvm/P.vhd': pkg('P'),
          'src/P.vhd': pkg('P'),
          'rtl/a.vhd': 'library lib;\nuse lib.p.all;\nentity a is\nend;',
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['rtl/a.vhd', 'src/P.vhd']);
      expect(map.missing.find((m) => m.name === 'lib')?.candidates).toEqual(['src/*.vhd']);
    });

    it('keeps a chain of copies reached from a live file', () => {
      const map = build(
        {
          'osvvm/A.vhd': pkg('A'),
          'osvvm/B.vhd': pkg('B'),
          'x/A.vhd': `use work.b.all;\n${pkg('A')}`,
          'x/B.vhd': pkg('B'),
          'x/top.vhd': 'use work.a.all;\nentity top is\nend;',
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual([
        'x/A.vhd',
        'x/B.vhd',
        'x/top.vhd',
      ]);
    });

    it('ignores template files of the user library as unit owners', () => {
      const map = build(
        {
          'osvvm/s_template.vhd': 'package settingspkg is\n c : ${X};\nend;',
          'gen/s.vhd': pkg('settingspkg'),
        },
        [],
        user
      );
      expect(map.libraries[0].files.map((f) => f.path)).toEqual(['gen/s.vhd']);
    });

    it('does not propose excluded user duplicates, and lists them as excludes', () => {
      const map = build(
        {
          'osvvm/P.vhd': pkg('P'),
          'src/Q.vhd': pkg('Q'),
          'src/P.vhd': pkg('P'),
          'rtl/a.vhd': 'library lib;\nuse lib.q.all;\nentity a is\nend;',
        },
        [],
        user
      );
      const lib = map.missing.find((m) => m.name === 'lib');
      expect(lib?.candidates).toEqual(['src/*.vhd']);
      expect(lib?.exclude).toEqual(['src/P.vhd']);
    });

    it('keeps live per-folder copies and still splits them (testbench shape)', () => {
      const tb = (dir: string, n: number): Record<string, string> => ({
        [`${dir}/TestCtrl_e.vhd`]: 'entity TestCtrl is\nend;',
        [`${dir}/tc${n}.vhd`]: `architecture tc${n} of TestCtrl is\nend;`,
      });
      const map = build(
        { ...tb('tbA', 1), ...tb('tbB', 2), ...tb('tbC', 3) },
        [],
        [{ name: 'osvvm_tba', files: ['tbA/*.vhd'], exclude: [] }]
      );
      expect(map.libraries.map((l) => l.name)).toEqual(['defaultlib_tbb', 'defaultlib_tbc']);
      expect(map.libraries.map((l) => l.files.length)).toEqual([2, 2]);
    });

    it('drops the entry silently when the user section defines defaultlib', () => {
      const map = build(
        {
          'osvvm/CoveragePkg.vhd': pkg('CoveragePkg'),
          'x/CoveragePkg.vhd': pkg('CoveragePkg'),
        },
        [],
        [...user, { name: 'defaultlib', files: ['rtl/*.vhd'], exclude: [] }]
      );
      expect(map.libraries).toEqual([]);
    });
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
        exclude: [],
      },
      {
        name: 'osvvm',
        firstUse: { file: 'rtl/b.vhd', line: 1 },
        otherFiles: 0,
        candidates: [],
        exclude: [],
      },
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
        exclude: [],
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
        exclude: [],
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
