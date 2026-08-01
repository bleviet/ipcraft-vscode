import * as vscode from 'vscode';
import {
  resolveToolchainVersionForOpen,
  resolveToolchainVersionForCreate,
} from '../../../../services/toolchains/resolveToolchainVersion';
import * as detector from '../../../../services/toolchains/toolchainVersionDetector';
import * as vivadoResolver from '../../../../utils/vivadoResolver';
import * as pickToolVersionModule from '../../../../utils/pickToolVersion';

jest.mock('../../../../services/toolchains/toolchainVersionDetector');
jest.mock('../../../../utils/vivadoResolver');
jest.mock('../../../../utils/pickToolVersion');

function makeCfg(overrides: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
    update: jest.fn().mockResolvedValue(undefined),
  } as unknown as vscode.WorkspaceConfiguration;
}

describe('resolveToolchainVersionForOpen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the pinned version directly without running detection', async () => {
    const cfg = makeCfg({ 'vivado.pinnedVersion': '2024.1' });
    const result = await resolveToolchainVersionForOpen(cfg, 'vivado', '/proj/foo.xpr');
    expect(result).toEqual({ runner: 'local', version: '2024.1' });
    expect(detector.detectVivadoProjectVersion).not.toHaveBeenCalled();
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
});

describe('resolveToolchainVersionForCreate', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the pinned version directly', async () => {
    const cfg = makeCfg({ 'quartus.pinnedVersion': '23.1' });
    expect(await resolveToolchainVersionForCreate(cfg, 'quartus')).toEqual({
      runner: 'local',
      version: '23.1',
    });
    expect(pickToolVersionModule.pickToolVersion).not.toHaveBeenCalled();
  });

  it('opens the QuickPick when nothing is pinned', async () => {
    const cfg = makeCfg({ 'quartus.pinnedVersion': '' });
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
