/**
 * The revisions of a file, read through the built-in git extension (`vscode.git`), which
 * respects the user's `git.path` and virtual workspaces. Only the small part of its API
 * that the System Viewer's comparison needs is typed here.
 */

import * as vscode from 'vscode';

/** `type`: 0 = branch, 1 = remote branch, 2 = tag. */
interface GitRef {
  name?: string;
  type: number;
  /** Remote branches: the name of the remote, when the git extension tells it. */
  remote?: string;
}

interface GitRepository {
  state: { HEAD?: { name?: string; commit?: string }; refs?: GitRef[] };
  show(ref: string, path: string): Promise<string>;
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  /** Missing in older versions of VS Code; `state.refs` is the fallback. */
  getRefs?(query: object): Promise<GitRef[]>;
  /** The commits that changed `path`, newest first. */
  log(options: { path: string; maxEntries: number }): Promise<GitCommit[]>;
  /** Refreshes `state`; the git extension fills `state.HEAD` asynchronously after it opens a repository. */
  status?(): Promise<void>;
}

interface GitCommit {
  hash: string;
  message: string;
  authorDate?: Date;
  authorName?: string;
}

interface GitApi {
  state: 'uninitialized' | 'initialized';
  onDidChangeState(listener: (state: 'uninitialized' | 'initialized') => void): vscode.Disposable;
  getRepository(uri: vscode.Uri): GitRepository | null;
}

export type { GitRepository };

/** One entry of the base picker that stands for a revision. */
export interface RevisionChoice {
  label: string;
  description: string;
  /** What to pass to `show`. */
  ref: string;
  /** How the comparison names this base. */
  baseLabel: string;
  /** The picker's group of the entry. */
  group: 'git' | 'commit' | 'branch' | 'tag';
}

const HEAD_BRANCH = 0;
const REMOTE_BRANCH = 1;
const TAG = 2;
const DEFAULT_BRANCHES = ['main', 'master'];
/** How long to wait for the git extension to find its repositories. */
const INIT_WAIT_MS = 3000;

/** Shown for a typed revision that git would take for an option. */
export const REVISION_DASH = 'A revision cannot start with -';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A failed git command has a generic message; the reason is the first line of its stderr. */
function gitReason(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | undefined)?.stderr;
  const firstLine = typeof stderr === 'string' ? stderr.trim().split('\n')[0].trim() : '';
  return firstLine ? `${messageOf(error)}: ${firstLine}` : messageOf(error);
}

/** True once the git extension has found its repositories; false if that takes too long. */
function whenInitialized(api: GitApi): Promise<boolean> {
  if (api.state === 'initialized') {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const subscription = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        finish(true);
      }
    });
    const timer = setTimeout(() => finish(false), INIT_WAIT_MS);
    function finish(initialized: boolean) {
      clearTimeout(timer);
      subscription.dispose();
      resolve(initialized);
    }
  });
}

/**
 * The repository that holds `uri`; undefined when the git extension is missing or disabled
 * or the file is in no repository.
 */
export async function openRepository(uri: vscode.Uri): Promise<GitRepository | undefined> {
  try {
    const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    if (!extension) {
      return undefined;
    }
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports.getAPI(1);
    return (await whenInitialized(api)) ? (api.getRepository(uri) ?? undefined) : undefined;
  } catch {
    // getAPI throws while the git extension is disabled.
    return undefined;
  }
}

async function refsOf(repo: GitRepository): Promise<GitRef[]> {
  return repo.getRefs ? await repo.getRefs({}) : (repo.state.refs ?? []);
}

/**
 * Whether a remote branch is `<remote>/<branch>`; `origin/feature/main` is not `main` of
 * `origin`.
 */
function isRemoteBranch(ref: GitRef, branch: string): boolean {
  if (ref.type !== REMOTE_BRANCH || ref.name === undefined) {
    return false;
  }
  const remote = ref.remote ?? ref.name.slice(0, Math.max(ref.name.indexOf('/'), 0));
  return ref.name === `${remote}/${branch}`;
}

