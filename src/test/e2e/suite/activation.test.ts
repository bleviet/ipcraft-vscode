/* eslint-disable */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseIpCore, parseMemoryMap } from '../../../domain/parse';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

async function readFixture(name: string): Promise<{ text: string; uri: vscode.Uri }> {
  const uri = vscode.Uri.file(path.join(FIXTURES_DIR, name));

  try {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(content).toString('utf8');
    assert.ok(text.trim(), `E2E fixture is empty: ${uri.fsPath}`);
    return { text, uri };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    assert.fail(`Unable to read E2E fixture ${uri.fsPath}: ${reason}`);
  }
}

suite('Extension Activation Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  setup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('bleviet.ipcraft-vscode'));
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('bleviet.ipcraft-vscode');
    await extension?.activate();
    assert.strictEqual(extension?.isActive, true);
  });

  test('Declares the active workspace trust contract', () => {
    const packageJson = vscode.extensions.getExtension('bleviet.ipcraft-vscode')?.packageJSON;
    const capability = packageJson.capabilities?.untrustedWorkspaces;

    assert.strictEqual(capability?.supported, 'limited');
    assert.ok(capability?.description.includes('Restricted Mode'));
    assert.strictEqual(
      typeof vscode.workspace.isTrusted,
      'boolean',
      'The extension host must expose the current workspace trust state'
    );
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

  test('Opening .mm.yml loads parsed content in the custom editor', async () => {
    const { text, uri: fixtureUri } = await readFixture('test.mm.yml');
    const parsed = parseMemoryMap(text);

    assert.strictEqual(parsed.map.name, 'TEST_MAP');
    assert.strictEqual(parsed.map.addressBlocks[0]?.name, 'REGS');
    assert.strictEqual(parsed.map.addressBlocks[0]?.registers[0]?.name, 'CTRL');
    assert.strictEqual(parsed.map.addressBlocks[0]?.registers[0]?.fields[0]?.name, 'ENABLE');

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
  });

  test('Opening .ip.yml loads parsed content in the custom editor', async () => {
    const { text, uri: fixtureUri } = await readFixture('test.ip.yml');
    const parsed = parseIpCore(text);
    const vlnv = parsed.vlnv as Record<string, unknown>;

    assert.strictEqual(vlnv.name, 'test_core');
    assert.strictEqual(parsed.description, 'Smoke test IP core');
    assert.deepStrictEqual(parsed.memoryMaps, { import: 'test.mm.yml' });

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
  });
});
