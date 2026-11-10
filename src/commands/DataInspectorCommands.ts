import * as path from 'path';
import * as vscode from 'vscode';
import { stringify } from 'yaml';
import type { IPCraftDataInspectorRecipe } from '../domain/dataInspector.types';
import { validateDataInspectorRecipe } from '../dataInspector/validateRecipe';
import { DataInspectorRegisterLayoutReader } from '../services/DataInspectorRegisterLayoutReader';
import type { ResourceRoots } from '../services/ResourceRoots';
import type { RegisterLayoutCopy } from '../shared/messages/dataInspector';
import { EDITOR_VIEW_TYPE_DATA_INSPECTOR } from '../utils/editorViewTypes';

export async function saveDataInspectorRecipeAs(
  recipe: IPCraftDataInspectorRecipe,
  extensionPath: string
): Promise<void> {
  validateDataInspectorRecipe(recipe, extensionPath);
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

export async function selectRegisterLayout(
  resourceRoots: ResourceRoots
): Promise<RegisterLayoutCopy | undefined> {
  const layouts = await new DataInspectorRegisterLayoutReader(resourceRoots).load();
  const selection = await vscode.window.showQuickPick(
    layouts.map((layout) => ({
      label: layout.label,
      description: layout.kind === 'port' ? `port · ${layout.width} bits` : `${layout.width} bits`,
      detail: path.dirname(layout.sourceFile),
      layout,
    })),
    {
      title: 'Open Register or Port in Data Inspector',
      placeHolder: 'Choose a register or port layout to copy',
    }
  );
  return selection?.layout;
}
