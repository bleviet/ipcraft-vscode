/**
 * Pure, vscode-free helpers for issue #206: making the `ipcraft` CLI available in a
 * terminal after installing the extension, without sudo/admin rights and without a
 * separate Node.js install.
 *
 * Two kinds of generated files:
 * - "launcher": lives in the extension's globalStorage, rewritten on every activation.
 *   It hardcodes the current `process.execPath` (VS Code's own Electron/Node runtime)
 *   and the current extension's `dist/cli.js`, so it always matches the installed
 *   extension version.
 * - "shim": a tiny, stable file written into a user-writable bin directory (e.g.
 *   `~/.local/bin`) by the install command. It never changes; it just forwards to the
 *   launcher, so the PATH entry the user (or their shell profile) points at never goes
 *   stale across extension updates.
 *
 * No function here touches disk, the network, or `vscode` — everything is string in,
 * string out, so platform-specific behavior (Windows vs. POSIX, zsh vs. bash, darwin vs.
 * linux) can be unit tested from any host OS.
 */

import * as path from 'path';

/** Marker line embedded in every POSIX shim/launcher IPCraft writes, used to recognize our own files before overwriting or removing them. */
export const POSIX_SHIM_MARKER = '# ipcraft-vscode shim';
/** Marker line embedded in every Windows shim/launcher IPCraft writes. */
export const WINDOWS_SHIM_MARKER = 'REM ipcraft-vscode shim';

/** Escapes a single-quoted POSIX shell argument: `'` -> `'\''`. */
function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The POSIX launcher script: runs the CLI bundle with VS Code's own Electron runtime
 * acting as plain Node (`ELECTRON_RUN_AS_NODE=1`), so no separate Node.js install is
 * required. Paths are single-quoted so spaces/parentheses in a `.app` bundle path
 * (typical on macOS) survive.
 */
export function posixLauncher(execPath: string, cliJsPath: string): string {
  return (
    `#!/bin/sh\n` +
    `${POSIX_SHIM_MARKER}\n` +
    `ELECTRON_RUN_AS_NODE=1 exec ${quotePosix(execPath)} ${quotePosix(cliJsPath)} "$@"\n`
  );
}

/** The Windows launcher script (`.cmd`): same idea, via `cmd.exe`. */
export function windowsLauncher(execPath: string, cliJsPath: string): string {
  return (
    `@echo off\r\n` +
    `${WINDOWS_SHIM_MARKER}\r\n` +
    `setlocal\r\n` +
    `set ELECTRON_RUN_AS_NODE=1\r\n` +
    `"${execPath}" "${cliJsPath}" %*\r\n`
  );
}

/** The POSIX shim written into the user's bin directory: forwards to the stable launcher path. */
export function posixShim(launcherPath: string): string {
  return `#!/bin/sh\n${POSIX_SHIM_MARKER}\nexec ${quotePosix(launcherPath)} "$@"\n`;
}

/** The Windows shim (`.cmd`) written into the user's bin directory: forwards to the stable launcher path. */
export function windowsShim(launcherPath: string): string {
  return `@echo off\r\n${WINDOWS_SHIM_MARKER}\r\n"${launcherPath}" %*\r\n`;
}

/** True when file content was written by IPCraft (carries one of our marker lines). */
export function isOwnShim(content: string): boolean {
  return content.includes(POSIX_SHIM_MARKER) || content.includes(WINDOWS_SHIM_MARKER);
}

/**
 * The user-writable, no-sudo bin directory the install command writes a shim into.
 * - Linux/macOS: `~/.local/bin` (XDG convention; already on PATH on most Linux distros).
 * - Windows: `%LOCALAPPDATA%\Programs\ipcraft` (per-user, no admin rights needed).
 */
export function userBinDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homedir: string
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.win32.join(homedir, 'AppData', 'Local');
    return path.win32.join(localAppData, 'Programs', 'ipcraft');
  }
  return path.posix.join(homedir, '.local', 'bin');
}

