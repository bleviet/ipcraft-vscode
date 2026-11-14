import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

interface GitResult {
  stdout: string;
  stderr: string;
  /** Spawn error code (`ENOENT`: git is not installed) or the exit code. */
  failure?: string | number;
}

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          ...(error && { failure: (error as { code?: string | number }).code ?? 1 }),
        });
      }
    );
  });
}

/** `: <first line of git's message>`, or nothing when git said nothing. */
function reason(result: GitResult): string {
  const first = result.stderr.trim().split('\n')[0].trim();
  return first ? `: ${first}` : '';
}

/** The file as git has it at a revision: its text, and the old path when it was found under another one. */
export type GitFile = { text: string; path?: string } | { missing: true };

interface Located {
  cwd: string;
  /** The path of the file relative to the repository root. */
  repoPath: string;
}

/** Finds the repository of `filePath` and checks that `ref` is a commit in it. */
async function locate(filePath: string, ref: string): Promise<Located> {
  if (ref.startsWith('-')) {
    throw new Error(`Invalid git revision '${ref}'`);
  }
  const absolute = path.resolve(filePath);
  const cwd = path.dirname(absolute);
  if (!(await fs.stat(cwd).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  const prefix = await git(cwd, ['rev-parse', '--show-prefix']);
  if (prefix.failure === 'ENOENT') {
    throw new Error(`git could not be started in '${cwd}' (is git installed?)`);
  }
  if (prefix.failure !== undefined) {
    throw new Error(`'${filePath}' is not in a git repository${reason(prefix)}`);
  }
  const revision = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (revision.failure !== undefined) {
    throw new Error(`git revision '${ref}' does not exist`);
  }
  return { cwd, repoPath: `${prefix.stdout.replace(/\n$/, '')}${path.basename(absolute)}` };
}

/**
 * The old path of `repoPath` per git's rename detection between `ref` and the current side
 * (`headRef`, or the working tree); undefined when the file was not renamed. Plumbing
 * (`diff-index`, `diff-tree`) is used because porcelain `git diff` reads the user's configuration
 * (`diff.relative`, `diff.noprefix`, ...) and may print other paths or leave changes out. The `-z`
 * lines are `R<score>\0<old>\0<new>`, with paths relative to the repository root.
 */
async function renamedFrom(
  { cwd, repoPath }: Located,
  ref: string,
  headRef: string | undefined
): Promise<string | undefined> {
  const listed = await git(
    cwd,
    headRef === undefined
      ? ['diff-index', '-M', '--name-status', '-z', ref, '--']
      : ['diff-tree', '-r', '-M', '--name-status', '-z', ref, headRef, '--']
  );
  if (listed.failure !== undefined) {
    return undefined;
  }
  const tokens = listed.stdout.split('\0');
  for (let i = 0; i < tokens.length; i += 1) {
    const copyOrRename = /^[RC]/.test(tokens[i]);
    if (tokens[i].startsWith('R') && tokens[i + 2] === repoPath) {
      return tokens[i + 1];
    }
    // `R` and `C` carry two paths, every other status one.
    i += copyOrRename ? 2 : 1;
  }
  return undefined;
}

/**
 * The text of `filePath` at the git revision `ref`, read from the repository that contains the
 * file. Throws when git cannot say (no repository, no such revision, any other git error).
 */
export async function readGitFileStrict(filePath: string, ref: string): Promise<string> {
  const { cwd, repoPath } = await locate(filePath, ref);
  const shown = await git(cwd, ['show', `${ref}:${repoPath}`]);
  if (shown.failure !== undefined) {
    throw new Error(`'${filePath}' does not exist at ${ref}${reason(shown)}`);
  }
  return shown.stdout;
}

/**
 * `filePath` at `ref` as the base of a comparison with the current side (`headRef`, or the
 * working tree): its text; its text under the old path when git's rename detection between the
 * two finds that it was renamed; or `missing` when the path did not exist at `ref`.
 */
export async function readGitFile(
  filePath: string,
  ref: string,
  headRef?: string
): Promise<GitFile> {
  if (headRef?.startsWith('-')) {
    throw new Error(`Invalid git revision '${headRef}'`);
  }
  const located = await locate(filePath, ref);
  const { cwd, repoPath } = located;
  const shown = await git(cwd, ['show', `${ref}:${repoPath}`]);
  if (shown.failure === undefined) {
    return { text: shown.stdout };
  }
  const old = await renamedFrom(located, ref, headRef);
  if (old !== undefined) {
    const renamed = await git(cwd, ['show', `${ref}:${old}`]);
    if (renamed.failure !== undefined) {
      throw new Error(`'${filePath}' does not exist at ${ref}${reason(renamed)}`);
    }
    return { text: renamed.stdout, path: old };
  }
  // Only the tree decides: the blob may be unavailable (partial clone, broken store) while the path exists.
  const listed = await git(cwd, [
    'ls-tree',
    '--full-tree',
    '--name-only',
    '-z',
    ref,
    '--',
    repoPath,
  ]);
  if (listed.failure === undefined && !listed.stdout.split('\0').includes(repoPath)) {
    return { missing: true };
  }
  // The path is at the revision (or the tree could not be listed), but its content is not readable.
  throw new Error(`'${filePath}' cannot be read at ${ref}${reason(shown)}`);
}
