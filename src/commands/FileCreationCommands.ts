import * as vscode from 'vscode';
import * as path from 'path';
import { resolveVendor } from '../utils/resolveVendor';
import { isIpCoreFile } from '../utils/fileExtensions';
import { EDITOR_VIEW_TYPE_IP_CORE, EDITOR_VIEW_TYPE_MEMORY_MAP } from '../utils/editorViewTypes';
import { CONFIG_KEY_IPCRAFT_IMPORT } from '../utils/configKeys';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { stringify } from 'yaml';
import { createEmptyRecipe } from '../dataInspector/recipe';
import { EDITOR_VIEW_TYPE_DATA_INSPECTOR } from '../utils/editorViewTypes';

function generateMemoryMapTemplate(name: string): string {
  return `- name: ${name}
  description: Description of this memory map
  addressBlocks:
    - name: BLOCK_0
      offset: 0
      usage: register
      defaultRegWidth: 32
      registers:
        - name: CTRL
          offset: 0
          access: read-write
          description: Control register
          fields:
            - name: ENABLE
              bits: "[0:0]"
              access: read-write
              description: Enable bit
`;
}

function resolveVendorFromSettings(): string {
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_IMPORT);
  return resolveVendor(cfg.get<string>('vendor'));
}

function nameFromFilePath(fsPath: string): string {
  const base = path.basename(fsPath);
  if (base.endsWith('.ip.yml')) {
    return base.slice(0, -'.ip.yml'.length);
  }
  if (base.endsWith('.ip.yaml')) {
    return base.slice(0, -'.ip.yaml'.length);
  }
  if (base.endsWith('.yml')) {
    return base.slice(0, -'.yml'.length);
  }
  if (base.endsWith('.yaml')) {
    return base.slice(0, -'.yaml'.length);
  }
  return base;
}

function generateIpCoreTemplate(vendor: string, name: string): string {
  return `vlnv:
  vendor: ${vendor}
  library: my_library
  name: ${name}
  version: 1.0.0

description: A new IP Core definition

`;
}

function generateIpCoreWithMemoryMapTemplate(
  vendor: string,
  name: string,
  memoryMapFileName: string
): string {
  return `vlnv:
  vendor: ${vendor}
  library: my_library
  name: ${name}
  version: 1.0.0

description: A new IP Core definition

# Memory maps - linked from external file
memoryMaps:
  import: ${memoryMapFileName}
`;
}

function ensureExtension(uri: vscode.Uri, ext: string): vscode.Uri {
  const p = uri.fsPath;
  if (p.endsWith(ext)) {
    return uri;
  }
  // VS Code's YAML filter may auto-append .yml/.yaml — replace it with the compound ext
  if (p.endsWith('.yml') || p.endsWith('.yaml')) {
    return vscode.Uri.file(p.replace(/\.(yml|yaml)$/, ext));
  }
  return vscode.Uri.file(p + ext);
}

function stripCompoundExtension(filename: string, ext: string): string {
  return filename.endsWith(ext) ? filename.slice(0, -ext.length) : filename;
}

