import * as vscode from 'vscode';
import { WebviewRouter } from '../../../services/WebviewRouter';
import { DocumentManager } from '../../../services/DocumentManager';
import { YamlValidator } from '../../../services/YamlValidator';
import { Logger } from '../../../utils/Logger';

type MockTextDocument = Pick<vscode.TextDocument, 'getText' | 'save' | 'uri' | 'version'>;

describe('WebviewRouter', () => {
  let webviewPanel: any;
  let document: MockTextDocument;
  let documentManager: any;
  let yamlValidator: any;
  let onReadyMock: jest.Mock;
  let messageListener: ((message: any) => Promise<void> | void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();

    messageListener = undefined;

    webviewPanel = {
      webview: {
        onDidReceiveMessage: jest.fn().mockImplementation((listener) => {
          messageListener = listener;
          return { dispose: jest.fn() };
        }),
        postMessage: jest.fn().mockResolvedValue(true),
      },
      onDidDispose: jest.fn().mockImplementation(() => {
        return { dispose: jest.fn() };
      }),
    };

    document = {
      getText: jest.fn().mockReturnValue('name: core'),
      save: jest.fn().mockResolvedValue(true),
      uri: { fsPath: '/project/ip/core.yml', toString: () => '/project/ip/core.yml' } as vscode.Uri,
      version: 1,
    };

    documentManager = {
      updateDocument: jest.fn().mockResolvedValue({ type: 'applied' }),
      saveDocument: jest.fn().mockResolvedValue(true),
      getText: jest.fn().mockReturnValue('name: core'),
      getRelativePath: jest.fn().mockReturnValue('ip/core.yml'),
    };

    yamlValidator = {
      validate: jest.fn().mockReturnValue({ valid: true }),
    };

    onReadyMock = jest.fn();

    (vscode.Uri.joinPath as jest.Mock).mockImplementation(
      (base: { fsPath?: string }, ...segments: string[]) => {
        const fsPath = [base?.fsPath ?? String(base), ...segments].join('/');
        return { fsPath, toString: () => fsPath };
      }
    );
    (vscode.commands as unknown as { executeCommand: jest.Mock }).executeCommand = jest.fn();
  });

  it('queues updates until ready, then flushes them', async () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.postUpdate({ data: 'first' });

    expect(webviewPanel.webview.postMessage).not.toHaveBeenCalled();

    // Trigger ready message
    if (messageListener) {
      await messageListener({ type: 'ready' });
    }

    expect(onReadyMock).toHaveBeenCalledTimes(1);
    expect(webviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'update',
      data: 'first',
      docVersion: 1,
    });
  });

  it('routes custom messages through registered handlers', async () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    const handler = jest.fn();
    router.on('customEvent', handler);

    if (messageListener) {
      await messageListener({ type: 'customEvent', payload: 'test' });
    }

    expect(handler).toHaveBeenCalledWith({ type: 'customEvent', payload: 'test' });
  });

  it('handles standard update messages and revision FIFO tracking', async () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.useStandardDocumentHandlers(
      documentManager as DocumentManager,
      yamlValidator as YamlValidator
    );

    if (messageListener) {
      await messageListener({ type: 'update', text: 'new text', editId: 101, baseDocVersion: 1 });
    }

    expect(documentManager.updateDocument).toHaveBeenCalledWith(document, 'new text', 1);
    expect(router.popSourceEditId()).toBe(101);
  });

  it('exposes FIFO edit pairing for custom structured editors', () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.trackSourceEditId(11);
    router.trackSourceEditId(12);
    router.forgetSourceEditId(11);

    expect(router.popSourceEditId()).toBe(12);
  });

  it('force-resyncs the webview when an edit is rejected as stale-base', async () => {
    // Models the V-3/V-4 interleave: a webview edit is based on a version the
    // document has since moved past (e.g. an external edit landed first), so the
    // host rejects it. The external change event may have already been mislabeled
    // as an echo of this (now rejected) edit and dropped, so the resync MUST carry
    // `forceResync` for the webview to accept the document's current text.
    (documentManager.updateDocument as jest.Mock).mockResolvedValue({
      type: 'rejected',
      reason: 'stale-base',
    });
    (documentManager.getText as jest.Mock).mockReturnValue('name: disk');

    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.useStandardDocumentHandlers(
      documentManager as DocumentManager,
      yamlValidator as YamlValidator
    );

    // onReady is a no-op mock, so becoming ready posts nothing; the only
    // postMessage that follows is the rejection resync we assert on.
    if (messageListener) {
      await messageListener({ type: 'ready' });
      await messageListener({
        type: 'update',
        text: 'name: webview',
        editId: 7,
        baseDocVersion: 1,
      });
    }

    // The rejected edit's id must not linger — otherwise the next change event
    // would be paired with it and treated as a self-echo.
    expect(router.popSourceEditId()).toBeUndefined();

    expect(webviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update',
        text: 'name: disk',
        forceResync: true,
      })
    );
  });

  it('resyncs without forcing when an edit is rejected for a non-version reason', async () => {
    (documentManager.updateDocument as jest.Mock).mockResolvedValue({
      type: 'rejected',
      reason: 'error',
    });
    (documentManager.getText as jest.Mock).mockReturnValue('name: disk');

    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.useStandardDocumentHandlers(
      documentManager as DocumentManager,
      yamlValidator as YamlValidator
    );

    if (messageListener) {
      await messageListener({ type: 'ready' });
      await messageListener({
        type: 'update',
        text: 'name: webview',
        editId: 9,
        baseDocVersion: 1,
      });
    }

    expect(webviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update',
        text: 'name: disk',
        forceResync: false,
      })
    );
  });

  it('handles save, validate and openFile commands', async () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.useStandardDocumentHandlers(
      documentManager as DocumentManager,
      yamlValidator as YamlValidator
    );

    if (messageListener) {
      await messageListener({ type: 'command', command: 'save' });
      await messageListener({ type: 'command', command: 'validate' });
      await messageListener({ type: 'command', command: 'openFile', path: 'other.yml' });
    }

    expect(documentManager.saveDocument).toHaveBeenCalledWith(document);
    expect(yamlValidator.validate).toHaveBeenCalledWith('name: core');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ fsPath: '/project/ip/core.yml/../other.yml' })
    );
  });

  it('respects command allow-list and blocks non-allowlisted commands', async () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      commandAllowlist: new Set(['fpga-ip-core.scaffoldProject']),
      onReady: onReadyMock,
    });

    router.useStandardDocumentHandlers(
      documentManager as DocumentManager,
      yamlValidator as YamlValidator
    );

    if (messageListener) {
      // Standard commands like save/validate are always allowed
      await messageListener({ type: 'command', command: 'save' });
      // Non-allowlisted custom commands are blocked
      await messageListener({ type: 'command', command: 'blocked.command' });
    }

    expect(documentManager.saveDocument).toHaveBeenCalledWith(document);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('disposes resources on disposal', () => {
    const router = new WebviewRouter({
      webviewPanel,
      document: document as vscode.TextDocument,
      logger: new Logger('TestRouter'),
      onReady: onReadyMock,
    });

    router.dispose();

    expect(router.popSourceEditId()).toBeUndefined();
  });
});