/** The remote branches (`origin/main`) count as a place where the default branch can live. */
function defaultBranch(refs: readonly GitRef[]): string | undefined {
  for (const branch of DEFAULT_BRANCHES) {
    const found =
      refs.find((r) => r.type === HEAD_BRANCH && r.name === branch) ??
      refs.find((r) => isRemoteBranch(r, branch));
    if (found?.name) {
      return found.name;
    }
  }
  return undefined;
}

async function mergeBaseChoice(
  repo: GitRepository,
  refs: readonly GitRef[]
): Promise<RevisionChoice | undefined> {
  const branch = defaultBranch(refs);
  if (!branch) {
    return undefined;
  }
  let base: string | undefined;
  try {
    base = await repo.getMergeBase('HEAD', branch);
  } catch {
    return undefined;
  }
  // HEAD is the branch's tip (or behind it): the merge base is HEAD itself.
  if (!base || base === repo.state.HEAD?.commit) {
    return undefined;
  }
  return {
    label: `Merge base with ${branch}`,
    description: base.slice(0, 7),
    ref: base,
    baseLabel: `${branch} (merge base ${base.slice(0, 7)})`,
    group: 'git',
  };
}

/**
 * The picker's revisions in order: HEAD, the merge base with the default branch (when it
 * differs from HEAD), the local branches except the current one, then the tags.
 */
export async function listRevisions(
  repo: GitRepository,
  uri: vscode.Uri
): Promise<RevisionChoice[]> {
  try {
    // Without HEAD the current branch would be listed among the others.
    if (!repo.state.HEAD && repo.status) {
      await repo.status();
    }
    const refs = await refsOf(repo);
    const current = repo.state.HEAD?.name;
    const named = (type: number, group: 'branch' | 'tag'): RevisionChoice[] =>
      refs
        .filter((r) => r.type === type && r.name && r.name !== current)
        .map((r) => ({
          label: r.name as string,
          description: group,
          ref: r.name as string,
          baseLabel: r.name as string,
          group,
        }));
    const mergeBase = await mergeBaseChoice(repo, refs);
    return [
      {
        label: 'HEAD',
        description: 'last commit',
        ref: 'HEAD',
        baseLabel: 'HEAD',
        group: 'git',
      },
      ...(mergeBase ? [mergeBase] : []),
      ...named(HEAD_BRANCH, 'branch'),
      ...named(TAG, 'tag'),
    ];
  } catch (error) {
    throw new Error(
      `Cannot list the revisions of ${vscode.workspace.asRelativePath(uri, false)}: ${messageOf(error)}`
    );
  }
}

const two = (n: number): string => String(n).padStart(2, '0');

/** The calendar day of `date` where the user is: `2026-03-04`. */
const localDay = (date: Date): string =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

const MAX_FILE_COMMITS = 20;
const LABEL_MAX = 60;
const NO_MESSAGE = '(no message)';

/** The commits that changed the file, newest first; none when the git extension cannot list them. */
export async function listFileCommits(
  repo: GitRepository,
  uri: vscode.Uri
): Promise<RevisionChoice[]> {
  let commits: GitCommit[];
  try {
    commits = await repo.log({ path: uri.fsPath, maxEntries: MAX_FILE_COMMITS });
  } catch {
    return [];
  }
  return commits.map((commit) => {
    const short = commit.hash.slice(0, 7);
    const subject = commit.message.split('\n')[0].trim() || NO_MESSAGE;
    const chars = [...subject];
    const cut = chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX).join('')}…` : subject;
    return {
      label: subject,
      description: [short, commit.authorDate && localDay(commit.authorDate), commit.authorName]
        .filter(Boolean)
        .join(' · '),
      ref: commit.hash,
      baseLabel: `${short} ${cut}`,
      group: 'commit',
    };
  });
}

/** The text of the file at `ref`. */
export async function readRevision(
  repo: GitRepository,
  ref: string,
  uri: vscode.Uri
): Promise<string> {
  // A leading '-' would be read by git as an option.
  if (ref.trim().startsWith('-')) {
    throw new Error(REVISION_DASH);
  }
  try {
    return await repo.show(ref, uri.fsPath);
  } catch (error) {
    throw new Error(
      `Cannot read ${vscode.workspace.asRelativePath(uri, false)} at '${ref}': ${gitReason(error)}`
    );
  }
}
