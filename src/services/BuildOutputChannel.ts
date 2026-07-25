import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/** Shared output channel used by Build, Generate & Build, and vendor project-creation commands. */
export function getBuildOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('IPCraft Build');
  return outputChannel;
}
