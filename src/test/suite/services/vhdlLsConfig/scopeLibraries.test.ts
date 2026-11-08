import { scopeLibraries } from '../../../../services/vhdlLsConfig/scopeLibraries';
import { scanVhdl } from '../../../../services/vhdlLsConfig/vhdlUnitScanner';

type Spec = Record<string, { text: string; listed?: boolean }>;

function split(spec: Spec, takenNames: string[] = ['defaultlib', 'ieee', 'std', 'work']) {
  const entries = Object.entries(spec);
  return scopeLibraries({
    files: entries.map(([path, f]) => ({ path, listed: f.listed ?? false })),
    scans: new Map(entries.map(([path, f]) => [path, scanVhdl(f.text)])),
    takenNames: new Set(takenNames),
  });
}

const ent = (name: string): string => `entity ${name} is\nend;`;
const pkg = (name: string, uses: string[] = []): string =>
  `${uses.map((u) => `use work.${u}.all;`).join('\n')}\npackage ${name} is\nend;`;

const osvvm = (dir: string, tb: string): Spec => ({
  [`${dir}/testbench/TestCtrl_e.vhd`]: { text: ent('TestCtrl') },
  [`${dir}/testbench/${tb}.vhd`]: {
    text: `${ent(tb)}\narchitecture a of ${tb} is\nbegin\n u : TestCtrl port map (x);\nend;`,
  },
  [`${dir}/TestCases/Tc1.vhd`]: {
    text: `architecture t1 of TestCtrl is\nend;\nconfiguration Tc1 of ${tb} is\nend;`,
  },
});

