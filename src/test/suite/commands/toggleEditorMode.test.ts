import * as vscode from 'vscode';
import { openAsVisualCommand } from '../../../commands/toggleEditorMode';
import { EDITOR_VIEW_TYPE_DATA_INSPECTOR } from '../../../utils/editorViewTypes';

describe('openAsVisualCommand', () => {
  it('opens Data Inspector recipes in the Data Inspector editor', async () => {
    const uri = { fsPath: '/workspace/status.ipci.yml' } as vscode.Uri;

    await openAsVisualCommand(uri);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      uri,
      EDITOR_VIEW_TYPE_DATA_INSPECTOR
    );
  });
});
