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

/** The text of `filePath` at the git revision `ref`, read from the repository that contains the file. */
export async function readGitFile(filePath: string, ref: string): Promise<string> {
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
  const shown = await git(cwd, [
    'show',
    `${ref}:${prefix.stdout.replace(/\n$/, '')}${path.basename(absolute)}`,
  ]);
  if (shown.failure !== undefined) {
    throw new Error(`'${filePath}' does not exist at ${ref}${reason(shown)}`);
  }
  return shown.stdout;
}
