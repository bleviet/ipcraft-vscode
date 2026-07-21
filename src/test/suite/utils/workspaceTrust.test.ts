import * as vscode from 'vscode';
import { safeRegisterCommand } from '../../../utils/vscodeHelpers';
import { WORKSPACE_TRUST_REQUIRED_MESSAGE } from '../../../utils/workspaceTrust';

describe('workspace trust command guard', () => {
  const workspace = vscode.workspace as typeof vscode.workspace & { isTrusted: boolean };
  const registerCommand = vscode.commands.registerCommand as jest.Mock;
  const showErrorMessage = vscode.window.showErrorMessage as jest.Mock;
  const executeCommand = vscode.commands.executeCommand as jest.Mock;
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    context.subscriptions.length = 0;
    workspace.isTrusted = true;
  });

  it('runs a trust-requiring command in a trusted workspace', async () => {
    const handler = jest.fn();
    safeRegisterCommand(context, 'ipcraft.test', handler, { requiresWorkspaceTrust: true });

    const registered = registerCommand.mock.calls[0][1] as () => Promise<void>;
    await registered();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('blocks a trust-requiring command in an untrusted workspace', async () => {
    workspace.isTrusted = false;
    const handler = jest.fn();
    safeRegisterCommand(context, 'ipcraft.test', handler, { requiresWorkspaceTrust: true });

    const registered = registerCommand.mock.calls[0][1] as () => Promise<void>;
    await registered();

    expect(handler).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledWith(
      WORKSPACE_TRUST_REQUIRED_MESSAGE,
      'Manage Workspace Trust'
    );
  });

  it('opens Workspace Trust management when requested', async () => {
    workspace.isTrusted = false;
    showErrorMessage.mockResolvedValue('Manage Workspace Trust');
    safeRegisterCommand(context, 'ipcraft.test', jest.fn(), { requiresWorkspaceTrust: true });

    const registered = registerCommand.mock.calls[0][1] as () => Promise<void>;
    await registered();

    expect(executeCommand).toHaveBeenCalledWith('workbench.trust.manage');
  });

  it('leaves read-only commands available in an untrusted workspace', async () => {
    workspace.isTrusted = false;
    const handler = jest.fn();
    safeRegisterCommand(context, 'ipcraft.readOnly', handler);

    const registered = registerCommand.mock.calls[0][1] as () => Promise<void>;
    await registered();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });
});
