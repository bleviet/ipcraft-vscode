import * as vscode from 'vscode';
import {
  resolveToolchainVersionForOpen,
  resolveToolchainVersionForCreate,
} from '../../../../services/toolchains/resolveToolchainVersion';
import * as detector from '../../../../services/toolchains/toolchainVersionDetector';
import * as vivadoResolver from '../../../../utils/vivadoResolver';
import * as quartusResolver from '../../../../utils/quartusResolver';
import * as pickToolVersionModule from '../../../../utils/pickToolVersion';

jest.mock('../../../../services/toolchains/toolchainVersionDetector');
jest.mock('../../../../utils/vivadoResolver');
jest.mock('../../../../utils/quartusResolver');
// Only the QuickPick is mocked — listConfiguredVersions stays real so these
// tests exercise the same install-dir resolution the production path uses.
jest.mock('../../../../utils/pickToolVersion', () => ({
  ...jest.requireActual<typeof import('../../../../utils/pickToolVersion')>(
    '../../../../utils/pickToolVersion'
  ),
  pickToolVersion: jest.fn(),
}));

function makeCfg(overrides: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
    update: jest.fn().mockResolvedValue(undefined),
  } as unknown as vscode.WorkspaceConfiguration;
}

describe('resolveToolchainVersionForOpen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (vscode.window as unknown as { showOpenDialog?: unknown }).showOpenDialog;
  });

  it('uses the pinned version directly without running detection', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '2024.1', 'vivado.installDirs': ['/x'] });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2024.1', installDir: '/x/2024.1', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');
    expect(result).toEqual({ runner: 'local', version: '2024.1' });
    expect(detector.detectVivadoProjectVersion).not.toHaveBeenCalled();
  });

  it('ignores a pinned version that is no longer configured and falls through to detection', async () => {
    // A stale pin (uninstalled version) must never silently resolve to some
    // other install — detection/picking decides instead.
    const cfg = makeCfg({ 'vivado.pinnedVersion': '2019.1', 'vivado.installDirs': ['/x'] });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2024.2', installDir: '/x/2024.2', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(detector.detectVivadoProjectVersion).toHaveBeenCalled();
    expect(result).toEqual({ runner: 'local', version: '2024.2' });
  });

  it('returns null (fall back to legacy/PATH) when nothing is configured', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': [] });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([]);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(result).toBeNull();
    expect(detector.detectVivadoProjectVersion).not.toHaveBeenCalled();
    expect(pickToolVersionModule.pickToolVersion).not.toHaveBeenCalled();
  });

  it('returns the docker choice when the vendor runner is docker', async () => {
    // listConfiguredVersions is runner-aware, so a docker-configured version
    // resolves with runner: 'docker', not a hardcoded 'local'.
    const cfg = makeCfg({
      'vivado.pinnedVersion': '',
      'vivado.runner': 'docker',
      'vivado.dockerImages': [{ label: '2024.2', image: 'my/vivado:2024.2' }],
    });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(result).toEqual({ runner: 'docker', version: '2024.2' });
  });

  it('launches with a toast when the exact detected version is configured', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/x'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2024.2', installDir: '/x/2024.2', launcher: { exe: 'vivado', prefixArgs: [] } },
    ]);
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');
    expect(result).toEqual({ runner: 'local', version: '2024.2' });
  });

  it('opens the QuickPick, pre-filtered to required candidates, when ambiguous', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/x', '/y'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'ambiguous',
      candidates: ['2024.1', '2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2024.1', installDir: '/x', launcher: { exe: 'a', prefixArgs: [] } },
      { version: '2024.2', installDir: '/y', launcher: { exe: 'b', prefixArgs: [] } },
    ]);
    (pickToolVersionModule.pickToolVersion as jest.Mock).mockResolvedValue({
      runner: 'local',
      version: '2024.2',
    });

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');
    expect(pickToolVersionModule.pickToolVersion).toHaveBeenCalledWith(cfg, 'vivado', [
      '2024.1',
      '2024.2',
    ]);
    expect(result).toEqual({ runner: 'local', version: '2024.2' });
  });

  it('uses the closest configured version when the user picks "Use <closest> anyway"', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/old'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2023.1', installDir: '/old', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    const showWarningMessage = jest
      .spyOn(vscode.window, 'showWarningMessage')
      .mockResolvedValue('Use 2023.1 anyway' as unknown as undefined);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(showWarningMessage).toHaveBeenCalledWith(
      'Vivado 2024.2 is required but not configured.',
      'Use 2023.1 anyway',
      'Browse for install dir…',
      'Configure paths'
    );
    expect(result).toEqual({ runner: 'local', version: '2023.1' });
  });

  it('never substitutes a version when the user dismisses the warning', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/old'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2023.1', installDir: '/old', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    jest.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(result).toBeUndefined();
  });

  it('opens settings and returns undefined when the user picks "Configure paths"', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/old'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2023.1', installDir: '/old', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    jest
      .spyOn(vscode.window, 'showWarningMessage')
      .mockResolvedValue('Configure paths' as unknown as undefined);
    const executeCommand = jest
      .spyOn(vscode.commands, 'executeCommand')
      .mockResolvedValue(undefined);

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      'ipcraft.vivado.installDirs'
    );
    expect(result).toBeUndefined();
  });

  it('browses for an install dir, appends it, and re-invokes the picker filtered to the required version', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/old'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2023.1', installDir: '/old', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    jest
      .spyOn(vscode.window, 'showWarningMessage')
      .mockResolvedValue('Browse for install dir…' as unknown as undefined);
    const showOpenDialog = jest.fn().mockResolvedValue([{ fsPath: '/new/install' }]);
    (vscode.window as unknown as { showOpenDialog: jest.Mock }).showOpenDialog = showOpenDialog;
    const freshCfg = {
      get: jest.fn(),
      update: jest.fn(),
    } as unknown as vscode.WorkspaceConfiguration;
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(freshCfg);
    (pickToolVersionModule.pickToolVersion as jest.Mock).mockResolvedValue({
      runner: 'local',
      version: '2024.2',
    });

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(cfg.update).toHaveBeenCalledWith(
      'vivado.installDirs',
      ['/old', '/new/install'],
      vscode.ConfigurationTarget.Workspace
    );
    expect(pickToolVersionModule.pickToolVersion).toHaveBeenCalledWith(freshCfg, 'vivado', [
      '2024.2',
    ]);
    expect(result).toEqual({ runner: 'local', version: '2024.2' });
  });

  it('does not touch installDirs or the picker when the browse dialog is cancelled', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '', 'vivado.installDirs': ['/old'] });
    (detector.detectVivadoProjectVersion as jest.Mock).mockResolvedValue({
      confidence: 'exact',
      candidates: ['2024.2'],
      source: 'project-file',
    });
    (vivadoResolver.resolveVivadoVersions as jest.Mock).mockReturnValue([
      { version: '2023.1', installDir: '/old', launcher: { exe: 'a', prefixArgs: [] } },
    ]);
    jest
      .spyOn(vscode.window, 'showWarningMessage')
      .mockResolvedValue('Browse for install dir…' as unknown as undefined);
    const showOpenDialog = jest.fn().mockResolvedValue(undefined);
    (vscode.window as unknown as { showOpenDialog: jest.Mock }).showOpenDialog = showOpenDialog;

    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');

    expect(result).toBeUndefined();
    expect(cfg.update).not.toHaveBeenCalled();
    expect(pickToolVersionModule.pickToolVersion).not.toHaveBeenCalled();
  });
});

