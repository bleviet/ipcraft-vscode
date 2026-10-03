/**
 * Pure helpers for Tcl `if` / `elseif` / `else` chains in `_hw.tcl` files:
 * chain collection by brace depth and branch selection against an evaluator.
 */

import { braceDelta, splitWords } from './hwTclLoops';

export interface IfBranch {
  /** Condition text (braces removed), or null for the `else` branch. */
  condition: string | null;
  body: string[];
}

export interface IfChain {
  branches: IfBranch[];
  /** False when the chain could not be parsed; `branches` is then one flat body. */
  parsed: boolean;
  /** Index of the first line after the chain. */
  next: number;
}

/**
 * Collects the `if` chain whose header is `lines[headerIdx]`. Continuation lines
 * such as `} elseif {c} {` and `} else {` keep the brace depth positive, so the
 * chain spans the lines until the depth returns to zero. Single-line braced forms
 * are handled the same way.
 */
export function collectIfChain(lines: readonly string[], headerIdx: number): IfChain {
  let depth = braceDelta(lines[headerIdx]);
  let next = headerIdx + 1;
  while (depth > 0 && next < lines.length) {
    depth += braceDelta(lines[next]);
    next++;
  }
  const chainLines = lines.slice(headerIdx, next).filter((l) => !l.trimStart().startsWith('#'));
  const branches = parseBranches(splitWords(chainLines.join('\n')));
  if (branches) {
    return { branches, parsed: true, next };
  }
  // Unparseable: expose everything between the header and the last line as one body.
  const inner = lines.slice(headerIdx + 1, depth > 0 ? next : next - 1);
  return { branches: [{ condition: null, body: inner }], parsed: false, next };
}

function parseBranches(words: ReturnType<typeof splitWords>): IfBranch[] | null {
  const branches: IfBranch[] = [];
  let i = 0;
  if (words[i++]?.text !== 'if') {
    return null;
  }
  for (;;) {
    const cond = words[i++];
    const body = words[i++];
    if (cond?.kind !== 'brace' || body?.kind !== 'brace') {
      return null;
    }
    branches.push({ condition: cond.text, body: body.text.split('\n') });
    const keyword = words[i++];
    if (keyword === undefined) {
      return branches;
    }
    if (keyword.text === 'else') {
      const elseBody = words[i++];
      if (elseBody?.kind !== 'brace' || i !== words.length) {
        return null;
      }
      branches.push({ condition: null, body: elseBody.text.split('\n') });
      return branches;
    }
    if (keyword.text !== 'elseif') {
      return null;
    }
  }
}

/**
 * Picks the bodies to process. `evaluate` returns the truth of a condition, or
 * null when it cannot be evaluated. Conditions are tried in order: the first true
 * branch (or `else`) is selected alone. If a condition reached before a selection
 * is unevaluable, or the chain was not parsed, every body is returned with
 * `resolved: false`.
 */
export function selectIfBranches(
  chain: IfChain,
  evaluate: (condition: string) => boolean | null
): { bodies: string[][]; resolved: boolean } {
  const all = { bodies: chain.branches.map((b) => b.body), resolved: false };
  if (!chain.parsed) {
    return all;
  }
  for (const branch of chain.branches) {
    const taken = branch.condition === null ? true : evaluate(branch.condition);
    if (taken === null) {
      return all;
    }
    if (taken) {
      return { bodies: [branch.body], resolved: true };
    }
  }
  return { bodies: [], resolved: true };
}
