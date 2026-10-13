import * as vscode from 'vscode';
import { MemoryMapEditorProvider } from '../../../providers/MemoryMapEditorProvider';

/** The provider sends the owning core's version context after the ready handshake. */
describe('MemoryMapEditorProvider version context wiring', () => {
  const corePath = '/ws/ip/uart.ip.yml';
  const uri = (fsPath: string): vscode.Uri =>
    ({ fsPath, toString: () => `file://${fsPath}` }) as unknown as vscode.Uri;

  let receive: ((message: unknown) => Promise<void> | void) | undefined;
  let onDispose: (() => void) | undefined;
  let postMessage: jest.Mock;
  let textChangeSubscription: { dispose: jest.Mock };
  let saveSubscription: { dispose: jest.Mock };
  let fileWatcher: { dispose: jest.Mock };

  beforeEach(() => {
    receive = undefined;
    onDispose = undefined;
    postMessage = jest.fn().mockResolvedValue(true);
    textChangeSubscription = { dispose: jest.fn() };
    saveSubscription = { dispose: jest.fn() };
    fileWatcher = { dispose: jest.fn() };
    (vscode.Uri.joinPath as jest.Mock).mockImplementation(() => uri('/ext/dist'));
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    (vscode.workspace.onDidChangeTextDocument as jest.Mock).mockReturnValue(textChangeSubscription);
    (vscode.workspace.onDidSaveTextDocument as jest.Mock).mockReturnValue(saveSubscription);
    (vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue({
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: fileWatcher.dispose,
    });
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([uri(corePath)]);
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('ip/uart.ip.yml');
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
      new TextEncoder().encode(
        "vlnv: { vendor: a, library: b, name: c, version: '1.2', versionScheme: major.minor }\nmemoryMaps:\n  import: ./uart.mm.yml\n"
      )
    );
  });

  function resolve(): void {
    const provider = new MemoryMapEditorProvider({
      extensionUri: uri('/ext'),
      extensionPath: '/ext',
      globalState: { get: jest.fn(), update: jest.fn() },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);
    const webview = {
      options: {},
      cspSource: 'vscode-resource:',
      asWebviewUri: jest.fn((target: vscode.Uri) => target),
      onDidReceiveMessage: jest.fn((listener: (message: unknown) => void) => {
        receive = listener;
        return { dispose: jest.fn() };
      }),
      postMessage,
    };
    const panel = {
      webview,
      onDidDispose: jest.fn((listener: () => void) => {
        onDispose = listener;
        return { dispose: jest.fn() };
      }),
    } as unknown as vscode.WebviewPanel;
    const document = {
      uri: uri('/ws/ip/uart.mm.yml'),
      getText: () => '',
      version: 1,
    } as unknown as vscode.TextDocument;
    provider.resolveCustomTextEditor(document, panel, {} as vscode.CancellationToken);
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  };

  it('does not watch or send anything before the webview is ready', () => {
    resolve();
    expect(postMessage).not.toHaveBeenCalled();
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('sends the update, then a versionContext notification, on ready', async () => {
    resolve();
    await receive?.({ type: 'ready' });
    await flush();

    const types = postMessage.mock.calls.map(([message]) => (message as { type: string }).type);
    expect(types).toEqual(['update', 'versionContext']);
    expect(postMessage.mock.calls[1][0]).toEqual({
      type: 'versionContext',
      context: {
        status: 'resolved',
        versionScheme: 'major.minor',
        version: '1.2',
        ipCorePath: 'ip/uart.ip.yml',
      },
    });
  });

  it('disposes the version watcher when the panel is disposed', async () => {
    resolve();
    await receive?.({ type: 'ready' });
    await flush();
    onDispose?.();

    expect(textChangeSubscription.dispose).toHaveBeenCalled();
    expect(saveSubscription.dispose).toHaveBeenCalledTimes(1);
    expect(fileWatcher.dispose).toHaveBeenCalledTimes(1);
  });

  it('replaces the watcher when the webview announces ready again', async () => {
    resolve();
    await receive?.({ type: 'ready' });
    await receive?.({ type: 'ready' });
    await flush();

    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
    expect(fileWatcher.dispose).toHaveBeenCalledTimes(1);
  });
});
