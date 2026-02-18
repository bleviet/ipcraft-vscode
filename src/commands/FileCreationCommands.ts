import * as vscode from "vscode";
import * as path from "path";

const IP_CORE_TEMPLATE = `apiVersion: 1.0
vlnv:
  vendor: my_vendor
  library: my_library
  name: New_IP_Core
  version: 1.0.0

description: A new IP Core definition

`;

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

/**
 * Generate IP Core template with memory map reference
 */
function generateIpCoreWithMemoryMapTemplate(
  memoryMapFileName: string,
): string {
  return `apiVersion: 1.0
vlnv:
  vendor: my_vendor
  library: my_library
  name: New_IP_Core
  version: 1.0.0

description: A new IP Core definition

# Memory maps - linked from external file
memoryMaps:
  import: ${memoryMapFileName}
`;
}

export async function createIpCoreCommand(): Promise<void> {
  await createFileWithTemplate("new_ip_core.ip.yml", IP_CORE_TEMPLATE);
}

export async function createMemoryMapCommand(): Promise<void> {
  await createFileWithTemplate("new_memory_map.mm.yml", MEMORY_MAP_TEMPLATE);
}

export async function createIpCoreWithMemoryMapCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;

  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      "new_ip_core.ip.yml",
    );
  }

  // Prompt user for IP Core file location
  const ipCoreUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: "Create IP Core",
    title: "Create IP Core with Memory Map",
    filters: {
      "YAML Files": ["yml", "yaml"],
    },
  });

  if (!ipCoreUri) {
    return;
  }

  try {
    // Derive memory map filename from IP Core filename
    // e.g., my_core.ip.yml -> my_core.mm.yml
    const ipCoreBaseName = path.basename(ipCoreUri.fsPath);
    const ipCoreDir = path.dirname(ipCoreUri.fsPath);

    // Remove .ip.yml or .yml suffix and add .mm.yml
    let memoryMapBaseName: string;
    if (ipCoreBaseName.endsWith(".ip.yml")) {
      memoryMapBaseName =
        ipCoreBaseName.slice(0, -".ip.yml".length) + ".mm.yml";
    } else if (ipCoreBaseName.endsWith(".yml")) {
      memoryMapBaseName = ipCoreBaseName.slice(0, -".yml".length) + ".mm.yml";
    } else {
      memoryMapBaseName = ipCoreBaseName + ".mm.yml";
    }

    const memoryMapUri = vscode.Uri.file(
      path.join(ipCoreDir, memoryMapBaseName),
    );

    // Create memory map file
    await vscode.workspace.fs.writeFile(
      memoryMapUri,
      new Uint8Array(Buffer.from(MEMORY_MAP_TEMPLATE)),
    );

    // Create IP Core file with reference to memory map
    const ipCoreContent =
      generateIpCoreWithMemoryMapTemplate(memoryMapBaseName);
    await vscode.workspace.fs.writeFile(
      ipCoreUri,
      new Uint8Array(Buffer.from(ipCoreContent)),
    );

    // Open the IP Core file
    const document = await vscode.workspace.openTextDocument(ipCoreUri);
    await vscode.window.showTextDocument(document);

    vscode.window.showInformationMessage(
      `Created ${ipCoreBaseName} and ${memoryMapBaseName}`,
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to create files: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function createFileWithTemplate(
  defaultFileName: string,
  template: string,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let defaultUri: vscode.Uri | undefined;

  if (workspaceFolders && workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(workspaceFolders[0].uri, defaultFileName);
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: "Create File",
    title: `Create ${defaultFileName}`,
    filters: {
      "YAML Files": ["yml", "yaml"],
    },
  });

  if (uri) {
    try {
      await vscode.workspace.fs.writeFile(
        uri,
        new Uint8Array(Buffer.from(template)),
      );
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
