import { shareUnits, type LibraryFiles } from '../../../../services/vhdlLsConfig/shareUnits';
import { scanVhdl } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

const pkg = (name: string, uses: string[] = []): string =>
  `${uses.map((u) => `use work.${u}.all;`).join('\n')}\npackage ${name} is\nend;`;

function share(texts: Record<string, string | undefined>, targets: string[], libs: LibraryFiles[]) {
  const scans = new Map(
    Object.entries(texts).map(([file, text]) => [
      file,
      text === undefined ? undefined : scanVhdl(text),
    ])
  );
  return shareUnits({
    targets: libs.filter((l) => targets.includes(l.name)),
    sources: libs,
    scans,
  });
}

describe('shareUnits', () => {
  it('gives a scope library the defaultlib files it needs, transitively', () => {
    const result = share(
      {
        'uart/tb.vhd': `${pkg('tb_pkg', ['pkg_a'])}`,
        'common/pkg_a.vhd': pkg('pkg_a', ['pkg_b']),
        'common/pkg_b.vhd': pkg('pkg_b'),
        'common/other.vhd': pkg('other'),
      },
      ['defaultlib_uart'],
      [
        { name: 'defaultlib', files: ['common/other.vhd', 'common/pkg_a.vhd', 'common/pkg_b.vhd'] },
        { name: 'defaultlib_uart', files: ['uart/tb.vhd'] },
      ]
    );
    expect([...result]).toEqual([
      [
        'defaultlib_uart',
        [
          { path: 'common/pkg_a.vhd', from: 'defaultlib' },
          { path: 'common/pkg_b.vhd', from: 'defaultlib' },
        ],
      ],
    ]);
  });

  it('gives defaultlib a user-library file and its work closure (VUnit shape)', () => {
    const result = share(
      {
        'tests/tb_dict.vhd': 'use work.dict_pkg.all;\nentity tb_dict is\nend;',
        'lib/dict_pkg.vhd': pkg('dict_pkg', ['codec_pkg']),
        'lib/codec_pkg.vhd': pkg('codec_pkg'),
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tests/tb_dict.vhd'] },
        { name: 'vunit_lib', files: ['lib/codec_pkg.vhd', 'lib/dict_pkg.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([
      { path: 'lib/codec_pkg.vhd', from: 'vunit_lib' },
      { path: 'lib/dict_pkg.vhd', from: 'vunit_lib' },
    ]);
    expect(result.size).toBe(1);
  });

  it('shares the entity of an architecture and a direct entity instantiation', () => {
    const result = share(
      {
        'a/top.vhd': 'architecture a of core is\nbegin\n u : entity work.fifo port map (x);\nend;',
        'lib/core.vhd': 'entity core is\nend;',
        'lib/fifo.vhd': 'entity fifo is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['a/top.vhd'] },
        { name: 'ext', files: ['lib/core.vhd', 'lib/fifo.vhd'] },
      ]
    );
    expect(result.get('defaultlib')?.map((f) => f.path)).toEqual(['lib/core.vhd', 'lib/fifo.vhd']);
  });

  it('does not share a unit that is only instantiated as a component', () => {
    const result = share(
      {
        'a/top.vhd': 'architecture a of top is\nbegin\n u : fifo port map (x);\nend;',
        'lib/fifo.vhd': 'entity fifo is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['a/top.vhd'] },
        { name: 'ext', files: ['lib/fifo.vhd'] },
      ]
    );
    expect(result.size).toBe(0);
  });

  it('brings the separate body and architecture files from the same source library', () => {
    const result = share(
      {
        'tb.vhd': 'use work.p.all;\nuse work.e.all;\nentity tb is\nend;',
        'lib/p.vhd': 'package p is\nend;',
        'lib/p_body.vhd': 'package body p is\nend;',
        'lib/e.vhd': 'entity e is\nend;',
        'lib/e_rtl.vhd': 'architecture rtl of e is\nend;',
        'lib/unrelated.vhd': 'architecture rtl of z is\nend;',
        'other/p_body.vhd': 'package body p is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tb.vhd'] },
        { name: 'ext', files: ['lib/p.vhd', 'lib/p_body.vhd', 'lib/e.vhd', 'lib/e_rtl.vhd'] },
        { name: 'ext2', files: ['lib/unrelated.vhd', 'other/p_body.vhd'] },
      ]
    );
    expect(result.get('defaultlib')?.map((f) => f.path)).toEqual([
      'lib/e.vhd',
      'lib/e_rtl.vhd',
      'lib/p.vhd',
      'lib/p_body.vhd',
    ]);
  });

  describe('brought-along files', () => {
    const run = (targetFiles: string[], extra: Record<string, string> = {}) =>
      share(
        {
          'tb.vhd': 'use work.x.all;\nentity tb is\nend;',
          'lib/x.vhd': 'package x is\nend;',
          'lib/mixed.vhd': 'package body x is\nend;\npackage body z is\nend;',
          'lib/both.vhd': 'package body x is\nend;',
          'lib/dup.vhd': 'architecture a of x is\nend;\nentity y is\nend;',
          ...extra,
        },
        ['defaultlib'],
        [
          { name: 'defaultlib', files: ['tb.vhd', ...targetFiles] },
          { name: 'ext', files: ['lib/x.vhd', 'lib/mixed.vhd', 'lib/both.vhd', 'lib/dup.vhd'] },
        ]
      ).get('defaultlib');

    it('does not take a file whose bodies include a unit absent from the target', () => {
      expect(run([])?.map((f) => f.path)).toEqual(['lib/both.vhd', 'lib/dup.vhd', 'lib/x.vhd']);
    });

    it('does not take a mixed file when the target declares its own z', () => {
      const result = run(['own_z.vhd'], { 'own_z.vhd': 'package z is\nend;' });
      expect(result?.map((f) => f.path)).toEqual(['lib/both.vhd', 'lib/dup.vhd', 'lib/x.vhd']);
    });

    it('skips a brought-along file declaring a unit the target already has', () => {
      const result = run(['own_y.vhd'], { 'own_y.vhd': 'entity y is\nend;' });
      expect(result?.map((f) => f.path)).toEqual(['lib/both.vhd', 'lib/x.vhd']);
    });
  });

  it('shares the declarer of a unit named by a configuration', () => {
    const result = share(
      {
        'cfg.vhd': 'configuration c of x is\nend;',
        'lib/x.vhd': 'entity x is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['cfg.vhd'] },
        { name: 'ext', files: ['lib/x.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([{ path: 'lib/x.vhd', from: 'ext' }]);
  });

  describe('closure inside the source library', () => {
    const uvvm = (
      extra: Record<string, string> = {},
      tb = 'entity work.a_vvc'
    ): Record<string, string> => ({
      'tb.vhd': `architecture t of tb is\nbegin\n u : ${tb} port map (x);\n v : entity work.b_vvc port map (x);\nend;`,
      'a_vvc.vhd': 'use work.methods_pkg.all;\nentity a_vvc is\nend;',
      'a/methods_pkg.vhd': 'package methods_pkg is\nend;',
      'b_vvc.vhd': 'use work.methods_pkg.all;\nentity b_vvc is\nend;',
      'b/methods_pkg.vhd': 'package methods_pkg is\nend;',
      ...extra,
    });
    const libs = (): LibraryFiles[] => [
      { name: 'defaultlib', files: ['tb.vhd'] },
      { name: 'lib_a', files: ['a_vvc.vhd', 'a/methods_pkg.vhd'] },
      { name: 'lib_b', files: ['b_vvc.vhd', 'b/methods_pkg.vhd'] },
    ];

    it('does not share a file whose closure needs a name another library already supplied', () => {
      const result = share(uvvm(), ['defaultlib'], libs());
      expect(result.get('defaultlib')).toEqual([
        { path: 'a/methods_pkg.vhd', from: 'lib_a' },
        { path: 'a_vvc.vhd', from: 'lib_a' },
      ]);
    });

    it('does not share a file whose closure needs a unit the target itself declares', () => {
      const texts = uvvm({ 'own.vhd': 'package methods_pkg is\nend;' });
      const l = libs();
      l[0].files.push('own.vhd');
      expect(share(texts, ['defaultlib'], l).size).toBe(0);
    });

    it('accepts a closure unit already shared from the same source library', () => {
      const texts = uvvm({ 'a_two.vhd': 'use work.methods_pkg.all;\nentity a_two is\nend;' });
      texts['tb.vhd'] += '\nuse work.a_two.all;';
      const l = libs();
      l[1].files.push('a_two.vhd');
      const paths = share(texts, ['defaultlib'], l)
        .get('defaultlib')
        ?.map((f) => f.path);
      expect(paths).toEqual(['a/methods_pkg.vhd', 'a_two.vhd', 'a_vvc.vhd']);
    });

    it('ignores a closure unit that nothing in the source library declares', () => {
      const texts = uvvm({
        'a_vvc.vhd': 'use work.elsewhere.all;\nentity a_vvc is\nend;',
        'own.vhd': 'package elsewhere is\nend;',
      });
      const l = libs();
      l[0].files.push('own.vhd');
      expect(
        share(texts, ['defaultlib'], l)
          .get('defaultlib')
          ?.map((f) => f.path)
      ).toContain('a_vvc.vhd');
    });
  });

  it('shares into a target whose own file is also listed in the source library', () => {
    const result = share(
      {
        'tb.vhd': 'use work.p.all;\nentity tb is\nend;',
        'c/q.vhd': 'package q is\nend;',
        's/p.vhd': 'use work.q.all;\npackage p is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tb.vhd', 'c/q.vhd'] },
        { name: 'slib', files: ['s/p.vhd', 'c/q.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([{ path: 's/p.vhd', from: 'slib' }]);
  });

  it('resolves the references of a shared body inside the source library', () => {
    const result = share(
      {
        'tb.vhd': 'use work.p.all;\nentity tb is\nend;',
        's/p.vhd': 'package p is\nend;',
        's/p_body.vhd': 'use work.q.all;\npackage body p is\nend;',
        's/sq/q.vhd': 'package q is\nend;',
        'o/q.vhd': 'package q is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'aaa', files: ['o/q.vhd'] },
        { name: 'defaultlib', files: ['tb.vhd'] },
        { name: 'slib', files: ['s/p.vhd', 's/p_body.vhd', 's/sq/q.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([
      { path: 's/p.vhd', from: 'slib' },
      { path: 's/p_body.vhd', from: 'slib' },
      { path: 's/sq/q.vhd', from: 'slib' },
    ]);
  });

  it('skips a candidate that declares a unit the target already has', () => {
    const result = share(
      {
        'tb.vhd': 'use work.x.all;\nentity tb is\nend;',
        'dup.vhd': 'package x is\nend;\npackage y is\nend;',
        'longer/clean.vhd': 'package x is\nend;',
        'own.vhd': 'package y is\nend;',
      },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tb.vhd', 'own.vhd'] },
        { name: 'ext', files: ['dup.vhd', 'longer/clean.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([{ path: 'longer/clean.vhd', from: 'ext' }]);
  });

  it('prefers the shorter path, then string order', () => {
    const texts = {
      'tb.vhd': 'use work.x.all;\nentity tb is\nend;',
      'lib/xx.vhd': 'package x is\nend;',
      'lib/b.vhd': 'package x is\nend;',
      'lib/a.vhd': 'package x is\nend;',
    };
    const result = share(
      texts,
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tb.vhd'] },
        { name: 'ext', files: ['lib/xx.vhd', 'lib/b.vhd', 'lib/a.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([{ path: 'lib/a.vhd', from: 'ext' }]);
  });

  it('names the lexicographically first library for a path listed in several', () => {
    const result = share(
      { 'tb.vhd': 'use work.x.all;\nentity tb is\nend;', 'x.vhd': 'package x is\nend;' },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tb.vhd'] },
        { name: 'zlib', files: ['x.vhd'] },
        { name: 'alib', files: ['x.vhd'] },
      ]
    );
    expect(result.get('defaultlib')).toEqual([{ path: 'x.vhd', from: 'alib' }]);
  });

  it('gives a non-target library nothing', () => {
    const result = share(
      { 'dsp.vhd': 'use work.y.all;\nentity d is\nend;', 'y.vhd': 'package y is\nend;' },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['y.vhd'] },
        { name: 'dsp_lib', files: ['dsp.vhd'] },
      ]
    );
    expect(result.size).toBe(0);
  });

  it('omits a target with no unresolved references', () => {
    const result = share(
      { 'tb.vhd': 'use work.x.all;\nentity tb is\nend;', 'x.vhd': 'package x is\nend;' },
      ['defaultlib'],
      [{ name: 'defaultlib', files: ['tb.vhd', 'x.vhd'] }]
    );
    expect(result.size).toBe(0);
  });

  it('treats unscanned files as declaring and referencing nothing', () => {
    const result = share(
      { 'tb.vhd': 'use work.x.all;\nentity tb is\nend;', 'x.vhd': undefined, 'big.vhd': undefined },
      ['defaultlib'],
      [
        { name: 'defaultlib', files: ['tb.vhd', 'big.vhd'] },
        { name: 'ext', files: ['x.vhd'] },
      ]
    );
    expect(result.size).toBe(0);
  });

  it('is deterministic regardless of input order', () => {
    const texts = {
      'tb.vhd': 'use work.x.all;\nuse work.y.all;\nentity tb is\nend;',
      'a/x.vhd': pkg('x'),
      'b/x.vhd': pkg('x'),
      'a/y.vhd': pkg('y'),
    };
    const libs: LibraryFiles[] = [
      { name: 'defaultlib', files: ['tb.vhd'] },
      { name: 'one', files: ['b/x.vhd', 'a/y.vhd'] },
      { name: 'two', files: ['a/x.vhd', 'a/y.vhd'] },
    ];
    const reversed = libs.map((l) => ({ ...l, files: [...l.files].reverse() })).reverse();
    expect(share(texts, ['defaultlib'], reversed)).toEqual(share(texts, ['defaultlib'], libs));
  });
});
