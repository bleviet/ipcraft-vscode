import { VivadoToolchain } from '../../../../services/toolchains/VivadoToolchain';
import * as vivadoResolver from '../../../../utils/vivadoResolver';
import * as fsHelpers from '../../../../utils/fsHelpers';
import * as buildRunner from '../../../../services/BuildRunner';
import * as childProcess from 'child_process';

jest.mock('../../../../utils/vivadoResolver');
jest.mock('../../../../utils/fsHelpers');
jest.mock('../../../../services/BuildRunner');
jest.mock('child_process');

const mockFindVivado = vivadoResolver.findVivadoInInstallDir as jest.Mock;
const mockGetLauncher = vivadoResolver.getVivadoLauncher as jest.Mock;
const mockFileExists = fsHelpers.fileExists as jest.Mock;
const mockRunProcess = buildRunner.runProcess as jest.Mock;
const mockSpawnSync = childProcess.spawnSync as jest.Mock;

function makeCfg(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
  } as unknown as import('vscode').WorkspaceConfiguration;
}

describe('VivadoToolchain', () => {
  let tc: VivadoToolchain;

  beforeEach(() => {
    tc = new VivadoToolchain();
  });

  it('has correct id, outputSubdir, and contextKey', () => {
    expect(tc.id).toBe('vivado');
    expect(tc.outputSubdir).toBe('xilinx');
    expect(tc.contextKey).toBe('ipcraft.vivadoFound');
  });

  it('resolve() delegates to getVivadoLauncher', () => {
    const expected = { exe: '/usr/bin/vivado', prefixArgs: ['-batch'] };
    mockGetLauncher.mockReturnValue(expected);
    const cfg = makeCfg();
    expect(tc.resolve('any', cfg)).toBe(expected);
    expect(mockGetLauncher).toHaveBeenCalledWith(cfg);
  });

  it('isAvailable() returns true when docker runner is configured with image', () => {
    const cfg = makeCfg({ 'vivado.runner': 'docker', 'vivado.dockerImage': 'my/vivado:latest' });
    expect(tc.isAvailable(cfg)).toBe(true);
  });

  it('isAvailable() returns false when docker runner has no image', () => {
    const cfg = makeCfg({ 'vivado.runner': 'docker', 'vivado.dockerImage': '' });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('isAvailable() returns true when installDir resolves', () => {
    mockFindVivado.mockReturnValue('/opt/xilinx/vivado');
    const cfg = makeCfg({ 'vivado.runner': 'local', 'vivado.installDir': '/opt/xilinx' });
    expect(tc.isAvailable(cfg)).toBe(true);
    expect(mockFindVivado).toHaveBeenCalledWith('/opt/xilinx');
  });

  it('isAvailable() returns false when installDir is set but not found', () => {
    mockFindVivado.mockReturnValue(null);
    const cfg = makeCfg({ 'vivado.runner': 'local', 'vivado.installDir': '/opt/xilinx' });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('isAvailable() falls back to PATH check when no installDir', () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    const cfg = makeCfg({ 'vivado.runner': 'local', 'vivado.installDir': '' });
    expect(tc.isAvailable(cfg)).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(expect.any(String), ['vivado'], { stdio: 'pipe' });
  });

  it('isAvailable() returns false when not on PATH', () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const cfg = makeCfg({ 'vivado.runner': 'local', 'vivado.installDir': '' });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('getDocker() returns DockerConfig for docker runner', () => {
    const cfg = makeCfg({ 'vivado.runner': 'docker', 'vivado.dockerImage': 'xilinx/vivado' });
    const docker = tc.getDocker(cfg, '/workspace');
    expect(docker).toEqual({ image: 'xilinx/vivado', mountBase: '/workspace' });
  });

  it('getDocker() returns undefined for local runner', () => {
    const cfg = makeCfg({ 'vivado.runner': 'local' });
    expect(tc.getDocker(cfg, '/workspace')).toBeUndefined();
  });

  it('getLaunchEnv() returns empty env and mounts', () => {
    const cfg = makeCfg();
    const env = tc.getLaunchEnv(cfg);
    expect(env.env).toEqual({});
    expect(env.extraMounts).toEqual([]);
  });

  describe('createProject()', () => {
    const outputChannel = { appendLine: jest.fn() } as unknown as import('vscode').OutputChannel;

    beforeEach(() => {
      mockFileExists.mockReset();
      mockRunProcess.mockReset();
      mockGetLauncher.mockReset();
    });

    it('returns false when project TCL is missing', async () => {
      mockFileExists.mockResolvedValue(false);
      const ok = await tc.createProject('my_ip', '/ip', makeCfg(), outputChannel);
      expect(ok).toBe(false);
      expect(mockRunProcess).not.toHaveBeenCalled();
    });

    it('returns false when launcher cannot be resolved', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetLauncher.mockReturnValue(null);
      const ok = await tc.createProject('my_ip', '/ip', makeCfg(), outputChannel);
      expect(ok).toBe(false);
      expect(mockRunProcess).not.toHaveBeenCalled();
    });

    it('invokes vivado -mode batch -source <project_tcl> in xilinx/ on success', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetLauncher.mockReturnValue({ exe: '/usr/bin/vivado', prefixArgs: [] });
      mockRunProcess.mockResolvedValue({ success: true });
      const ok = await tc.createProject('my_ip', '/ip', makeCfg(), outputChannel);
      expect(ok).toBe(true);
      expect(mockRunProcess).toHaveBeenCalledWith(
        '/usr/bin/vivado',
        expect.arrayContaining(['-mode', 'batch', '-source', 'my_ip_project.tcl']),
        expect.objectContaining({ cwd: expect.stringContaining('xilinx') })
      );
    });
  });
});

describe('VivadoToolchain subTools', () => {
  let tc: VivadoToolchain;
  beforeEach(() => {
    tc = new VivadoToolchain();
  });

  it('declares no sub-tools', () => {
    expect(tc.subTools).toHaveLength(0);
  });

  it('isSubToolAvailable always returns false', () => {
    const cfg = makeCfg();
    expect(tc.isSubToolAvailable('any-tool', cfg)).toBe(false);
  });
});
