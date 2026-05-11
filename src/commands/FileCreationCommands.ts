import * as vscode from 'vscode';
import * as path from 'path';
import { resolveVendor } from '../utils/resolveVendor';

const MEMORY_MAP_TEMPLATE = `- name: NEW_MEMORY_MAP
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

function resolveVendorFromSettings(): string {
  const cfg = vscode.workspace.getConfiguration('ipcraft.import');
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

export async function createIpCoreCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;
  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'new_ip_core.ip.yml');
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create File',
    title: 'Create new_ip_core.ip.yml',
    filters: { 'YAML Files': ['yml', 'yaml'] },
  });

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
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to create file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function createMemoryMapCommand(): Promise<void> {
  await createFileWithTemplate('new_memory_map.mm.yml', MEMORY_MAP_TEMPLATE);
}

export async function createIpCoreWithMemoryMapCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;

  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'new_ip_core.ip.yml');
  }

  const ipCoreUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create IP Core',
    title: 'Create IP Core with Memory Map',
    filters: {
      'YAML Files': ['yml', 'yaml'],
    },
  });

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

    await vscode.workspace.fs.writeFile(
      memoryMapUri,
      new Uint8Array(Buffer.from(MEMORY_MAP_TEMPLATE))
    );

    const vendor = resolveVendorFromSettings();
    const name = nameFromFilePath(ipCoreUri.fsPath);
    const ipCoreContent = generateIpCoreWithMemoryMapTemplate(vendor, name, memoryMapBaseName);
    await vscode.workspace.fs.writeFile(ipCoreUri, new Uint8Array(Buffer.from(ipCoreContent)));

    const document = await vscode.workspace.openTextDocument(ipCoreUri);
    await vscode.window.showTextDocument(document);

    void vscode.window.showInformationMessage(`Created ${ipCoreBaseName} and ${memoryMapBaseName}`);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to create files: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function createFileWithTemplate(defaultFileName: string, template: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;

  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, defaultFileName);
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Create File',
    title: `Create ${defaultFileName}`,
    filters: {
      'YAML Files': ['yml', 'yaml'],
    },
  });

  if (uri) {
    try {
      await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(template)));
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to create file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
