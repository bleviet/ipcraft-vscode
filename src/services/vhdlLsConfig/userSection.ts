/**
 * Reads the hand-written user section of a vhdl_ls.toml: the libraries it defines, the
 * "Missing library" proposals already present, and a matcher for its `files`/`exclude` globs.
 * Pure.
 */

import * as toml from 'toml';

export interface UserLibrary {
  /** Lower-cased library name. */
  name: string;
  files: string[];
  exclude: string[];
}

export interface UserSection {
  libraries: UserLibrary[];
  /** Lower-cased names that already have a `# Missing library <name>` line. */
  proposedLibraries: Set<string>;
}

export type UserSectionResult =
  | { ok: true; section: UserSection }
  | { ok: false; line: number; message: string };

export interface TomlErrorInfo {
  line: number;
  message: string;
}

/**
 * Extracts line and message from the error thrown by `toml.parse`. Semantic errors (duplicate
 * keys) carry `line`; syntax errors carry `location` and a long list of expected tokens.
 */
export function tomlErrorInfo(err: unknown): TomlErrorInfo {
  const e = err as {
    line?: number;
    message?: string;
    found?: string | null;
    location?: { start: { line: number; column: number } };
  };
  if (e.location) {
    const found =
      e.found === undefined || e.found === null ? 'end of input' : JSON.stringify(e.found);
    return {
      line: e.location.start.line,
      message: `unexpected ${found} at column ${e.location.start.column}`,
    };
  }
  return { line: e.line ?? 1, message: e.message ?? String(err) };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function parseUserSection(text: string): UserSectionResult {
  let data: { libraries?: Record<string, { files?: unknown; exclude?: unknown }> };
  try {
    data = toml.parse(text) as typeof data;
  } catch (err) {
    return { ok: false, ...tomlErrorInfo(err) };
  }
  const libraries = Object.entries(data.libraries ?? {}).map(([name, lib]) => ({
    name: name.toLowerCase(),
    files: stringList(lib?.files),
    exclude: stringList(lib?.exclude),
  }));
  const proposedLibraries = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^#\s*Missing library\s+([A-Za-z0-9_]+)\b/i.exec(line);
    if (m) {
      proposedLibraries.add(m[1].toLowerCase());
    }
  }
  return { ok: true, section: { libraries, proposedLibraries } };
}

/** Converts a glob (`*`, `**`, `?`) to an anchored RegExp over root-relative POSIX paths. */
function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        i++;
        if (normalized[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** `included` by the library, `excluded` (matches `files` but also `exclude`), or `none`. */
export type UserMatch = 'included' | 'excluded' | 'none';

/** Compiles the library's globs once; the matcher takes a root-relative POSIX path. */
export function createUserLibraryMatcher(library: UserLibrary): (file: string) => UserMatch {
  const files = library.files.map(globToRegExp);
  const exclude = library.exclude.map(globToRegExp);
  return (file) => {
    if (!files.some((re) => re.test(file))) {
      return 'none';
    }
    return exclude.some((re) => re.test(file)) ? 'excluded' : 'included';
  };
}
