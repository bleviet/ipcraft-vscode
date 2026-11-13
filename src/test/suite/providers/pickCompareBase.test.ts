import * as vscode from 'vscode';
import {
  compareItems,
  escapeIcons,
  pickCompareBase,
} from '../../../providers/systemDiagram/pickCompareBase';
import * as git from '../../../services/systemDiagram/compare/gitRevisions';

jest.mock('../../../services/systemDiagram/compare/gitRevisions');

const document = {
  uri: {
    fsPath: '/ws/sys/system.bd',
    scheme: 'file',
    toString: () => 'file:///ws/sys/system.bd',
  },
  fileName: '/ws/sys/system.bd',
} as unknown as vscode.TextDocument;

const revisions = [
  { label: 'HEAD', description: 'last commit', ref: 'HEAD', baseLabel: 'HEAD', group: 'git' },
  {
    label: 'Merge base with main',
    description: 'bbbbbbb',
    ref: 'bbbbbbb2222',
    baseLabel: 'main (merge base bbbbbbb)',
    group: 'git',
  },
  { label: 'dev', description: 'branch', ref: 'dev', baseLabel: 'dev', group: 'branch' },
  { label: 'v1.0', description: 'tag', ref: 'v1.0', baseLabel: 'v1.0', group: 'tag' },
] as const;
const commits = [
  {
    label: 'Add the DMA',
    description: 'ccccccc · 2026-03-04 · Ada',
    ref: 'ccccccc3333',
    baseLabel: 'ccccccc Add the DMA',
    group: 'commit',
  },
] as const;
const repo = {} as git.GitRepository;
const quickPick = vscode.window.showQuickPick as jest.Mock;

const uriOf = (fsPath: string) =>
  ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }) as unknown as vscode.Uri;
const tab = (input: unknown) => ({ input });
const inGroups = (...groups: unknown[][]) => {
  (vscode.window.tabGroups as { all: unknown }).all = groups.map((tabs) => ({ tabs }));
};

function inRepository(inside: boolean) {
  (git.openRepository as jest.Mock).mockResolvedValue(inside ? repo : undefined);
  (git.listRevisions as jest.Mock).mockResolvedValue(revisions);
  (git.listFileCommits as jest.Mock).mockResolvedValue(commits);
  (git.readRevision as jest.Mock).mockResolvedValue('revision text');
}

const pickLabel = (label: string) =>
  quickPick.mockImplementation((items: { label: string }[]) =>
    Promise.resolve(items.find((i) => i.label === label))
  );

const shownLabels = () => (quickPick.mock.calls[0][0] as { label: string }[]).map((i) => i.label);

describe('compareItems', () => {
  const designs = [uriOf('/ws/sys/other.bd'), uriOf('/ws/ip/x.qsys')];

  beforeEach(() => {
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((path: string) =>
      path.replace('/ws/', '')
    );
  });

  it('groups the open designs, git, the commits, the branches and the tags, then the free entries', () => {
    const items = compareItems(designs, revisions, commits, true);
    expect(items.map((i) => i.label)).toEqual([
      'Open designs',
      'other.bd',
      'x.qsys',
      'Git',
      'HEAD',
      'Merge base with main',
      'Commits that changed this file',
      'Add the DMA',
      'Branches',
      'dev',
      'Tags',
      'v1.0',
      'Other',
      'Enter a revision…',
      'Compare with File…',
    ]);
    expect(
      items.filter((i) => i.kind === vscode.QuickPickItemKind.Separator).map((i) => i.label)
    ).toEqual([
      'Open designs',
      'Git',
      'Commits that changed this file',
      'Branches',
      'Tags',
      'Other',
    ]);
  });

  it('describes a design by its folder and a commit by its hash, day and author', () => {
    const items = compareItems(designs, revisions, commits, true);
    expect(items.find((i) => i.label === 'other.bd')?.description).toBe('sys');
    expect(items.find((i) => i.label === 'Add the DMA')?.description).toBe(
      'ccccccc · 2026-03-04 · Ada'
    );
    expect(items.find((i) => i.label === 'HEAD')?.description).toBe('last commit');
  });

  it('leaves out empty groups', () => {
    expect(compareItems([], revisions, [], true).map((i) => i.label)).toEqual([
      'Git',
      'HEAD',
      'Merge base with main',
      'Branches',
      'dev',
      'Tags',
      'v1.0',
      'Other',
      'Enter a revision…',
      'Compare with File…',
    ]);
  });

  it('offers a typed revision in a repository whose revisions cannot be listed', () => {
    expect(compareItems([], [], [], true).map((i) => i.label)).toEqual([
      'Enter a revision…',
      'Compare with File…',
    ]);
  });

  it('offers the open designs and the file outside a repository', () => {
    expect(compareItems(designs.slice(0, 1), [], [], false).map((i) => i.label)).toEqual([
      'Open designs',
      'other.bd',
      'Other',
      'Compare with File…',
    ]);
  });

  it('offers only the file, with no heading, without designs and repository', () => {
    expect(compareItems([], [], [], false).map((i) => i.label)).toEqual(['Compare with File…']);
  });
});

