import * as vscode from 'vscode';
import * as path from 'path';
import { STAGING_SCHEME, setStagingContent } from '../providers/StagingContentProvider';

/** What `writeImportedFile` did with the target on disk. */
export type ImportWriteOutcome = 'created' | 'unchanged' | 'overwritten' | 'kept';

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
 *                                       'Overwrite' writes, anything else keeps
 *                                       their version ('kept').
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
  const token = (diffSeq += 1);
  const currentKey = `/import/${token}/current/${filename}`;
  const proposedKey = `/import/${token}/imported/${filename}`;
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
    'Keep Existing'
  );
  if (choice === 'Overwrite') {
    await vscode.workspace.fs.writeFile(targetUri, encoder.encode(newContent));
    return 'overwritten';
  }
  return 'kept';
}
