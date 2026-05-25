import * as vscode from 'vscode';
import * as path from 'path';
import { migrate } from '../utils/migrateIpCore';
import { Logger } from '../utils/Logger';

const logger = new Logger('MigrateLegacyIpCore');

async function findLegacyIpYmlFiles(): Promise<vscode.Uri[]> {
  const allFiles = await vscode.workspace.findFiles('**/*.ip.yml', '**/node_modules/**');
  const legacy: vscode.Uri[] = [];
  for (const uri of allFiles) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf-8');
    if (/^vendor\s*:/m.test(text)) {
      legacy.push(uri);
    }
  }
  return legacy;
}

export async function migrateLegacyIpCoreCommand(): Promise<void> {
  const legacyFiles = await findLegacyIpYmlFiles();

  if (legacyFiles.length === 0) {
    void vscode.window.showInformationMessage(
      'IPCraft: No legacy .ip.yml files found (nothing to migrate).'
    );
    return;
  }

  const fileList = legacyFiles.map((u) => path.basename(u.fsPath)).join(', ');
  const answer = await vscode.window.showWarningMessage(
    `IPCraft: Found ${legacyFiles.length} file(s) with legacy \`vendor:\` field: ${fileList}. Migrate to \`targets:\` now?`,
    { modal: true },
    'Migrate'
  );

  if (answer !== 'Migrate') {
    return;
  }

  let migratedCount = 0;
  const notes: string[] = [];

  for (const uri of legacyFiles) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const original = Buffer.from(bytes).toString('utf-8');
      const result = migrate(original);
      if (result.changed) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(result.text, 'utf-8'));
        migratedCount++;
        for (const note of result.notes) {
          notes.push(`${path.basename(uri.fsPath)}: ${note}`);
        }
        logger.info(`Migrated ${uri.fsPath}`, { notes: result.notes });
      }
    } catch (error) {
      logger.error(`Failed to migrate ${uri.fsPath}`, error as Error);
    }
  }

  if (migratedCount > 0) {
    const summary = notes.join('\n');
    void vscode.window.showInformationMessage(
      `IPCraft: Migrated ${migratedCount} file(s).\n${summary}`,
      'OK'
    );
  } else {
    void vscode.window.showInformationMessage('IPCraft: Migration complete — no changes needed.');
  }
}

/**
 * Called on activation. Silently checks for legacy files and shows a one-time
 * notification if any are found. Uses globalState to avoid showing this on
 * every restart once the user has been informed.
 */
export async function checkForLegacyIpYmlFiles(context: vscode.ExtensionContext): Promise<void> {
  const KEY = 'ipcraft.migrationNoticeShown';
  if (context.globalState.get<boolean>(KEY)) {
    return;
  }

  const legacyFiles = await findLegacyIpYmlFiles();
  if (legacyFiles.length === 0) {
    return;
  }

  void context.globalState.update(KEY, true);

  const answer = await vscode.window.showWarningMessage(
    `IPCraft: ${legacyFiles.length} .ip.yml file(s) use the legacy \`vendor:\` field. Run "IPCraft: Migrate Legacy IP Cores" to update them to \`targets:\`.`,
    'Migrate Now',
    'Later'
  );

  if (answer === 'Migrate Now') {
    await migrateLegacyIpCoreCommand();
  }
}
