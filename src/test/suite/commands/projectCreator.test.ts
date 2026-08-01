import * as vscode from 'vscode';
import { createVendorProject } from '../../../commands/projectCreator';
import * as registry from '../../../services/toolchains/registry';
import { CONFIG_KEY_IPCRAFT } from '../../../utils/configKeys';

jest.mock('../../../services/toolchains/registry');

const mockGetToolchain = registry.getToolchain as jest.Mock;
const mockCreateProject = jest.fn();
const outputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel;

describe('createVendorProject', () => {
  beforeEach(() => {
    mockGetToolchain.mockReturnValue({ createProject: mockCreateProject });
    mockCreateProject.mockResolvedValue(true);
  });

  it('uses the supplied resource-scoped configuration rather than looking up an unscoped one', async () => {
    const scopedCfg = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;

    await expect(
      createVendorProject('vivado', 'foo', '/workspace-a/ip', outputChannel, '2024.2', scopedCfg)
    ).resolves.toBe(true);

    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
    expect(mockCreateProject).toHaveBeenCalledWith(
      'foo',
      '/workspace-a/ip',
      scopedCfg,
      outputChannel,
      '2024.2'
    );
  });

  it('keeps the legacy unscoped lookup for existing callers without a configuration', async () => {
    const legacyCfg = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(legacyCfg);

    await createVendorProject('vivado', 'foo', '/ip', outputChannel);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(CONFIG_KEY_IPCRAFT);
    expect(mockCreateProject).toHaveBeenCalledWith(
      'foo',
      '/ip',
      legacyCfg,
      outputChannel,
      undefined
    );
  });
});
