/**
 * Pure helpers for expanding Tcl `for` / `foreach` loops in `_hw.tcl` files:
 * body collection by brace depth and header resolution to iteration values.
 */

import { evaluateTclInt, hasTclSyntax } from './hwTclExpr';

/** Loops with more iterations than this are treated as unresolvable. */
export const MAX_LOOP_ITERATIONS = 256;

export interface LoopResolveContext {
  /** Applies the parser's `$var` / `${var}` substitution to a string. */
  substitute: (text: string) => string;
  getVariable: (name: string) => string | undefined;
  /** True when `name` is a declared parameter (a variable holding one is not a list). */
  isParameter: (name: string) => boolean;
  /** Numeric parameter defaults, used to evaluate bounds like `NUM_CHANNELS`. */
  paramValues: ReadonlyMap<string, number>;
}

export interface ResolvedLoop {
  variable: string;
  values: string[];
}

interface Word {
  kind: 'brace' | 'other';
  text: string;
}

/** Parses a Tcl list, removing the quotes or braces around each item. */
export function parseTclList(text: string): string[] {
  const items: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
    } else if (text[i] === '"') {
      let item = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && j + 1 < text.length) {
          j++;
        }
        item += text[j];
      }
      items.push(item);
      i = j + 1;
    } else if (text[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === '{') {
          depth++;
        } else if (text[j] === '}' && --depth === 0) {
          break;
        }
      }
      items.push(text.slice(i + 1, j));
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/\s/.test(text[j])) {
        j++;
      }
      items.push(text.slice(i, j));
      i = j;
    }
  }
  return items;
}

/** Net unescaped brace depth of one line (comment lines count as zero). */
function braceDelta(line: string): number {
  if (line.trimStart().startsWith('#')) {
    return 0;
  }
  let delta = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
    } else if (line[i] === '{') {
      delta++;
    } else if (line[i] === '}') {
      delta--;
    }
  }
  return delta;
}

/** Splits a command line into Tcl words, keeping braced words as one unit. */
function splitWords(line: string): Word[] {
  const words: Word[] = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) {
      i++;
      continue;
    }
    if (line[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < line.length; j++) {
        if (line[j] === '\\') {
          j++;
        } else if (line[j] === '{') {
          depth++;
        } else if (line[j] === '}' && --depth === 0) {
          break;
        }
      }
      words.push({ kind: 'brace', text: line.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    let j = i;
    let bracketDepth = 0;
    for (; j < line.length && (bracketDepth > 0 || !/\s/.test(line[j])); j++) {
      if (line[j] === '[') {
        bracketDepth++;
      } else if (line[j] === ']') {
        bracketDepth--;
      }
    }
    words.push({ kind: 'other', text: line.slice(i, j) });
    i = j;
  }
  return words;
}

/**
 * Collects the body of the loop whose header is `lines[headerIdx]`. `next` is
 * the index of the first line after the loop. A body closed on the header line
 * is its last braced word; otherwise it spans the following lines until the
 * brace depth returns to zero (the closing line itself is not a command).
 */
export function collectLoopBody(
  lines: readonly string[],
  headerIdx: number
): { body: string[]; next: number } {
  let depth = braceDelta(lines[headerIdx]);
  if (depth <= 0) {
    const last = splitWords(lines[headerIdx]).pop();
    return { body: last?.kind === 'brace' ? [last.text] : [], next: headerIdx + 1 };
  }
  const body: string[] = [];
  let idx = headerIdx + 1;
  for (; idx < lines.length; idx++) {
    depth += braceDelta(lines[idx]);
    if (depth <= 0) {
      idx++;
      break;
    }
    body.push(lines[idx]);
  }
  return { body, next: idx };
}

function evalBound(text: string, ctx: LoopResolveContext): number | null {
  return evaluateTclInt(ctx.substitute(text), ctx.paramValues);
}

function resolveForLoop(words: Word[], ctx: LoopResolveContext): ResolvedLoop | null {
  const [, init, cond, next] = words;
  if (init?.kind !== 'brace' || cond?.kind !== 'brace' || next?.kind !== 'brace') {
    return null;
  }
  const initMatch = /^\s*set\s+(\w+)\s+(.+?)\s*$/.exec(init.text);
  const condMatch = /^\s*\$(?:\{(\w+)\}|(\w+))\s*(<=|<)\s*(.+?)\s*$/.exec(cond.text);
  const nextMatch = /^\s*incr\s+(\w+)(?:\s+(.+?))?\s*$/.exec(next.text);
  if (!initMatch || !condMatch || !nextMatch) {
    return null;
  }
  const variable = initMatch[1];
  if ((condMatch[1] ?? condMatch[2]) !== variable || nextMatch[1] !== variable) {
    return null;
  }
  const start = evalBound(initMatch[2], ctx);
  const bound = evalBound(condMatch[4], ctx);
  const step = nextMatch[2] === undefined ? 1 : evalBound(nextMatch[2], ctx);
  if (start === null || bound === null || step === null || step <= 0) {
    return null;
  }
  const inclusive = condMatch[3] === '<=';
  const values: string[] = [];
  for (let v = start; inclusive ? v <= bound : v < bound; v += step) {
    if (values.length >= MAX_LOOP_ITERATIONS) {
      return null;
    }
    values.push(String(v));
  }
  return { variable, values };
}

function resolveForeachLoop(words: Word[], ctx: LoopResolveContext): ResolvedLoop | null {
  const [, varWord, listWord] = words;
  if (varWord?.kind !== 'other' || !/^\w+$/.test(varWord.text) || !listWord) {
    return null;
  }
  let values: string[];
  if (listWord.kind === 'brace') {
    values = parseTclList(listWord.text);
  } else {
    const ref = /^\$(?:\{(\w+)\}|(\w+))$/.exec(listWord.text);
    const value = ref ? ctx.getVariable(ref[1] ?? ref[2]) : undefined;
    if (value === undefined) {
      return null;
    }
    const listCmd = /^\s*\[\s*list\b([\s\S]*)\]\s*$/.exec(value);
    if (listCmd) {
      values = parseTclList(listCmd[1]);
    } else if (hasTclSyntax(value) || ctx.isParameter(value.trim())) {
      return null;
    } else {
      values = parseTclList(value);
    }
  }
  if (values.length > MAX_LOOP_ITERATIONS || values.some(hasTclSyntax)) {
    return null;
  }
  return { variable: varWord.text, values };
}

/** Resolves a `for` / `foreach` header line to its variable and values, or null. */
export function resolveLoop(header: string, ctx: LoopResolveContext): ResolvedLoop | null {
  const words = splitWords(header);
  if (words[0]?.text === 'for') {
    return resolveForLoop(words, ctx);
  }
  if (words[0]?.text === 'foreach') {
    return resolveForeachLoop(words, ctx);
  }
  return null;
}
