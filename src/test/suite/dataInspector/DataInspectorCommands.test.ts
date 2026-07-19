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

    await saveDataInspectorRecipeAs(createEmptyRecipe('address-decode'), process.cwd());

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

  it('rejects an invalid recipe before offering a save location', async () => {
    const recipe = createEmptyRecipe('invalid');
    recipe.sources[0].width = 0;

    await expect(saveDataInspectorRecipeAs(recipe, process.cwd())).rejects.toThrow();

    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a schema-valid recipe with semantic conflicts before writing', async () => {
    const recipe = createEmptyRecipe('overlapping');
    recipe.fields = ['field-a', 'field-b'].map((id) => ({
      id,
      name: id.toUpperCase(),
      sourceId: 'input',
      msb: 1,
      lsb: 0,
      groupId: 'default',
      display: { interpretation: 'hex' as const },
    }));

    await expect(saveDataInspectorRecipeAs(recipe, process.cwd())).rejects.toThrow('overlaps');

    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});
