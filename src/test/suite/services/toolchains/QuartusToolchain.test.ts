import {
  QuartusToolchain,
  quartusDeviceFamily,
  mapBusTypeToAltera,
  resolveHwTclRtlFiles,
  detectPll,
} from '../../../../services/toolchains/QuartusToolchain';
import * as quartusResolver from '../../../../utils/quartusResolver';
import * as fsHelpers from '../../../../utils/fsHelpers';
import * as buildRunner from '../../../../services/BuildRunner';
import * as fsPromises from 'fs/promises';
import * as childProcess from 'child_process';
import * as fs2 from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ScaffoldContext } from '../../../../services/toolchains/SynthesisToolchain';
import type { TemplateLoader } from '../../../../generator/TemplateLoader';
import type { IpCoreData } from '../../../../generator/types';

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

describe('QuartusToolchain.scaffold() — RTL file fallback (issue #91)', () => {
  // Mirrors the equivalent VivadoToolchain test: the project TCL/SDC set must
  // resolve rtl_files from fileSets when opts.rtlFiles is undefined, reusing
  // the same resolved, compile-ordered list as the hw.tcl fileset section —
  // not silently falling back to `opts.rtlFiles ?? []`.
  let tmp: string;
  let renderCalls: Array<{ name: string; ctx: Record<string, unknown> }>;
  let templates: TemplateLoader;

  beforeEach(() => {
    tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-quartus-scaffold-fallback-'));
    fs2.writeFileSync(path.join(tmp, 'weird_types.vhd'), 'package internal_types is\nend package;');
    fs2.writeFileSync(
      path.join(tmp, 'main_logic.vhd'),
      'use work.internal_types.all;\nentity main_logic is\nend entity;'
    );
    // jest.mock('fs/promises') at the top of this file replaces the real module with
    // auto-mocks, so resolveFileSetRtlFiles's fs.readFile calls need an explicit real
    // implementation to read the real temp files written above.
    (fsPromises.readFile as jest.Mock).mockImplementation((p: string) =>
      Promise.resolve(fs2.readFileSync(p, 'utf8'))
    );
    renderCalls = [];
    templates = {
      hasTemplate: jest.fn().mockReturnValue(false),
      render: jest.fn((name: string, ctx: Record<string, unknown>) => {
        renderCalls.push({ name, ctx });
        return '';
      }),
    } as unknown as TemplateLoader;
  });

  afterEach(() => {
    fs2.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves rtl_files for the project TCL/SDC from fileSets when opts.rtlFiles is undefined', async () => {
    const ipCoreData = {
      vlnv: { vendor: 'test', library: 'ip', name: 'main_logic', version: '1.0' },
      fileSets: [
        {
          name: 'RTL_Sources',
          // Declared in the wrong order — proves real dependency parsing.
          files: [
            { path: 'main_logic.vhd', type: 'vhdl' },
            { path: 'weird_types.vhd', type: 'vhdl' },
          ],
        },
      ],
    } as unknown as IpCoreData;

    const ctx: ScaffoldContext = {
      name: 'main_logic',
      templateContext: {},
      templates,
      ipCoreData,
      busDefinitions: {},
      isSv: false,
      memoryMaps: [],
      ipCoreDir: tmp,
    };

    const tc = new QuartusToolchain();
    await tc.scaffold(ctx, {
      includeProject: true,
      rtlFiles: undefined,
      quartusDevice: '5CSEBA6U23I7',
    });

    const hwTclCall = renderCalls.find((c) => c.name === 'altera_hw_tcl.j2');
    const hwTclRtlFiles = (hwTclCall!.ctx.rtl_files as Array<{ path: string }>).map((f) => f.path);

    const projectCall = renderCalls.find((c) => c.name === 'quartus_project.tcl.j2');
    expect(projectCall).toBeDefined();
    const rtlFiles = projectCall!.ctx.rtl_files as string[];
    expect(rtlFiles).not.toEqual([]);
    expect(rtlFiles.some((f) => f.includes('weird_types.vhd'))).toBe(true);
    expect(rtlFiles.some((f) => f.includes('main_logic.vhd'))).toBe(true);
    expect(rtlFiles.findIndex((f) => f.includes('weird_types.vhd'))).toBeLessThan(
      rtlFiles.findIndex((f) => f.includes('main_logic.vhd'))
    );
    // Same resolved order that fed the hw.tcl fileset section.
    expect(rtlFiles).toEqual(hwTclRtlFiles);

    const sdcCall = renderCalls.find((c) => c.name === 'quartus_sdc.j2');
    expect(sdcCall!.ctx.rtl_files).toEqual(rtlFiles);
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

  // jest.mock('fs/promises') above replaces the real module with auto-mocks, so
  // resolveFileSetRtlFiles's fs.readFile calls need an explicit real implementation
  // here — this test exercises genuine file content instead of the filename-suffix
  // heuristic the previous version of this fallback relied on. jest config sets
  // resetMocks: true, so this implementation doesn't need manual teardown.
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  function writeFile(relPath: string, content: string) {
    const full = path.join(tmp, relPath);
    fs2.mkdirSync(path.dirname(full), { recursive: true });
    fs2.writeFileSync(full, content);
  }

  it('sorts the fileset fallback into real dependency order, defeating a naming-heuristic mis-sort', async () => {
    tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-quartus-order-'));
    (fsPromises.readFile as jest.Mock).mockImplementation((p: string) =>
      Promise.resolve(fs2.readFileSync(p, 'utf8'))
    );

    // Declared — and named — in the wrong order: 'main_logic.vhd' sorts alphabetically
    // before 'weird_types.vhd' and neither matches a _pkg/_regs/_core/_bus naming
    // convention, so any filename-suffix heuristic would leave them in this (broken)
    // order. main_logic actually `use work`s the package weird_types declares.
    writeFile(
      'rtl/main_logic.vhd',
      [
        'library ieee;',
        'use ieee.std_logic_1164.all;',
        'use work.weird_types_pkg.all;',
        '',
        'entity main_logic is',
        '  port (clk : in std_logic);',
        'end entity main_logic;',
        '',
        'architecture rtl of main_logic is',
        'begin',
        'end architecture rtl;',
      ].join('\n')
    );
    writeFile(
      'rtl/weird_types.vhd',
      [
        'package weird_types_pkg is',
        '  type my_type is (a, b, c);',
        'end package weird_types_pkg;',
      ].join('\n')
    );

    const ipCore = makeIpCore(['rtl/main_logic.vhd', 'rtl/weird_types.vhd']);
    const entries = await resolveHwTclRtlFiles(
      undefined,
      ipCore as never,
      false,
      'main_logic',
      tmp
    );
    expect(entries.map((e) => e.name)).toEqual(['weird_types.vhd', 'main_logic.vhd']);
  });

  it('marks only the top-level entity as is_top', async () => {
    const ipCore = makeIpCore(['rtl/dut_pkg.vhd', 'rtl/dut.vhd', 'rtl/dut_core.vhd']);
    const entries = await resolveHwTclRtlFiles(undefined, ipCore as never, false, 'dut', undefined);
    expect(entries.find((e) => e.name === 'dut.vhd')?.is_top).toBe(true);
    expect(entries.find((e) => e.name === 'dut_pkg.vhd')?.is_top).toBe(false);
    expect(entries.find((e) => e.name === 'dut_core.vhd')?.is_top).toBe(false);
  });

  it('uses rtlFiles directly when provided (no sort override)', async () => {
    const provided = ['../rtl/dut.vhd', '../rtl/dut_pkg.vhd'];
    const entries = await resolveHwTclRtlFiles(provided, {} as never, false, 'dut', undefined);
    expect(entries.map((e) => e.path)).toEqual(provided);
  });

  it('preserves the declared fileSets order when ipCoreDir is not provided (degrade, no heuristic tiebreak)', async () => {
    // Deliberately out of dependency order (core before pkg): with no ipCoreDir to read
    // real content from, the fallback must not reorder via any naming heuristic — it
    // preserves exactly what the user declared.
    const ipCore = makeIpCore(['rtl/dut_core.vhd', 'rtl/dut_pkg.vhd', 'rtl/dut.vhd']);
    const entries = await resolveHwTclRtlFiles(undefined, ipCore as never, false, 'dut', undefined);
    expect(entries.map((e) => e.name)).toEqual(['dut_core.vhd', 'dut_pkg.vhd', 'dut.vhd']);
  });
});

describe('detectPll — issue #77', () => {
  // quartus_sdc.j2 used to emit `derive_pll_clocks -create_base_clocks` on
  // every design even when no PLL was instantiated (Quartus then warns the
  // command is ignored). detectPll() is the gate: it returns true when any
  // RTL or fileSet path contains "pll" (case-insensitive) so the SDC only
  // carries the command for designs that actually have a PLL.
  it('returns false when no path contains "pll"', () => {
    expect(detectPll(['rtl/dut.vhd', 'rtl/dut_core.sv'], {} as never)).toBe(false);
  });

  it('returns true when an rtlFiles path contains "pll" (case-insensitive)', () => {
    expect(detectPll(['rtl/dut.vhd', 'rtl/my_PLL.sv'], {} as never)).toBe(true);
    expect(detectPll(['rtl/dut.vhd', 'rtl/pll_clock_gen.vhd'], {} as never)).toBe(true);
  });

  it('returns true when a fileSets entry path contains "pll"', () => {
    const ipCore = {
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/dut.vhd', type: 'vhdl' },
            { path: 'altera/my_pll.qip', type: 'unknown' },
          ],
        },
      ],
    };
    expect(detectPll(undefined, ipCore as never)).toBe(true);
  });

  it('returns false for an empty design (no rtlFiles, no fileSets)', () => {
    expect(detectPll(undefined, {} as never)).toBe(false);
    expect(detectPll([], {} as never)).toBe(false);
  });

  it('matches "pll" anywhere in the path (substring match, case-insensitive)', () => {
    expect(detectPll(['rtl/clock_pll_gen.vhd'], {} as never)).toBe(true);
    expect(detectPll(['rtl/PLL_WRAPPER.vhd'], {} as never)).toBe(true);
    expect(detectPll(['altera/altera_pll.qip'], {} as never)).toBe(true);
  });
});
