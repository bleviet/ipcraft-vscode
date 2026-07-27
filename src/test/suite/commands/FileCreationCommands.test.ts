import * as vscode from 'vscode';
import {
  createIpCoreCommand,
  createIpCoreWithMemoryMapCommand,
  createMemoryMapCommand,
} from '../../../commands/FileCreationCommands';

const workspaceUri = { fsPath: '/workspace' } as vscode.Uri;

function uri(fsPath: string): vscode.Uri {
  return { fsPath, toString: () => fsPath } as vscode.Uri;
}

describe('file creation command filenames', () => {
  beforeEach(() => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [{ uri: workspaceUri }];
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
    (
      vscode.window.tabGroups.activeTabGroup as unknown as {
        activeTab?: unknown;
      }
    ).activeTab = undefined;

    (vscode.Uri.joinPath as jest.Mock).mockImplementation((base: vscode.Uri, filename: string) =>
      uri(`${base.fsPath}/${filename}`)
    );
    (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => uri(fsPath));
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
    (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
  });

  it('offers and writes new_ip_core.ip.yml when creating an IP core', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      uri('/workspace/new_ip_core.yml')
    );

    await createIpCoreCommand();

    expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: expect.objectContaining({ fsPath: '/workspace/new_ip_core.ip.yml' }),
      })
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/new_ip_core.ip.yml' }),
      expect.any(Uint8Array)
    );
  });

  it('normalizes an alternate compound .ip.yaml filename without duplicating .ip', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      uri('/workspace/new_ip_core.ip.yaml')
    );

    await createIpCoreCommand();

    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/new_ip_core.ip.yml' }),
      expect.any(Uint8Array)
    );
  });

  it('offers and writes new_memory_map.mm.yml when creating a standalone memory map', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      uri('/workspace/new_memory_map.yml')
    );

    await createMemoryMapCommand();

    expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: expect.objectContaining({ fsPath: '/workspace/new_memory_map.mm.yml' }),
      })
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/new_memory_map.mm.yml' }),
      expect.any(Uint8Array)
    );
  });

  it('offers a matching .mm.yml name when creating a memory map for the active IP core', async () => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { fileName: '/workspace/new_ip_core.ip.yml' },
    };
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      uri('/workspace/new_ip_core.yml')
    );

    await createMemoryMapCommand();

    expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: expect.objectContaining({ fsPath: '/workspace/new_ip_core.mm.yml' }),
      })
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/new_ip_core.mm.yml' }),
      expect.any(Uint8Array)
    );
  });

  it('offers and writes matching compound filenames in the combined creation flow', async () => {
    (vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(
      uri('/workspace/new_ip_core.yml')
    );

    await createIpCoreWithMemoryMapCommand();

    expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: expect.objectContaining({ fsPath: '/workspace/new_ip_core.ip.yml' }),
      })
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fsPath: '/workspace/new_ip_core.mm.yml' }),
      expect.any(Uint8Array)
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fsPath: '/workspace/new_ip_core.ip.yml' }),
      expect.any(Uint8Array)
    );
  });
});
