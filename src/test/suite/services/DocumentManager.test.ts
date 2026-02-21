import * as vscode from 'vscode';
import { DocumentManager } from '../../../services/DocumentManager';
import * as ErrorHandler from '../../../utils/ErrorHandler';

describe('DocumentManager', () => {
  let manager: DocumentManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new DocumentManager();
  });

  it('returns document text via getText', () => {
    const document = {
      getText: jest.fn().mockReturnValue('name: demo'),
    } as unknown as vscode.TextDocument;

    expect(manager.getText(document)).toBe('name: demo');
  });

  it('updates document content and returns true when edit is applied', async () => {
    const document = {
      uri: { fsPath: '/project/ip/core.yml' } as vscode.Uri,
      lineCount: 2,
      lineAt: jest.fn().mockReturnValue({ lineNumber: 1, text: 'tail' }),
    } as unknown as vscode.TextDocument;

    (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

    const success = await manager.updateDocument(document, 'name: updated');

    expect(success).toBe(true);
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    const editArg = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0] as {
      replace: jest.Mock;
    };
    expect(editArg.replace).toHaveBeenCalledWith(
      document.uri,
      expect.objectContaining({
        startLine: 0,
        startCharacter: 0,
        endLine: 1,
        endCharacter: 4,
      }),
      'name: updated'
    );
  });

  it('returns false when applyEdit returns false', async () => {
    const document = {
      uri: { fsPath: '/project/ip/core.yml' } as vscode.Uri,
      lineCount: 1,
      lineAt: jest.fn().mockReturnValue({ lineNumber: 0, text: 'x' }),
    } as unknown as vscode.TextDocument;

    (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(false);

    const success = await manager.updateDocument(document, 'x');

    expect(success).toBe(false);
  });

  it('handles update exceptions and returns false', async () => {
    const errorSpy = jest.spyOn(ErrorHandler, 'handleError').mockImplementation(() => {
      return undefined;
    });
    const document = {
      uri: { fsPath: '/project/ip/core.yml' } as vscode.Uri,
      lineCount: 1,
      lineAt: jest.fn().mockImplementation(() => {
        throw new Error('line failure');
      }),
    } as unknown as vscode.TextDocument;

    const success = await manager.updateDocument(document, 'x');

    expect(success).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error), 'DocumentManager.updateDocument');
  });

  it('saves document and propagates save result', async () => {
    const document = {
      save: jest.fn().mockResolvedValue(true),
    } as unknown as vscode.TextDocument;

    const success = await manager.saveDocument(document);

    expect(success).toBe(true);
    expect(document.save).toHaveBeenCalledTimes(1);
  });

  it('returns false when save returns false or throws', async () => {
    const errorSpy = jest.spyOn(ErrorHandler, 'handleError').mockImplementation(() => {
      return undefined;
    });
    const falseSaveDoc = {
      save: jest.fn().mockResolvedValue(false),
    } as unknown as vscode.TextDocument;
    const throwSaveDoc = {
      save: jest.fn().mockRejectedValue(new Error('save failure')),
    } as unknown as vscode.TextDocument;

    const resultFalse = await manager.saveDocument(falseSaveDoc);
    const resultThrow = await manager.saveDocument(throwSaveDoc);

    expect(resultFalse).toBe(false);
    expect(resultThrow).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error), 'DocumentManager.saveDocument');
  });

  it('gets relative path via workspace API', () => {
    const uri = {
      fsPath: '/project/ip/core.yml',
      toString: () => '/project/ip/core.yml',
    } as vscode.Uri;
    (vscode.workspace.asRelativePath as jest.Mock).mockReturnValue('ip/core.yml');

    const result = manager.getRelativePath(uri);

    expect(result).toBe('ip/core.yml');
    expect(vscode.workspace.asRelativePath).toHaveBeenCalledWith(uri, false);
  });
});
