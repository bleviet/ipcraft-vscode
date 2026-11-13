import * as vscode from 'vscode';
import { compareItems, pickCompareBase } from '../../../providers/systemDiagram/pickCompareBase';
import * as git from '../../../services/systemDiagram/compare/gitRevisions';

jest.mock('../../../services/systemDiagram/compare/gitRevisions');

const document = {
  uri: { fsPath: '/ws/sys/system.bd' },
  fileName: '/ws/sys/system.bd',
} as unknown as vscode.TextDocument;

const revisions = [
  { label: 'HEAD', description: 'last commit', ref: 'HEAD', baseLabel: 'HEAD' },
  {
    label: 'Merge base with main',
    description: 'bbbbbbb',
    ref: 'bbbbbbb2222',
    baseLabel: 'main (merge base bbbbbbb)',
  },
  { label: 'dev', description: 'branch', ref: 'dev', baseLabel: 'dev' },
  { label: 'v1.0', description: 'tag', ref: 'v1.0', baseLabel: 'v1.0' },
];
const repo = {} as git.GitRepository;
const quickPick = vscode.window.showQuickPick as jest.Mock;

function inRepository(inside: boolean) {
  (git.openRepository as jest.Mock).mockResolvedValue(inside ? repo : undefined);
  (git.listRevisions as jest.Mock).mockResolvedValue(revisions);
  (git.readRevision as jest.Mock).mockResolvedValue('revision text');
}

const pickLabel = (label: string) =>
  quickPick.mockImplementation((items: { label: string }[]) =>
    Promise.resolve(items.find((i) => i.label === label))
  );

describe('compareItems', () => {
  it('lists the revisions, then entering one, then a file', () => {
    expect(compareItems(revisions).map((i) => i.label)).toEqual([
      'HEAD',
      'Merge base with main',
      'dev',
      'v1.0',
      'Enter a revision…',
      'Compare with File…',
    ]);
  });

  it('offers only a file outside a repository', () => {
    expect(compareItems(undefined).map((i) => i.label)).toEqual(['Compare with File…']);
  });
});

describe('pickCompareBase', () => {
  beforeEach(() => {
    (vscode.Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/ws/sys' });
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((file: { fsPath: string }) =>
      file.fsPath.replace('/ws/', '')
    );
  });

  it('titles the picker with the file name', async () => {
    inRepository(true);
    quickPick.mockResolvedValue(undefined);
    expect(await pickCompareBase(document)).toBeUndefined();
    expect(quickPick.mock.calls[0][1]).toEqual({ title: 'Compare system.bd with' });
  });

  it('reads the picked revision, labelled as picked', async () => {
    inRepository(true);
    pickLabel('v1.0');
    expect(await pickCompareBase(document)).toEqual({ text: 'revision text', label: 'v1.0' });
    expect(git.readRevision).toHaveBeenCalledWith(repo, 'v1.0', document.uri);
  });

  it('labels the merge base with the default branch and the short hash', async () => {
    inRepository(true);
    pickLabel('Merge base with main');
    expect(await pickCompareBase(document)).toEqual({
      text: 'revision text',
      label: 'main (merge base bbbbbbb)',
    });
    expect(git.readRevision).toHaveBeenCalledWith(repo, 'bbbbbbb2222', document.uri);
  });

  it('reads a revision typed in', async () => {
    inRepository(true);
    pickLabel('Enter a revision…');
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(' abc1234 ');
    expect(await pickCompareBase(document)).toEqual({ text: 'revision text', label: 'abc1234' });
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Git revision (branch, tag or commit)' })
    );
  });

  it('validates the typed revision: a leading dash is refused', async () => {
    inRepository(true);
    pickLabel('Enter a revision…');
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('main');
    await pickCompareBase(document);
    const { validateInput } = (vscode.window.showInputBox as jest.Mock).mock.calls[0][0] as {
      validateInput: (value: string) => string | undefined;
    };
    expect(validateInput(' --upload-pack=x')).toBe('A revision cannot start with -');
    expect(validateInput('feature-x')).toBeUndefined();
  });

  it('still offers the file when the revisions cannot be listed', async () => {
    inRepository(true);
    (git.listRevisions as jest.Mock).mockRejectedValue(new Error('boom'));
    quickPick.mockResolvedValue(undefined);
    await pickCompareBase(document);
    const items = quickPick.mock.calls[0][0] as { label: string }[];
    expect(items.map((i) => i.label)).toEqual(['Compare with File…']);
  });

  it('does nothing when the input box is cancelled', async () => {
    inRepository(true);
    pickLabel('Enter a revision…');
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    expect(await pickCompareBase(document)).toBeUndefined();
    expect(git.readRevision).not.toHaveBeenCalled();
  });

  it('reads the picked file, labelled with its workspace path', async () => {
    inRepository(false);
    pickLabel('Compare with File…');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: '/ws/old/other.bd' }]);
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
      new TextEncoder().encode('file text')
    );
    expect(await pickCompareBase(document)).toEqual({ text: 'file text', label: 'old/other.bd' });
    const items = quickPick.mock.calls[0][0] as { label: string }[];
    expect(items.map((i) => i.label)).toEqual(['Compare with File…']);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
      canSelectMany: false,
      defaultUri: { fsPath: '/ws/sys' },
      filters: { 'System design': ['bd'] },
    });
  });

  it('does nothing when the open dialog is cancelled', async () => {
    inRepository(false);
    pickLabel('Compare with File…');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    expect(await pickCompareBase(document)).toBeUndefined();
  });
});
