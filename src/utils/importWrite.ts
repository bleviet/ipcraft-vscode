import * as vscode from 'vscode';
import * as path from 'path';
import { STAGING_SCHEME, setStagingContent } from '../providers/StagingContentProvider';

/** What `writeImportedFile` did with the target on disk. */
export type ImportWriteOutcome = 'created' | 'unchanged' | 'overwritten' | 'kept' | 'merged';

// Monotonic token so each conflict gets fresh content provider URIs — the
// staging provider has no change event, so reused URIs would serve stale text.
let diffSeq = 0;

/** Human-readable phrasing for an outcome, for summary notifications. */
export function describeOutcome(filename: string, outcome: ImportWriteOutcome): string {
  switch (outcome) {
    case 'created':
      return `${filename} created`;
    case 'overwritten':
      return `${filename} updated`;
    case 'kept':
      return `${filename} left unchanged (kept your version)`;
    case 'unchanged':
      return `${filename} already up to date`;
    case 'merged':
      return `${filename} opened in the merge editor — resolve and save to apply`;
  }
}

/**
 * Writes an imported artifact (.ip.yml / .mm.yml) without clobbering user edits.
 *
 * Importers regenerate these files from an external source (component.xml,
 * _hw.tcl, VHDL). A second import must not silently destroy hand-edits a user
 * made after the first import. This mirrors how code generation stages output:
 *
 *   - target missing                 -> write it, return 'created'
 *   - target identical to import     -> no write, return 'unchanged'
 *   - target exists but differs      -> open VS Code's built-in 3-way merge
 *                                       editor on the conflict ('merged') so
 *                                       the user accepts the import per change
 *                                       region. The merge editor subsumes the
 *                                       whole-file paths: completing with every
 *                                       change accepted overwrites; discarding
 *                                       without completing keeps their version.
 *
 * The merge inputs are served read-only through the shared
 * StagingContentProvider so the merge needs no temp file on disk.
 */
export async function writeImportedFile(
  targetUri: vscode.Uri,
  newContent: string
): Promise<ImportWriteOutcome> {
  const encoder = new TextEncoder();

  let existing: string | undefined;
  try {
    existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(targetUri));
  } catch {
    existing = undefined; // does not exist (or unreadable) — treat as new
  }

  if (existing === undefined) {
    await vscode.workspace.fs.writeFile(targetUri, encoder.encode(newContent));
    return 'created';
  }
  if (existing === newContent) {
    return 'unchanged';
  }

  // Conflict — never silently overwrite. Open the 3-way merge editor directly.
  const opened = await openMergeEditorForConflict(targetUri, existing, newContent, 'Imported');
  return opened ? 'merged' : 'kept';
}

/**
 * Opens VS Code's built-in 3-way merge editor on a file conflict so the user can
 * accept the incoming content per change region instead of all-or-nothing.
 *
 * Shared by import (incoming = imported content) and code-generation staging
 * (incoming = generated content). There is no real common ancestor, so `base` is
 * seeded with the current on-disk content. That makes every incoming change a
 * non-conflicting block: accepted by default (-> incoming value), un-accept to
 * keep the current value (which equals base). The merge editor writes the
 * resolved result to the real file on disk (`output`) when the user completes
 * the merge, so this function does not write the file itself.
 *
 * Returns true when the merge editor opened, false when it could not (e.g. the
 * internal command is missing) — in which case the file is left untouched and
 * the user is shown an error.
 *
 * @param incomingLabel pane title for the incoming side ('Imported' / 'Generated').
 */
export async function openMergeEditorForConflict(
  targetUri: vscode.Uri,
  current: string,
  incoming: string,
  incomingLabel: string
): Promise<boolean> {
  const filename = path.basename(targetUri.fsPath);
  // The staging URIs feeding the merge panes must NOT match the .ip.yml/.mm.yml
  // custom-editor selectors (filenamePattern "*.ip.yml" / "*.mm.yml", priority
  // "default"). VS Code matches those by filename regardless of URI scheme, so a
  // staging URI ending in .mm.yml could pull the visual editor into a merge pane.
  // Use a .yaml suffix: YAML highlighting, but unmatched by those patterns.
  // Non-YAML generated files (.vhd/.sv/...) have no custom editor, so this is a
  // no-op for them.
  const mergeName = filename.replace(/\.ya?ml$/i, '.yaml');
  const token = (diffSeq += 1);
  const baseKey = `/merge/${token}/base/${mergeName}`;
  const currentKey = `/merge/${token}/current/${mergeName}`;
  const incomingKey = `/merge/${token}/incoming/${mergeName}`;
  setStagingContent(baseKey, current);
  setStagingContent(currentKey, current);
  setStagingContent(incomingKey, incoming);

  const staged = (key: string) => vscode.Uri.from({ scheme: STAGING_SCHEME, path: key });

  try {
    // `_open.mergeEditor` is the internal command the Git extension uses to open
    // the 3-way merge editor with arbitrary inputs; there is no public API for
    // it. `output` must be a writable document, so it is the real file on disk.
    await vscode.commands.executeCommand('_open.mergeEditor', {
      base: staged(baseKey),
      input1: { uri: staged(currentKey), title: 'Current (on disk)', detail: filename },
      input2: { uri: staged(incomingKey), title: incomingLabel, detail: filename },
      output: targetUri,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Could not open the merge editor for ${filename}: ${message}. ` +
        `The file was left unchanged.`
    );
    return false;
  }
}
