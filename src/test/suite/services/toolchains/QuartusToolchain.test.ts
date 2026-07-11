import * as path from 'path';
import {
  QuartusToolchain,
  quartusDeviceFamily,
  mapBusTypeToAltera,
  resolveHwTclRtlFiles,
} from '../../../../services/toolchains/QuartusToolchain';
import * as quartusResolver from '../../../../utils/quartusResolver';
import * as fsHelpers from '../../../../utils/fsHelpers';
import * as buildRunner from '../../../../services/BuildRunner';
import * as fsPromises from 'fs/promises';
import * as childProcess from 'child_process';
import { TemplateLoader } from '../../../../generator/TemplateLoader';
import { Logger } from '../../../../utils/Logger';
import type { ScaffoldContext } from '../../../../services/toolchains/SynthesisToolchain';

jest.mock('../../../../utils/quartusResolver');
jest.mock('../../../../utils/fsHelpers');
jest.mock('../../../../services/BuildRunner');
jest.mock('fs/promises');
jest.mock('child_process');

const mockFindInInstallDir = quartusResolver.findInInstallDir as jest.Mock;
const mockGetQuartusTool = quartusResolver.getQuartusTool as jest.Mock;
const mockFileExists = fsHelpers.fileExists as jest.Mock;
const mockRunProcess = buildRunner.runProcess as jest.Mock;
const mockMkdir = fsPromises.mkdir as jest.Mock;
const mockSpawnSync = childProcess.spawnSync as jest.Mock;

function makeCfg(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
  } as unknown as import('vscode').WorkspaceConfiguration;
}

describe('mapBusTypeToAltera', () => {
  const cases: [string, string][] = [
    ['AXI4L', 'axi4lite'],
    ['axi4lite', 'axi4lite'],
    ['axi4', 'axi4'],
    ['axis', 'axi4stream'],
    ['avmm', 'avalon'],
    ['avst', 'avalon_streaming'],
    ['custom_bus', 'conduit'],
  ];
  it.each(cases)('maps %s → %s', (input, expected) => {
    expect(mapBusTypeToAltera(input)).toBe(expected);
  });
  it('returns conduit for undefined input', () => {
    expect(mapBusTypeToAltera(undefined)).toBe('conduit');
  });
});

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

  describe('createProject()', () => {
    const outputChannel = { appendLine: jest.fn() } as unknown as import('vscode').OutputChannel;

    beforeEach(() => {
      mockFileExists.mockReset();
      mockRunProcess.mockReset();
      mockGetQuartusTool.mockReset();
      mockMkdir.mockReset();
      mockMkdir.mockResolvedValue(undefined);
    });

    it('returns false when project TCL is missing', async () => {
      mockFileExists.mockResolvedValue(false);
      const ok = await tc.createProject('my_ip', '/ip', makeCfg(), outputChannel);
      expect(ok).toBe(false);
      expect(mockRunProcess).not.toHaveBeenCalled();
    });

    it('returns false when quartus_sh cannot be resolved', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetQuartusTool.mockReturnValue('');
      const ok = await tc.createProject('my_ip', '/ip', makeCfg(), outputChannel);
      expect(ok).toBe(false);
      expect(mockRunProcess).not.toHaveBeenCalled();
    });

    it('invokes quartus_sh -t <project_tcl> in altera/build on success', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetQuartusTool.mockReturnValue('/opt/quartus/bin/quartus_sh');
      mockRunProcess.mockResolvedValue({ success: true });
      const ok = await tc.createProject('my_ip', '/ip', makeCfg(), outputChannel);
      expect(ok).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('altera/build'), {
        recursive: true,
      });
      expect(mockRunProcess).toHaveBeenCalledWith(
        '/opt/quartus/bin/quartus_sh',
        ['-t', expect.stringContaining('my_ip_project.tcl')],
        expect.objectContaining({ cwd: expect.stringContaining('altera/build') })
      );
    });
  });
});

describe('QuartusToolchain.scaffold() — includeDebugMaster', () => {
  const templatesPath = path.resolve(__dirname, '../../../../generator/templates');
  const logger = new Logger('test');
  const templates = new TemplateLoader(logger, templatesPath);

  function makeScaffoldContext(): ScaffoldContext {
    return {
      name: 'my_ip',
      templateContext: {
        entity_name: 'my_ip',
        version: '1.0',
        clock_port: 'clk',
        reset_port: 'rst',
        secondary_clocks: [],
        secondary_resets: [],
        expanded_bus_interfaces: [{ name: 's_avmm', type: 'avmm', mode: 'slave' }],
        interrupt_ports: [],
      },
      templates,
      ipCoreData: {} as never,
      busDefinitions: {},
      isSv: false,
      memoryMaps: [],
    };
  }

  it('omits the JTAG-to-Avalon-MM debug master by default', () => {
    const tc = new QuartusToolchain();
    const files = tc.scaffold(makeScaffoldContext(), {});
    expect(files['altera/test.qsys']).not.toContain('jtag_debug_master');
    expect(files['altera/test.qsys']).not.toContain('altera_jtag_avalon_master');
    // Without the debug master, the Avalon-MM slave stays a top-level export.
    expect(files['altera/test.qsys']).toContain('my_ip_0_s_avmm');
  });

  it('adds the JTAG-to-Avalon-MM debug master when includeDebugMaster is true', () => {
    const tc = new QuartusToolchain();
    const files = tc.scaffold(makeScaffoldContext(), { includeDebugMaster: true });
    const qsys = files['altera/test.qsys'];
    expect(qsys).toContain('kind="altera_jtag_avalon_master"');
    expect(qsys).toContain(
      '<connection kind="avalon" start="jtag_debug_master.master" end="my_ip_0.s_avmm">'
    );
    // The Avalon-MM slave is now internally connected, not top-level exported.
    expect(qsys).not.toContain('my_ip_0_s_avmm');
  });
});

