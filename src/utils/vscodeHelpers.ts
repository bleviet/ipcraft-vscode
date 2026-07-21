import * as vscode from 'vscode';
import { requireWorkspaceTrust } from './workspaceTrust';

interface RegisterCommandOptions {
  requiresWorkspaceTrust?: boolean;
}

/**
 * Register a command, ignoring "already exists" errors that occur when the
 * extension host restarts without a full deactivation cycle.
 */
export function safeRegisterCommand(
  context: vscode.ExtensionContext,
  command: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => unknown,
  options: RegisterCommandOptions = {}
): void {
  try {
    const guardedHandler = options.requiresWorkspaceTrust
      ? async (...args: unknown[]) => {
          if (await requireWorkspaceTrust()) {
            return handler(...args);
          }
          return undefined;
        }
      : handler;
    context.subscriptions.push(vscode.commands.registerCommand(command, guardedHandler));
  } catch {
    // Command was already registered by a previous (stale) activation
  }
}
