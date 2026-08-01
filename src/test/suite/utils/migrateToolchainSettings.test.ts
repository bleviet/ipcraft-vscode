import * as vscode from 'vscode';
import { migrateToolchainSettings } from '../../../utils/migrateToolchainSettings';

function makeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: jest.fn((key: string) => store.get(key)),
      update: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    },
  } as unknown as vscode.ExtensionContext;
}

describe('migrateToolchainSettings', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    updateMock = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: jest.fn((key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          'vivado.installDir': '/tools/Xilinx/Vivado/2024.2',
          'vivado.installDirs': [],
          'vivado.dockerImage': '',
          'vivado.dockerImages': [],
          'quartus.installDir': '',
          'quartus.installDirs': [],
          'quartus.dockerImage': '',
          'quartus.dockerImages': [],
        };
        return values[key] ?? def;
      }),
      update: updateMock,
    } as unknown as vscode.WorkspaceConfiguration);
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('folds a set legacy installDir into installDirs when the array is empty', async () => {
    await migrateToolchainSettings(makeContext());
    expect(updateMock).toHaveBeenCalledWith(
      'vivado.installDirs',
      ['/tools/Xilinx/Vivado/2024.2'],
      vscode.ConfigurationTarget.Global
    );
  });

  it('does not touch quartus.installDirs when the legacy setting is empty', async () => {
    await migrateToolchainSettings(makeContext());
    expect(updateMock).not.toHaveBeenCalledWith(
      'quartus.installDirs',
      expect.anything(),
      expect.anything()
    );
  });

  it('runs only once per install', async () => {
    const context = makeContext();
    await migrateToolchainSettings(context);
    updateMock.mockClear();
    await migrateToolchainSettings(context);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('folds a set legacy dockerImage into dockerImages, deriving the label from the image tag', async () => {
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: jest.fn((key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          'vivado.installDir': '',
          'vivado.installDirs': [],
          'vivado.dockerImage': 'cvsoc/vivado:2024.2',
          'vivado.dockerImages': [],
          'quartus.installDir': '',
          'quartus.installDirs': [],
          'quartus.dockerImage': '',
          'quartus.dockerImages': [],
        };
        return values[key] ?? def;
      }),
      update: updateMock,
    } as unknown as vscode.WorkspaceConfiguration);

    await migrateToolchainSettings(makeContext());
    expect(updateMock).toHaveBeenCalledWith(
      'vivado.dockerImages',
      [{ label: '2024.2', image: 'cvsoc/vivado:2024.2' }],
      vscode.ConfigurationTarget.Global
    );
  });

  it('falls back to the whole image reference as the label when it has no tag', async () => {
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: jest.fn((key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          'vivado.installDir': '',
          'vivado.installDirs': [],
          'vivado.dockerImage': 'my-custom-vivado-image',
          'vivado.dockerImages': [],
          'quartus.installDir': '',
          'quartus.installDirs': [],
          'quartus.dockerImage': '',
          'quartus.dockerImages': [],
        };
        return values[key] ?? def;
      }),
      update: updateMock,
    } as unknown as vscode.WorkspaceConfiguration);

    await migrateToolchainSettings(makeContext());
    expect(updateMock).toHaveBeenCalledWith(
      'vivado.dockerImages',
      [{ label: 'my-custom-vivado-image', image: 'my-custom-vivado-image' }],
      vscode.ConfigurationTarget.Global
    );
  });

  it('migrates both installDir and dockerImage independently when both are legacy-set', async () => {
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: jest.fn((key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          'vivado.installDir': '/tools/Xilinx/Vivado/2024.2',
          'vivado.installDirs': [],
          'vivado.dockerImage': 'cvsoc/vivado:2024.2',
          'vivado.dockerImages': [],
          'quartus.installDir': '',
          'quartus.installDirs': [],
          'quartus.dockerImage': '',
          'quartus.dockerImages': [],
        };
        return values[key] ?? def;
      }),
      update: updateMock,
    } as unknown as vscode.WorkspaceConfiguration);

    await migrateToolchainSettings(makeContext());
    expect(updateMock).toHaveBeenCalledWith(
      'vivado.installDirs',
      ['/tools/Xilinx/Vivado/2024.2'],
      vscode.ConfigurationTarget.Global
    );
    expect(updateMock).toHaveBeenCalledWith(
      'vivado.dockerImages',
      [{ label: '2024.2', image: 'cvsoc/vivado:2024.2' }],
      vscode.ConfigurationTarget.Global
    );
  });

  it('never overwrites an already-populated dockerImages array', async () => {
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: jest.fn((key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          'vivado.installDir': '',
          'vivado.installDirs': [],
          'vivado.dockerImage': 'cvsoc/vivado:2024.2',
          'vivado.dockerImages': [{ label: 'existing', image: 'foo/bar:1' }],
          'quartus.installDir': '',
          'quartus.installDirs': [],
          'quartus.dockerImage': '',
          'quartus.dockerImages': [],
        };
        return values[key] ?? def;
      }),
      update: updateMock,
    } as unknown as vscode.WorkspaceConfiguration);

    await migrateToolchainSettings(makeContext());
    expect(updateMock).not.toHaveBeenCalledWith(
      'vivado.dockerImages',
      expect.anything(),
      expect.anything()
    );
  });

  it('never overwrites an already-populated installDirs array', async () => {
    jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: jest.fn((key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          'vivado.installDir': '/tools/Xilinx/Vivado/2024.2',
          'vivado.installDirs': ['/tools/Xilinx/Vivado/2025.1'],
          'quartus.installDir': '',
          'quartus.installDirs': [],
        };
        return values[key] ?? def;
      }),
      update: updateMock,
    } as unknown as vscode.WorkspaceConfiguration);

    await migrateToolchainSettings(makeContext());
    expect(updateMock).not.toHaveBeenCalledWith(
      'vivado.installDirs',
      expect.anything(),
      expect.anything()
    );
  });
});
