import * as vscode from 'vscode';
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
      overwritePaths: [],
    });
  });

  it('carries an empty merged set when nothing was merged', async () => {
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/b.ip.yml';
    bridge.register(fsPath, fakePanel());

    const pending = bridge.showInWebview(fsPath, [file('x.vhd')]);
    bridge.resolveStaging(fsPath, false);

    expect(await pending).toEqual({ confirmed: false, mergedPaths: [], overwritePaths: [] });
  });

  it('carries overwritePaths through to the staging decision', async () => {
    const bridge = WebviewStagingBridge.getInstance();
    const fsPath = '/proj/c.ip.yml';
    bridge.register(fsPath, fakePanel());

    const pending = bridge.showInWebview(fsPath, [file('locked.vhd')]);
    bridge.resolveStaging(fsPath, true, ['locked.vhd']);

    expect(await pending).toEqual({
      confirmed: true,
      mergedPaths: [],
      overwritePaths: ['locked.vhd'],
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
