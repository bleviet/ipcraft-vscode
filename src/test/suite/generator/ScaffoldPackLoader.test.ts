import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveScaffoldOutputPath,
  ScaffoldPackLoader,
} from '../../../generator/ScaffoldPackLoader';

function writePack(dir: string, name: string, extra = ''): string {
  const packDir = path.join(dir, name);
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(
    path.join(packDir, 'scaffold.yml'),
    `name: "${name}"\napiVersion: "^1.0"\nfullGeneration: true\nfiles: []\n${extra}`
  );
  return packDir;
}

describe('ScaffoldPackLoader.resolve', () => {
  let tmp: string;
  let builtinDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-packloader-'));
    builtinDir = path.join(tmp, 'builtin');
    fs.mkdirSync(builtinDir, { recursive: true });
    writePack(builtinDir, 'builtin-minimal');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves a built-in pack by name', () => {
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('builtin-minimal');
    expect(pack.name).toBe('builtin-minimal');
  });

  it('prefers a workspace pack over a built-in of the same name', () => {
    const wsPacks = path.join(tmp, 'ws', '.vscode', 'ipcraft', 'packs');
    writePack(wsPacks, 'builtin-minimal');
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('builtin-minimal', [wsPacks]);
    expect(pack.packDir).toBe(path.join(wsPacks, 'builtin-minimal'));
    expect(pack.category).toBe('workspace');
  });

  it('resolves a pack given an absolute directory path', () => {
    // A pack that lives nowhere on the search paths, addressed directly.
    const standalone = writePack(path.join(tmp, 'elsewhere'), 'aurora-rtl');
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve(standalone);
    expect(pack.name).toBe('aurora-rtl');
    expect(pack.packDir).toBe(standalone);
  });

  it('throws a descriptive error when a named pack is not found', () => {
    const loader = new ScaffoldPackLoader(builtinDir);
    expect(() => loader.resolve('does-not-exist')).toThrow(/does-not-exist/);
  });

  it('defaults generateFrameworkTestbench to true when the manifest omits it', () => {
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('builtin-minimal');
    expect(pack.generateFrameworkTestbench).toBe(true);
  });

  it('honors an explicit generateFrameworkTestbench: false in the manifest', () => {
    writePack(builtinDir, 'no-framework-tb', 'generateFrameworkTestbench: false\n');
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('no-framework-tb');
    expect(pack.generateFrameworkTestbench).toBe(false);
  });
});

describe.each([
  {
    name: 'POSIX',
    pathApi: path.posix,
    outputDir: '/workspace/generated',
    nestedTarget: 'rtl/core.vhd',
    expected: '/workspace/generated/rtl/core.vhd',
  },
  {
    name: 'Windows',
    pathApi: path.win32,
    outputDir: 'C:\\workspace\\generated',
    nestedTarget: 'rtl\\core.vhd',
    expected: 'C:\\workspace\\generated\\rtl\\core.vhd',
  },
])(
  'resolveScaffoldOutputPath with $name semantics',
  ({ pathApi, outputDir, nestedTarget, expected }) => {
    it('accepts a nested relative target', () => {
      expect(resolveScaffoldOutputPath(outputDir, nestedTarget, pathApi)).toBe(expected);
    });

    it.each([
      ['', 'empty'],
      ['   ', 'empty'],
      ['.', 'output directory'],
      ['./', 'output directory'],
      ['../outside.txt', 'traversal'],
      ['rtl/../../outside.txt', 'traversal'],
      ['..\\outside.txt', 'traversal'],
      ['rtl\\..\\outside.txt', 'traversal'],
      ['/tmp/outside.txt', 'absolute'],
      ['\\outside.txt', 'absolute'],
      ['C:\\outside.txt', 'absolute'],
      ['C:outside.txt', 'drive-qualified'],
      ['\\\\server\\share\\outside.txt', 'UNC'],
    ])('rejects unsafe target %j', (target, reason) => {
      expect(() => resolveScaffoldOutputPath(outputDir, target, pathApi)).toThrow(reason);
    });
  }
);
