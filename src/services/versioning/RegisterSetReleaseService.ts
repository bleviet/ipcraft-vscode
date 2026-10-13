import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../../utils/Logger';
import {
  needsDecision,
  pendingMaps,
  planRelease,
  releaseStates,
  type MapReleaseInput,
  type ReleaseDecision,
} from '../../shared/versioning/planRelease';
import { validateVersion, type VersionScheme } from '../../shared/versioning/versionScheme';
import { applyDocumentPathEdits, saveDocument } from './documentEdits';
import { hasVersionGateErrors } from './versionGate';
import {
  buildMapReleases,
  describeRecorded,
  historyEdits,
  invalidCoreVersionMessage,
  readCoreReleaseInfo,
  type ImportedMapFile,
  type MapRelease,
} from './releaseFiles';

const logger = new Logger('RegisterSetRelease');

const SAVE_AND_CONTINUE = 'Save and Continue';

export type ReleaseOutcome = { proceed: true; written?: string[] } | { proceed: false };

interface MapFile {
  /** The import's own path and overrides: the key source for every lookup (never `document.uri`). */
  absPath: string;
  entryOverrides?: Record<string, unknown>;
  document: vscode.TextDocument;
  releases: MapRelease[];
}

/** Opens the imported `.mm.yml` files; one that cannot be read or parsed is left to generation. */
export async function loadMapFiles(imports: readonly ImportedMapFile[]): Promise<MapFile[]> {
  const files: MapFile[] = [];
  for (const { absPath, entryOverrides } of imports) {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
      files.push({
        absPath,
        entryOverrides,
        document,
        releases: buildMapReleases(document.getText(), entryOverrides),
      });
    } catch (err) {
      logger.warn(`Skipping ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return files;
}

function recordedAnywhere(inputs: readonly MapReleaseInput[], version: string): boolean {
  return inputs.some(
    (input) => input.versioned && input.history?.versions.some((entry) => entry.version === version)
  );
}

/** Modal that asks before unsaved user edits are persisted; false = the user cancelled. */
async function confirmSave(message: string): Promise<boolean> {
  const picked = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    SAVE_AND_CONTINUE
  );
  return picked === SAVE_AND_CONTINUE;
}

/** Whether the saved (on-disk) text of a map file holds a versioned map; unreadable counts as no. */
async function isSavedVersioned(
  absPath: string,
  entryOverrides: Record<string, unknown> | undefined
): Promise<boolean> {
  try {
    return buildMapReleases(await fs.readFile(absPath, 'utf8'), entryOverrides).some(
      (entry) => entry.input.versioned
    );
  } catch {
    return false;
  }
}

type Choice = { decision: ReleaseDecision; coreVersion: string; newVersion?: string } | undefined;

/** One modal for every pending map; undefined means cancel (nothing is written). */
async function askDecision(
  inputs: readonly MapReleaseInput[],
  coreVersion: string,
  scheme: VersionScheme
): Promise<Choice> {
  const pending = pendingMaps(inputs, coreVersion);
  const names = pending.map((map) => map.mapName).join(', ');
  const compared = [...new Set(pending.map((map) => map.state.reference.version))].join(', ');
  const needsNewVersion = pending.some((map) => map.state.coreVersionRecorded);
  // Overwrite re-points the entry of the core version, so every pending map must record it.
  const canOverwrite = pending.every((map) => map.state.coreVersionRecorded);
  const adoptLabel = needsNewVersion
    ? 'Adopt as new version...'
    : `Adopt as version ${coreVersion}`;
  const overwriteLabel = `Overwrite version ${coreVersion}`;

  const picked = await vscode.window.showWarningMessage(
    `Register layout changed since version ${compared} (${names}).`,
    {
      modal: true,
      detail:
        `Adopt: record the current layout as a new version and keep the previous ones in the ` +
        `version history.\n` +
        (canOverwrite
          ? `Overwrite: replace the layout recorded for version ${coreVersion} with the current one.\n`
          : `Overwrite is not offered: version ${coreVersion} is not recorded in every changed map.\n`) +
        `Cancel: do not generate.`,
    },
    adoptLabel,
    ...(canOverwrite ? [overwriteLabel] : [])
  );
  if (canOverwrite && picked === overwriteLabel) {
    return { decision: 'overwrite', coreVersion };
  }
  if (picked !== adoptLabel) {
    return undefined;
  }
  if (!needsNewVersion) {
    return { decision: 'adopt', coreVersion };
  }
  const entered = await vscode.window.showInputBox({
    title: `New IP core version (${scheme})`,
    prompt: `Version ${coreVersion} is already recorded; enter the new ${scheme} version`,
    value: coreVersion,
    validateInput: (value) =>
      validateVersion(scheme, value.trim()) ??
      (recordedAnywhere(inputs, value.trim())
        ? `Version ${value.trim()} is already recorded`
        : null),
  });
  const newVersion = entered?.trim();
  return newVersion === undefined
    ? undefined
    : { decision: 'adopt', coreVersion: newVersion, newVersion };
}

/** Names of the unsaved edits a failed run leaves behind, for the error message. */
function withUnsavedNote(err: unknown, unsaved: ReadonlyMap<vscode.TextDocument, string>): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (unsaved.size === 0) {
    return err instanceof Error ? err : new Error(message);
  }
  return new Error(
    `${message.endsWith('.') ? message : `${message}.`} ${[...unsaved.values()].join('; ')}.`
  );
}

async function release(ipCoreUri: vscode.Uri): Promise<ReleaseOutcome> {
  const ipDocument = await vscode.workspace.openTextDocument(ipCoreUri);
  const info = readCoreReleaseInfo(ipDocument.getText(), path.dirname(ipCoreUri.fsPath));
  if (!info || info.imports.length === 0 || info.version === '') {
    return { proceed: true };
  }
  let files = await loadMapFiles(info.imports);

  // Generation reads the memory maps from disk: a versioned map with unsaved edits would be
  // planned from text that generation never sees. Saving persists the user's edits, so ask first.
  // A map is "versioned" here when its editor text OR its saved file is: the saved file is what
  // generation reads, and the edited text is what the user is about to save. Either way the map
  // must be on disk in its final form before the gate and the plan look at it.
  const dirty: MapFile[] = [];
  for (const file of files) {
    if (
      file.document.isDirty &&
      (file.releases.some((entry) => entry.input.versioned) ||
        (await isSavedVersioned(file.absPath, file.entryOverrides)))
    ) {
      dirty.push(file);
    }
  }
  if (dirty.length > 0) {
    const names = dirty.map((file) => path.basename(file.document.uri.fsPath));
    const verb = names.length > 1 ? 'have' : 'has';
    const saved = await confirmSave(
      `${names.join(', ')} ${verb} unsaved changes. Generation reads memory maps from disk, so they must be saved before the register-set release can be recorded.`
    );
    if (!saved) {
      logger.info('Register-set release cancelled: unsaved memory maps were not saved');
      return { proceed: false };
    }
    for (const file of dirty) {
      await saveDocument(file.document);
    }
    // Saving may reformat (save participants): plan from what is on disk now.
    files = await loadMapFiles(info.imports);
  }

  // A design the `$version` gate blocks cannot be generated: record nothing and prompt for
  // nothing, so generation reports the gate errors. The gate reads the maps from disk (the default
  // reader), exactly like generation, and runs after the dirty maps were saved above. A design
  // without a versioned map is never gated, so it behaves as before register-set versioning.
  const releases = files.flatMap((file) => file.releases);
  const inputs = releases.map((entry) => entry.input);
  if (!inputs.some((input) => input.versioned)) {
    return { proceed: true };
  }
  if (await hasVersionGateErrors(ipDocument.getText(), ipCoreUri.fsPath)) {
    logger.info('Register-set release skipped: generation is blocked by $version reference errors');
    return { proceed: true };
  }

  const versionError = invalidCoreVersionMessage(info.scheme, info.version);
  if (
    versionError &&
    releaseStates(inputs, info.version).some((s) => s && s.kind !== 'up-to-date')
  ) {
    throw new Error(versionError);
  }

  let choice: Choice;
  if (needsDecision(inputs, info.version)) {
    choice = await askDecision(inputs, info.version, info.scheme);
    if (!choice) {
      logger.info('Register-set release cancelled; nothing written');
      return { proceed: false };
    }
  }
  const coreVersion = choice?.coreVersion ?? info.version;
  const coreEdited = choice?.newVersion !== undefined;
  const coreName = path.basename(ipCoreUri.fsPath);
  if (
    coreEdited &&
    ipDocument.isDirty &&
    !(await confirmSave(
      `${coreName} has unsaved changes that will be saved together with the new version.`
    ))
  ) {
    logger.info('Register-set release cancelled: the IP core has unsaved changes');
    return { proceed: false };
  }
  const plans = planRelease(inputs, coreVersion, choice?.decision);

  const written: string[] = [];
  // Documents edited by this run and not saved yet, with what the user needs to know about them.
  const unsaved = new Map<vscode.TextDocument, string>();
  try {
    // The core first: if a map write fails afterwards, the next run only needs the adopt prompt.
    if (
      coreEdited &&
      (await applyDocumentPathEdits(ipDocument, [
        { path: ['vlnv', 'version'], value: coreVersion },
      ]))
    ) {
      unsaved.set(ipDocument, `${coreName} was changed to version ${coreVersion} and is unsaved`);
      written.push(ipCoreUri.fsPath);
      logger.info(`Set vlnv.version to ${coreVersion} in ${ipCoreUri.fsPath}`);
    }
    let offset = 0;
    for (const file of files) {
      const filePlans = plans.slice(offset, offset + file.releases.length);
      offset += file.releases.length;
      const edits = historyEdits(file.releases, filePlans);
      if (edits.length > 0 && (await applyDocumentPathEdits(file.document, edits))) {
        unsaved.set(
          file.document,
          `${path.basename(file.document.uri.fsPath)} was changed and is unsaved`
        );
        written.push(file.document.uri.fsPath);
        for (const plan of filePlans) {
          for (const line of describeRecorded(plan, coreVersion, choice?.decision)) {
            logger.info(`${file.document.uri.fsPath}: ${line}`);
          }
        }
      }
    }
    // Generation reads the memory maps from disk, so the edited documents must be saved.
    for (const document of [...unsaved.keys()]) {
      await saveDocument(document);
      unsaved.delete(document);
    }
  } catch (err) {
    throw withUnsavedNote(err, unsaved);
  }
  return { proceed: true, written };
}

/**
 * The generation seam for register-set versioning: records the IP core's version in each
 * versioned imported memory map, asking the user when the layout changed since the reference
 * recorded version (the core version's entry, else the latest). A design with `$version` gate
 * errors in the saved files is left alone (`{ proceed: true }`, nothing prompted or written) so
 * generation reports them. `{ proceed: false }` means the user cancelled (nothing was written)
 * or the release failed (an error message is shown; edits applied before the failure stay in
 * the open editors unsaved, and the message names them). Unsaved memory maps that are versioned
 * in the editor or on disk are saved only after the user agrees, before the gate runs. Must not
 * be called from preview/dry-run-only paths: it may prompt and write.
 */
export async function ensureRegisterSetsReleased(ipCoreUri: vscode.Uri): Promise<ReleaseOutcome> {
  try {
    return await release(ipCoreUri);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Register-set release failed', err instanceof Error ? err : new Error(message));
    void vscode.window.showErrorMessage(`Register-set versioning failed: ${message}`);
    return { proceed: false };
  }
}
