import * as path from 'path';
import * as vscode from 'vscode';
import { applyDocumentPathEdits, saveDocument } from '../services/versioning/documentEdits';
import { loadMapFiles } from '../services/versioning/RegisterSetReleaseService';
import { readVersionContext } from '../services/versioning/watchVersionContext';
import {
  buildMapReleases,
  describeRecorded,
  historyEdits,
  invalidCoreVersionMessage,
  readCoreReleaseInfo,
  type MapRelease,
} from '../services/versioning/releaseFiles';
import { planRelease } from '../shared/versioning/planRelease';
import type { VersionScheme } from '../shared/versioning/versionScheme';
import { findActiveSpecFile } from '../utils/activeIpCoreFile';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { isIpCoreFile } from '../utils/fileExtensions';
import { Logger } from '../utils/Logger';

const logger = new Logger('StartRegisterSetVersioning');

interface Target {
  version: string;
  scheme: VersionScheme;
  files: Array<{ document: vscode.TextDocument; releases: MapRelease[] }>;
}

/** The IP core at workspace-relative `ipCorePath` (as the version context reports it). */
async function openOwningCore(ipCorePath: string): Promise<vscode.TextDocument | undefined> {
  const cores = await vscode.workspace.findFiles('**/*.ip.yml', '**/node_modules/**');
  const coreUri = cores.find((core) => vscode.workspace.asRelativePath(core, false) === ipCorePath);
  return coreUri ? vscode.workspace.openTextDocument(coreUri) : undefined;
}

/** The version and memory-map files to version, or an error message for the user. */
async function resolveTarget(uri: vscode.Uri): Promise<Target | string> {
  if (isIpCoreFile(uri.fsPath)) {
    const document = await vscode.workspace.openTextDocument(uri);
    const info = readCoreReleaseInfo(document.getText(), path.dirname(uri.fsPath));
    if (!info || info.imports.length === 0) {
      return 'Register-set versioning needs an imported .mm.yml; this IP core has none.';
    }
    return {
      version: info.version,
      scheme: info.scheme,
      files: await loadMapFiles(info.imports),
    };
  }

  const context = await readVersionContext(uri);
  if (context.status === 'none') {
    return `No IP core imports ${path.basename(uri.fsPath)}; register-set versioning needs the owning IP core's version.`;
  }
  if (context.status === 'ambiguous') {
    return `${path.basename(uri.fsPath)} is imported by several IP cores (${(context.candidates ?? []).join(', ')}); register-set versioning needs a single owner.`;
  }
  // The core decides which maps of this file generation loads (first map only for an array entry).
  const coreDocument = await openOwningCore(context.ipCorePath ?? '');
  const info =
    coreDocument &&
    readCoreReleaseInfo(coreDocument.getText(), path.dirname(coreDocument.uri.fsPath));
  const imported = info?.imports.find((entry) => entry.absPath === path.resolve(uri.fsPath));
  if (!info || !imported) {
    return `Could not read how ${context.ipCorePath ?? 'the owning IP core'} imports ${path.basename(uri.fsPath)}.`;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  return {
    version: info.version,
    scheme: info.scheme,
    files: [{ document, releases: buildMapReleases(document.getText(), imported.entryOverrides) }],
  };
}

/**
 * `IPCraft: Start Register-Set Versioning`: records the IP core's version and the current
 * register layout as the initial `versionHistory` of every memory map that has none. Maps that
 * already have a history are left alone. One edit per file; a file that already had unsaved
 * changes is edited but not saved.
 */
export async function startRegisterSetVersioning(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? findActiveSpecFile();
  if (!target) {
    void vscode.window.showErrorMessage('No active .ip.yml or .mm.yml file. Please open one.');
    return;
  }
  try {
    const resolved = await resolveTarget(target);
    if (typeof resolved === 'string') {
      void vscode.window.showErrorMessage(resolved);
      return;
    }
    const { version, scheme, files } = resolved;
    if (version === '') {
      void vscode.window.showErrorMessage('The IP core has no vlnv.version to record.');
      return;
    }
    const versionError = invalidCoreVersionMessage(scheme, version);
    if (versionError) {
      void vscode.window.showErrorMessage(versionError);
      return;
    }
    if (files.every((file) => file.releases.length === 0)) {
      void vscode.window.showErrorMessage('No memory map found to version.');
      return;
    }

    const recorded: string[] = [];
    const unsaved: string[] = [];
    for (const { document, releases } of files) {
      // Activate only the maps without a history; the planner leaves the others alone.
      const inputs = releases.map(({ input }) => ({
        ...input,
        versioned: input.history === undefined,
      }));
      const plans = planRelease(inputs, version, scheme);
      const edits = historyEdits(releases, plans);
      if (edits.length === 0) {
        continue;
      }
      const wasDirty = document.isDirty;
      if (await applyDocumentPathEdits(document, edits)) {
        if (wasDirty) {
          unsaved.push(path.basename(document.uri.fsPath));
        } else {
          await saveDocument(document);
        }
        recorded.push(...plans.flatMap((plan) => describeRecorded(plan, version, undefined)));
      }
    }

    if (recorded.length === 0) {
      void vscode.window.showInformationMessage('Register-set versioning is already active.');
      return;
    }
    logger.info(`Started register-set versioning: ${recorded.join('; ')}`);
    const note =
      unsaved.length > 0 ? ` Left unsaved (unsaved changes): ${unsaved.join(', ')}.` : '';
    void vscode.window.showInformationMessage(
      `Started register-set versioning. ${recorded.join('; ')}.${note}`
    );
  } catch (error) {
    await handleErrorWithUserNotification(
      error,
      'startRegisterSetVersioning',
      `Could not start register-set versioning: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
