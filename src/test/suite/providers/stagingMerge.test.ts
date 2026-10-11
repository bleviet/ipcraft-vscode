import * as vscode from 'vscode';
import * as StagingContentProvider from '../../../providers/StagingContentProvider';
import { WebviewStagingBridge } from '../../../providers/WebviewStagingBridge';
import { mergeStagedFile, type StagedFile } from '../../../providers/StagingPanel';
import { Logger } from '../../../utils/Logger';
import { writeBaselines } from '../../../generator/generationBaseline';

jest.mock('../../../generator/generationBaseline', () => ({
  writeBaselines: jest.fn().mockResolvedValue(undefined),
}));

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
  (vscode.Uri.file as unknown as jest.Mock).mockImplementation((p: string) => ({
    fsPath: p,
    toString: () => `file://${p}`,
  }));
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

describe('mergeStagedFile baseline update on merge completion', () => {
  type DocListener = (doc: { uri: { fsPath: string } }) => void;
  const onSave = vscode.workspace.onDidSaveTextDocument as unknown as jest.Mock;
  const onClose = vscode.workspace.onDidCloseTextDocument as unknown as jest.Mock;
  const writeBaselinesMock = writeBaselines as unknown as jest.Mock;
  let saveListener: DocListener | undefined;
  let closeListener: DocListener | undefined;
  let saveDispose: jest.Mock;
  let closeDispose: jest.Mock;
  const uriOf = (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` });
  const doc = (fsPath: string) => ({ uri: uriOf(fsPath) });
  const TabInputTextMerge = (
    vscode as unknown as {
      TabInputTextMerge: new (b: unknown, i1: unknown, i2: unknown, r: unknown) => object;
    }
  ).TabInputTextMerge;
  const mergeTab = (fsPath: string) => ({
    input: new TabInputTextMerge(undefined, undefined, undefined, uriOf(fsPath)),
  });
  const tabGroups = vscode.window.tabGroups as unknown as {
    all: Array<{ tabs: unknown[] }>;
    onDidChangeTabs: jest.Mock;
  };
  let tabsListener: ((e: { closed: unknown[] }) => void) | undefined;
  let tabsDispose: jest.Mock;

  beforeEach(() => {
    saveListener = undefined;
    closeListener = undefined;
    saveDispose = jest.fn();
    closeDispose = jest.fn();
    onSave.mockImplementation((l: DocListener) => {
      saveListener = l;
      return { dispose: saveDispose };
    });
    onClose.mockImplementation((l: DocListener) => {
      closeListener = l;
      return { dispose: closeDispose };
    });
    tabsListener = undefined;
    tabsDispose = jest.fn();
    tabGroups.onDidChangeTabs.mockImplementation((l: typeof tabsListener) => {
      tabsListener = l;
      return { dispose: tabsDispose };
    });
    tabGroups.all = [{ tabs: [mergeTab('/out/rtl/core.vhd')] }];
    writeBaselinesMock.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue(bytes('on disk content'));
  });

  it('writes the generated content as the baseline when the merged document is saved', async () => {
    await mergeStagedFile(file('rtl/core.vhd'));

    saveListener?.(doc('/out/rtl/core.vhd'));

    expect(writeBaselinesMock).toHaveBeenCalledWith('/out', [
      { relativePath: 'rtl/core.vhd', content: 'generated:rtl/core.vhd' },
    ]);
    expect(saveDispose).toHaveBeenCalled();
    expect(closeDispose).toHaveBeenCalled();
  });

  it('writes nothing and disposes when the merge tab was closed before the save', async () => {
    await mergeStagedFile(file('rtl/core.vhd'));
    const closed = tabGroups.all[0].tabs;
    tabGroups.all = [{ tabs: [] }];

    tabsListener?.({ closed });
    expect(tabsDispose).toHaveBeenCalled();
    expect(saveDispose).toHaveBeenCalled();

    saveListener?.(doc('/out/rtl/core.vhd'));
    expect(writeBaselinesMock).not.toHaveBeenCalled();
  });

  it('writes nothing when saved while only a normal tab is open', async () => {
    await mergeStagedFile(file('rtl/core.vhd'));
    tabGroups.all = [{ tabs: [{ input: {} }] }];

    saveListener?.(doc('/out/rtl/core.vhd'));

    expect(writeBaselinesMock).not.toHaveBeenCalled();
    expect(saveDispose).toHaveBeenCalled();
    expect(tabsDispose).toHaveBeenCalled();
  });

  it('disposes without writing when the document is closed unsaved', async () => {
    await mergeStagedFile(file('rtl/core.vhd'));

    closeListener?.(doc('/out/rtl/core.vhd'));

    // Disposed subscriptions are never invoked by VS Code again.
    expect(saveDispose).toHaveBeenCalled();
    expect(closeDispose).toHaveBeenCalled();
    expect(writeBaselinesMock).not.toHaveBeenCalled();
  });

  it('ignores saves of other documents', async () => {
    await mergeStagedFile(file('rtl/core.vhd'));

    saveListener?.(doc('/out/rtl/other.vhd'));
    closeListener?.(doc('/out/rtl/other.vhd'));

    expect(writeBaselinesMock).not.toHaveBeenCalled();
    expect(saveDispose).not.toHaveBeenCalled();
  });

  it('registers no listener when the merge editor fails to open', async () => {
    executeCommand.mockImplementation(async (command: string) => {
      if (command === '_open.mergeEditor') {
        throw new Error('command not found');
      }
    });

    await mergeStagedFile(file('rtl/core.vhd'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not throw when the baseline write fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    writeBaselinesMock.mockRejectedValue(new Error('disk full'));
    await mergeStagedFile(file('rtl/core.vhd'));

    expect(() => saveListener?.(doc('/out/rtl/core.vhd'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    warn.mockRestore();
  });
});
