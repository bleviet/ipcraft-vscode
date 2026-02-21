import * as vscode from 'vscode';
import { HtmlGenerator } from '../../../services/HtmlGenerator';

describe('HtmlGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.Uri.joinPath as jest.Mock).mockImplementation(
      (base: { fsPath?: string }, ...segments: string[]) => {
        const fsPath = [base?.fsPath ?? String(base), ...segments].join('/');
        return { fsPath, toString: () => fsPath };
      }
    );
  });

  function createWebview(): vscode.Webview {
    return {
      cspSource: 'vscode-resource:',
      asWebviewUri: jest.fn((uri: vscode.Uri) => ({
        fsPath: `wv:${uri.fsPath}`,
        toString: () => `wv:${uri.fsPath}`,
      })),
    } as unknown as vscode.Webview;
  }

  function createContext(): vscode.ExtensionContext {
    return {
      extensionUri: { fsPath: '/ext', toString: () => '/ext' } as vscode.Uri,
    } as vscode.ExtensionContext;
  }

  it('generates memory map editor HTML with expected assets and CSP', () => {
    const webview = createWebview();
    const generator = new HtmlGenerator(createContext());

    const html = generator.generateHtml(webview);

    expect(html).toContain('<title>Memory Map Editor</title>');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain("default-src 'none';");
    expect(html).toContain('style-src vscode-resource:;');
    expect(html).toContain('script-src vscode-resource:;');
    expect(html).toContain('wv:/ext/dist/webview.js');
    expect(html).toContain('wv:/ext/dist/webview.css');
    expect(html).toContain('wv:/ext/node_modules/@vscode/codicons/dist/codicon.css');
    expect(webview.asWebviewUri as jest.Mock).toHaveBeenCalledTimes(3);
  });

  it('generates IP core editor HTML with expected assets and root node', () => {
    const webview = createWebview();
    const generator = new HtmlGenerator(createContext());

    const html = generator.generateIpCoreHtml(webview);

    expect(html).toContain('<title>IP Core Editor</title>');
    expect(html).toContain('<div id="ipcore-root"></div>');
    expect(html).toContain('wv:/ext/dist/ipcore.js');
    expect(html).toContain('wv:/ext/dist/ipcore.css');
    expect(html).toContain('wv:/ext/node_modules/@vscode/codicons/dist/codicon.css');
    expect(webview.asWebviewUri as jest.Mock).toHaveBeenCalledTimes(3);
  });
});
