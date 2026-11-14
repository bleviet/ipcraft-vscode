/** The base picker of the System Viewer's comparison: a git revision or another file. */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  listFileCommits,
  listRevisions,
  openRepository,
  REVISION_DASH,
  readRevision,
  resolveCommit,
  revisionFileReader,
  type GitRepository,
  type RevisionChoice,
} from '../../services/systemDiagram/compare/gitRevisions';
import type { ReadAt } from '../../services/systemDiagram/enrichment/revisionIo';
import { openDesignTabs } from './openDesignTabs';

/** The text of the chosen base and how the comparison names it; `file` is set when the base is a file. */
export interface CompareBase {
  text: string;
  label: string;
  file?: vscode.Uri;
  /** The revision has no such file: the base is an empty design and `text` is empty. */
  missing?: true;
  /** The revision has the file under this (workspace-relative) path: it was renamed since. */
  renamedFrom?: string;
  /** A git revision only: reads the workspace definitions as they were at that revision. */
  readDefinitionAt?: ReadAt<vscode.Uri>;
}

type Choice = RevisionChoice | { action: 'enter' | 'file' } | { action: 'open'; uri: vscode.Uri };

type PickItem = vscode.QuickPickItem & { choice?: Choice };

const separator = (label: string): PickItem => ({
  label,
  kind: vscode.QuickPickItemKind.Separator,
});

const DESIGN_EXTENSIONS = ['bd', 'tcl', 'qsys'];

const ENTER_ITEM: PickItem = { label: 'Enter a revision…', choice: { action: 'enter' } };
const FILE_ITEM: PickItem = { label: 'Compare with File…', choice: { action: 'file' } };

/**
 * The picker's items in groups, each under a separator: the open designs, git, the commits
 * of the file, the branches, the tags, then the free entries (only the file without a repository).
 */
export function compareItems(
  designs: readonly vscode.Uri[],
  revisions: readonly RevisionChoice[],
  commits: readonly RevisionChoice[],
  inRepository: boolean
): PickItem[] {
  const of = (group: RevisionChoice['group']) =>
    revisions.filter((r) => r.group === group).map(toItem);
  const groups: [string, PickItem[]][] = [
    ['Open designs', designs.map(designItem)],
    ['Git', of('git')],
    ['Commits that changed this file', commits.map(toItem)],
    ['Branches', of('branch')],
    ['Tags', of('tag')],
    ['Other', [...(inRepository ? [ENTER_ITEM] : []), FILE_ITEM]],
  ];
  const listed = groups.filter(([, items]) => items.length > 0);
  return listed.flatMap(([label, items]) =>
    listed.length === 1 ? items : [separator(label), ...items]
  );
}

/** The picker reads `$(name)` as an icon: user data must not. */
export const escapeIcons = (text: string): string => text.replace(/\$\(/g, '\\$(');

/** The folder of a design: relative to the workspace, empty at its root, absolute outside it. */
function folderOf(uri: vscode.Uri): string {
  const folder = path.dirname(uri.fsPath);
  if (vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath === folder) {
    return '';
  }
  return vscode.workspace.asRelativePath(folder, false);
}

const designItem = (uri: vscode.Uri): PickItem => ({
  label: escapeIcons(path.basename(uri.fsPath)),
  description: escapeIcons(folderOf(uri)),
  choice: { action: 'open', uri },
});

async function openBase(uri: vscode.Uri): Promise<CompareBase> {
  const opened = await vscode.workspace.openTextDocument(uri);
  return { text: opened.getText(), label: vscode.workspace.asRelativePath(uri, false), file: uri };
}

const toItem = (revision: RevisionChoice): PickItem => ({
  label: escapeIcons(revision.label),
  description: escapeIcons(revision.description),
  choice: revision,
});

async function revisionBase(
  repo: GitRepository,
  ref: string,
  label: string,
  uri: vscode.Uri
): Promise<CompareBase> {
  // A branch or HEAD moves with the next commit: read the design and the definitions at one commit.
  const hash = await resolveCommit(repo, ref);
  // A name that moves (HEAD, a branch) is shown with the commit it named, so a later commit does not make the label look current.
  const shown =
    label === ref && !hash.toLowerCase().startsWith(ref.toLowerCase())
      ? `${label} (${hash.slice(0, 7)})`
      : label;
  const read = await readRevision(repo, hash, uri);
  if ('missing' in read) {
    return { text: '', label: shown, missing: true };
  }
  return { ...read, label: shown, readDefinitionAt: revisionFileReader(repo, hash) };
}

async function fileBase(document: vscode.TextDocument): Promise<CompareBase | undefined> {
  const own = path.extname(document.fileName).slice(1);
  const extensions = DESIGN_EXTENSIONS.includes(own)
    ? [own, ...DESIGN_EXTENSIONS.filter((extension) => extension !== own)]
    : DESIGN_EXTENSIONS;
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.joinPath(document.uri, '..'),
    filters: { 'System designs': extensions },
  });
  const file = picked?.[0];
  if (!file) {
    return undefined;
  }
  // An open tab holds the text the user sees, which may differ from the file on disk.
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === file.toString());
  return {
    text: open?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(file)),
    label: vscode.workspace.asRelativePath(file, false),
    file,
  };
}

/** Asks what to compare the document with; undefined when the user cancels at any step. */
export async function pickCompareBase(
  document: vscode.TextDocument
): Promise<CompareBase | undefined> {
  // The git extension can take a few seconds to find its repositories.
  const repo = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Reading the git repository…' },
    () => openRepository(document.uri)
  );
  // Without the lists the picker still offers a typed revision and the file.
  const [revisions, commits] = repo
    ? await Promise.all([
        listRevisions(repo, document.uri).catch(() => []),
        listFileCommits(repo, document.uri),
      ])
    : [[], []];
  const picked = await vscode.window.showQuickPick(
    compareItems(openDesignTabs(document), revisions, commits, repo !== undefined),
    { title: `Compare ${path.basename(document.fileName)} with`, matchOnDescription: true }
  );
  const choice = picked?.choice;
  if (!choice) {
    return undefined;
  }
  if ('uri' in choice) {
    return openBase(choice.uri);
  }
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