export async function createIpCoreCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;
  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'new_ip_core');
  }

  const rawUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create File',
    title: 'Create new_ip_core.ip.yml',
    filters: { 'YAML Files': ['yml', 'yaml'] },
  });

  const uri = rawUri ? ensureExtension(rawUri, '.ip.yml') : undefined;

  if (!uri) {
    return;
  }

  try {
    const vendor = resolveVendorFromSettings();
    const name = nameFromFilePath(uri.fsPath);
    await vscode.workspace.fs.writeFile(
      uri,
      new Uint8Array(Buffer.from(generateIpCoreTemplate(vendor, name)))
    );
    await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR_VIEW_TYPE_IP_CORE);
  } catch (error) {
    void handleErrorWithUserNotification(
      error,
      'createIpCoreCommand',
      `Failed to create file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function createMemoryMapCommand(): Promise<void> {
  let defaultFileName = 'new_memory_map.mm.yml';
  let defaultDir: vscode.Uri | undefined;
  let memoryMapName = 'NEW_MEMORY_MAP';

  const editor = vscode.window.activeTextEditor;
  if (editor && isIpCoreFile(editor.document.fileName)) {
    const ipCoreName = nameFromFilePath(editor.document.fileName);
    defaultFileName = `${ipCoreName}.mm.yml`;
    defaultDir = vscode.Uri.file(path.dirname(editor.document.fileName));
    memoryMapName = `${ipCoreName.toUpperCase()}_MEMMAP`;
  } else {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (
      activeTab?.input instanceof vscode.TabInputCustom &&
      isIpCoreFile(activeTab.input.uri.fsPath)
    ) {
      const ipCoreName = nameFromFilePath(activeTab.input.uri.fsPath);
      defaultFileName = `${ipCoreName}.mm.yml`;
      defaultDir = vscode.Uri.file(path.dirname(activeTab.input.uri.fsPath));
      memoryMapName = `${ipCoreName.toUpperCase()}_MEMMAP`;
    }
  }

  await createFileWithTemplate(
    defaultFileName,
    generateMemoryMapTemplate(memoryMapName),
    defaultDir,
    '.mm.yml'
  );
}

export async function createDataInspectorRecipeCommand(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const rawUri = await vscode.window.showSaveDialog({
    defaultUri: workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder.uri, 'new_data_inspector.ipci.yml')
      : undefined,
    saveLabel: 'Create Recipe',
    title: 'Create new_data_inspector.ipci.yml',
    filters: { 'IPCraft Data Inspector Recipe': ['ipci.yml'] },
  });
  const uri = rawUri ? ensureExtension(rawUri, '.ipci.yml') : undefined;
  if (!uri) {
    return;
  }
  try {
    const name = path.basename(uri.fsPath, '.ipci.yml');
    const text = stringify(createEmptyRecipe(name), { lineWidth: 0 });
    await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(text)));
    await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR_VIEW_TYPE_DATA_INSPECTOR);
  } catch (error) {
    void handleErrorWithUserNotification(
      error,
      'createDataInspectorRecipeCommand',
      `Failed to create recipe: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function createIpCoreWithMemoryMapCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;

  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'new_ip_core');
  }

  const rawIpCoreUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create IP Core',
    title: 'Create IP Core with Memory Map',
    filters: {
      'YAML Files': ['yml', 'yaml'],
    },
  });

  const ipCoreUri = rawIpCoreUri ? ensureExtension(rawIpCoreUri, '.ip.yml') : undefined;

  if (!ipCoreUri) {
    return;
  }

  try {
    const ipCoreBaseName = path.basename(ipCoreUri.fsPath);
    const ipCoreDir = path.dirname(ipCoreUri.fsPath);

    let memoryMapBaseName: string;
    if (ipCoreBaseName.endsWith('.ip.yml')) {
      memoryMapBaseName = ipCoreBaseName.slice(0, -'.ip.yml'.length) + '.mm.yml';
    } else if (ipCoreBaseName.endsWith('.yml')) {
      memoryMapBaseName = ipCoreBaseName.slice(0, -'.yml'.length) + '.mm.yml';
    } else {
      memoryMapBaseName = ipCoreBaseName + '.mm.yml';
    }

    const memoryMapUri = vscode.Uri.file(path.join(ipCoreDir, memoryMapBaseName));

    const vendor = resolveVendorFromSettings();
    const name = nameFromFilePath(ipCoreUri.fsPath);
    const memoryMapName = `${name.toUpperCase()}_MEMMAP`;
    await vscode.workspace.fs.writeFile(
      memoryMapUri,
      new Uint8Array(Buffer.from(generateMemoryMapTemplate(memoryMapName)))
    );
    const ipCoreContent = generateIpCoreWithMemoryMapTemplate(vendor, name, memoryMapBaseName);
    await vscode.workspace.fs.writeFile(ipCoreUri, new Uint8Array(Buffer.from(ipCoreContent)));

    await vscode.commands.executeCommand('vscode.openWith', ipCoreUri, EDITOR_VIEW_TYPE_IP_CORE);

    void vscode.window.showInformationMessage(`Created ${ipCoreBaseName} and ${memoryMapBaseName}`);
  } catch (error) {
    void handleErrorWithUserNotification(
      error,
      'createIpCoreWithMemoryMapCommand',
      `Failed to create files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function createFileWithTemplate(
  defaultFileName: string,
  template: string,
  defaultDir?: vscode.Uri,
  compoundExt?: string
): Promise<void> {
  let defaultUri: vscode.Uri | undefined;
  const dialogFileName = compoundExt
    ? stripCompoundExtension(defaultFileName, compoundExt)
    : defaultFileName;

  if (defaultDir) {
    defaultUri = vscode.Uri.joinPath(defaultDir, dialogFileName);
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, dialogFileName);
    }
  }

  const rawUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create File',
    title: `Create ${defaultFileName}`,
    filters: {
      'YAML Files': ['yml', 'yaml'],
    },
  });

  const uri = rawUri && compoundExt ? ensureExtension(rawUri, compoundExt) : rawUri;

  if (uri) {
    try {
      await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(template)));
      if (compoundExt === '.mm.yml') {
        await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR_VIEW_TYPE_MEMORY_MAP);
      } else {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
      }
    } catch (error) {
      void handleErrorWithUserNotification(
        error,
        'createFileWithTemplate',
        `Failed to create file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
