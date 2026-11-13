/** The base picker of the System Viewer's comparison: a git revision or another file. */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  listRevisions,
  openRepository,
  REVISION_DASH,
  readRevision,
  type GitRepository,
  type RevisionChoice,
} from '../../services/systemDiagram/compare/gitRevisions';

/** The text of the chosen base and how the comparison names it. */
export interface CompareBase {
  text: string;
  label: string;
}

type Choice = RevisionChoice | { action: 'enter' | 'file' };

type PickItem = vscode.QuickPickItem & { choice: Choice };

const ENTER_ITEM: PickItem = { label: 'Enter a revision…', choice: { action: 'enter' } };
const FILE_ITEM: PickItem = { label: 'Compare with File…', choice: { action: 'file' } };

/** The picker's items: the revisions, then the free entries; only the file without a repository. */
export function compareItems(revisions: readonly RevisionChoice[] | undefined): PickItem[] {
  const entries = revisions ? [...revisions.map(toItem), ENTER_ITEM] : [];
  return [...entries, FILE_ITEM];
}

const toItem = (revision: RevisionChoice): PickItem => ({
  label: revision.label,
  description: revision.description,
  choice: revision,
});

async function revisionBase(
  repo: GitRepository,
  ref: string,
  label: string,
  uri: vscode.Uri
): Promise<CompareBase> {
  return { text: await readRevision(repo, ref, uri), label };
}

async function fileBase(document: vscode.TextDocument): Promise<CompareBase | undefined> {
  const extension = path.extname(document.fileName).slice(1);
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.joinPath(document.uri, '..'),
    ...(extension && { filters: { 'System design': [extension] } }),
  });
  const file = picked?.[0];
  if (!file) {
    return undefined;
  }
  return {
    text: new TextDecoder().decode(await vscode.workspace.fs.readFile(file)),
    label: vscode.workspace.asRelativePath(file, false),
  };
}

/** Asks what to compare the document with; undefined when the user cancels at any step. */
export async function pickCompareBase(
  document: vscode.TextDocument
): Promise<CompareBase | undefined> {
  const repo = await openRepository(document.uri);
  // Without the list the picker still offers the file.
  const revisions = repo && (await listRevisions(repo, document.uri).catch(() => undefined));
  const picked = await vscode.window.showQuickPick(compareItems(revisions), {
    title: `Compare ${path.basename(document.fileName)} with`,
  });
  if (!picked) {
    return undefined;
  }
  const { choice } = picked;
  if ('ref' in choice) {
    return revisionBase(repo as GitRepository, choice.ref, choice.baseLabel, document.uri);
  }
  if (choice.action === 'file') {
    return fileBase(document);
  }
  const ref = (
    await vscode.window.showInputBox({
      prompt: 'Git revision (branch, tag or commit)',
      validateInput: (value) => (value.trim().startsWith('-') ? REVISION_DASH : undefined),
    })
  )?.trim();
  return ref ? revisionBase(repo as GitRepository, ref, ref, document.uri) : undefined;
}