describe('escapeIcons', () => {
  it('writes \\$( so the picker shows the text, not an icon', () => {
    expect(escapeIcons('Fix $(rocket) and $(x)')).toBe('Fix \\$(rocket) and \\$(x)');
    expect(escapeIcons('plain $ text')).toBe('plain $ text');
  });
});

describe('pickCompareBase', () => {
  beforeEach(() => {
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: () => Promise<unknown>) => task()
    );
    (vscode.workspace as { textDocuments: unknown }).textDocuments = [];
    (vscode.Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/ws/sys' });
    (vscode.workspace.asRelativePath as jest.Mock).mockImplementation(
      (file: { fsPath: string } | string) =>
        (typeof file === 'string' ? file : file.fsPath).replace('/ws/', '')
    );
    inGroups([]);
  });

  it('titles the picker with the file name', async () => {
    inRepository(true);
    quickPick.mockResolvedValue(undefined);
    expect(await pickCompareBase(document)).toBeUndefined();
    expect(quickPick.mock.calls[0][1]).toEqual({
      title: 'Compare system.bd with',
      matchOnDescription: true,
    });
  });

  it('reads the picked revision, labelled as picked', async () => {
    inRepository(true);
    pickLabel('v1.0');
    const base = await pickCompareBase(document);
    expect(base).toEqual({ text: 'revision text', label: 'v1.0' });
    expect(base).not.toHaveProperty('file');
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
    (git.listFileCommits as jest.Mock).mockResolvedValue([]);
    quickPick.mockResolvedValue(undefined);
    await pickCompareBase(document);
    expect(shownLabels()).toEqual(['Enter a revision…', 'Compare with File…']);
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
    expect(await pickCompareBase(document)).toEqual({
      text: 'file text',
      label: 'old/other.bd',
      file: { fsPath: '/ws/old/other.bd' },
    });
    expect(shownLabels()).toEqual(['Compare with File…']);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
      canSelectMany: false,
      defaultUri: { fsPath: '/ws/sys' },
      filters: { 'System designs': ['bd', 'tcl', 'qsys'] },
    });
  });

  it('shows progress in the status bar while the git repository is read', async () => {
    inRepository(true);
    quickPick.mockResolvedValue(undefined);
    await pickCompareBase(document);
    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      { location: vscode.ProgressLocation.Window, title: 'Reading the git repository…' },
      expect.any(Function)
    );
    expect(git.openRepository).toHaveBeenCalledWith(document.uri);
  });

  it('reads the text of the picked file from its open tab, not from the disk', async () => {
    inRepository(false);
    pickLabel('Compare with File…');
    const picked = uriOf('/ws/old/other.bd');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([picked]);
    (vscode.workspace as { textDocuments: unknown }).textDocuments = [
      { uri: uriOf('/ws/old/else.bd'), getText: () => 'wrong tab' },
      { uri: uriOf('/ws/old/other.bd'), getText: () => 'unsaved text' },
    ];
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
      new TextEncoder().encode('disk text')
    );
    expect(await pickCompareBase(document)).toEqual({
      text: 'unsaved text',
      label: 'old/other.bd',
      file: picked,
    });
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it('does nothing when the open dialog is cancelled', async () => {
    inRepository(false);
    pickLabel('Compare with File…');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    expect(await pickCompareBase(document)).toBeUndefined();
  });

  it('labels a picked commit with its short hash and subject, as a revision', async () => {
    inRepository(true);
    pickLabel('Add the DMA');
    const base = await pickCompareBase(document);
    expect(base).toEqual({ text: 'revision text', label: 'ccccccc Add the DMA' });
    expect(base).not.toHaveProperty('file');
    expect(git.readRevision).toHaveBeenCalledWith(repo, 'ccccccc3333', document.uri);
  });

  it('shows the revisions in a repository without other tabs and commits', async () => {
    inRepository(true);
    (git.listFileCommits as jest.Mock).mockResolvedValue([]);
    quickPick.mockResolvedValue(undefined);
    await pickCompareBase(document);
    expect(shownLabels()).toEqual([
      'Git',
      'HEAD',
      'Merge base with main',
      'Branches',
      'dev',
      'Tags',
      'v1.0',
      'Other',
      'Enter a revision…',
      'Compare with File…',
    ]);
  });

  it('shows the open design without a repository', async () => {
    inRepository(false);
    inGroups([tab(new vscode.TabInputText(uriOf('/ws/sys/other.bd')))]);
    quickPick.mockResolvedValue(undefined);
    await pickCompareBase(document);
    expect(shownLabels()).toEqual(['Open designs', 'other.bd', 'Other', 'Compare with File…']);
    expect(git.listFileCommits).not.toHaveBeenCalled();
  });

  describe('open design tabs', () => {
    const open = (...tabs: unknown[][]) => {
      inRepository(false);
      inGroups(...tabs);
      quickPick.mockResolvedValue(undefined);
    };
    const designLabels = async () => {
      await pickCompareBase(document);
      return shownLabels().filter((label) => label !== 'Compare with File…' && label !== 'Other');
    };

    it('lists the design files of text and custom editor tabs of all groups, once each', async () => {
      open(
        [
          tab(new vscode.TabInputText(uriOf('/ws/a/one.bd'))),
          tab(new vscode.TabInputCustom(uriOf('/ws/a/two.qsys'), 'ipcraft.systemDiagram')),
        ],
        [
          tab(new vscode.TabInputCustom(uriOf('/ws/a/one.bd'), 'ipcraft.systemDiagram')),
          tab(new vscode.TabInputText(uriOf('/ws/b/three.tcl'))),
        ]
      );
      expect(await designLabels()).toEqual(['Open designs', 'one.bd', 'two.qsys', 'three.tcl']);
    });

    it('lists only tabs of files on disk, not git or untitled ones', async () => {
      const scheme = (fsPath: string, name: string) => ({
        ...uriOf(fsPath),
        scheme: name,
      });
      open([
        tab(new vscode.TabInputText(scheme('/ws/a/head.bd', 'git') as unknown as vscode.Uri)),
        tab(new vscode.TabInputText(scheme('/ws/a/new.bd', 'untitled') as unknown as vscode.Uri)),
        tab(new vscode.TabInputText(scheme('/ws/a/disk.bd', 'file') as unknown as vscode.Uri)),
      ]);
      expect(await designLabels()).toEqual(['Open designs', 'disk.bd']);
    });

    it('lists tabs of the scheme of the document, so remote workspaces work', async () => {
      const remote = (fsPath: string, name: string) =>
        ({ ...uriOf(fsPath), scheme: name }) as unknown as vscode.Uri;
      const remoteDocument = {
        ...document,
        uri: remote('/ws/sys/system.bd', 'vscode-remote'),
      } as unknown as vscode.TextDocument;
      open([
        tab(new vscode.TabInputText(remote('/ws/a/remote.bd', 'vscode-remote'))),
        tab(new vscode.TabInputText(remote('/ws/a/local.bd', 'file'))),
        tab(new vscode.TabInputText(remote('/ws/a/head.bd', 'git'))),
      ]);
      await pickCompareBase(remoteDocument);
      expect(shownLabels()).toContain('remote.bd');
      expect(shownLabels()).not.toContain('local.bd');
      expect(shownLabels()).not.toContain('head.bd');
    });

    it('leaves out the document itself, other files, hardware tcl and diff tabs', async () => {
      open([
        tab(new vscode.TabInputText(uriOf('/ws/sys/system.bd'))),
        tab(new vscode.TabInputCustom(uriOf('/ws/sys/system.bd'), 'ipcraft.systemDiagram')),
        tab(new vscode.TabInputText(uriOf('/ws/a/notes.txt'))),
        tab(new vscode.TabInputText(uriOf('/ws/a/core_hw.tcl'))),
        tab(new vscode.TabInputText(uriOf('/ws/a/core.ip.yml'))),
        tab(new vscode.TabInputTextDiff(uriOf('/ws/a/old.bd'), uriOf('/ws/a/new.bd'))),
        tab({}),
      ]);
      expect(await designLabels()).toEqual([]);
    });

    it('compares with the current text of the picked tab, as a file base', async () => {
      const other = uriOf('/ws/a/other.bd');
      open([tab(new vscode.TabInputText(other))]);
      pickLabel('other.bd');
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        getText: () => 'unsaved text',
      });
      expect(await pickCompareBase(document)).toEqual({
        text: 'unsaved text',
        label: 'a/other.bd',
        file: other,
      });
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(other);
    });
  });

  it('offers all design formats in the open dialog, the own one first', async () => {
    inRepository(false);
    pickLabel('Compare with File…');
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined);
    const tclDocument = {
      ...document,
      uri: { fsPath: '/ws/sys/d.tcl', scheme: 'file' },
      fileName: '/ws/sys/d.tcl',
    } as unknown as vscode.TextDocument;
    await pickCompareBase(tclDocument);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { 'System designs': ['tcl', 'bd', 'qsys'] } })
    );
  });

  it('escapes icons in labels and descriptions that come from user data', async () => {
    inRepository(true);
    (git.listFileCommits as jest.Mock).mockResolvedValue([
      { ...commits[0], label: 'Use $(bug) fix', description: 'ccccccc · Ada $(x)' },
    ]);
    inGroups([tab(new vscode.TabInputText(uriOf('/ws/$(a)/x$(b).bd')))]);
    quickPick.mockResolvedValue(undefined);
    await pickCompareBase(document);
    const items = quickPick.mock.calls[0][0] as { label: string; description?: string }[];
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Use \\$(bug) fix', 'x\\$(b).bd'])
    );
    expect(items.find((i) => i.label === 'x\\$(b).bd')?.description).toBe('\\$(a)');
    expect(items.find((i) => i.label === 'Use \\$(bug) fix')?.description).toBe(
      'ccccccc · Ada \\$(x)'
    );
  });

  describe('the folder of an open design', () => {
    const descriptionOf = async (fsPath: string, workspaceRoot?: string) => {
      inRepository(false);
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(
        workspaceRoot && { uri: { fsPath: workspaceRoot } }
      );
      (vscode.workspace.asRelativePath as jest.Mock).mockImplementation((file: string) =>
        file.startsWith('/ws/') ? file.slice(4) : file
      );
      inGroups([tab(new vscode.TabInputText(uriOf(fsPath)))]);
      quickPick.mockResolvedValue(undefined);
      await pickCompareBase(document);
      return (quickPick.mock.calls[0][0] as { label: string; description?: string }[]).find(
        (i) => i.description !== undefined && i.label.endsWith('.bd')
      )?.description;
    };

    it('is empty at the workspace root', async () => {
      expect(await descriptionOf('/ws/top.bd', '/ws')).toBe('');
    });

    it('is relative inside the workspace', async () => {
      expect(await descriptionOf('/ws/hw/top.bd', '/ws')).toBe('hw');
    });

    it('is the absolute folder outside the workspace', async () => {
      expect(await descriptionOf('/elsewhere/hw/top.bd')).toBe('/elsewhere/hw');
    });
  });
});
