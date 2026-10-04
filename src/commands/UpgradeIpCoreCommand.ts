import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'yaml';
import type { ResourceRoots } from '../services/ResourceRoots';
import type { IpCoreDataNode } from '../services/ImportResolver';
import { loadRuntimeBusLibrary } from '../services/loadRuntimeBusLibrary';
import { IP_CORE_FORMAT_VERSION, migrateIpCoreYaml } from '../shared/ipCoreFormat';
import { getActiveIpCoreFile } from '../utils/activeIpCoreFile';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { Logger } from '../utils/Logger';

const logger = new Logger('UpgradeIpCoreCommand');

/** Explorer multi-select passes the clicked item plus all selected items. */
function resolveTargets(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): vscode.Uri[] {
  if (uris && uris.length > 0) {
    return uris;
  }
  const target = uri ?? getActiveIpCoreFile();
  return target ? [target] : [];
}

type UpgradeOutcome = 'upgraded' | 'unsaved' | 'current';

/**
 * A document that already had unsaved changes is edited but not saved, so the user's
 * unrelated edits are never persisted to disk without their consent.
 */
async function upgradeDocument(
  uri: vscode.Uri,
  resourceRoots: ResourceRoots
): Promise<UpgradeOutcome> {
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  const ipCoreData = yaml.parse(text) as unknown;
  if (!ipCoreData || typeof ipCoreData !== 'object' || Array.isArray(ipCoreData)) {
    throw new Error('Invalid YAML: must be an object');
  }

  const library = await loadRuntimeBusLibrary(
    logger,
    resourceRoots,
    uri,
    ipCoreData as IpCoreDataNode
  );
  const result = migrateIpCoreYaml(text, library);
  if (!result.changed) {
    return 'current';
  }

  const wasDirty = document.isDirty;
  const lastLine = document.lineAt(document.lineCount - 1);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length), result.text);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error('The editor rejected the edit.');
  }
  if (wasDirty) {
    return 'unsaved';
  }
  if (!(await document.save())) {
    throw new Error('The upgraded document could not be saved.');
  }
  return 'upgraded';
}

/** Upgrade `.ip.yml` files to the latest file format version. */
export async function upgradeIpCore(
  resourceRoots: ResourceRoots,
  uri?: vscode.Uri,
  uris?: vscode.Uri[]
): Promise<void> {
  const targets = resolveTargets(uri, uris);
  if (targets.length === 0) {
    return;
  }

  const counts: Record<UpgradeOutcome, number> = { upgraded: 0, unsaved: 0, current: 0 };
  for (const target of targets) {
    try {
      counts[await upgradeDocument(target, resourceRoots)]++;
    } catch (error) {
      await handleErrorWithUserNotification(
        error,
        'upgradeIpCore',
        `Could not upgrade ${path.basename(target.fsPath)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const unsaved =
    counts.unsaved > 0 ? `; ${counts.unsaved} left unsaved because they had unsaved changes` : '';
  void vscode.window.showInformationMessage(
    `Upgraded ${counts.upgraded} file(s) to format ${IP_CORE_FORMAT_VERSION}${unsaved}; ${counts.current} already current`
  );
}
