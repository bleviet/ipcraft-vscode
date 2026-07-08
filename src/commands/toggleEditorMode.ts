import * as vscode from 'vscode';
import { EDITOR_VIEW_TYPE_MEMORY_MAP, EDITOR_VIEW_TYPE_IP_CORE } from '../utils/editorViewTypes';
import { isMmFile } from '../utils/fileExtensions';

export async function openAsTextCommand(): Promise<void> {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!(activeTab?.input instanceof vscode.TabInputCustom)) {
    return;
  }
  if (activeTab.input.viewType === 'fpgaIpCore.sourcePreview') {
    // Source previews (.vhd, _hw.tcl, component.xml) have no paired text tab — just close.
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } else {
    await vscode.commands.executeCommand('vscode.openWith', activeTab.input.uri, 'default');
  }
}

export async function openAsVisualCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    return;
  }
  const viewType = isMmFile(targetUri.fsPath)
    ? EDITOR_VIEW_TYPE_MEMORY_MAP
    : EDITOR_VIEW_TYPE_IP_CORE;
  await vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
}
