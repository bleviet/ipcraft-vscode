/**
 * Pure helpers for Tcl `proc` declarations in `_hw.tcl` files: argument-list
 * parsing, the default bindings to apply when a proc body is run, and the
 * classification of the file-local `log2ceil` helper.
 */

import { collectLoopBody, parseTclList } from './hwTclLoops';
import { parseTclTokens } from './hwTclTokens';

export interface ProcParam {
  name: string;
  defaultValue?: string;
}

/** Parses a proc argument-list word: `a {b 7} {c "x"} {d {}}`. */
export function parseProcParams(spec: string): ProcParam[] {
  return parseTclList(spec).map((item) => {
    const [name, defaultValue] = parseTclList(item);
    return defaultValue === undefined ? { name } : { name, defaultValue };
  });
}

/**
 * Pre-scans the flattened content for `proc NAME ARGSPEC ...` declarations and
 * returns, per proc, the default bindings to apply when its body runs: param i
 * is bound iff it has a default and no call site (a line whose first word is
 * NAME) passes argument i. Procs that are never called get all their defaults.
 */
export function computeProcDefaults(lines: readonly string[]): Map<string, Map<string, string>> {
  const declared = new Map<string, ProcParam[]>();
  const maxArity = new Map<string, number>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const tokens = parseTclTokens(line);
    if (tokens[0] === 'proc' && tokens.length >= 3) {
      declared.set(tokens[1], parseProcParams(tokens[2]));
    } else if (tokens.length > 0) {
      maxArity.set(tokens[0], Math.max(maxArity.get(tokens[0]) ?? 0, tokens.length - 1));
    }
  }
  const result = new Map<string, Map<string, string>>();
  for (const [name, params] of declared) {
    const passed = maxArity.get(name) ?? 0;
    const bindings = new Map<string, string>();
    params.forEach((param, i) => {
      if (param.defaultValue !== undefined && i >= passed) {
        bindings.set(param.name, param.defaultValue);
      }
    });
    if (bindings.size > 0) {
      result.set(name, bindings);
    }
  }
  return result;
}

const stripSpace = (s: string): string => s.replace(/\s+/g, '');

const LOOP_FORM = (p: string): string[] => [
  'setval0',
  'seti1',
  `while{$i<$${p}}{`,
  'setval[expr$val+1]',
  'seti[expr1<<$val]',
  '}',
  'return$val',
];

/**
 * True when the `proc log2ceil` declared at `lines[headerIdx]` computes
 * ceil(log2(x)) (log2ceil(1) == 0): the `while {$i < $num}` loop form or the
 * `expr {int(ceil(log($x)/log(2)))}` one-liner. Variants with other semantics
 * (e.g. `set val 1` or `$i <= $num`) are rejected.
 */
export function isCeilLog2Proc(lines: readonly string[], headerIdx: number): boolean {
  const header = lines[headerIdx].trim();
  const tokens = parseTclTokens(header);
  if (tokens[0] !== 'proc' || tokens[1] !== 'log2ceil' || tokens.length < 3) {
    return false;
  }
  const params = parseProcParams(tokens[2]);
  if (params.length !== 1) {
    return false;
  }
  const p = params[0].name;
  if (
    stripSpace(header) ===
    stripSpace(`proc log2ceil ${p} "expr {int(ceil(log(\\$${p})/[expr log(2)]))}"`)
  ) {
    return true;
  }
  const { body } = collectLoopBody(lines, headerIdx);
  const code = body
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => stripSpace(l).replace(/;$/, ''));
  if (code.length === 1 && code[0] === `return[expr{int(ceil(log($${p})/log(2)))}]`) {
    return true;
  }
  const expected = LOOP_FORM(p);
  return code.length === expected.length && code.every((l, i) => l === expected[i]);
}

/** True when the file's own (last) `proc log2ceil` has ceil(log2) semantics. */
export function hasCeilLog2Proc(lines: readonly string[]): boolean {
  let last = -1;
  lines.forEach((line, i) => {
    if (/^\s*proc\s+log2ceil\b/.test(line)) {
      last = i;
    }
  });
  return last >= 0 && isCeilLog2Proc(lines, last);
}
