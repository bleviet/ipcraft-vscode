import * as vscode from 'vscode';
import { safeRegisterCommand } from '../../../utils/vscodeHelpers';
import { registerGeneratorCommands } from '../../../commands/GenerateCommands';
import { getActiveIpCoreFile } from '../../../utils/activeIpCoreFile';

jest.mock('../../../utils/vscodeHelpers', () => ({
  safeRegisterCommand: jest.fn(),
}));

// issue #167: pins the exact command-id / requiresWorkspaceTrust surface that
// registerGeneratorCommands exposes today, so splitting the module can't
// silently drop or reorder a command registration.
describe('registerGeneratorCommands registration surface', () => {
  it('registers every command with its current trust requirement', () => {
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const resourceRoots = {
      schemasDir: '/schemas',
      builtinPacksDir: '/packs',
      templatesDir: '/templates',
      busDefinitionsDir: '/bus_definitions',
    };

    registerGeneratorCommands(context, resourceRoots);

    const calls = (safeRegisterCommand as jest.Mock).mock.calls.map(([, command, , options]) => ({
      command,
      requiresWorkspaceTrust: options?.requiresWorkspaceTrust ?? false,
    }));

    expect(calls).toEqual([
      { command: 'fpga-ip-core.generateHdl', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.scaffoldProject', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.exportAltera', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.exportXilinx', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.generateVivadoProject', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.generateQuartusProject', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.generateAndBuildVivado', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.generateAndBuildQuartus', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.generateTestbench', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.generateDocumentation', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.openSettings', requiresWorkspaceTrust: false },
      { command: 'fpga-ip-core.parseVHDL', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.parseHwTcl', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.parseComponentXml', requiresWorkspaceTrust: true },
      { command: 'fpga-ip-core.viewBusDefinitions', requiresWorkspaceTrust: false },
    ]);
  });
});

function setActiveTab(uri: { fsPath: string } | undefined): void {
  const activeTabGroup = vscode.window.tabGroups.activeTabGroup as unknown as {
    activeTab: { input: unknown } | undefined;
  };
  activeTabGroup.activeTab = uri
    ? { input: new vscode.TabInputCustom(uri as vscode.Uri, 'ipcraft.ipCoreEditor') }
    : undefined;
}

describe('getActiveIpCoreFile', () => {
  afterEach(() => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    setActiveTab(undefined);
    (vscode.window.showErrorMessage as jest.Mock).mockClear();
  });

  it('returns the uri silently when the active text editor is an .ip.yml file', () => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { fileName: '/core.ip.yml', uri: { fsPath: '/core.ip.yml' } },
    };

    const result = getActiveIpCoreFile();

    expect(result).toEqual({ fsPath: '/core.ip.yml' });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('errors and returns undefined when the active text editor is not an .ip.yml file, even if an IP-core custom-editor tab is open', () => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { fileName: '/core.vhd', uri: { fsPath: '/core.vhd' } },
    };
    setActiveTab({ fsPath: '/other.ip.yml' });

    const result = getActiveIpCoreFile();

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Active file is not an IP core file (*.ip.yml).'
    );
  });

  it('falls back to an active IP-core custom-editor tab when there is no active text editor', () => {
    setActiveTab({ fsPath: '/core.ip.yml' });

    const result = getActiveIpCoreFile();

    expect(result).toEqual({ fsPath: '/core.ip.yml' });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('errors and returns undefined when nothing active resolves to an .ip.yml file', () => {
    const result = getActiveIpCoreFile();

    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'No active IP core file. Please open a .ip.yml file.'
    );
  });
});
