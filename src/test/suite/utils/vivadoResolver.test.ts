import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveVivadoInstallDir,
  findVivadoInInstallDir,
  getVivadoLauncher,
} from '../../../utils/vivadoResolver';

function makeFakeVivadoDir(versionDirName: string): { root: string; versionDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-test-'));
  const versionDir = path.join(root, versionDirName);
  const binDir = path.join(versionDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'vivado.bat'), '');
  } else {
    fs.writeFileSync(path.join(binDir, 'vivado'), '');
  }
  return { root, versionDir };
}

describe('vivadoResolver', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('resolveVivadoInstallDir', () => {
    it('returns the directory directly when it is already the version-specific dir', () => {
      const { root, versionDir } = makeFakeVivadoDir('2024.2');
      cleanupDirs.push(root);
      // Point installDir straight at the version dir.
      expect(resolveVivadoInstallDir(versionDir)).toBe(versionDir);
    });

    it('resolves a family directory to its versioned subdirectory', () => {
      const { root, versionDir } = makeFakeVivadoDir('2024.2');
      cleanupDirs.push(root);
      expect(resolveVivadoInstallDir(root)).toBe(versionDir);
    });

    it('picks the lexicographically latest version when multiple are present', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-test-'));
      cleanupDirs.push(root);
      for (const v of ['2022.1', '2024.2', '2023.1']) {
        const binDir = path.join(root, v, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(
          path.join(binDir, process.platform === 'win32' ? 'vivado.bat' : 'vivado'),
          ''
        );
      }
      expect(resolveVivadoInstallDir(root)).toBe(path.join(root, '2024.2'));
    });

    it('returns null when nothing is found', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-test-'));
      cleanupDirs.push(root);
      expect(resolveVivadoInstallDir(root)).toBeNull();
    });

    it('returns null for a nonexistent path', () => {
      expect(resolveVivadoInstallDir('/no/such/path/at/all')).toBeNull();
    });
  });

  describe('findVivadoInInstallDir', () => {
    it('finds the launcher in the version-specific directory directly', () => {
      const { root, versionDir } = makeFakeVivadoDir('2024.2');
      cleanupDirs.push(root);
      const launcher = findVivadoInInstallDir(versionDir);
      expect(launcher).not.toBeNull();
      if (process.platform === 'win32') {
        expect(launcher?.exe).toContain('vivado.bat');
      } else {
        expect(launcher?.exe).toBe(path.join(versionDir, 'bin', 'vivado'));
      }
    });

    it('finds the launcher through a family directory', () => {
      const { root, versionDir } = makeFakeVivadoDir('2024.2');
      cleanupDirs.push(root);
      const launcher = findVivadoInInstallDir(root);
      expect(launcher).not.toBeNull();
      if (process.platform !== 'win32') {
        expect(launcher?.exe).toBe(path.join(versionDir, 'bin', 'vivado'));
      }
    });

    it('returns null when no Vivado installation is found', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-test-'));
      cleanupDirs.push(root);
      expect(findVivadoInInstallDir(root)).toBeNull();
    });
  });

  describe('getVivadoLauncher', () => {
    it('falls back to PATH-resolved "vivado" when installDir is empty', () => {
      const config = { get: jest.fn().mockReturnValue('') } as unknown as Parameters<
        typeof getVivadoLauncher
      >[0];
      expect(getVivadoLauncher(config)).toEqual({ exe: 'vivado', prefixArgs: [] });
    });

    it('falls back to PATH-resolved "vivado" when installDir does not resolve', () => {
      const config = {
        get: jest.fn().mockReturnValue('/no/such/path/at/all'),
      } as unknown as Parameters<typeof getVivadoLauncher>[0];
      expect(getVivadoLauncher(config)).toEqual({ exe: 'vivado', prefixArgs: [] });
    });

    it('uses the resolved installDir when configured', () => {
      const { root, versionDir } = makeFakeVivadoDir('2024.2');
      cleanupDirs.push(root);
      const config = { get: jest.fn().mockReturnValue(versionDir) } as unknown as Parameters<
        typeof getVivadoLauncher
      >[0];
      const launcher = getVivadoLauncher(config);
      expect(launcher.exe).not.toBe('vivado');
    });
  });
});
