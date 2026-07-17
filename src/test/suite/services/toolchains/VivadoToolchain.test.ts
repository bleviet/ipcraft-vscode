import { VivadoToolchain } from '../../../../services/toolchains/VivadoToolchain';
import * as vivadoResolver from '../../../../utils/vivadoResolver';
import * as fsHelpers from '../../../../utils/fsHelpers';
import * as buildRunner from '../../../../services/BuildRunner';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ScaffoldContext } from '../../../../services/toolchains/SynthesisToolchain';
import type { TemplateLoader } from '../../../../generator/TemplateLoader';
import type { IpCoreData } from '../../../../generator/types';

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

describe('VivadoToolchain.scaffold() — RTL file fallback (issue #91)', () => {
  // Real templates.render() isn't needed to prove the fix — only that the
  // project TCL / XDC set receives the same resolved, compile-ordered rtl_files
  // that the built-in component.xml generator resolves, instead of silently
  // falling back to `opts.rtlFiles ?? []` (which was empty whenever the
  // scaffolder hadn't precomputed rtlFiles for this run).
  let tmp: string;
  let renderCalls: Array<{ name: string; ctx: Record<string, unknown> }>;
  let templates: TemplateLoader;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-scaffold-fallback-'));
    fs.writeFileSync(path.join(tmp, 'weird_types.vhd'), 'package internal_types is\nend package;');
    fs.writeFileSync(
      path.join(tmp, 'main_logic.vhd'),
      'use work.internal_types.all;\nentity main_logic is\nend entity;'
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves rtl_files for the project TCL/XDC set from fileSets when opts.rtlFiles is undefined', async () => {
    const ipCoreData = {
      vlnv: { vendor: 'test', library: 'ip', name: 'main_logic', version: '1.0' },
      fileSets: [
        {
          name: 'RTL_Sources',
          // Declared in the wrong order — proves real dependency parsing, not
          // just "whatever opts.rtlFiles happened to contain".
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

    const tc = new VivadoToolchain();
    await tc.scaffold(ctx, {
      includeProject: true,
      rtlFiles: undefined,
      targetPart: 'xc7z020clg484-1',
    });

    const projectCall = renderCalls.find((c) => c.name === 'vivado_project.tcl.j2');
    expect(projectCall).toBeDefined();
    const rtlFiles = projectCall!.ctx.rtl_files as string[];
    expect(rtlFiles).not.toEqual([]);
    expect(rtlFiles.some((f) => f.includes('weird_types.vhd'))).toBe(true);
    expect(rtlFiles.some((f) => f.includes('main_logic.vhd'))).toBe(true);
    // Real dependency order: the package must come before its consumer.
    expect(rtlFiles.findIndex((f) => f.includes('weird_types.vhd'))).toBeLessThan(
      rtlFiles.findIndex((f) => f.includes('main_logic.vhd'))
    );

    // The XDC template shares the same resolved list.
    const xdcCall = renderCalls.find((c) => c.name === 'vivado_ooc.xdc.j2');
    expect(xdcCall!.ctx.rtl_files).toEqual(rtlFiles);
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
