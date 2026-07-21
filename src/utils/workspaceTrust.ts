import * as vscode from 'vscode';

export const WORKSPACE_TRUST_REQUIRED_MESSAGE =
  'This IPCraft action is disabled in Restricted Mode because it can run generators, templates, or external FPGA tools.';

/**
 * Stop execution-capable features at their extension-host boundary. Manifest
 * enablement keeps the normal UI disabled; this guard also covers API and
 * webview-triggered command execution.
 */
export async function requireWorkspaceTrust(): Promise<boolean> {
  if (vscode.workspace.isTrusted) {
    return true;
  }

  const action = await vscode.window.showErrorMessage(
    WORKSPACE_TRUST_REQUIRED_MESSAGE,
    'Manage Workspace Trust'
  );
  if (action === 'Manage Workspace Trust') {
    await vscode.commands.executeCommand('workbench.trust.manage');
  }
  return false;
}
