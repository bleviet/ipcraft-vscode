/* eslint-disable */
import * as assert from 'assert';
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
});
