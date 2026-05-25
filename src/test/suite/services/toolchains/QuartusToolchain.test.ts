import {
  QuartusToolchain,
  quartusDeviceFamily,
} from '../../../../services/toolchains/QuartusToolchain';
import * as quartusResolver from '../../../../utils/quartusResolver';
import * as childProcess from 'child_process';

jest.mock('../../../../utils/quartusResolver');
jest.mock('child_process');

const mockFindInInstallDir = quartusResolver.findInInstallDir as jest.Mock;
const mockGetQuartusTool = quartusResolver.getQuartusTool as jest.Mock;
const mockSpawnSync = childProcess.spawnSync as jest.Mock;

function makeCfg(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
  } as unknown as import('vscode').WorkspaceConfiguration;
}

describe('quartusDeviceFamily', () => {
  const cases: [string, string][] = [
    ['5CSEBA6U23I7', 'Cyclone V'],
    ['10CX220YF780E5G', 'Cyclone 10 LP'],
    ['10M50DAF672C7G', 'MAX 10'],
    ['EP4CGX15BF14C7', 'Cyclone IV GX'],
    ['EP4CE22F17C6', 'Cyclone IV E'],
    ['EP3C10F256C8', 'Cyclone III'],
    ['EP2C5T144C8', 'Cyclone II'],
    ['5AGZME1H29C4N', 'Arria V GZ'],
    ['5ASTMD5K3F40I3', 'Arria V'],
    ['EP5SGXEA7H2F35C2', 'Stratix V'],
    ['EP4SGX230KF40C2', 'Stratix IV'],
    ['EP3SE50F780C2', 'Stratix III'],
    ['UNKNOWN_PART', 'Cyclone V'],
  ];

  it.each(cases)('maps %s → %s', (part, expected) => {
    expect(quartusDeviceFamily(part)).toBe(expected);
  });
});

describe('QuartusToolchain', () => {
  let tc: QuartusToolchain;

  beforeEach(() => {
    tc = new QuartusToolchain();
  });

  it('has correct id, outputSubdir, and contextKey', () => {
    expect(tc.id).toBe('quartus');
    expect(tc.outputSubdir).toBe('altera');
    expect(tc.contextKey).toBe('ipcraft.quartusFound');
  });

  it('resolve() delegates to getQuartusTool', () => {
    mockGetQuartusTool.mockReturnValue('/opt/quartus/bin/quartus_sh');
    const cfg = makeCfg();
    const result = tc.resolve('quartus_sh', cfg);
    expect(result.exe).toBe('/opt/quartus/bin/quartus_sh');
    expect(result.prefixArgs).toEqual([]);
    expect(mockGetQuartusTool).toHaveBeenCalledWith(cfg, 'quartus_sh');
  });

  it('isAvailable() returns true when docker runner is configured with image', () => {
    const cfg = makeCfg({ 'quartus.runner': 'docker', 'quartus.dockerImage': 'my/quartus:latest' });
    expect(tc.isAvailable(cfg)).toBe(true);
  });

  it('isAvailable() returns false when docker runner has no image', () => {
    const cfg = makeCfg({ 'quartus.runner': 'docker', 'quartus.dockerImage': '' });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('isAvailable() returns true when installDir resolves quartus_sh', () => {
    mockFindInInstallDir.mockReturnValue('/opt/intelFPGA/20.1/quartus/bin/quartus_sh');
    const cfg = makeCfg({ 'quartus.runner': 'local', 'quartus.installDir': '/opt/intelFPGA/20.1' });
    expect(tc.isAvailable(cfg)).toBe(true);
    expect(mockFindInInstallDir).toHaveBeenCalledWith('quartus_sh', '/opt/intelFPGA/20.1');
  });

  it('isAvailable() returns false when installDir is set but tool not found', () => {
    mockFindInInstallDir.mockReturnValue(null);
    const cfg = makeCfg({ 'quartus.runner': 'local', 'quartus.installDir': '/opt/intelFPGA/20.1' });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('isAvailable() falls back to PATH check when no installDir and no dockerImage', () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    const cfg = makeCfg({
      'quartus.runner': 'local',
      'quartus.installDir': '',
      'quartus.dockerImage': '',
    });
    expect(tc.isAvailable(cfg)).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(expect.any(String), ['quartus_sh'], {
      stdio: 'pipe',
    });
  });

  it('isAvailable() returns false when not on PATH', () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const cfg = makeCfg({
      'quartus.runner': 'local',
      'quartus.installDir': '',
      'quartus.dockerImage': '',
    });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('getDocker() returns DockerConfig for docker runner', () => {
    const cfg = makeCfg({ 'quartus.runner': 'docker', 'quartus.dockerImage': 'intel/quartus' });
    const docker = tc.getDocker(cfg, '/workspace');
    expect(docker).toEqual({ image: 'intel/quartus', mountBase: '/workspace' });
  });

  it('getDocker() returns undefined for local runner', () => {
    const cfg = makeCfg({ 'quartus.runner': 'local' });
    expect(tc.getDocker(cfg, '/workspace')).toBeUndefined();
  });

  it('getLaunchEnv() returns empty env and mounts', () => {
    const cfg = makeCfg();
    const env = tc.getLaunchEnv(cfg);
    expect(env.env).toEqual({});
    expect(env.extraMounts).toEqual([]);
  });
});
