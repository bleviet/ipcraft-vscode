import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Shared "IPCraft Register Debug" Output Channel — carries the raw
 * System Console / xsdb dialogue for every register transaction, the same
 * pattern BuildCommands.ts uses for the "IPCraft Build" channel.
 */
export function getRegisterDebugOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('IPCraft Register Debug');
  return outputChannel;
}
