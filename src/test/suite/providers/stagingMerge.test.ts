import * as vscode from 'vscode';
import * as StagingContentProvider from '../../../providers/StagingContentProvider';
import { WebviewStagingBridge } from '../../../providers/WebviewStagingBridge';
import { mergeStagedFile, type StagedFile } from '../../../providers/StagingPanel';

const fsMock = vscode.workspace.fs as unknown as {
  readFile: jest.Mock;
  writeFile: jest.Mock;
};
const executeCommand = vscode.commands.executeCommand as unknown as jest.Mock;

const bytes = (s: string) => new TextEncoder().encode(s);

const file = (relativePath: string, status: StagedFile['status'] = 'modified'): StagedFile => ({
  relativePath,
  status,
  protected: false,
  content: `generated:${relativePath}`,
  diskPath: `/out/${relativePath}`,
  actions: [],
});

// Minimal webview panel stub for the bridge (it only posts messages + registers dispose).
const fakePanel = () =>
  ({
    webview: { postMessage: jest.fn() },
    onDidDispose: jest.fn(),
  }) as unknown as vscode.WebviewPanel;

beforeEach(() => {
  // resetMocks wipes shared mock implementations each test; restore the pieces used here.
  (vscode.Uri.from as unknown as jest.Mock).mockImplementation(
    (parts: { scheme?: string; path?: string }) => ({ scheme: parts.scheme, path: parts.path })
  );
  (vscode.Uri.file as unknown as jest.Mock).mockImplementation((p: string) => ({ fsPath: p }));
});

describe('WebviewStagingBridge merge tracking', () => {
  it('returns the files marked merged in the staging decision', async () => {
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/a.ip.yml';
    bridge.register(fsPath, fakePanel());

    const pending = bridge.showInWebview(fsPath, [file('core_regs.vhd'), file('core_pkg.vhd')]);
    bridge.markMerged(fsPath, 'core_regs.vhd');
    bridge.resolveStaging(fsPath, true);

    expect(await pending).toEqual({
      confirmed: true,
      mergedPaths: ['core_regs.vhd'],
      actions: {},
    });
  });

  it('carries an empty merged set when nothing was merged', async () => {
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/b.ip.yml';
    bridge.register(fsPath, fakePanel());

    const pending = bridge.showInWebview(fsPath, [file('x.vhd')]);
    bridge.resolveStaging(fsPath, false);

    expect(await pending).toEqual({ confirmed: false, mergedPaths: [], actions: {} });
  });

  it('carries the chosen actions through to the staging decision', async () => {
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/c.ip.yml';
    bridge.register(fsPath, fakePanel());

    const pending = bridge.showInWebview(fsPath, [file('locked.vhd')]);
    bridge.resolveStaging(fsPath, true, { 'locked.vhd': 'auto-merge' });

    expect(await pending).toEqual({
      confirmed: true,
      mergedPaths: [],
      actions: { 'locked.vhd': 'auto-merge' },
    });
  });

  it('sends the review fields but not contents or baseline to the webview', async () => {
    const panel = fakePanel();
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/e.ip.yml';
    bridge.register(fsPath, panel);

    const reviewed: StagedFile = {
      ...file('rtl/core.vhd'),
      baseline: 'old',
      handEdited: true,
      interfaceDrift: { added: ['irq'], removed: [], changed: [] },
      actions: ['keep', 'overwrite', 'sync-interface'],
      defaultAction: 'keep',
    };
    const pending = bridge.showInWebview(fsPath, [reviewed]);
    bridge.resolveStaging(fsPath, false);
    await pending;

    const sent = (panel.webview.postMessage as jest.Mock).mock.calls[0][0] as {
      files: Record<string, unknown>[];
    };
    expect(sent.files[0]).toEqual({
      relativePath: 'rtl/core.vhd',
      status: 'modified',
      protected: false,
      origin: undefined,
      handEdited: true,
      interfaceDrift: { added: ['irq'], removed: [], changed: [] },
      actions: ['keep', 'overwrite', 'sync-interface'],
      defaultAction: 'keep',
    });
  });

  it("forwards each file's origin and any generation warnings to the webview (issue #156)", async () => {
    const panel = fakePanel();
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/d.ip.yml';
    bridge.register(fsPath, panel);

    const frameworkFile: StagedFile = { ...file('tb/Makefile'), origin: 'framework-testbench' };
    const pending = bridge.showInWebview(fsPath, [file('rtl/core.vhd'), frameworkFile], undefined, [
      'pack does not declare generateFrameworkTestbench',
    ]);
    bridge.resolveStaging(fsPath, false);
    await pending;

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stagingStart',
        warnings: ['pack does not declare generateFrameworkTestbench'],
        files: [
          expect.objectContaining({ relativePath: 'rtl/core.vhd', origin: undefined }),
          expect.objectContaining({ relativePath: 'tb/Makefile', origin: 'framework-testbench' }),
        ],
      })
    );
  });
});

describe('mergeStagedFile', () => {
  it('opens the 3-way merge editor for a file with the on-disk content as base', async () => {
    fsMock.readFile.mockResolvedValue(bytes('on disk content'));

    const opened = await mergeStagedFile(file('core_regs.vhd'));

    expect(opened).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith(
      '_open.mergeEditor',
      expect.objectContaining({
        output: expect.objectContaining({ fsPath: '/out/core_regs.vhd' }),
        input2: expect.objectContaining({ title: 'Generated' }),
      })
    );
    // The merge editor writes the result on completion — mergeStagedFile must not.
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('uses the baseline as the merge base when present, the current content otherwise', async () => {
    const setContent = jest.spyOn(StagingContentProvider, 'setStagingContent');
    fsMock.readFile.mockResolvedValue(bytes('on disk content'));

    await mergeStagedFile({ ...file('a.vhd'), baseline: 'baseline content' });
    await mergeStagedFile(file('b.vhd'));

    const baseWrites = setContent.mock.calls.filter(([key]) => key.includes('/base/'));
    expect(baseWrites.map(([, content]) => content)).toEqual([
      'baseline content',
      'on disk content',
    ]);
    setContent.mockRestore();
  });

  it('returns false and does not throw when the merge editor cannot open', async () => {
    fsMock.readFile.mockResolvedValue(bytes('on disk content'));
    executeCommand.mockImplementation(async (command: string) => {
      if (command === '_open.mergeEditor') {
        throw new Error('command not found');
      }
    });

    const opened = await mergeStagedFile(file('core_regs.vhd'));

    expect(opened).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
