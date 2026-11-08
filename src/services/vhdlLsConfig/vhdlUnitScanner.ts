/**
 * Light VHDL scanner: finds primary units, `library` clauses and library references (`use`,
 * `context` and direct `entity`/`configuration` instantiation) without a full parse. Comments,
 * string literals and character literals are blanked first so keywords inside them are not
 * matched. Pure.
 */

export type VhdlUnitKind = 'entity' | 'package' | 'configuration' | 'context';

export interface VhdlUnit {
  kind: VhdlUnitKind;
  name: string;
  line: number;
}

export interface VhdlLibraryClause {
  name: string;
  line: number;
}

export interface VhdlUse {
  library: string;
  unit: string;
  line: number;
}

export interface VhdlScan {
  units: VhdlUnit[];
  libraries: VhdlLibraryClause[];
  uses: VhdlUse[];
}

/** Replaces comments, strings and character literals with spaces (newlines kept), then lower-cases. */
function blankNonCode(text: string): string {
  const out: string[] = [];
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      out.push(text[k] === '\n' ? '\n' : ' ');
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '-' && text[i + 1] === '-') {
      let end = text.indexOf('\n', i);
      end = end === -1 ? text.length : end;
      blank(i, end);
      i = end;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      blank(i, end);
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      const end = Math.min(j + 1, text.length);
      blank(i, end);
      i = end;
    } else if (ch === "'" && i + 2 < text.length && text[i + 2] === "'" && text[i + 1] !== '\n') {
      blank(i, i + 3);
      i += 3;
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join('').toLowerCase();
}

const IDENT = /^[a-z][a-z0-9_]*$/;

export function scanVhdl(text: string): VhdlScan {
  const code = blankNonCode(text);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };

  const units: VhdlUnit[] = [];
  for (const m of code.matchAll(
    /\b(entity|package|configuration|context)\s+([a-z][a-z0-9_]*)\s+(?:of\s+[a-z][a-z0-9_.]*\s+)?is\b/g
  )) {
    units.push({ kind: m[1] as VhdlUnitKind, name: m[2], line: lineAt(m.index) });
  }

  const libraries: VhdlLibraryClause[] = [];
  for (const m of code.matchAll(/\blibrary\s+([^;]+);/g)) {
    for (const item of m[1].split(',')) {
      const name = item.trim();
      if (IDENT.test(name)) {
        libraries.push({ name, line: lineAt(m.index) });
      }
    }
  }

  const uses: VhdlUse[] = [];
  for (const m of code.matchAll(/\buse\s+([^;]+);/g)) {
    for (const item of m[1].split(',')) {
      const ref = /^\s*([a-z]\w*)\s*\.\s*([a-z]\w*)/.exec(item);
      if (ref) {
        uses.push({ library: ref[1], unit: ref[2], line: lineAt(m.index) });
      }
    }
  }
  for (const m of code.matchAll(/\bcontext\s+([a-z]\w*)\s*\.\s*([a-z]\w*)\s*;/g)) {
    uses.push({ library: m[1], unit: m[2], line: lineAt(m.index) });
  }
  // Direct instantiation: `label: entity lib.unit(arch)` / `configuration lib.cfg`.
  for (const m of code.matchAll(/\b(?:entity|configuration)\s+([a-z]\w*)\s*\.\s*([a-z]\w*)/g)) {
    uses.push({ library: m[1], unit: m[2], line: lineAt(m.index) });
  }

  return { units, libraries, uses };
}
