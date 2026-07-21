import * as vscode from 'vscode';
import { MemoryMapEditorProvider } from '../../../providers/MemoryMapEditorProvider';
import { DataInspectorRecipeEditorProvider } from '../../../providers/DataInspectorRecipeEditorProvider';

/**
 * Guards issue #121: every webview must declare explicit, minimal
 * localResourceRoots limited to packaged `dist` assets, and no resource root or
 * generated URI may point into node_modules (excluded from the VSIX).
 */
describe('webview localResourceRoots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.Uri.joinPath as jest.Mock).mockImplementation(
      (base: { toString?: () => string }, ...segments: string[]) => {
        const fsPath = [base?.toString?.() ?? String(base), ...segments].join('/');
        return { fsPath, toString: () => fsPath };
      }
    );
    (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockReturnValue({
      dispose: jest.fn(),
    });
  });

  function createContext(): vscode.ExtensionContext {
    return {
      extensionUri: { fsPath: '/ext', toString: () => '/ext' } as vscode.Uri,
      extensionPath: '/ext',
      globalState: { get: jest.fn(), update: jest.fn() },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  }

  interface CapturedWebview {
    options: vscode.WebviewOptions;
    cspSource: string;
    asWebviewUri: jest.Mock;
    onDidReceiveMessage: jest.Mock;
    postMessage: jest.Mock;
  }

  function createPanel(): {
    panel: vscode.WebviewPanel;
    webview: CapturedWebview;
  } {
    const webview: CapturedWebview = {
      options: {},
      cspSource: 'vscode-resource:',
      asWebviewUri: jest.fn((uri: vscode.Uri) => ({
        toString: () => `wv:${uri.toString()}`,
      })),
      onDidReceiveMessage: jest.fn(),
      postMessage: jest.fn(),
    };
    const panel = {
      webview,
      onDidDispose: jest.fn(),
    } as unknown as vscode.WebviewPanel;
    return { panel, webview };
  }

  function createDocument(fsPath: string): vscode.TextDocument {
    return {
      uri: { fsPath, toString: () => `file://${fsPath}` } as vscode.Uri,
      getText: () => '',
      version: 1,
    } as unknown as vscode.TextDocument;
  }

  function rootPaths(options: vscode.WebviewOptions): string[] {
    return (options.localResourceRoots ?? []).map((r) => r.fsPath);
  }

  it('MemoryMapEditorProvider scopes roots to dist and never node_modules', () => {
    const provider = new MemoryMapEditorProvider(createContext());
    const { panel, webview } = createPanel();

    provider.resolveCustomTextEditor(
      createDocument('/ws/a.mm.yml'),
      panel,
      {} as vscode.CancellationToken
    );

    expect(webview.options.enableScripts).toBe(true);
    expect(rootPaths(webview.options)).toEqual(['/ext/dist']);
    expect(rootPaths(webview.options).some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('DataInspectorRecipeEditorProvider scopes roots to dist and never node_modules', () => {
    const provider = new DataInspectorRecipeEditorProvider(createContext());
    const { panel, webview } = createPanel();

    provider.resolveCustomTextEditor(
      createDocument('/ws/a.di.yml'),
      panel,
      {} as vscode.CancellationToken
    );

    expect(webview.options.enableScripts).toBe(true);
    expect(rootPaths(webview.options)).toEqual(['/ext/dist']);
    expect(rootPaths(webview.options).some((p) => p.includes('node_modules'))).toBe(false);
  });
});
