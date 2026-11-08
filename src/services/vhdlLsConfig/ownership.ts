/**
 * Decides whether an existing vhdl_ls.toml is IPCraft's own, unmodified output, and extracts
 * its user section. Pure.
 */

import {
  GENERATED_END,
  GENERATED_START,
  HEADER_HASH_PREFIX,
  USER_MARKER,
  hashGeneratedLines,
} from './renderVhdlLsToml';

/**
 * none: no file. owned: IPCraft output whose generated section is untouched. edited: IPCraft
 * output whose generated section changed or lost a marker. user: not written by IPCraft.
 */
export type Ownership = 'none' | 'owned' | 'edited' | 'user';

/** Converts CRLF line endings to LF. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function classifyExisting(rawText: string | undefined): Ownership {
  if (rawText === undefined) {
    return 'none';
  }
  const lines = normalizeEol(rawText).split('\n');
  const header = lines.find((line) => line.startsWith(HEADER_HASH_PREFIX));
  if (header === undefined) {
    return 'user';
  }
  const start = lines.indexOf(GENERATED_START);
  const end = lines.indexOf(GENERATED_END, start + 1);
  if (start === -1 || end === -1 || !lines.includes(USER_MARKER)) {
    return 'edited';
  }
  const recorded = header.slice(HEADER_HASH_PREFIX.length).trim();
  return hashGeneratedLines(lines.slice(start + 1, end)) === recorded ? 'owned' : 'edited';
}

/** The text after the user marker line (excluding that line), verbatim. */
export function splitUserSection(rawText: string): string {
  const text = normalizeEol(rawText);
  const marker = text.indexOf(USER_MARKER);
  if (marker === -1) {
    return '';
  }
  const newline = text.indexOf('\n', marker);
  return newline === -1 ? '' : text.slice(newline + 1);
}