describe('scopeLibraries', () => {
  it('leaves everything in defaultlib when nothing collides', () => {
    const result = split({ 'a/x.vhd': { text: ent('x') }, 'b/y.vhd': { text: ent('y') } });
    expect(result).toEqual({ defaultFiles: ['a/x.vhd', 'b/y.vhd'], scopes: [] });
  });

  it('splits an OSVVM-shaped repo into one library per testbench folder', () => {
    const result = split({ ...osvvm('uart', 'TbUart'), ...osvvm('axi', 'TbAxi') });
    expect(result.defaultFiles).toEqual([]);
    expect(result.scopes).toEqual([
      {
        name: 'defaultlib_axi',
        files: ['axi/TestCases/Tc1.vhd', 'axi/testbench/TbAxi.vhd', 'axi/testbench/TestCtrl_e.vhd'],
        shared: [],
      },
      {
        name: 'defaultlib_uart',
        files: [
          'uart/TestCases/Tc1.vhd',
          'uart/testbench/TbUart.vhd',
          'uart/testbench/TestCtrl_e.vhd',
        ],
        shared: [],
      },
    ]);
  });

  it('shares transitive dependencies that stay in defaultlib', () => {
    const spec: Spec = {
      ...osvvm('uart', 'TbUart'),
      ...osvvm('axi', 'TbAxi'),
      'common/pkg_a.vhd': { text: pkg('pkg_a', ['pkg_b']) },
      'common/pkg_b.vhd': { text: pkg('pkg_b') },
      'common/other.vhd': { text: pkg('other') },
    };
    spec['uart/testbench/TbUart.vhd'].text += '\nuse work.pkg_a.all;';
    const result = split(spec);
    expect(result.defaultFiles).toEqual([
      'common/other.vhd',
      'common/pkg_a.vhd',
      'common/pkg_b.vhd',
    ]);
    expect(result.scopes.map((s) => [s.name, s.shared])).toEqual([
      ['defaultlib_axi', []],
      ['defaultlib_uart', ['common/pkg_a.vhd', 'common/pkg_b.vhd']],
    ]);
  });

  it('keeps the nearest seed in defaultlib for a listed file', () => {
    const result = split({
      'ctrl/rtl/ctrl.vhd': { text: pkg('ctrl', ['common_pkg']), listed: true },
      'common/common_pkg.vhd': { text: pkg('common_pkg') },
      'common/gen_copy/common_pkg.vhd': { text: pkg('common_pkg') },
    });
    expect(result.defaultFiles).toEqual(['common/common_pkg.vhd', 'ctrl/rtl/ctrl.vhd']);
    expect(result.scopes).toEqual([
      { name: 'defaultlib_gen_copy', files: ['common/gen_copy/common_pkg.vhd'], shared: [] },
    ]);
  });

  it('keeps a group in defaultlib when a defaultlib file depends on it', () => {
    const result = split({
      'common/common_pkg.vhd': { text: pkg('common_pkg') },
      'common/gen_copy/common_pkg.vhd': { text: pkg('common_pkg') },
      'core/core.vhd': { text: `use work.common_pkg.all;\n${ent('core')}` },
      'top/top.vhd': {
        text: `${ent('top')}\narchitecture a of top is\nbegin\n u: core port map (x);\nend;`,
      },
    });
    expect(result.defaultFiles).toEqual(['common/common_pkg.vhd', 'core/core.vhd', 'top/top.vhd']);
    expect(result.scopes).toEqual([
      { name: 'defaultlib_gen_copy', files: ['common/gen_copy/common_pkg.vhd'], shared: [] },
    ]);
  });

  it('merges a chain of groups reached from defaultlib', () => {
    const result = split({
      'a/p.vhd': { text: pkg('p') },
      'a/copy/p.vhd': { text: pkg('p') },
      'b/q.vhd': { text: pkg('q') },
      'b/copy/q.vhd': { text: pkg('q') },
      'mid/mid.vhd': { text: `use work.p.all;\n${ent('mid')}` },
      'low/low.vhd': { text: `use work.q.all;\nuse work.mid.all;\n${ent('low')}` },
      'top/top.vhd': {
        text: `${ent('top')}\narchitecture a of top is\nbegin\n u: low port map (x);\nend;`,
      },
    });
    expect(result.defaultFiles).toEqual([
      'a/p.vhd',
      'b/q.vhd',
      'low/low.vhd',
      'mid/mid.vhd',
      'top/top.vhd',
    ]);
    expect(result.scopes.map((s) => s.files)).toEqual([['a/copy/p.vhd'], ['b/copy/q.vhd']]);
  });

  it('does not split when a listed file declares the name', () => {
    const result = split({
      'a/p.vhd': { text: pkg('p'), listed: true },
      'b/p.vhd': { text: pkg('p') },
      'c/p.vhd': { text: pkg('p') },
    });
    expect(result.scopes).toEqual([]);
    expect(result.defaultFiles).toHaveLength(3);
  });

  it('does not split same-directory duplicates', () => {
    const result = split({ 'a/p1.vhd': { text: pkg('p') }, 'a/p2.vhd': { text: pkg('p') } });
    expect(result.scopes).toEqual([]);
  });

  describe('naming', () => {
    const pair = (a: string, b: string): Spec => ({
      [`${a}/t.vhd`]: { text: ent('t') },
      [`${b}/t.vhd`]: { text: ent('t') },
    });
    const names = (spec: Spec, taken?: string[]): string[] =>
      split(spec, taken).scopes.map((s) => s.name);

    it('uses the shortest unique suffix', () => {
      expect(names(pair('a/x/tb', 'b/x/tb'))).toEqual(['defaultlib_a_x_tb', 'defaultlib_b_x_tb']);
      expect(names(pair('a/tb1', 'b/tb2'))).toEqual(['defaultlib_tb1', 'defaultlib_tb2']);
    });

    it('sanitises segments into valid VHDL identifiers', () => {
      expect(names(pair('Tb-Axi4 v2', 'other'))).toEqual([
        'defaultlib_tb_axi4_v2',
        'defaultlib_other',
      ]);
    });

    it('appends a counter when the name is taken', () => {
      expect(names(pair('a', 'b'), ['defaultlib_a'])).toEqual(['defaultlib_a_2', 'defaultlib_b']);
    });

    it('names the root directory root', () => {
      expect(names({ 't.vhd': { text: ent('t') }, 'sub/t.vhd': { text: ent('t') } })).toEqual([
        'defaultlib_root',
        'defaultlib_sub',
      ]);
    });
  });

  it('is deterministic regardless of input order', () => {
    const spec: Spec = { ...osvvm('uart', 'TbUart'), ...osvvm('axi', 'TbAxi') };
    const reversed = Object.fromEntries(Object.entries(spec).reverse());
    expect(split(reversed)).toEqual(split(spec));
  });
});
