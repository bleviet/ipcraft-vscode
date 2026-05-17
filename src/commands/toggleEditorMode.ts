import * as vscode from 'vscode';

export async function openAsTextCommand(): Promise<void> {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!(activeTab?.input instanceof vscode.TabInputCustom)) {
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', activeTab.input.uri, 'default');
}

export async function openAsVisualCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    return;
  }
  const viewType = targetUri.fsPath.endsWith('.mm.yml')
    ? 'fpgaMemoryMap.editor'
    : 'fpgaIpCore.editor';
  await vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
}
