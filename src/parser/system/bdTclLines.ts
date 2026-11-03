/**
 * Pure line helpers for the block design Tcl reader: logical-line assembly
 * (continuations, comments, blanks) and brace-depth block / proc collection.
 */

import { braceDelta, splitWords } from '../hwTclLoops';
import { parseProcParams, type ProcParam } from '../hwTclProcs';

export interface LogicalLine {
  text: string;
  /** 1-based line where the logical line starts. */
  line: number;
}

export interface ProcDef {
  name: string;
  params: ProcParam[];
  body: LogicalLine[];
  /** Line of the `proc` header. */
  line: number;
}

function endsWithContinuation(text: string): boolean {
  const trailing = /\\+$/.exec(text);
  return trailing !== null && trailing[0].length % 2 === 1;
}

/**
 * Joins backslash-newline continuations (the backslash, the newline and the
 * next line's leading whitespace become one space) and drops comment and blank
 * lines. Each result keeps the 1-based start line.
 */
export function toLogicalLines(text: string): LogicalLine[] {
  const physical = text.split(/\r?\n/);
  const result: LogicalLine[] = [];
  for (let i = 0; i < physical.length; i++) {
    const trimmed = physical[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    let joined = physical[i].trimStart();
    const start = i + 1;
    while (endsWithContinuation(joined) && i + 1 < physical.length) {
      i++;
      joined = `${joined.slice(0, -1)} ${physical[i].trimStart()}`;
    }
    result.push({ text: joined.trimEnd(), line: start });
  }
  return result;
}

/**
 * Index of the first line after the block that opens on `lines[idx]`: the
 * header itself when it is brace-balanced, otherwise the line after the one
 * where the brace depth returns to zero.
 */
export function blockEnd(lines: readonly LogicalLine[], idx: number): number {
  let depth = braceDelta(lines[idx].text);
  let j = idx + 1;
  while (depth > 0 && j < lines.length) {
    depth += braceDelta(lines[j].text);
    j++;
  }
  return j;
}

/** The lines strictly between a block header and its closing line. */
export function blockBody(lines: readonly LogicalLine[], idx: number): LogicalLine[] {
  const end = blockEnd(lines, idx);
  return end - idx > 1 ? lines.slice(idx + 1, end - 1) : [];
}

/**
 * Collects every `proc NAME ARGS { ... }` outside `namespace eval` blocks.
 * Bodies are not evaluated here.
 */
export function collectProcs(lines: readonly LogicalLine[]): Map<string, ProcDef> {
  const procs = new Map<string, ProcDef>();
  let i = 0;
  while (i < lines.length) {
    const words = splitWords(lines[i].text);
    const first = words[0]?.text;
    if (first === 'proc' && words.length >= 3) {
      const body =
        blockEnd(lines, i) - i > 1
          ? blockBody(lines, i)
          : words[3] !== undefined
            ? [{ text: words[3].text.trim(), line: lines[i].line }]
            : [];
      procs.set(words[1].text, {
        name: words[1].text,
        params: parseProcParams(words[2].text),
        body,
        line: lines[i].line,
      });
      i = blockEnd(lines, i);
    } else if (first === 'namespace') {
      i = blockEnd(lines, i);
    } else {
      i++;
    }
  }
  return procs;
}
