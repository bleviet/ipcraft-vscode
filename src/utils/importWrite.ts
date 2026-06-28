import * as vscode from 'vscode';
import * as path from 'path';
import { STAGING_SCHEME, setStagingContent } from '../providers/StagingContentProvider';

/** What `writeImportedFile` did with the target on disk. */
export type ImportWriteOutcome = 'created' | 'unchanged' | 'overwritten' | 'kept' | 'merged';

// Monotonic token so each conflict diff gets fresh content provider URIs — the
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
 *   - target exists but differs      -> open a diff (current on disk vs. the
 *                                       imported content) and ask the user;
 *                                       'Overwrite' writes the whole import,
 *                                       'Merge...' hands the conflict to VS
 *                                       Code's 3-way merge editor for per-change
 *                                       accept/reject ('merged'), anything else
 *                                       keeps their version ('kept').
 *
 * The proposed content is served read-only through the shared
 * StagingContentProvider so the diff needs no temp file on disk.
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

  // Conflict — never silently overwrite. Show the diff, then let the user decide.
  // Both sides are served through the plain-text staging scheme so the diff
  // always opens as a text diff. The real file on disk has a custom (visual)
  // editor registered as its default, which would otherwise hijack the diff
  // pane and hide the textual changes.
  const filename = path.basename(targetUri.fsPath);
  // The diff URIs must NOT match the .ip.yml/.mm.yml custom-editor selectors
  // (filenamePattern "*.ip.yml" / "*.mm.yml", priority "default"). VS Code
  // matches those by filename regardless of URI scheme, so a staging URI ending
  // in .mm.yml would still open the visual editor inside the diff. Use a .yaml
  // suffix: YAML syntax highlighting, but unmatched by those patterns.
  const diffName = filename.replace(/\.ya?ml$/i, '.yaml');
  const token = (diffSeq += 1);
  const currentKey = `/import/${token}/current/${diffName}`;
  const proposedKey = `/import/${token}/imported/${diffName}`;
  setStagingContent(currentKey, existing);
  setStagingContent(proposedKey, newContent);
  await vscode.commands.executeCommand(
    'vscode.diff',
    vscode.Uri.from({ scheme: STAGING_SCHEME, path: currentKey }),
    vscode.Uri.from({ scheme: STAGING_SCHEME, path: proposedKey }),
    `${filename}: Current ↔ Imported`,
    { preview: true }
  );

  const choice = await vscode.window.showWarningMessage(
    `${filename} already exists and differs from the imported version. ` +
      `Review the diff, then choose how to proceed.`,
    'Overwrite',
    'Merge...',
    'Keep Existing'
  );
  if (choice === 'Overwrite') {
    await vscode.workspace.fs.writeFile(targetUri, encoder.encode(newContent));
    return 'overwritten';
  }
  if (choice === 'Merge...') {
    return openMergeEditor(targetUri, existing, newContent, filename, diffName, token);
  }
  return 'kept';
}

/**
 * Hands an import conflict to VS Code's built-in 3-way merge editor so the user
 * can accept the imported content per change region instead of all-or-nothing.
 *
 * An import has no real common ancestor, so `base` is seeded with the on-disk
 * content. That makes every imported change a non-conflicting "incoming" block:
 * accepted by default (-> imported value), un-accept to keep the current value
 * (which equals base). The merge editor writes the resolved result to the real
 * file on disk (`output`) when the user completes the merge, so this function
 * does not write the file itself.
 *
 * If the merge editor cannot be opened (e.g. the internal command is missing),
 * the file is left untouched and the user is told to re-run with Overwrite /
 * Keep Existing.
 */
async function openMergeEditor(
  targetUri: vscode.Uri,
  existing: string,
  newContent: string,
  filename: string,
  diffName: string,
  token: number
): Promise<ImportWriteOutcome> {
  const baseKey = `/import/${token}/base/${diffName}`;
  const currentKey = `/import/${token}/mergeCurrent/${diffName}`;
  const importedKey = `/import/${token}/mergeImported/${diffName}`;
  setStagingContent(baseKey, existing);
  setStagingContent(currentKey, existing);
  setStagingContent(importedKey, newContent);

  const staged = (key: string) => vscode.Uri.from({ scheme: STAGING_SCHEME, path: key });

  try {
    // `_open.mergeEditor` is the internal command the Git extension uses to open
    // the 3-way merge editor with arbitrary inputs; there is no public API for
    // it. `output` must be a writable document, so it is the real file on disk.
    await vscode.commands.executeCommand('_open.mergeEditor', {
      base: staged(baseKey),
      input1: { uri: staged(currentKey), title: 'Current (on disk)', detail: filename },
      input2: { uri: staged(importedKey), title: 'Imported', detail: filename },
      output: targetUri,
    });
    return 'merged';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Could not open the merge editor for ${filename}: ${message}. ` +
        `The file was left unchanged — re-run the import and choose Overwrite or Keep Existing.`
    );
    return 'kept';
  }
}
