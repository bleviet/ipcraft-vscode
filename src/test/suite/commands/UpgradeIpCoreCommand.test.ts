import * as path from 'path';
import * as vscode from 'vscode';
import { upgradeIpCore } from '../../../commands/UpgradeIpCoreCommand';
import { loadRuntimeBusLibrary } from '../../../services/loadRuntimeBusLibrary';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { builtinBusLibrary } from '../../helpers/busLibrary';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/loadRuntimeBusLibrary', () => ({
  loadRuntimeBusLibrary: jest.fn(),
}));

const LEGACY = `apiVersion: '1.0'
busInterfaces:
  - name: avalon
    type: ${BUS_VLNV.AVALON_MM}
    mode: master
    useOptionalPorts: [read_n, write_n]
`;
const CURRENT = "apiVersion: '1.1'\nclocks: []\n";

const resourceRoots = devResourceRoots(path.resolve(__dirname, '../../../..'));

function uriFor(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

function installDocuments(
  contents: Record<string, string>,
  options: { dirty?: string[]; saveResult?: boolean } = {}
): {
  save: jest.Mock;
} {
  const save = jest.fn().mockResolvedValue(options.saveResult ?? true);
  (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest
    .fn()
    .mockImplementation(async (uri: { fsPath: string }) => {
      const text = contents[uri.fsPath];
      const lines = text.split('\n');
      return {
        getText: () => text,
        isDirty: options.dirty?.includes(uri.fsPath) ?? false,
        lineCount: lines.length,
        lineAt: (line: number) => ({ lineNumber: line, text: lines[line] }),
        save,
      };
    });
  return { save };
}

describe('upgradeIpCore', () => {
  let replace: jest.Mock;

  beforeEach(() => {
    (loadRuntimeBusLibrary as jest.Mock).mockResolvedValue(builtinBusLibrary());
    (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);
    replace = jest.fn();
    jest
      .spyOn(vscode, 'WorkspaceEdit')
      .mockImplementation(() => ({ replace }) as unknown as vscode.WorkspaceEdit);
  });

  afterEach(() => {
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = undefined;
  });

  it('upgrades every selected file with one edit and save each, then summarizes', async () => {
    const { save } = installDocuments({
      '/a.ip.yml': LEGACY,
      '/b.ip.yml': CURRENT,
      '/c.ip.yml': LEGACY,
    });

    await upgradeIpCore(resourceRoots, uriFor('/a.ip.yml'), [
      uriFor('/a.ip.yml'),
      uriFor('/b.ip.yml'),
      uriFor('/c.ip.yml'),
    ]);

    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace.mock.calls.map(([uri]: [{ fsPath: string }]) => uri.fsPath)).toEqual([
      '/a.ip.yml',
      '/c.ip.yml',
    ]);
    expect(replace.mock.calls[0][2]).toContain('portPolarityOverrides');
    expect(replace.mock.calls[0][2]).toContain("apiVersion: '1.1'");
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Upgraded 2 file(s) to format 1.1; 1 already current'
    );
  });

  it('does not edit or save a file that is already current', async () => {
    const { save } = installDocuments({ '/b.ip.yml': CURRENT });

    await upgradeIpCore(resourceRoots, uriFor('/b.ip.yml'));

    expect(replace).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Upgraded 0 file(s) to format 1.1; 1 already current'
    );
  });

  it('uses the active .ip.yml when invoked without a uri', async () => {
    installDocuments({ '/active.ip.yml': LEGACY });
    (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
      document: { fileName: '/active.ip.yml', uri: uriFor('/active.ip.yml') },
    };

    await upgradeIpCore(resourceRoots);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0].fsPath).toBe('/active.ip.yml');
  });

  it('reports a failing file as an error and still processes the others', async () => {
    installDocuments({ '/bad.ip.yml': 'a: [unclosed', '/a.ip.yml': LEGACY });

    await upgradeIpCore(resourceRoots, undefined, [uriFor('/bad.ip.yml'), uriFor('/a.ip.yml')]);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('bad.ip.yml'),
      expect.anything(),
      expect.anything()
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Upgraded 1 file(s) to format 1.1; 0 already current'
    );
  });

  it('replaces the full document range', async () => {
    installDocuments({ '/a.ip.yml': LEGACY });

    await upgradeIpCore(resourceRoots, uriFor('/a.ip.yml'));

    const lines = LEGACY.split('\n');
    expect(replace.mock.calls[0][1]).toMatchObject({
      startLine: 0,
      startCharacter: 0,
      endLine: lines.length - 1,
      endCharacter: lines[lines.length - 1].length,
    });
  });

  it('applies the edit but does not save a document with unsaved changes', async () => {
    const { save } = installDocuments(
      { '/dirty.ip.yml': LEGACY, '/a.ip.yml': LEGACY },
      { dirty: ['/dirty.ip.yml'] }
    );

    await upgradeIpCore(resourceRoots, undefined, [uriFor('/dirty.ip.yml'), uriFor('/a.ip.yml')]);

    expect(replace).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Upgraded 1 file(s) to format 1.1; 1 left unsaved because they had unsaved changes; 0 already current'
    );
  });

  it('reports a failed save as an error and does not count it as upgraded', async () => {
    installDocuments({ '/a.ip.yml': LEGACY }, { saveResult: false });

    await upgradeIpCore(resourceRoots, uriFor('/a.ip.yml'));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('a.ip.yml'),
      expect.anything(),
      expect.anything()
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Upgraded 0 file(s) to format 1.1; 0 already current'
    );
  });
});
