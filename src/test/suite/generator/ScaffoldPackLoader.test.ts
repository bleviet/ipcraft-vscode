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

  it('tracks an omitted generateFrameworkTestbench separately from its enabled default', () => {
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('builtin-minimal');
    expect(pack.generateFrameworkTestbench).toBe(true);
    expect(pack.generateFrameworkTestbenchDeclared).toBe(false);
  });

  it('honors an explicit generateFrameworkTestbench: false in the manifest', () => {
    writePack(builtinDir, 'no-framework-tb', 'generateFrameworkTestbench: false\n');
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('no-framework-tb');
    expect(pack.generateFrameworkTestbench).toBe(false);
  });

  it('marks generateFrameworkTestbench as undeclared when the manifest omits it', () => {
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('builtin-minimal');
    expect(pack.generateFrameworkTestbenchDeclared).toBe(false);
  });

  it('marks generateFrameworkTestbench as declared when the manifest sets it explicitly', () => {
    writePack(builtinDir, 'explicit-true-tb', 'generateFrameworkTestbench: true\n');
    writePack(builtinDir, 'explicit-false-tb', 'generateFrameworkTestbench: false\n');
    const loader = new ScaffoldPackLoader(builtinDir);
    expect(loader.resolve('explicit-true-tb').generateFrameworkTestbenchDeclared).toBe(true);
    expect(loader.resolve('explicit-false-tb').generateFrameworkTestbenchDeclared).toBe(true);
  });

  it('leaves requirements undefined when the manifest omits it', () => {
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('builtin-minimal');
    expect(pack.requirements).toBeUndefined();
  });

  it('parses a requirements block from the manifest (issue #152)', () => {
    writePack(
      builtinDir,
      'avalon-only-pack',
      [
        'requirements:',
        '  hdlLanguages:',
        '    - vhdl',
        '  busTypes:',
        '    - avmm',
        '  memoryMappedSlave: required',
        '  logicalPorts:',
        '    - address',
        '    - read',
        '    - write',
        '    - writedata',
        '    - readdata',
        '',
      ].join('\n')
    );
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('avalon-only-pack');
    expect(pack.requirements).toEqual({
      hdlLanguages: ['vhdl'],
      busTypes: ['avmm'],
      memoryMappedSlave: 'required',
      logicalPorts: ['address', 'read', 'write', 'writedata', 'readdata'],
    });
  });

  it('ignores an unrecognized memoryMappedSlave value', () => {
    writePack(builtinDir, 'bad-mms-pack', 'requirements:\n  memoryMappedSlave: sometimes\n');
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('bad-mms-pack');
    expect(pack.requirements?.memoryMappedSlave).toBeUndefined();
  });

  it('parses files[].executable: true from the manifest (issue #153)', () => {
    const packDir = path.join(builtinDir, 'executable-pack');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      [
        'name: "executable-pack"',
        'files:',
        '  - source: script.sh.j2',
        '    target: script.sh',
        '    executable: true',
        '',
      ].join('\n')
    );
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('executable-pack');
    expect(pack.files).toEqual([
      {
        source: 'script.sh.j2',
        target: 'script.sh',
        condition: undefined,
        managed: true,
        executable: true,
      },
    ]);
  });

  it('defaults files[].executable to undefined when the manifest omits it', () => {
    const packDir = path.join(builtinDir, 'non-executable-pack');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      [
        'name: "non-executable-pack"',
        'files:',
        '  - source: top.vhd.j2',
        '    target: rtl/top.vhd',
        '',
      ].join('\n')
    );
    const loader = new ScaffoldPackLoader(builtinDir);
    const pack = loader.resolve('non-executable-pack');
    expect(pack.files[0].executable).toBeUndefined();
  });

  describe('generation.indentation (issue #160)', () => {
    it('leaves generation undefined when the manifest omits the block', () => {
      const loader = new ScaffoldPackLoader(builtinDir);
      const pack = loader.resolve('builtin-minimal');
      expect(pack.generation).toBeUndefined();
    });

    it('parses a style-only indentation block', () => {
      writePack(builtinDir, 'tab-pack', 'generation:\n  indentation:\n    style: tab\n');
      const loader = new ScaffoldPackLoader(builtinDir);
      const pack = loader.resolve('tab-pack');
      expect(pack.generation?.indentation).toEqual({ style: 'tab' });
      expect(pack.generation?.indentation).not.toHaveProperty('size');
    });

    it('parses a size-only indentation block', () => {
      writePack(builtinDir, 'size-only-pack', 'generation:\n  indentation:\n    size: 4\n');
      const loader = new ScaffoldPackLoader(builtinDir);
      const pack = loader.resolve('size-only-pack');
      expect(pack.generation?.indentation).toEqual({ size: 4 });
    });

    it('parses both style and size when present', () => {
      writePack(
        builtinDir,
        'both-pack',
        'generation:\n  indentation:\n    style: spaces\n    size: 4\n'
      );
      const loader = new ScaffoldPackLoader(builtinDir);
      const pack = loader.resolve('both-pack');
      expect(pack.generation?.indentation).toEqual({ style: 'spaces', size: 4 });
    });

    it('throws an actionable error naming the pack and value for an invalid style', () => {
      writePack(builtinDir, 'bad-style-pack', 'generation:\n  indentation:\n    style: sideways\n');
      const loader = new ScaffoldPackLoader(builtinDir);
      expect(() => loader.resolve('bad-style-pack')).toThrow(/bad-style-pack/);
      expect(() => loader.resolve('bad-style-pack')).toThrow(/sideways/);
    });

    it.each([
      ['0', '0'],
      ['-1', '-1'],
      ['1.5', '1.5'],
      ['"abc"', 'abc'],
    ])('throws an actionable error naming the pack for an invalid size %s', (yamlValue) => {
      writePack(
        builtinDir,
        'bad-size-pack',
        `generation:\n  indentation:\n    size: ${yamlValue}\n`
      );
      const loader = new ScaffoldPackLoader(builtinDir);
      expect(() => loader.resolve('bad-size-pack')).toThrow(/bad-size-pack/);
    });

    it('validates size even when style is tab (size is still checked independently)', () => {
      writePack(
        builtinDir,
        'tab-bad-size-pack',
        'generation:\n  indentation:\n    style: tab\n    size: 0\n'
      );
      const loader = new ScaffoldPackLoader(builtinDir);
      expect(() => loader.resolve('tab-bad-size-pack')).toThrow(/tab-bad-size-pack/);
    });
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
