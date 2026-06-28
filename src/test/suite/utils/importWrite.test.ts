import * as vscode from 'vscode';
import { writeImportedFile } from '../../../utils/importWrite';

const fsMock = vscode.workspace.fs as unknown as {
  readFile: jest.Mock;
  writeFile: jest.Mock;
};
const showWarning = vscode.window.showWarningMessage as unknown as jest.Mock;
const executeCommand = vscode.commands.executeCommand as unknown as jest.Mock;

const uri = (p: string) => ({ fsPath: p }) as unknown as vscode.Uri;
const bytes = (s: string) => new TextEncoder().encode(s);
const writtenText = (call: unknown[]): string => new TextDecoder().decode(call[1] as Uint8Array);

describe('writeImportedFile', () => {
  beforeEach(() => {
    // resetMocks wipes the shared mock's implementation each test; restore the
    // pieces this helper relies on.
    (vscode.Uri.from as unknown as jest.Mock).mockImplementation(
      (parts: { scheme?: string; path?: string }) => ({ scheme: parts.scheme, path: parts.path })
    );
  });

  it('writes a new file when the target does not exist', async () => {
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'));

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'new: content');

    expect(outcome).toBe('created');
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    expect(writtenText(fsMock.writeFile.mock.calls[0] as unknown[])).toBe('new: content');
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('does nothing when the existing file is identical', async () => {
    fsMock.readFile.mockResolvedValue(bytes('same: content'));

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'same: content');

    expect(outcome).toBe('unchanged');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('opens the 3-way merge editor directly on a conflict (no blocking prompt)', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));

    const target = uri('/out/core.mm.yml');
    const outcome = await writeImportedFile(target, 'new: imported');

    expect(outcome).toBe('merged');
    // No read-only diff tab and no Overwrite/Keep-Existing warning — the merge
    // editor opens straight away.
    expect(showWarning).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalledWith('vscode.diff', expect.anything());
    // The merge editor opens with the real file as the writable `output`;
    // base/current/imported sides are served through the staging scheme on a
    // .yaml path so the file's custom visual editor cannot hijack a merge pane.
    const stagingYaml = expect.objectContaining({
      scheme: 'ipcraft-staging',
      path: expect.stringMatching(/\.yaml$/),
    });
    expect(executeCommand).toHaveBeenCalledWith(
      '_open.mergeEditor',
      expect.objectContaining({
        output: target,
        base: stagingYaml,
        input1: expect.objectContaining({ uri: stagingYaml }),
        input2: expect.objectContaining({ uri: stagingYaml }),
      })
    );
    // The merge editor writes the resolved result on completion — not us.
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('leaves the file unchanged and warns when the merge editor cannot open', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));
    executeCommand.mockImplementation(async (command: string) => {
      if (command === '_open.mergeEditor') {
        throw new Error('command not found');
      }
    });

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'new: imported');

    expect(outcome).toBe('kept');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