describe('resolveToolchainVersionForCreate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the pinned version directly', async () => {
    const cfg = makeCfg({ 'quartus.pinnedVersion': '23.1', 'quartus.installDirs': ['/q'] });
    (quartusResolver.resolveQuartusVersions as jest.Mock).mockReturnValue([
      { version: '23.1', installDir: '/q/23.1' },
    ]);
    expect(await resolveToolchainVersionForCreate(cfg, 'quartus')).toEqual({
      runner: 'local',
      version: '23.1',
    });
    expect(pickToolVersionModule.pickToolVersion).not.toHaveBeenCalled();
  });

  it('ignores a pinned version that is no longer configured and opens the QuickPick', async () => {
    const cfg = makeCfg({ 'quartus.pinnedVersion': '20.1', 'quartus.installDirs': ['/q'] });
    (quartusResolver.resolveQuartusVersions as jest.Mock).mockReturnValue([
      { version: '23.1', installDir: '/q/23.1' },
    ]);
    (pickToolVersionModule.pickToolVersion as jest.Mock).mockResolvedValue({
      runner: 'local',
      version: '23.1',
    });
    expect(await resolveToolchainVersionForCreate(cfg, 'quartus')).toEqual({
      runner: 'local',
      version: '23.1',
    });
    expect(pickToolVersionModule.pickToolVersion).toHaveBeenCalledWith(cfg, 'quartus');
  });

  it('returns null (fall back to legacy/PATH) when nothing is configured', async () => {
    const cfg = makeCfg({ 'quartus.pinnedVersion': '', 'quartus.installDirs': [] });
    (quartusResolver.resolveQuartusVersions as jest.Mock).mockReturnValue([]);
    expect(await resolveToolchainVersionForCreate(cfg, 'quartus')).toBeNull();
    expect(pickToolVersionModule.pickToolVersion).not.toHaveBeenCalled();
  });

  it('opens the QuickPick when nothing is pinned', async () => {
    const cfg = makeCfg({ 'quartus.pinnedVersion': '', 'quartus.installDirs': ['/q'] });
    (quartusResolver.resolveQuartusVersions as jest.Mock).mockReturnValue([
      { version: '23.1', installDir: '/q/23.1' },
    ]);
    (pickToolVersionModule.pickToolVersion as jest.Mock).mockResolvedValue({
      runner: 'local',
      version: '23.1',
    });
    expect(await resolveToolchainVersionForCreate(cfg, 'quartus')).toEqual({
      runner: 'local',
      version: '23.1',
    });
    expect(pickToolVersionModule.pickToolVersion).toHaveBeenCalledWith(cfg, 'quartus');
  });
});
