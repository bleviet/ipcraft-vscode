import { proposeLibraryFiles } from '../../../../services/vhdlLsConfig/proposeLibraryFiles';
import { scanVhdl, type VhdlScan } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

const pkg = (name: string, extra = ''): string => `${extra}package ${name} is\nend;\n`;
const KNOWN = new Set(['ieee', 'std', 'work', 'defaultlib']);

function propose(
  name: string,
  wanted: string[],
  files: Record<string, string | undefined>,
  known: ReadonlySet<string> = KNOWN,
  matchedByUser: string[] = []
) {
  const candidates = new Map<string, VhdlScan | undefined>(
    Object.entries(files).map(([f, t]) => [f, t === undefined ? undefined : scanVhdl(t)])
  );
  return proposeLibraryFiles({
    name,
    wanted: new Set(wanted),
    candidates,
    matchedByUser: new Set(matchedByUser),
    known,
  });
}

describe('proposeLibraryFiles', () => {
  it('picks only the directory covering the wanted units (UVVM shape)', () => {
    const result = propose('bitvis_vip_axi', ['vvc_methods_pkg', 'axi_bfm_pkg'], {
      'bitvis_vip_axi/src/vvc.vhd': pkg('vvc_methods_pkg'),
      'bitvis_vip_axi/src/bfm.vhd': pkg('axi_bfm_pkg'),
      'bitvis_vip_sbi/src/vvc.vhd': pkg('vvc_methods_pkg'),
      'bitvis_vip_uart/src/vvc.vhd': pkg('vvc_methods_pkg'),
    });
    expect(result.files).toEqual(['bitvis_vip_axi/src/*.vhd']);
    expect(result.exclude).toEqual([]);
  });

  it('breaks ties by name affinity, then shorter directory, then string order', () => {
    const files = {
      'bitvis_vip_axilite/src/a.vhd': pkg('p'),
      'bitvis_vip_axi/src/a.vhd': pkg('p'),
    };
    expect(propose('bitvis_vip_axi', ['p'], files).files).toEqual(['bitvis_vip_axi/src/*.vhd']);
    expect(
      propose('lib', ['p'], { 'bb/long/a.vhd': pkg('p'), 'cc/a.vhd': pkg('p') }).files
    ).toEqual(['cc/*.vhd']);
    expect(propose('lib', ['p'], { 'bb/a.vhd': pkg('p'), 'aa/a.vhd': pkg('p') }).files).toEqual([
      'aa/*.vhd',
    ]);
  });

  it('adds the directory of a work-referenced package, not one reached by instantiation', () => {
    const result = propose('osvvm_axi4', ['top_pkg'], {
      'axi4/src/top.vhd': pkg('top_pkg', 'use work.settings_pkg.all;\n'),
      'axi4/src/inst.vhd':
        'entity e is\nend;\narchitecture a of e is\nbegin\n  u: comp port map (x => y);\nend;\n',
      'common/src/settings.vhd': pkg('settings_pkg'),
      'other/comp.vhd': 'entity comp is\nend;\n',
    });
    expect(result.files).toEqual(['axi4/src/*.vhd', 'common/src/*.vhd']);
  });

  it('excludes duplicate losers and template files in picked directories', () => {
    const result = propose('lib', ['p', 'q'], {
      'src/p.vhd': pkg('p'),
      'src/p_deprecated_copy.vhd': pkg('p'),
      'src/q.vhd': pkg('q'),
      'src/q_template.vhd': 'package tq is\n  c : ${X};\nend;\n',
    });
    expect(result.files).toEqual(['src/*.vhd']);
    expect(result.exclude).toEqual(['src/p_deprecated_copy.vhd', 'src/q_template.vhd']);
  });

  it('keeps the copy without an unknown library', () => {
    const result = propose('lib', ['api'], {
      'src/api_nvc.vhd': pkg('api', 'library nvc;\n'),
      'src/api_default.vhd': pkg('api'),
    });
    expect(result.exclude).toEqual(['src/api_nvc.vhd']);
    const known = propose(
      'lib',
      ['api'],
      { 'src/api_nvc.vhd': pkg('api', 'library nvc;\n'), 'src/api_default.vhd': pkg('api') },
      new Set([...KNOWN, 'nvc'])
    );
    expect(known.exclude).toEqual(['src/api_default.vhd']);
  });

  it('returns nothing without an eligible declarer', () => {
    expect(propose('lib', ['p'], { 'a.vhd': pkg('other'), 'big.vhd': undefined })).toEqual({
      files: [],
      exclude: [],
    });
    expect(propose('lib', ['p'], { 't.vhd': 'package p is\n c : ${X};\nend;' })).toEqual({
      files: [],
      exclude: [],
    });
  });

  it('emits one glob per extension in a directory', () => {
    const result = propose('lib', ['p', 'q'], { 'src/p.vhd': pkg('p'), 'src/q.vhdl': pkg('q') });
    expect(result.files).toEqual(['src/*.vhd', 'src/*.vhdl']);
  });

  it('uses *.ext for the root directory', () => {
    expect(propose('lib', ['p'], { 'p.vhd': pkg('p') }).files).toEqual(['*.vhd']);
  });

  it('is deterministic regardless of input order', () => {
    const files: [string, string][] = [
      ['a/p.vhd', pkg('p')],
      ['b/p.vhd', pkg('p')],
      ['c/q.vhd', pkg('q')],
      ['c/q2.vhd', pkg('q')],
    ];
    const run = (order: [string, string][]) =>
      propose('lib', ['p', 'q'], Object.fromEntries(order));
    expect(run([...files].reverse())).toEqual(run(files));
  });

  it('keeps both files when each is the sole declarer of a wanted unit', () => {
    const result = propose('lib', ['p', 'r'], {
      'aaa/pq.vhd': `${pkg('p')}${pkg('q')}`,
      'b/q.vhd': `${pkg('q')}${pkg('r')}`,
    });
    expect(result.files).toEqual(['aaa/*.vhd', 'b/*.vhd']);
    expect(result.exclude).toEqual([]);
  });

  it('excludes a file whose only unit is already taken', () => {
    const result = propose('lib', ['p'], { 'src/p.vhd': pkg('p'), 'src/p_copy.vhd': pkg('p') });
    expect(result.exclude).toEqual(['src/p_copy.vhd']);
  });

  it('penalises a copy needing an unavailable library, not one needing an available one', () => {
    const files = {
      'src/a_unisim.vhd': pkg('api', 'library unisim;\n'),
      'src/b_common_long_name.vhd': pkg('api', 'library osvvm_common;\n'),
    };
    const available = new Set([...KNOWN, 'osvvm_common']);
    expect(propose('lib', ['api'], files, available).exclude).toEqual(['src/a_unisim.vhd']);
    expect(propose('lib', ['api'], files).exclude).toEqual(['src/b_common_long_name.vhd']);
  });

  it('does not let an excluded duplicate pull a directory through work references', () => {
    const result = propose('lib', ['fifo', 'a', 'b'], {
      'aa/f.vhd': `${pkg('fifo')}${pkg('a')}`,
      'bb/b.vhd': pkg('b'),
      'bb/fifo_long.vhd': pkg('fifo', 'use work.cc_pkg.all;\n'),
      'cc/c.vhd': pkg('cc_pkg'),
    });
    expect(result.files).toEqual(['aa/*.vhd', 'bb/*.vhd']);
    expect(result.exclude).toEqual(['bb/fifo_long.vhd']);
  });

  it('follows work references over two levels', () => {
    const result = propose('lib', ['top'], {
      'aa/top.vhd': pkg('top', 'use work.mid.all;\n'),
      'bb/mid.vhd': pkg('mid', 'use work.leaf.all;\n'),
      'cc/leaf.vhd': pkg('leaf'),
      'dd/unrelated.vhd': pkg('unrelated'),
    });
    expect(result.files).toEqual(['aa/*.vhd', 'bb/*.vhd', 'cc/*.vhd']);
  });

  it('chooses among directories declaring a closure unit by name affinity', () => {
    const result = propose('lib_core', ['top'], {
      'aa/top.vhd': pkg('top', 'use work.u.all;\n'),
      'mm/u.vhd': pkg('u'),
      'zz/core/u.vhd': pkg('u'),
    });
    expect(result.files).toEqual(['aa/*.vhd', 'zz/core/*.vhd']);
  });

  it('ignores closure units declared only in template or unscanned files', () => {
    const result = propose('lib', ['top'], {
      'aa/top.vhd': pkg('top', 'use work.t.all;\nuse work.v.all;\n'),
      'bb/t.vhd': 'package t is\n c : ${X};\nend;',
      'cc/v.vhd': undefined,
    });
    expect(result.files).toEqual(['aa/*.vhd']);
  });

  it('lists user-claimed files in picked directories, only for emitted extensions', () => {
    const result = propose('lib', ['p'], { 'src/p.vhd': pkg('p') }, KNOWN, [
      'src/user.vhd',
      'src/user.vhdl',
      'other/user.vhd',
    ]);
    expect(result.exclude).toEqual(['src/user.vhd']);
  });

  it('follows references of needed files only, not unrelated siblings (UVVM shape)', () => {
    const result = propose('bitvis_vip_sbi', ['sbi_vvc_old'], {
      'ref/src/sbi_vvc_old.vhd': pkg('sbi_vvc_old'),
      'ref/src/uart_vvc_old.vhd': pkg('uart_vvc_old', 'use work.uart_pkg.all;\n'),
      'bitvis_vip_uart/src/uart_pkg.vhd': pkg('uart_pkg'),
    });
    expect(result.files).toEqual(['ref/src/*.vhd']);
  });

  it('follows references through same-folder siblings of a needed file', () => {
    const result = propose('m', ['p'], {
      'a/p.vhd': pkg('p', 'use work.h.all;\n'),
      'a/h.vhd': pkg('h', 'use work.k.all;\n'),
      'c/k.vhd': pkg('k'),
    });
    expect(result.files).toEqual(['a/*.vhd', 'c/*.vhd']);
  });
});
