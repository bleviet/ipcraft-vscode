import * as path from 'path';
import * as jsyaml from 'js-yaml';
import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { updateFileSets } from '../services/FileSetUpdater';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';
import { Logger } from '../utils/Logger';
import { DocumentManager } from '../services/DocumentManager';

export interface GenerateOptionsMessage {
  vendorFiles?: 'none' | 'intel' | 'xilinx' | 'both';
  includeTestbench?: boolean;
  includeRegfile?: boolean;
  includeVhdl?: boolean;
}

export interface GenerateRequestMessage {
  options?: GenerateOptionsMessage;
}

type FileSet = {
  name?: string;
  description?: string;
  files?: { path: string; type: string }[];
};

interface HandleGenerateOptions {
  logger: Logger;
  context: vscode.ExtensionContext;
  documentManager: DocumentManager;
  document: vscode.TextDocument;
  webview: vscode.Webview;
  message: GenerateRequestMessage;
  refreshWebview: () => Promise<void>;
}

export async function handleGenerateRequest({
  logger,
  context,
  documentManager,
  document,
  webview,
  message,
  refreshWebview,
}: HandleGenerateOptions): Promise<void> {
  logger.info('Generate request received', message.options as Record<string, unknown> | undefined);

  const baseDir = path.dirname(document.uri.fsPath);
  const text = document.getText();
  const rawData = jsyaml.load(text) as { vlnv?: { name?: string } };
  const ipName = rawData.vlnv?.name?.toLowerCase() ?? 'ip_core';

  const folderUris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Output Folder',
    title: 'Select Output Directory for Generated Files',
    defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)),
  });

  if (!folderUris || folderUris.length === 0) {
    void webview.postMessage({
      type: 'generateResult',
      success: false,
      error: 'No output directory selected',
    });
    return;
  }

  const outputBaseDir = path.join(folderUris[0].fsPath, ipName);

  const generator = new IpCoreScaffolder(logger, new TemplateLoader(logger), context);
  const result = await generator.generateAll(document.uri.fsPath, outputBaseDir, {
    vendor: message.options?.vendorFiles ?? 'both',
    includeTestbench: message.options?.includeTestbench !== false,
    includeRegs: message.options?.includeRegfile !== false,
    includeVhdl: message.options?.includeVhdl !== false,
    updateYaml: false,
  });

  if (!result.success) {
    void webview.postMessage({
      type: 'generateResult',
      success: false,
      error: result.error ?? 'Generation failed',
    });
    return;
  }

  const writtenFiles = result.files ? Object.keys(result.files) : [];
  logger.info(`Generated ${writtenFiles.length} files to ${outputBaseDir}`);

  void webview.postMessage({
    type: 'generateResult',
    success: true,
    files: writtenFiles,
  });

  const action = await vscode.window.showInformationMessage(
    `Generated ${writtenFiles.length} files to ${outputBaseDir}`,
    'Open Folder'
  );

  if (action === 'Open Folder') {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputBaseDir));
  }

  try {
    const doc = YAML.parseDocument(document.getText());

    const yamlRelativeFiles = writtenFiles.map((f) => {
      const absolutePath = path.join(outputBaseDir, f);
      return path.relative(baseDir, absolutePath);
    });

    const currentData = doc.toJSON() as Record<string, unknown>;
    const fileSets: FileSet[] = Array.isArray(currentData.fileSets)
      ? (currentData.fileSets as FileSet[])
      : Array.isArray(currentData.file_sets)
        ? (currentData.file_sets as FileSet[])
        : [];

    const key = currentData.fileSets
      ? 'fileSets'
      : currentData.file_sets
        ? 'file_sets'
        : 'fileSets';
    const updatedFileSets = updateFileSets(fileSets, yamlRelativeFiles) as FileSet[];
    doc.setIn([key], updatedFileSets);

    const newText = doc.toString();
    const updateSuccess = await documentManager.updateDocument(document, newText);
    if (updateSuccess) {
      logger.info('Updated file sets with generated files');
      await refreshWebview();
    } else {
      logger.error('Failed to apply document edit for file sets');
    }
  } catch (error) {
    logger.error('Error updating file sets', error as Error);
  }
}
