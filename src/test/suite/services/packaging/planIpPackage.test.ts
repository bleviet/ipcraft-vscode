import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { unzipSync } from 'fflate';
import {
  planIpPackage,
  writePackageToDirectory,
  writePackageToZip,
} from '../../../../services/packaging';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-pkg-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function put(rel: string, content: string): Promise<string> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  return abs;
}

const text = (entries: Map<string, Uint8Array>, key: string): string =>
  Buffer.from(entries.get(key) as Uint8Array).toString('utf8');

const vlnv = (name: string): string =>
  `vlnv:\n  vendor: v\n  library: l\n  name: ${name}\n  version: 1.0.0\n`;

describe('planIpPackage', () => {
  it('keeps an internal-only IP byte-identical', async () => {
    const ipText = `${vlnv('a')}fileSets:\n  - name: rtl\n    files:\n      - path: ./rtl/a.vhd  # keep\n        type: vhdl\n`;
    const ip = await put('ip/a.ip.yml', ipText);
    await put('ip/rtl/a.vhd', 'entity a;');
    const plan = await planIpPackage(ip);
    expect([...plan.entries.keys()].sort()).toEqual(['a.ip.yml', 'rtl/a.vhd']);
    expect(text(plan.entries, 'a.ip.yml')).toBe(ipText);
    expect(plan.warnings).toEqual([]);
  });

  it('moves an external fileset file under deps/ and preserves comments and hex', async () => {
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}# top comment\nfileSets:\n  - name: rtl\n    files:\n      - path: ../common/pkg.vhd # shared\n        type: vhdl\nbase: 0x10\n`
    );
    await put('common/pkg.vhd', 'package p;');
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'deps/common/pkg.vhd')).toBe('package p;');
    const out = text(entries, 'a.ip.yml');
    expect(out).toContain('path: deps/common/pkg.vhd # shared');
    expect(out).toContain('# top comment');
    expect(out).toContain('base: 0x10');
  });

  it('handles an absolute file path', async () => {
    const abs = await put('other/x.vhd', 'x');
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - name: rtl\n    files:\n      - path: ${abs}\n`
    );
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'deps/other/x.vhd')).toBe('x');
    expect(text(entries, 'a.ip.yml')).toContain('path: deps/other/x.vhd');
  });

  it('rewrites whole-list and per-entry memory map imports outside the root', async () => {
    const whole = await put(
      'ip1/a.ip.yml',
      `${vlnv('a')}memoryMaps:\n  import: ../maps/a.mm.yml\n`
    );
    await put('maps/a.mm.yml', '- name: A\n');
    const p1 = await planIpPackage(whole);
    expect(text(p1.entries, 'a.ip.yml')).toContain('import: deps/maps/a.mm.yml');
    expect(text(p1.entries, 'deps/maps/a.mm.yml')).toBe('- name: A\n');

    const per = await put(
      'ip2/b.ip.yml',
      `${vlnv('b')}memoryMaps:\n  - import: ../maps/a.mm.yml\n    name: Over\n`
    );
    const p2 = await planIpPackage(per);
    expect(text(p2.entries, 'b.ip.yml')).toContain('- import: deps/maps/a.mm.yml');
    expect(p2.entries.has('deps/maps/a.mm.yml')).toBe(true);
  });

  it('rewrites a fileset import outside the root and its inner file paths', async () => {
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - import: ../fs/rtl.fileset.yml\n`
    );
    await put(
      'fs/rtl.fileset.yml',
      '- name: rtl\n  files:\n    - path: ../common/c.vhd # c\n    - path: rtl/in.vhd\n'
    );
    await put('common/c.vhd', 'c');
    await put('ip/rtl/in.vhd', 'in');
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'a.ip.yml')).toContain('import: deps/fs/rtl.fileset.yml');
    const fsText = text(entries, 'deps/fs/rtl.fileset.yml');
    expect(fsText).toContain('path: deps/common/c.vhd # c');
    expect(fsText).toContain('path: rtl/in.vhd');
    expect(text(entries, 'deps/common/c.vhd')).toBe('c');
    expect(text(entries, 'rtl/in.vhd')).toBe('in');
  });

  it('copies an external bus library directory recursively', async () => {
    const ip = await put('ip/a.ip.yml', `${vlnv('a')}useBusLibrary: ../buslib\n`);
    await put('buslib/x.yml', 'x');
    await put('buslib/sub/y.yml', 'y');
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'a.ip.yml')).toContain('useBusLibrary: deps/buslib');
    expect(text(entries, 'deps/buslib/x.yml')).toBe('x');
    expect(text(entries, 'deps/buslib/sub/y.yml')).toBe('y');
  });

  it('bundles subcores transitively, terminates cycles and warns on VLNV-only ones', async () => {
    const ip = await put(
      'top/top.ip.yml',
      `${vlnv('top')}subcores:\n  - vlnv: v:l:sub:1.0.0\n    path: ../sub\n  - v:l:catalog:1.0.0\n`
    );
    await put(
      'sub/sub.ip.yml',
      `${vlnv('sub')}subcores:\n  - vlnv: v:l:top:1.0.0\n    path: ../top\nfileSets:\n  - name: r\n    files:\n      - path: ../subdep/s.vhd\n`
    );
    await put('sub/other.ip.yml', vlnv('other'));
    await put('subdep/s.vhd', 's');
    const { entries, warnings } = await planIpPackage(ip);
    expect(text(entries, 'top.ip.yml')).toContain('path: deps/sub');
    expect(text(entries, 'deps/sub/sub.ip.yml')).toContain('path: deps/subdep/s.vhd');
    expect(text(entries, 'deps/sub/deps/subdep/s.vhd')).toBe('s');
    const backRef = /^\s+path: (\.\.\/\.\.)$/m.exec(text(entries, 'deps/sub/sub.ip.yml'));
    expect(backRef?.[1]).toBeDefined();
    // deps/sub + ../.. is the package root, where top.ip.yml lives.
    expect(path.posix.join('deps/sub', backRef?.[1] as string)).toBe('.');
    expect(entries.has('deps/sub/other.ip.yml')).toBe(false);
    expect(warnings).toEqual([
      'Subcore v:l:catalog:1.0.0 has no path; not bundled (add "path:" to include it)',
    ]);
  });

  it('rewrites a relative path that leaves the root and returns, and an absolute inner path', async () => {
    const abs = path.join(tmp, 'ip/rtl/b.vhd');
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - name: r\n    files:\n      - path: ../ip/rtl/a.vhd\n      - path: ${abs}\n      - path: ./rtl/c.vhd\n`
    );
    await put('ip/rtl/a.vhd', 'a');
    await put('ip/rtl/b.vhd', 'b');
    await put('ip/rtl/c.vhd', 'c');
    const out = text((await planIpPackage(ip)).entries, 'a.ip.yml');
    expect(out).toContain('path: rtl/a.vhd');
    expect(out).toContain('path: rtl/b.vhd');
    expect(out).toContain('path: ./rtl/c.vhd');
  });

  it('throws when different files map to the same package path', async () => {
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - name: r\n    files:\n      - path: deps/x/a.vhd\n      - path: ../x/a.vhd\n`
    );
    await put('ip/deps/x/a.vhd', 'one');
    await put('x/a.vhd', 'two');
    await expect(planIpPackage(ip)).rejects.toThrow(/Package path conflict/);
  });

  it('reports every missing path in one error', async () => {
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}memoryMaps:\n  import: gone.mm.yml\nfileSets:\n  - name: r\n    files:\n      - path: missing.vhd\n`
    );
    const err = await planIpPackage(ip).catch((e: Error) => e);
    expect((err as Error).message).toContain('gone.mm.yml');
    expect((err as Error).message).toContain('missing.vhd');
  });
});

describe('planIpPackage edge cases', () => {
  it('points a file-form subcore path inside a cycle at the packaged ip file', async () => {
    const ip = await put(
      'a/a.ip.yml',
      `${vlnv('a')}subcores:\n  - vlnv: v:l:b:1.0.0\n    path: ../b\n`
    );
    await put(
      'b/b.ip.yml',
      `${vlnv('b')}subcores:\n  - vlnv: v:l:a:1.0.0\n    path: ../a/a.ip.yml\n`
    );
    const { entries } = await planIpPackage(ip);
    const back = /path: (\S+)$/m.exec(text(entries, 'deps/b/b.ip.yml'))?.[1] as string;
    expect(path.posix.join('deps/b', back)).toBe('a.ip.yml');
  });

  it('terminates an a -> b -> c -> a cycle with a correct back-reference', async () => {
    const sub = (name: string, next: string): string =>
      `${vlnv(name)}subcores:\n  - vlnv: v:l:${next}:1.0.0\n    path: ../${next}\n`;
    const ip = await put('a/a.ip.yml', sub('a', 'b'));
    await put('b/b.ip.yml', sub('b', 'c'));
    await put('c/c.ip.yml', sub('c', 'a'));
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'a.ip.yml')).toContain('path: deps/b');
    expect(text(entries, 'deps/b/b.ip.yml')).toContain('path: deps/c');
    const back = /path: (\S+)$/m.exec(text(entries, 'deps/b/deps/c/c.ip.yml'))?.[1] as string;
    expect(path.posix.join('deps/b/deps/c', back)).toBe('.');
  });

  it('keeps a self-reference byte-identical', async () => {
    const ipText = `${vlnv('a')}subcores:\n  - vlnv: v:l:a:1.0.0\n    path: ./a.ip.yml\n`;
    const ip = await put('a/a.ip.yml', ipText);
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'a.ip.yml')).toBe(ipText);
  });

  it('copies a single-file useBusLibrary', async () => {
    const ip = await put('ip/a.ip.yml', `${vlnv('a')}useBusLibrary: ../lib/bus.yml\n`);
    await put('lib/bus.yml', 'bus');
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'a.ip.yml')).toContain('useBusLibrary: deps/lib/bus.yml');
    expect(text(entries, 'deps/lib/bus.yml')).toBe('bus');
  });

  it('follows a symlinked folder and reports a broken link as missing', async () => {
    const ip = await put('ip/a.ip.yml', `${vlnv('a')}useBusLibrary: ../lib\n`);
    await put('real/y.yml', 'y');
    await put('lib/x.yml', 'x');
    await fs.symlink(path.join(tmp, 'real'), path.join(tmp, 'lib/linked'));
    expect(text((await planIpPackage(ip)).entries, 'deps/lib/linked/y.yml')).toBe('y');
    await fs.symlink(path.join(tmp, 'nowhere'), path.join(tmp, 'lib/broken'));
    await expect(planIpPackage(ip)).rejects.toThrow(/Not found: .*broken/);
  });

  it('copies two links to the same folder instead of flagging a loop', async () => {
    const ip = await put('ip/a.ip.yml', `${vlnv('a')}useBusLibrary: ../lib\n`);
    await put('lib/s/f.yml', 'f');
    await fs.symlink(path.join(tmp, 'lib/s'), path.join(tmp, 'lib/k1'));
    await fs.symlink(path.join(tmp, 'lib/s'), path.join(tmp, 'lib/k2'));
    const { entries } = await planIpPackage(ip);
    expect(text(entries, 'deps/lib/k1/f.yml')).toBe('f');
    expect(text(entries, 'deps/lib/k2/f.yml')).toBe('f');
  });

  it('fails fast and clearly on symlink loops in a bus library', async () => {
    const ip = await put('ip/a.ip.yml', `${vlnv('a')}useBusLibrary: ../lib\n`);
    await put('lib/x.yml', 'x');
    await fs.symlink(path.join(tmp, 'lib'), path.join(tmp, 'lib/loop1'));
    await fs.symlink(path.join(tmp, 'lib'), path.join(tmp, 'lib/loop2'));
    const started = Date.now();
    const err = (await planIpPackage(ip).catch((e: Error) => e)) as Error;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(err.message).toMatch(/Symlink loop: .*loop1 -> /);
    expect(err.message).toMatch(/Symlink loop: .*loop2 -> /);
    expect(err.message).not.toContain('Not found');
  });

  it('keeps a directory self-reference path ./ byte-identical', async () => {
    const ipText = `${vlnv('a')}subcores:\n  - vlnv: v:l:a:1.0.0\n    path: ./\n`;
    const ip = await put('a/a.ip.yml', ipText);
    expect(text((await planIpPackage(ip)).entries, 'a.ip.yml')).toBe(ipText);
  });

  it('names the fileset file when a listed file is a directory', async () => {
    await fs.mkdir(path.join(tmp, 'ip/rtl'), { recursive: true });
    const ip = await put('ip/a.ip.yml', `${vlnv('a')}fileSets:\n  - import: r.fileset.yml\n`);
    await put('ip/r.fileset.yml', '- name: r\n  files:\n    - path: rtl\n');
    await expect(planIpPackage(ip)).rejects.toThrow(/listed in .*r\.fileset\.yml/);
  });

  it('names a file reference that is a directory', async () => {
    await fs.mkdir(path.join(tmp, 'ip/rtl'), { recursive: true });
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - name: r\n    files:\n      - path: rtl\n`
    );
    await expect(planIpPackage(ip)).rejects.toThrow(
      /fileSets\.0\.files\.0\.path 'rtl' must be a file but is a directory/
    );
  });

  it('reports a conflict together with missing paths', async () => {
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - name: r\n    files:\n      - path: deps/x/a.vhd\n      - path: ../x/a.vhd\n      - path: gone.vhd\n`
    );
    await put('ip/deps/x/a.vhd', 'one');
    await put('x/a.vhd', 'two');
    const msg = ((await planIpPackage(ip).catch((e: Error) => e)) as Error).message;
    expect(msg).toContain('Package path conflict');
    expect(msg).toContain('gone.vhd');
  });

  it('skips an unparsable sibling .ip.yml in the subcore folder', async () => {
    const ip = await put(
      'top/top.ip.yml',
      `${vlnv('top')}subcores:\n  - vlnv: v:l:sub:1.0.0\n    path: ../sub\n`
    );
    await put('sub/a_broken.ip.yml', 'a: [unclosed');
    await put('sub/sub.ip.yml', vlnv('sub'));
    const { entries } = await planIpPackage(ip);
    expect(entries.has('deps/sub/sub.ip.yml')).toBe(true);
  });
});

describe('package writers', () => {
  async function samplePlan() {
    const ip = await put(
      'ip/a.ip.yml',
      `${vlnv('a')}fileSets:\n  - name: r\n    files:\n      - path: ../c/p.vhd\n`
    );
    await put('c/p.vhd', 'p');
    return planIpPackage(ip);
  }

  it('writes a directory and refuses a non-empty one', async () => {
    const plan = await samplePlan();
    const out = path.join(tmp, 'out');
    await writePackageToDirectory(plan, out);
    expect(await fs.readFile(path.join(out, 'deps/c/p.vhd'), 'utf8')).toBe('p');
    await expect(writePackageToDirectory(plan, out)).rejects.toThrow(/not empty/);
  });

  it('round-trips through a zip with a single top folder', async () => {
    const plan = await samplePlan();
    const zipPath = path.join(tmp, 'pkg_1.0.0.zip');
    await writePackageToZip(plan, zipPath);
    const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
    expect(Object.keys(files).sort()).toEqual(['pkg_1.0.0/a.ip.yml', 'pkg_1.0.0/deps/c/p.vhd']);
    expect(Buffer.from(files['pkg_1.0.0/deps/c/p.vhd']).toString()).toBe('p');
  });
});
