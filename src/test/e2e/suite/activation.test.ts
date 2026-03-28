/* eslint-disable */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Extension Activation Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('bleviet.ipcraft-vscode'));
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('bleviet.ipcraft-vscode');
    await extension?.activate();
    assert.strictEqual(extension?.isActive, true);
  });

  test('Should register custom editors', () => {
    const packageJson = vscode.extensions.getExtension('bleviet.ipcraft-vscode')?.packageJSON;
    const customEditors = packageJson.contributes.customEditors;

    const hasMemoryMapEditor = customEditors.some(
      (e: any) => e.viewType === 'fpgaMemoryMap.editor'
    );
    const hasIpCoreEditor = customEditors.some((e: any) => e.viewType === 'fpgaIpCore.editor');

    assert.strictEqual(hasMemoryMapEditor, true, 'Memory Map editor should be registered');
    assert.strictEqual(hasIpCoreEditor, true, 'IP Core editor should be registered');
  });

  test('Opening .mm.yml resolves to custom editor, not text editor', async () => {
    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/test.mm.yml'));

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.open', fixtureUri);

    // Give the custom editor provider time to resolve and render
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // A custom editor does NOT produce a TextEditor entry in visibleTextEditors
    const hasTextEditor = vscode.window.visibleTextEditors.some(
      (e) => e.document.uri.fsPath === fixtureUri.fsPath
    );
    assert.strictEqual(
      hasTextEditor,
      false,
      '.mm.yml should be handled by the custom editor provider, not the text editor'
    );

    // Verify the active tab's viewType is the memory map custom editor
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(activeTab, 'Should have an active tab after opening .mm.yml');
    const input = activeTab.input as vscode.TabInputCustom | undefined;
    assert.strictEqual(
      input?.viewType,
      'fpgaMemoryMap.editor',
      `Active tab viewType should be 'fpgaMemoryMap.editor', got '${input?.viewType}'`
    );

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('Opening .ip.yml resolves to custom editor, not text editor', async () => {
    const fixtureUri = vscode.Uri.file(path.resolve(__dirname, '../../fixtures/test.ip.yml'));

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.open', fixtureUri);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const hasTextEditor = vscode.window.visibleTextEditors.some(
      (e) => e.document.uri.fsPath === fixtureUri.fsPath
    );
    assert.strictEqual(
      hasTextEditor,
      false,
      '.ip.yml should be handled by the custom editor provider, not the text editor'
    );

    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(activeTab, 'Should have an active tab after opening .ip.yml');
    const input = activeTab.input as vscode.TabInputCustom | undefined;
    assert.strictEqual(
      input?.viewType,
      'fpgaIpCore.editor',
      `Active tab viewType should be 'fpgaIpCore.editor', got '${input?.viewType}'`
    );

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
