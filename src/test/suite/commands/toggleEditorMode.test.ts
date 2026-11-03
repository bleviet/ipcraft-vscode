import * as vscode from 'vscode';
import { openAsTextCommand, openAsVisualCommand } from '../../../commands/toggleEditorMode';
import {
  EDITOR_VIEW_TYPE_DATA_INSPECTOR,
  EDITOR_VIEW_TYPE_SYSTEM_DIAGRAM,
} from '../../../utils/editorViewTypes';

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

describe('openAsTextCommand', () => {
  it('reopens the system diagram as a text editor with the default editor', async () => {
    const uri = { fsPath: '/workspace/system.tcl' } as vscode.Uri;
    const activeTabGroup = vscode.window.tabGroups.activeTabGroup as unknown as {
      activeTab: { input: unknown } | undefined;
    };
    activeTabGroup.activeTab = {
      input: new vscode.TabInputCustom(uri, EDITOR_VIEW_TYPE_SYSTEM_DIAGRAM),
    };

    await openAsTextCommand();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode.openWith', uri, 'default');
  });
});
