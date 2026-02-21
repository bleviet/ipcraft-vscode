import * as vscode from 'vscode';
import { MessageHandler } from '../../../services/MessageHandler';
import { YamlValidator } from '../../../services/YamlValidator';
import { DocumentManager } from '../../../services/DocumentManager';
import { Logger } from '../../../utils/Logger';

type MockTextDocument = Pick<vscode.TextDocument, 'getText' | 'save' | 'uri'>;

describe('MessageHandler', () => {
  let yamlValidator: Pick<YamlValidator, 'validate'>;
  let documentManager: Pick<DocumentManager, 'updateDocument' | 'getText' | 'getRelativePath'>;
  let document: MockTextDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    (vscode.Uri.joinPath as jest.Mock).mockImplementation(
      (base: { fsPath?: string }, ...segments: string[]) => {
        const fsPath = [base?.fsPath ?? String(base), ...segments].join('/');
        return { fsPath, toString: () => fsPath };
      }
    );
    (vscode.commands as unknown as { executeCommand: jest.Mock }).executeCommand = jest.fn();

    yamlValidator = {
      validate: jest.fn().mockReturnValue({ valid: true }),
    };

    documentManager = {
      updateDocument: jest.fn().mockResolvedValue(true),
      getText: jest.fn().mockReturnValue('name: core'),
      getRelativePath: jest.fn().mockReturnValue('ip/core.yml'),
    };

    document = {
      getText: jest.fn().mockReturnValue('name: core'),
      save: jest.fn().mockResolvedValue(true),
      uri: { fsPath: '/project/ip/core.yml', toString: () => '/project/ip/core.yml' } as vscode.Uri,
    };
  });

  it('routes update messages to DocumentManager', async () => {
    const handler = new MessageHandler(
      yamlValidator as YamlValidator,
      documentManager as DocumentManager
    );

    await handler.handleMessage(
      { type: 'update', text: 'name: updated' },
      document as vscode.TextDocument
    );

    expect(documentManager.updateDocument).toHaveBeenCalledWith(document, 'name: updated');
  });

  it('handles save command by saving the document', async () => {
    const handler = new MessageHandler(
      yamlValidator as YamlValidator,
      documentManager as DocumentManager
    );

    await handler.handleMessage(
      { type: 'command', command: 'save' },
      document as vscode.TextDocument
    );

    expect(document.save).toHaveBeenCalledTimes(1);
  });

  it('handles validate command success and failure branches', async () => {
    const handler = new MessageHandler(
      yamlValidator as YamlValidator,
      documentManager as DocumentManager
    );

    await handler.handleMessage(
      { type: 'command', command: 'validate' },
      document as vscode.TextDocument
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('YAML parsed successfully.');

    (yamlValidator.validate as jest.Mock).mockReturnValueOnce({
      valid: false,
      error: 'bad yaml',
    });

    await handler.handleMessage(
      { type: 'command', command: 'validate' },
      document as vscode.TextDocument
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('YAML parse error: bad yaml');
  });

  it('handles openFile command and shows error when opening fails', async () => {
    const handler = new MessageHandler(
      yamlValidator as YamlValidator,
      documentManager as DocumentManager
    );
    const executeCommand = (vscode.commands as unknown as { executeCommand: jest.Mock })
      .executeCommand;

    await handler.handleMessage(
      { type: 'command', command: 'openFile', path: 'child.mm.yml' },
      document as vscode.TextDocument
    );

    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.objectContaining({ fsPath: '/project/ip/core.yml/../child.mm.yml' })
    );

    executeCommand.mockRejectedValueOnce(new Error('open failed'));

    await handler.handleMessage(
      { type: 'command', command: 'openFile', path: 'missing.mm.yml' },
      document as vscode.TextDocument
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to open file: missing.mm.yml'
    );
  });

  it('warns on unknown message and command types', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const handler = new MessageHandler(
      yamlValidator as YamlValidator,
      documentManager as DocumentManager
    );

    await handler.handleMessage({ type: 'unknown' }, document as vscode.TextDocument);
    await handler.handleMessage(
      { type: 'command', command: 'not-supported' },
      document as vscode.TextDocument
    );

    expect(warnSpy).toHaveBeenCalledWith('Unknown message type', 'unknown');
    expect(warnSpy).toHaveBeenCalledWith('Unknown command', 'not-supported');
  });

  it('sends update payload to webview', () => {
    const handler = new MessageHandler(
      yamlValidator as YamlValidator,
      documentManager as DocumentManager
    );
    const postMessage = jest.fn();

    handler.sendUpdate(
      { postMessage } as unknown as vscode.Webview,
      document as vscode.TextDocument
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: 'update',
      text: 'name: core',
      fileName: 'ip/core.yml',
    });
  });
});
