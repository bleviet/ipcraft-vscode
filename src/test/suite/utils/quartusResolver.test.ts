import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findInInstallDir,
  getQuartusTool,
  resolveQuartusVersions,
} from '../../../utils/quartusResolver';
import * as detectQuartusVersion from '../../../utils/detectQuartusVersion';

function makeFakeQuartusDir(): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-quartus-test-'));
  const binDir = path.join(root, 'quartus', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const exe = process.platform === 'win32' ? 'quartus_sh.exe' : 'quartus_sh';
  fs.writeFileSync(path.join(binDir, exe), '');
  return { root };
}

function makeCfg(overrides: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
  } as unknown as import('vscode').WorkspaceConfiguration;
}

describe('quartusResolver', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('findInInstallDir', () => {
    it('finds quartus_sh in the well-known Linux subdirectory', () => {
      const { root } = makeFakeQuartusDir();
      cleanupDirs.push(root);
      if (process.platform !== 'win32') {
        expect(findInInstallDir('quartus_sh', root)).toBe(
          path.join(root, 'quartus', 'bin', 'quartus_sh')
        );
      }
    });

    it('returns null when nothing is found', () => {
      expect(findInInstallDir('quartus_sh', '/no/such/dir')).toBeNull();
    });
  });

  describe('resolveQuartusVersions', () => {
    it('resolves each installDirs entry to its probed version', () => {
      const { root } = makeFakeQuartusDir();
      cleanupDirs.push(root);
      jest.spyOn(detectQuartusVersion, 'detectQuartusVersionAt').mockReturnValue('23.1');

      const resolved = resolveQuartusVersions([root]);
      expect(resolved).toEqual([{ version: '23.1', installDir: root }]);
    });

    it('falls back to the folder name when the version probe fails', () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-quartus-test-'));
      const versionDir = path.join(parent, '24.1');
      fs.mkdirSync(path.join(versionDir, 'quartus', 'bin'), { recursive: true });
      fs.writeFileSync(
        path.join(
          versionDir,
          'quartus',
          'bin',
          process.platform === 'win32' ? 'quartus_sh.exe' : 'quartus_sh'
        ),
        ''
      );
      cleanupDirs.push(parent);
      jest.spyOn(detectQuartusVersion, 'detectQuartusVersionAt').mockReturnValue(undefined);

      expect(resolveQuartusVersions([versionDir])[0].version).toBe('24.1');
    });

    it('skips entries that do not resolve to a real install', () => {
      expect(resolveQuartusVersions(['/no/such/dir'])).toEqual([]);
    });
  });

  describe('getQuartusTool with installDirs', () => {
    it('picks the latest configured version when no preferredVersion is given', () => {
      const { root: root1 } = makeFakeQuartusDir();
      const { root: root2 } = makeFakeQuartusDir();
      cleanupDirs.push(root1, root2);
      jest
        .spyOn(detectQuartusVersion, 'detectQuartusVersionAt')
        .mockReturnValueOnce('23.1')
        .mockReturnValueOnce('24.1');

      const cfg = makeCfg({ 'quartus.installDirs': [root1, root2] });
      expect(getQuartusTool(cfg, 'quartus_sh')).toBe(
        path.join(root2, 'quartus', 'bin', 'quartus_sh')
      );
    });

    it('picks the requested preferredVersion when configured', () => {
      const { root: root1 } = makeFakeQuartusDir();
      const { root: root2 } = makeFakeQuartusDir();
      cleanupDirs.push(root1, root2);
      jest
        .spyOn(detectQuartusVersion, 'detectQuartusVersionAt')
        .mockReturnValueOnce('23.1')
        .mockReturnValueOnce('24.1');

      const cfg = makeCfg({ 'quartus.installDirs': [root1, root2] });
      expect(getQuartusTool(cfg, 'quartus_sh', '23.1')).toBe(
        path.join(root1, 'quartus', 'bin', 'quartus_sh')
      );
    });

    it('falls back to the legacy singular installDir when installDirs is empty', () => {
      const { root } = makeFakeQuartusDir();
      cleanupDirs.push(root);
      const cfg = makeCfg({ 'quartus.installDirs': [], 'quartus.installDir': root });
      expect(getQuartusTool(cfg, 'quartus_sh')).toBe(
        path.join(root, 'quartus', 'bin', 'quartus_sh')
      );
    });
  });
});
