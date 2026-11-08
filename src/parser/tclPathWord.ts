import * as path from 'path';
import { hasTclSyntax } from './hwTclExpr';
import { parseTclList } from './hwTclLoops';

const FILE_JOIN = /^\s*\[\s*file\s+join\s+([\s\S]*)\]\s*$/;

/**
 * Resolves a Tcl path word (a plain path or `[file join ...]`) to a path string.
 * Items that exactly equal a key of `substitutions` are replaced by its value.
 * Returns null when Tcl syntax remains that cannot be resolved statically.
 */
export function resolveTclPathWord(
  raw: string,
  substitutions: ReadonlyMap<string, string> = new Map()
): string | null {
  const substitute = (item: string): string => substitutions.get(item) ?? item;
  const joined = FILE_JOIN.exec(raw);
  const filePath = joined ? path.join(...parseTclList(joined[1]).map(substitute)) : substitute(raw);
  return hasTclSyntax(filePath) ? null : filePath;
}
