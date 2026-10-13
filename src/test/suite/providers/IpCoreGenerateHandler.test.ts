import * as vscode from 'vscode';
import { handleGenerateRequest } from '../../../providers/IpCoreGenerateHandler';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { ensureRegisterSetsReleased } from '../../../services/versioning/RegisterSetReleaseService';
import { requireWorkspaceTrust } from '../../../utils/workspaceTrust';
import type { DocumentManager } from '../../../services/DocumentManager';
import type { ResourceRoots } from '../../../services/ResourceRoots';
import type { Logger } from '../../../utils/Logger';

jest.mock('../../../generator/IpCoreScaffolder', () => ({ IpCoreScaffolder: jest.fn() }));
jest.mock('../../../generator/TemplateLoader', () => ({ TemplateLoader: jest.fn() }));
jest.mock('../../../utils/workspaceTrust', () => ({ requireWorkspaceTrust: jest.fn() }));
jest.mock('../../../services/versioning/RegisterSetReleaseService', () => ({
  ensureRegisterSetsReleased: jest.fn(),
}));

describe('handleGenerateRequest register-set versioning', () => {
  const document = {
    uri: { fsPath: '/proj/core.ip.yml' },
    getText: jest.fn(() => 'vlnv: {}\n'),
  } as unknown as vscode.TextDocument;
  const postMessage = jest.fn();
  let generateAll: jest.Mock;

  const run = (): Promise<void> =>
    handleGenerateRequest({
      logger: { info: jest.fn(), error: jest.fn() } as unknown as Logger,
      resourceRoots: { templatesDir: '/templates' } as ResourceRoots,
      documentManager: {} as DocumentManager,
      document,
      webview: { postMessage } as unknown as vscode.Webview,
      message: {},
      refreshWebview: jest.fn(),
    });

  beforeEach(() => {
    (requireWorkspaceTrust as jest.Mock).mockResolvedValue(true);
    (vscode.Uri.file as jest.Mock).mockImplementation((p: string) => ({ fsPath: p }));
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    });
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: '/out' }]);
    generateAll = jest.fn().mockResolvedValue({ success: false, error: 'stop here' });
    (IpCoreScaffolder as jest.Mock).mockImplementation(() => ({ generateAll }));
  });

  it('does not generate and reports a failed result when the release is cancelled', async () => {
    (ensureRegisterSetsReleased as jest.Mock).mockResolvedValue({ proceed: false });

    await run();

    expect(ensureRegisterSetsReleased).toHaveBeenCalledWith(document.uri);
    expect(generateAll).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'generateResult', success: false })
    );
  });

  it('generates after the release proceeds', async () => {
    (ensureRegisterSetsReleased as jest.Mock).mockResolvedValue({ proceed: true });

    await run();

    expect(generateAll).toHaveBeenCalledTimes(1);
    expect(generateAll).toHaveBeenCalledWith('/proj/core.ip.yml', '/out', expect.anything());
  });
});
