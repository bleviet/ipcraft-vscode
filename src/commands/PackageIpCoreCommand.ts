import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { planIpPackage, writePackageToDirectory, writePackageToZip } from '../services/packaging';
import { findActiveSpecFile } from '../utils/activeIpCoreFile';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { isIpCoreFile } from '../utils/fileExtensions';

/** `<name>_<version>` from the IP's vlnv, falling back to the file name stem. */
async function defaultPackageName(ipPath: string): Promise<string> {
  try {
    const data = yaml.load(await fs.readFile(ipPath, 'utf8')) as {
      vlnv?: { name?: string; version?: string };
    } | null;
    const { name, version } = data?.vlnv ?? {};
    if (name && version) {
      return `${name}_${version}`;
    }
  } catch {
    // fall through to the file name
  }
  return path.basename(ipPath).replace(/\.ip\.ya?ml$/, '');
}

/** Asks for a destination; returns the package path and writer mode, or undefined if cancelled. */
async function pickDestination(
  ipPath: string
): Promise<{ outPath: string; zip: boolean } | undefined> {
  const packageName = await defaultPackageName(ipPath);
  const mode = await vscode.window.showQuickPick(['Folder', 'Zip archive'], {
    placeHolder: 'Package the IP core as...',
  });
  if (!mode) {
    return undefined;
  }
  if (mode === 'Zip archive') {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(ipPath), `${packageName}.zip`)),
      filters: { 'Zip archive': ['zip'] },
    });
    return target && { outPath: target.fsPath, zip: true };
  }
  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Parent Folder',
  });
  return parent?.[0] && { outPath: path.join(parent[0].fsPath, packageName), zip: false };
}

/** Bundle an `.ip.yml` and every file it references into a folder or zip archive. */
export async function packageIpCoreCommand(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? findActiveSpecFile();
  if (!target || !isIpCoreFile(target.fsPath)) {
    void vscode.window.showErrorMessage('No active .ip.yml file. Please open one.');
    return;
  }

  try {
    const destination = await pickDestination(target.fsPath);
    if (!destination) {
      return;
    }
    const plan = await planIpPackage(target.fsPath);
    await (destination.zip
      ? writePackageToZip(plan, destination.outPath)
      : writePackageToDirectory(plan, destination.outPath));

    for (const warning of plan.warnings) {
      void vscode.window.showWarningMessage(warning);
    }
    const reveal = 'Reveal';
    const choice = await vscode.window.showInformationMessage(
      `Packaged ${plan.entries.size} file(s) into ${destination.outPath}`,
      reveal
    );
    if (choice === reveal) {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destination.outPath));
    }
  } catch (error) {
    await handleErrorWithUserNotification(
      error,
      'packageIpCore',
      `Could not package ${path.basename(target.fsPath)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
