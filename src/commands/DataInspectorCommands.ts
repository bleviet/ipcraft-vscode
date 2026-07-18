import * as path from 'path';
import * as vscode from 'vscode';
import { stringify } from 'yaml';
import type { IPCraftDataInspectorRecipe } from '../domain/dataInspector.types';
import { DataInspectorRegisterLayoutReader } from '../services/DataInspectorRegisterLayoutReader';
import type { RegisterLayoutCopy } from '../shared/messages/dataInspector';
import { EDITOR_VIEW_TYPE_DATA_INSPECTOR } from '../utils/editorViewTypes';

export async function saveDataInspectorRecipeAs(recipe: IPCraftDataInspectorRecipe): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const rawUri = await vscode.window.showSaveDialog({
    defaultUri: workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder.uri, `${recipe.name || 'data-inspector'}.ipci.yml`)
      : undefined,
    saveLabel: 'Save Recipe',
    title: 'Save Data Inspector Recipe',
    filters: { 'IPCraft Data Inspector Recipe': ['ipci.yml'] },
  });
  if (!rawUri) {
    return;
  }
  const uri = rawUri.fsPath.endsWith('.ipci.yml')
    ? rawUri
    : vscode.Uri.file(rawUri.fsPath.replace(/\.(yml|yaml)$/, '') + '.ipci.yml');
  await vscode.workspace.fs.writeFile(
    uri,
    new Uint8Array(Buffer.from(stringify(recipe, { lineWidth: 0 })))
  );
  await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR_VIEW_TYPE_DATA_INSPECTOR);
}

export async function selectRegisterLayout(): Promise<RegisterLayoutCopy | undefined> {
  const layouts = await new DataInspectorRegisterLayoutReader().load();
  const selection = await vscode.window.showQuickPick(
    layouts.map((layout) => ({
      label: layout.label,
      description: `${layout.width} bits`,
      detail: path.dirname(layout.sourceFile),
      layout,
    })),
    { title: 'Open Register in Data Inspector', placeHolder: 'Choose a register layout to copy' }
  );
  return selection?.layout;
}
