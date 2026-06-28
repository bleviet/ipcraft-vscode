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

  it('shows a diff and overwrites only when the user confirms', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));
    showWarning.mockResolvedValue('Overwrite');

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'new: imported');

    expect(outcome).toBe('overwritten');
    // A diff of current vs. imported was opened before asking. Both sides use the
    // plain-text staging scheme AND a .yaml (not .mm.yml/.ip.yml) path, so the
    // file's custom visual editor cannot hijack the diff pane and hide the
    // textual changes.
    const stagingYaml = expect.objectContaining({
      scheme: 'ipcraft-staging',
      path: expect.stringMatching(/\.yaml$/),
    });
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      stagingYaml,
      stagingYaml,
      expect.stringContaining('Current'),
      expect.anything()
    );
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    expect(writtenText(fsMock.writeFile.mock.calls[0] as unknown[])).toBe('new: imported');
  });

  it('opens the 3-way merge editor when the user chooses Merge...', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));
    showWarning.mockResolvedValue('Merge...');

    const target = uri('/out/core.mm.yml');
    const outcome = await writeImportedFile(target, 'new: imported');

    expect(outcome).toBe('merged');
    // The merge editor is opened with the real file as the writable `output`;
    // base/current/imported sides are served through the staging scheme.
    expect(executeCommand).toHaveBeenCalledWith(
      '_open.mergeEditor',
      expect.objectContaining({
        output: target,
        base: expect.objectContaining({ scheme: 'ipcraft-staging' }),
        input1: expect.objectContaining({
          uri: expect.objectContaining({ scheme: 'ipcraft-staging' }),
        }),
        input2: expect.objectContaining({
          uri: expect.objectContaining({ scheme: 'ipcraft-staging' }),
        }),
      })
    );
    // The merge editor writes the resolved result on completion — not us.
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the file and warns when the merge editor cannot open', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));
    showWarning.mockResolvedValue('Merge...');
    executeCommand.mockImplementation(async (command: string) => {
      if (command === '_open.mergeEditor') {
        throw new Error('command not found');
      }
    });

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'new: imported');

    expect(outcome).toBe('kept');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('keeps the user version when the user declines', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));
    showWarning.mockResolvedValue('Keep Existing');

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'new: imported');

    expect(outcome).toBe('kept');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the user version when the prompt is dismissed', async () => {
    fsMock.readFile.mockResolvedValue(bytes('old: edited by user'));
    showWarning.mockResolvedValue(undefined);

    const outcome = await writeImportedFile(uri('/out/core.mm.yml'), 'new: imported');

    expect(outcome).toBe('kept');
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });
});