function normalizeWindowsDir(dir: string): string {
  return dir
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

function normalizePosixDir(dir: string): string {
  return dir.trim().replace(/\/+$/, '');
}

/** Splits a Windows `Path`-style value (`;`-delimited) into non-empty, trimmed entries. */
export function windowsPathEntries(pathValue: string | undefined): string[] {
  return (pathValue ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Case-insensitive, trailing-separator-tolerant check for whether `dir` is on `pathEnv`. */
export function isDirOnPath(
  dir: string,
  pathEnv: string | undefined,
  platform: NodeJS.Platform
): boolean {
  if (platform === 'win32') {
    const target = normalizeWindowsDir(dir);
    return windowsPathEntries(pathEnv).some((entry) => normalizeWindowsDir(entry) === target);
  }
  const target = normalizePosixDir(dir);
  return (pathEnv ?? '')
    .split(':')
    .some((entry) => normalizePosixDir(entry) === target && entry.length > 0);
}

/** Appends `dir` to a Windows `Path`-style value, unless it is already present (case-insensitive). */
export function addWindowsPathEntry(pathValue: string | undefined, dir: string): string {
  const entries = windowsPathEntries(pathValue);
  const target = normalizeWindowsDir(dir);
  if (entries.some((entry) => normalizeWindowsDir(entry) === target)) {
    return entries.join(';');
  }
  return [...entries, dir].join(';');
}

/** Removes any entry matching `dir` (case-insensitive) from a Windows `Path`-style value. */
export function removeWindowsPathEntry(pathValue: string | undefined, dir: string): string {
  const target = normalizeWindowsDir(dir);
  return windowsPathEntries(pathValue)
    .filter((entry) => normalizeWindowsDir(entry) !== target)
    .join(';');
}

/** Escapes a value for interpolation into a single-quoted PowerShell string literal: `'` -> `''`. */
export function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * The shell profile file the install command offers to edit, or `undefined` when the
 * shell is unrecognized (fish, unknown, or Windows) — in which case only a hint is shown.
 * zsh/bash on macOS default to a *login* shell (`.zprofile`/`.bash_profile`); on Linux,
 * terminals are typically interactive non-login shells (`.zshrc`/`.bashrc`).
 */
export function shellProfileFor(
  platform: NodeJS.Platform,
  shellEnv: string | undefined,
  homedir: string
): string | undefined {
  if (platform === 'win32') {
    return undefined;
  }
  const shellName = shellEnv ? path.posix.basename(shellEnv) : '';
  const isDarwin = platform === 'darwin';
  if (shellName === 'zsh') {
    return path.posix.join(homedir, isDarwin ? '.zprofile' : '.zshrc');
  }
  if (shellName === 'bash') {
    return path.posix.join(homedir, isDarwin ? '.bash_profile' : '.bashrc');
  }
  return undefined;
}

/** Renders `dir` as `$HOME/...` when it is under `homedir`, so the profile line survives account renames/moves. */
export function pathExprForProfile(dir: string, homedir: string): string {
  const home = normalizePosixDir(homedir);
  const target = normalizePosixDir(dir);
  if (target === home) {
    return '$HOME';
  }
  const prefix = `${home}/`;
  if (target.startsWith(prefix)) {
    return `$HOME/${target.slice(prefix.length)}`;
  }
  return dir;
}

const BLOCK_START = '# >>> ipcraft >>>';
const BLOCK_END = '# <<< ipcraft <<<';

/** Builds the literal `export PATH=...` line the install command adds to a shell profile. */
export function pathExportLine(pathExpr: string): string {
  return `export PATH="${pathExpr}:$PATH"`;
}

/**
 * Removes IPCraft's idempotent, delimited PATH block (and the single blank separator
 * line `addPathBlock` inserts before it) from `profileText`. A no-op when the block is
 * absent or malformed (defensive: never corrupt a profile we don't fully understand).
 */
export function removePathBlock(profileText: string): string {
  const lines = profileText.split('\n');
  const startIdx = lines.findIndex((line) => line.trim() === BLOCK_START);
  if (startIdx === -1) {
    return profileText;
  }
  const endIdx = lines.findIndex((line, i) => i > startIdx && line.trim() === BLOCK_END);
  if (endIdx === -1) {
    return profileText;
  }
  const removeFrom = startIdx > 0 && lines[startIdx - 1] === '' ? startIdx - 1 : startIdx;
  return [...lines.slice(0, removeFrom), ...lines.slice(endIdx + 1)].join('\n');
}

/**
 * Idempotently adds (replacing any previous copy of) IPCraft's delimited PATH block to
 * `profileText`. Calling this twice with the same arguments produces identical output.
 */
export function addPathBlock(profileText: string, pathExpr: string): string {
  const base = removePathBlock(profileText);
  const trimmedBase = base.replace(/\n+$/, '');
  const block = [BLOCK_START, pathExportLine(pathExpr), BLOCK_END].join('\n');
  return trimmedBase.length === 0 ? `${block}\n` : `${trimmedBase}\n\n${block}\n`;
}
