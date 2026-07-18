import * as vscode from 'vscode';
import { createEmptyRecipe } from '../../../dataInspector/recipe';
import { saveDataInspectorRecipeAs } from '../../../commands/DataInspectorCommands';
import { EDITOR_VIEW_TYPE_DATA_INSPECTOR } from '../../../utils/editorViewTypes';

describe('Data Inspector commands', () => {
  it('offers and writes the compound .ipci.yml recipe extension', async () => {
    jest
      .mocked(vscode.Uri.file)
      .mockImplementation(
        (filePath) => ({ fsPath: filePath, toString: () => filePath }) as unknown as vscode.Uri
      );
    jest
      .mocked(vscode.window.showSaveDialog)
      .mockImplementation(async () => vscode.Uri.file('/workspace/demo'));

    await saveDataInspectorRecipeAs(createEmptyRecipe('address-decode'));

    expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { 'IPCraft Data Inspector Recipe': ['ipci.yml'] },
      })
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: '/workspace/demo.ipci.yml' }),
      expect.any(Uint8Array)
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      expect.objectContaining({ fsPath: '/workspace/demo.ipci.yml' }),
      EDITOR_VIEW_TYPE_DATA_INSPECTOR
    );
  });
});
