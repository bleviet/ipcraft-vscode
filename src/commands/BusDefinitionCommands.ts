import * as vscode from 'vscode';
import * as path from 'path';
import { ResourceRoots } from '../services/ResourceRoots';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

/**
 * Let the user pick a bus definition file and open it in a read-only editor tab
 */
export async function viewBusDefinitions(resourceRoots: ResourceRoots): Promise<void> {
  const busDirPath = resourceRoots.busDefinitionsDir;
  const dirUri = vscode.Uri.file(busDirPath);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch (error) {
    void handleErrorWithUserNotification(
      error,
      'listBusDefinitions.readDirectory',
      `Failed to open bus definitions: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const ymlFiles = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.yml'))
    .map(([name]) => name)
    .sort();

  if (ymlFiles.length === 0) {
    void vscode.window.showInformationMessage('No bus definitions found.');
    return;
  }

  const selected = await vscode.window.showQuickPick(ymlFiles, {
    placeHolder: 'Select a bus definition to view',
    title: 'Bus Definitions',
  });

  if (!selected) {
    return;
  }

  const uri = vscode.Uri.file(path.join(busDirPath, selected));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
    });
  } catch (error) {
    void handleErrorWithUserNotification(
      error,
      'listBusDefinitions.openDocument',
      `Failed to open bus definition: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