describe('QuartusToolchain subTools', () => {
  let tc: QuartusToolchain;
  beforeEach(() => {
    tc = new QuartusToolchain();
  });

  it('declares qsys-edit as the only sub-tool with ipcraft.qsysEditFound context key', () => {
    expect(tc.subTools).toHaveLength(1);
    expect(tc.subTools[0].name).toBe('qsys-edit');
    expect(tc.subTools[0].contextKey).toBe('ipcraft.qsysEditFound');
  });

  it('isSubToolAvailable returns false for unknown sub-tool names', () => {
    const cfg = makeCfg({ 'quartus.runner': 'local', 'quartus.installDir': '' });
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(tc.isSubToolAvailable('unknown-tool', cfg)).toBe(false);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('isSubToolAvailable returns true when docker runner is configured', () => {
    const cfg = makeCfg({
      'quartus.runner': 'docker',
      'quartus.dockerImage': 'cvsoc/quartus:latest',
    });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(true);
  });

  it('isSubToolAvailable returns false when docker runner has no image', () => {
    const cfg = makeCfg({ 'quartus.runner': 'docker', 'quartus.dockerImage': '' });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(false);
  });

  it('isSubToolAvailable uses findInInstallDir when installDir is set', () => {
    mockFindInInstallDir.mockReturnValue('/opt/intelFPGA/quartus/sopc_builder/bin/qsys-edit');
    const cfg = makeCfg({ 'quartus.runner': 'local', 'quartus.installDir': '/opt/intelFPGA' });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(true);
    expect(mockFindInInstallDir).toHaveBeenCalledWith('qsys-edit', '/opt/intelFPGA');
  });

  it('isSubToolAvailable returns false when installDir is set but tool not found', () => {
    mockFindInInstallDir.mockReturnValue(null);
    const cfg = makeCfg({ 'quartus.runner': 'local', 'quartus.installDir': '/opt/intelFPGA' });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(false);
  });

  it('isSubToolAvailable falls back to PATH check when no installDir or dockerImage', () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    const cfg = makeCfg({
      'quartus.runner': 'local',
      'quartus.installDir': '',
      'quartus.dockerImage': '',
    });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(expect.any(String), ['qsys-edit'], {
      stdio: 'pipe',
    });
  });

  it('isSubToolAvailable returns false when not on PATH', () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    const cfg = makeCfg({
      'quartus.runner': 'local',
      'quartus.installDir': '',
      'quartus.dockerImage': '',
    });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(false);
  });

  it('isSubToolAvailable returns true when dockerImage is set even without docker runner', () => {
    const cfg = makeCfg({
      'quartus.runner': 'local',
      'quartus.installDir': '',
      'quartus.dockerImage': 'cvsoc/quartus:latest',
    });
    expect(tc.isSubToolAvailable('qsys-edit', cfg)).toBe(true);
  });
});

describe('resolveHwTclRtlFiles — compile order', () => {
  const makeIpCore = (filePaths: string[]) => ({
    fileSets: [
      {
        name: 'RTL_Sources',
        files: filePaths.map((p) => ({ path: p, type: 'vhdl' })),
      },
    ],
  });

  it('sorts fileset fallback path into compile order (pkg→regs→core→bus→top)', () => {
    const ipCore = makeIpCore([
      'rtl/dut.vhd',
      'rtl/dut_axil.vhd',
      'rtl/dut_core.vhd',
      'rtl/dut_regs.vhd',
      'rtl/dut_pkg.vhd',
    ]);
    const entries = resolveHwTclRtlFiles(undefined, ipCore as never, false, 'dut');
    const names = entries.map((e) => e.name);
    expect(names[0]).toBe('dut_pkg.vhd');
    expect(names[1]).toBe('dut_regs.vhd');
    expect(names[2]).toBe('dut_core.vhd');
    expect(names[3]).toBe('dut_axil.vhd');
    expect(names[4]).toBe('dut.vhd');
  });

  it('marks only the top-level entity as is_top', () => {
    const ipCore = makeIpCore(['rtl/dut_pkg.vhd', 'rtl/dut.vhd', 'rtl/dut_core.vhd']);
    const entries = resolveHwTclRtlFiles(undefined, ipCore as never, false, 'dut');
    expect(entries.find((e) => e.name === 'dut.vhd')?.is_top).toBe(true);
    expect(entries.find((e) => e.name === 'dut_pkg.vhd')?.is_top).toBe(false);
    expect(entries.find((e) => e.name === 'dut_core.vhd')?.is_top).toBe(false);
  });

  it('uses rtlFiles directly when provided (no sort override)', () => {
    const provided = ['../rtl/dut.vhd', '../rtl/dut_pkg.vhd'];
    const entries = resolveHwTclRtlFiles(provided, {} as never, false, 'dut');
    expect(entries.map((e) => e.path)).toEqual(provided);
  });
});
