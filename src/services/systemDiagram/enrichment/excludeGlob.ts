/**
 * Builds the single `findFiles` exclude glob for the workspace index from the
 * ignored directories and the user's `search.exclude` setting. Pure: setting in,
 * glob string out.
 *
 * VS Code applies `files.exclude` itself when `findFiles` gets an exclude
 * string, so only `search.exclude` is merged here. Entries with `false` or a
 * `when` clause are ignored. VS Code globs do not nest braces, so a pattern's
 * brace group is expanded into alternatives; a pattern with nested, unbalanced
 * or stray braces is skipped.
 */

import { IGNORED_DIRECTORY_GLOBS } from './workspaceFilter';

export type ExcludeSetting = Record<string, unknown> | undefined;

export interface ExcludeGlob {
  glob: string;
  /** User patterns left out because their braces cannot be expanded. */
  skipped: string[];
}

export function buildExcludeGlob(searchExclude: ExcludeSetting): ExcludeGlob {
  const patterns = new Set<string>(IGNORED_DIRECTORY_GLOBS);
  const skipped: string[] = [];
  for (const [pattern, value] of Object.entries(searchExclude ?? {})) {
    if (value !== true) {
      continue;
    }
    const expanded = expandBraces(pattern);
    if (expanded) {
      expanded.forEach((alternative) => patterns.add(alternative));
    } else {
      skipped.push(pattern);
    }
  }
  return { glob: `{${[...patterns].join(',')}}`, skipped };
}

/**
 * Index of the next `{` or `}` at or after `from`, ignoring `[...]` classes;
 * -1 when there is none.
 */
function nextBrace(text: string, from: number): number {
  let inClass = false;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (inClass) {
      inClass = char !== ']';
    } else if (char === '[') {
      inClass = true;
    } else if (char === '{' || char === '}') {
      return i;
    }
  }
  return -1;
}

/** Expands brace groups into alternatives; undefined for nested, unbalanced or stray braces. */
function expandBraces(pattern: string): string[] | undefined {
  const open = nextBrace(pattern, 0);
  if (open < 0) {
    return [pattern];
  }
  const close = pattern[open] === '{' ? nextBrace(pattern, open + 1) : -1;
  if (close < 0 || pattern[close] !== '}') {
    return undefined;
  }
  const tail = expandBraces(pattern.slice(close + 1));
  if (!tail) {
    return undefined;
  }
  const head = pattern.slice(0, open);
  return pattern
    .slice(open + 1, close)
    .split(',')
    .flatMap((alternative) => tail.map((rest) => `${head}${alternative}${rest}`));
}
