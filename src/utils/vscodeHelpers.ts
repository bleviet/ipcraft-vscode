import * as vscode from 'vscode';

/**
 * Register a command, ignoring "already exists" errors that occur when the
 * extension host restarts without a full deactivation cycle.
 */
export function safeRegisterCommand(
  context: vscode.ExtensionContext,
  command: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => any
): void {
  try {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  } catch {
    // Command was already registered by a previous (stale) activation
  }
}
