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
import * as detector from '../../../../services/toolchains/toolchainVersionDetector';

jest.mock('../../../../utils/vivadoResolver');
jest.mock('../../../../utils/fsHelpers');
jest.mock('../../../../services/BuildRunner');
jest.mock('child_process');
jest.mock('../../../../services/toolchains/toolchainVersionDetector');

const mockFindVivado = vivadoResolver.findVivadoInInstallDir as jest.Mock;
const mockGetLauncher = vivadoResolver.getVivadoLauncher as jest.Mock;
const mockResolveVivadoVersions = vivadoResolver.resolveVivadoVersions as jest.Mock;
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
    expect(mockGetLauncher).toHaveBeenCalledWith(cfg, undefined);
  });

  it('resolve() forwards preferredVersion to getVivadoLauncher', () => {
    const expected = { exe: '/opt/2024.1/bin/vivado', prefixArgs: [] };
    mockGetLauncher.mockReturnValue(expected);
    const cfg = makeCfg();
    expect(tc.resolve('any', cfg, '2024.1')).toBe(expected);
    expect(mockGetLauncher).toHaveBeenCalledWith(cfg, '2024.1');
  });

  it('isAvailable() returns true when docker runner is configured with image', () => {
    const cfg = makeCfg({ 'vivado.runner': 'docker', 'vivado.dockerImage': 'my/vivado:latest' });
    expect(tc.isAvailable(cfg)).toBe(true);
  });

  it('isAvailable() returns false when docker runner has no image', () => {
    const cfg = makeCfg({ 'vivado.runner': 'docker', 'vivado.dockerImage': '' });
    expect(tc.isAvailable(cfg)).toBe(false);
  });

  it('isAvailable() returns true when dockerImages is populated for the docker runner', () => {
    const cfg = makeCfg({
      'vivado.runner': 'docker',
      'vivado.dockerImages': [{ label: '2024.2', image: 'my/vivado:2024.2' }],
      'vivado.dockerImage': '',
    });
    expect(tc.isAvailable(cfg)).toBe(true);
  });

  it('isAvailable() returns true when installDirs resolves at least one version', () => {
    mockResolveVivadoVersions.mockReturnValue([{ version: '2024.2', installDir: '/opt/2024.2' }]);
    const cfg = makeCfg({ 'vivado.runner': 'local', 'vivado.installDirs': ['/opt/xilinx'] });
    expect(tc.isAvailable(cfg)).toBe(true);
    expect(mockResolveVivadoVersions).toHaveBeenCalledWith(['/opt/xilinx']);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('isAvailable() returns false when installDirs is set but nothing resolves', () => {
    mockResolveVivadoVersions.mockReturnValue([]);
    mockSpawnSync.mockReturnValue({ status: 0 });
    const cfg = makeCfg({ 'vivado.runner': 'local', 'vivado.installDirs': ['/nope'] });
    // installDirs is authoritative once set — it does not silently fall through
    // to the legacy installDir/PATH probe.
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

  it('getDocker() picks the dockerImages entry matching preferredVersion', () => {
    const cfg = makeCfg({
      'vivado.runner': 'docker',
      'vivado.dockerImages': [
        { label: '2024.1', image: 'my/vivado:2024.1' },
        { label: '2024.2', image: 'my/vivado:2024.2' },
      ],
    });
    expect(tc.getDocker(cfg, '/work', '2024.1')).toEqual({
      image: 'my/vivado:2024.1',
      mountBase: '/work',
    });
  });

  it('getDocker() falls back to the legacy singular dockerImage when dockerImages is empty', () => {
    const cfg = makeCfg({ 'vivado.runner': 'docker', 'vivado.dockerImage': 'my/vivado:latest' });
    expect(tc.getDocker(cfg, '/work')).toEqual({ image: 'my/vivado:latest', mountBase: '/work' });
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

    it('uses the container-native vivado executable for Docker project creation', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetLauncher.mockReturnValue({ exe: '/host/xilinx/bin/vivado', prefixArgs: [] });
      mockRunProcess.mockResolvedValue({ success: true });
      const cfg = makeCfg({
        'vivado.runner': 'docker',
        'vivado.dockerImages': [{ label: '2024.2', image: 'example/vivado:2024.2' }],
      });

      await tc.createProject('my_ip', '/ip', cfg, outputChannel, '2024.2');

      expect(mockGetLauncher).not.toHaveBeenCalled();
      expect(mockRunProcess).toHaveBeenCalledWith(
        'vivado',
        expect.arrayContaining(['-mode', 'batch']),
        expect.objectContaining({ docker: { image: 'example/vivado:2024.2', mountBase: '/ip' } })
      );
    });

    it('createProject() writes the sidecar after a successful run, when preferredVersion is given', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetLauncher.mockReturnValue({ exe: 'vivado', prefixArgs: [] });
      mockRunProcess.mockResolvedValue({ success: true, exitCode: 0 });
      const cfg = makeCfg();
      const outputChannel = { appendLine: jest.fn() } as unknown as import('vscode').OutputChannel;

      const ok = await tc.createProject('foo', '/ip', cfg, outputChannel, '2024.2');

      expect(ok).toBe(true);
      // The .xpr lands in xilinx/build/ooc/ (see vivado_project.tcl.j2), and
      // detectVivadoProjectVersion() reads the sidecar from the .xpr's own
      // directory — so it must be written there, not in xilinx/.
      expect(detector.writeSidecar).toHaveBeenCalledWith(
        path.join('/ip', 'xilinx', 'build', 'ooc'),
        {
          vendor: 'vivado',
          version: '2024.2',
          sourcePath: expect.stringContaining('vivado'),
        }
      );
    });

    it('writes the sidecar where detectVivadoProjectVersion() actually reads it (cross-module)', async () => {
      // Regression guard for the write-side/read-side path mismatch: the
      // toolchain wrote the sidecar to xilinx/ while the detector looked for it
      // next to the .xpr (xilinx/build/ooc/), so auto-detection was dead code.
      // This test takes whatever directory createProject() chose and proves the
      // REAL detector finds a real sidecar written there.
      const realDetector = jest.requireActual<typeof detector>(
        '../../../../services/toolchains/toolchainVersionDetector'
      );
      const ipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-sidecar-'));
      try {
        mockFileExists.mockResolvedValue(true);
        mockGetLauncher.mockReturnValue({ exe: '/opt/2024.2/bin/vivado', prefixArgs: [] });
        mockRunProcess.mockResolvedValue({ success: true });

        await tc.createProject('foo', ipDir, makeCfg(), outputChannel, '2024.2');

        // Where createProject() decided to put the sidecar…
        const sidecarDir = (detector.writeSidecar as jest.Mock).mock.calls[0][0] as string;
        fs.mkdirSync(sidecarDir, { recursive: true });
        await realDetector.writeSidecar(sidecarDir, {
          vendor: 'vivado',
          version: '2024.2',
          sourcePath: '/opt/2024.2/bin/vivado',
        });

        // …versus where vivado_project.tcl.j2 actually creates the .xpr
        // (project_dir = $script_dir/build/ooc). These must agree.
        const xprDir = path.join(ipDir, 'xilinx', 'build', 'ooc');
        fs.mkdirSync(xprDir, { recursive: true });
        const xprPath = path.join(xprDir, 'foo.xpr');
        fs.writeFileSync(xprPath, '<Project Version="7" Minor="0">', 'utf8');
        expect(await realDetector.detectVivadoProjectVersion(xprPath)).toEqual({
          confidence: 'exact',
          candidates: ['2024.2'],
          source: 'sidecar',
        });
      } finally {
        fs.rmSync(ipDir, { recursive: true, force: true });
      }
    });

    it('createProject() does not write a sidecar when preferredVersion is omitted', async () => {
      mockFileExists.mockResolvedValue(true);
      mockGetLauncher.mockReturnValue({ exe: 'vivado', prefixArgs: [] });
      mockRunProcess.mockResolvedValue({ success: true, exitCode: 0 });
      const cfg = makeCfg();
      const outputChannel = { appendLine: jest.fn() } as unknown as import('vscode').OutputChannel;

      await tc.createProject('foo', '/ip', cfg, outputChannel);

      expect(detector.writeSidecar).not.toHaveBeenCalled();
    });
  });

  describe('detectBuildModes()', () => {
    const outputChannel = { appendLine: jest.fn() } as unknown as import('vscode').OutputChannel;

    it('describes the OOC project file used for version detection', async () => {
      mockFileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      mockGetLauncher.mockReturnValue({ exe: 'vivado', prefixArgs: [] });

      const [mode] = await tc.detectBuildModes('foo', '/ip', makeCfg(), outputChannel);

      expect(mode).toEqual(
        expect.objectContaining({
          vendor: 'vivado',
          projectFilePath: path.join('/ip', 'xilinx', 'build', 'ooc', 'foo.xpr'),
        })
      );
    });

    it('uses the detection-time preferred version for a local build', async () => {
      mockFileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      mockGetLauncher.mockReturnValue({ exe: '/opt/2023.2/bin/vivado', prefixArgs: [] });
      mockRunProcess.mockResolvedValue({ success: false });
      const cfg = makeCfg({ 'vivado.runner': 'local' });
      const [mode] = await tc.detectBuildModes('foo', '/ip', cfg, outputChannel, '2023.2');

      await mode.run();

      expect(mockGetLauncher).toHaveBeenLastCalledWith(cfg, '2023.2');
      expect(mockRunProcess).toHaveBeenCalledWith(
        '/opt/2023.2/bin/vivado',
        expect.any(Array),
        expect.objectContaining({ docker: undefined })
      );
    });

    it('uses the container command with the preferred Docker image', async () => {
      mockFileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      mockGetLauncher.mockReturnValue({ exe: '/opt/2023.2/bin/vivado', prefixArgs: [] });
      mockRunProcess.mockResolvedValue({ success: false });
      const cfg = makeCfg({
        'vivado.runner': 'docker',
        'vivado.installDirs': ['/opt/Xilinx'],
        'vivado.dockerImages': [
          { label: '2024.1', image: 'vivado:2024.1' },
          { label: '2023.2', image: 'vivado:2023.2' },
        ],
      });
      const [mode] = await tc.detectBuildModes('foo', '/ip', cfg, outputChannel);

      await (mode.run as (preferredVersion?: string) => Promise<unknown>)('2023.2');

      expect(mockRunProcess).toHaveBeenCalledWith(
        'vivado',
        expect.any(Array),
        expect.objectContaining({
          docker: { image: 'vivado:2023.2', mountBase: '/ip' },
        })
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
