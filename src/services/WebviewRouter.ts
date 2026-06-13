import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { DocumentManager } from './DocumentManager';
import { YamlValidator } from './YamlValidator';

export interface RouterOptions {
  webviewPanel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  logger: Logger;
  commandAllowlist?: ReadonlySet<string>;
  onReady: () => Promise<void> | void;
}

export class WebviewRouter<M extends { type: string } = { type: string }> {
  private readonly webviewPanel: vscode.WebviewPanel;
  private readonly document: vscode.TextDocument;
  private readonly logger: Logger;
  private readonly commandAllowlist?: ReadonlySet<string>;
  private readonly onReady: () => Promise<void> | void;
  private readonly disposables: vscode.Disposable[] = [];
  private isReady = false;
  private isDisposed = false;
  private readonly handlers = new Map<string, (message: unknown) => Promise<void> | void>();
  private pendingUpdates: unknown[] = [];

  // Monotonic pending edit IDs for V-3 FIFO pairing
  private readonly pendingEditIds: number[] = [];

  constructor(options: RouterOptions) {
    this.webviewPanel = options.webviewPanel;
    this.document = options.document;
    this.logger = options.logger;
    this.commandAllowlist = options.commandAllowlist;
    this.onReady = options.onReady;

    this.webviewPanel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (this.isDisposed) {
          return;
        }

        if (
          !message ||
          typeof message !== 'object' ||
          !('type' in message) ||
          typeof (message as { type: unknown }).type !== 'string'
        ) {
          this.logger.warn('Received invalid message format from webview');
          return;
        }

        const typedMessage = message as M;
        const msgType = typedMessage.type;

        this.logger.debug(`Received message from webview: ${msgType}`);

        if (msgType === 'ready') {
          this.isReady = true;
          this.logger.info('Webview ready handshake received');
          try {
            await this.onReady();
          } catch (err) {
            this.logger.error('Error in onReady callback', err as Error);
          }
          // Flush any pending updates
          while (this.pendingUpdates.length > 0) {
            const payload = this.pendingUpdates.shift();
            this.postMessage(payload);
          }
          return;
        }

        const handler = this.handlers.get(msgType);
        if (handler) {
          try {
            await handler(typedMessage);
          } catch (err) {
            this.logger.error(`Error in handler for type "${msgType}"`, err as Error);
          }
        } else {
          this.logger.warn(`No handler registered for message type: ${msgType}`);
        }
      },
      null,
      this.disposables
    );

    this.webviewPanel.onDidDispose(
      () => {
        this.dispose();
      },
      null,
      this.disposables
    );
  }

  on<T extends M['type']>(
    type: T,
    handler: (message: Extract<M, { type: T }>) => Promise<void> | void
  ): this {
    this.handlers.set(type, handler as (message: unknown) => Promise<void> | void);
    return this;
  }

  useStandardDocumentHandlers(
    documentManager: DocumentManager,
    yamlValidator: YamlValidator,
    onForceResync?: () => void
  ): this {
    this.on('update', async (message) => {
      // Cast the message to access properties since update is a standard protocol message type
      const msg = message as unknown as { text: string; editId?: number; baseDocVersion?: number };
      if (msg.editId !== undefined) {
        this.pendingEditIds.push(msg.editId);
      }
      const result = await documentManager.updateDocument(
        this.document,
        msg.text,
        msg.baseDocVersion
      );

      if (result.type === 'rejected') {
        if (msg.editId !== undefined) {
          const idx = this.pendingEditIds.indexOf(msg.editId);
          if (idx !== -1) {
            this.pendingEditIds.splice(idx, 1);
          }
        }

        if (result.reason === 'stale-base') {
          void vscode.window.showWarningMessage(
            `File "${documentManager.getRelativePath(this.document.uri)}" has changed on disk. Visual editor has been reloaded.`
          );
        }

        // `forceResync` tells the webview to re-parse this update unconditionally.
        // A concurrent external edit can be mislabeled as an echo of the rejected
        // webview edit (FIFO pairing) and dropped, and the version it bumped would
        // make this resync look stale — so the webview must accept it regardless.
        if (result.reason === 'stale-base' && onForceResync) {
          // Let the caller do a full update (e.g. IP core needs imports, hasComponentXml, etc.)
          onForceResync();
        } else {
          this.postUpdate({
            text: documentManager.getText(this.document),
            fileName: documentManager.getRelativePath(this.document.uri),
            forceResync: result.reason === 'stale-base',
          });
        }
      } else if (result.type === 'noop') {
        if (msg.editId !== undefined) {
          const idx = this.pendingEditIds.indexOf(msg.editId);
          if (idx !== -1) {
            this.pendingEditIds.splice(idx, 1);
          }
        }
      }
    });

    this.on('command', async (message) => {
      const msg = message as unknown as { command: string; path?: string };
      if (this.commandAllowlist && !this.commandAllowlist.has(msg.command)) {
        const isStandard = ['save', 'validate', 'openFile'].includes(msg.command);
        if (!isStandard) {
          this.logger.warn(`Blocked non-allowlisted command: ${msg.command}`);
          return;
        }
      }

      switch (msg.command) {
        case 'save':
          await documentManager.saveDocument(this.document);
          this.logger.info('Document saved');
          break;
        case 'validate': {
          const res = yamlValidator.validate(documentManager.getText(this.document));
          if (res.valid) {
            void vscode.window.showInformationMessage('YAML parsed successfully.');
            this.logger.info('YAML validation successful');
          } else {
            void vscode.window.showErrorMessage(
              `YAML parse error: ${res.error ?? 'Unknown error'}`
            );
            this.logger.warn('YAML validation failed', res.error);
          }
          break;
        }
        case 'openFile':
          if (msg.path) {
            try {
              const currentDir = vscode.Uri.joinPath(this.document.uri, '..');
              const targetUri = vscode.Uri.joinPath(currentDir, msg.path);
              await vscode.commands.executeCommand('vscode.open', targetUri);
              this.logger.info('Opened file:', targetUri.toString());
            } catch (e) {
              this.logger.error('Failed to open file', e as Error);
              void vscode.window.showErrorMessage(`Failed to open file: ${msg.path}`);
            }
          }
          break;
        default:
          this.logger.warn(`Unknown command: ${msg.command}`);
      }
    });

    return this;
  }

  popSourceEditId(): number | undefined {
    return this.pendingEditIds.shift();
  }

  handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
    if (event.document.uri.toString() !== this.document.uri.toString()) {
      return;
    }
    const sourceEditId = this.popSourceEditId();
    this.postUpdate({
      text: event.document.getText(),
      sourceEditId,
    });
  }

  /**
   * Push an update to the webview.
   *
   * `docVersion` stamps the document version this `text` corresponds to. It
   * defaults to the live document version, but callers that read `text`
   * asynchronously (e.g. after resolving imports) must pass the version they
   * captured alongside the text — otherwise a concurrent edit could advance the
   * live version and the webview would record a version that does not match the
   * (older) text it received, dropping the genuine follow-up update as stale.
   */
  postUpdate(payload: unknown, docVersion: number = this.document.version) {
    const msg = {
      ...(payload as Record<string, unknown>),
      type: 'update',
      docVersion,
    };
    if (!this.isReady) {
      this.pendingUpdates = [msg];
      this.logger.debug('Queueing update message until webview is ready');
      return;
    }
    this.postMessage(msg);
  }

  private postMessage(message: unknown) {
    if (!this.isDisposed) {
      void this.webviewPanel.webview.postMessage(message);
    }
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.disposables.forEach((d) => {
      d.dispose();
    });
    this.disposables.length = 0;
    this.handlers.clear();
    this.pendingUpdates = [];
    this.logger.debug('WebviewRouter disposed');
  }
}
