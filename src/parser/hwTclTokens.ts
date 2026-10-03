/**
 * Pure Tcl word tokenizer for the `_hw.tcl` importer: splits one command line
 * into words and applies `$var` / `${var}` substitution and the bracket forms
 * that carry port information.
 */

import { log2ceilToClog2, unquoteTclWord } from './hwTclExpr';

export function parseTclTokens(
  line: string,
  variables: ReadonlyMap<string, string> = new Map(),
  /** When true, `[log2ceil ARG]` becomes `clog2(ARG)` (the file's own proc has ceil(log2) semantics). */
  rewriteLog2ceil = false
): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    if (ch === '"') {
      i++;
      let val = '';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) {
          const escaped = line[i + 1];
          val += escaped === '$' ? `\\${escaped}` : escaped;
          i += 2;
          continue;
        } else {
          val += line[i];
        }
        i++;
      }
      i++; // closing quote
      tokens.push(substituteTclVariables(val, variables));
      continue;
    }

    if (ch === '{') {
      i++;
      let val = '';
      let depth = 1;
      while (i < line.length && depth > 0) {
        if (line[i] === '\\' && i + 1 < line.length) {
          // An escaped brace is literal and must not affect the outer braced
          // word's nesting. Preserve the escape for a later Tcl-list parse.
          val += line[i];
          val += line[i + 1];
          i += 2;
          continue;
        }
        if (line[i] === '{') {
          depth++;
        } else if (line[i] === '}') {
          depth--;
          if (depth === 0) {
            break;
          }
        }
        val += line[i];
        i++;
      }
      i++; // closing brace
      tokens.push(val);
      continue;
    }

    if (ch === '[') {
      // Command substitution. Capture the bracket body so we can recover the
      // one form that carries port information: `[get_parameter_value PARAM]`,
      // which Quartus (and our own generator) use for parameter-dependent port
      // widths inside the elaborate callback.
      let depth = 1;
      i++;
      let body = '';
      while (i < line.length && depth > 0) {
        if (line[i] === '[') {
          depth++;
        } else if (line[i] === ']') {
          depth--;
          if (depth === 0) {
            break;
          }
        }
        body += line[i];
        i++;
      }
      i++; // closing bracket
      const paramRef = /^\s*get_parameter_value\s+(\S+)\s*$/.exec(body);
      if (paramRef) {
        tokens.push(substituteTclVariables(unquoteTclWord(paramRef[1]), variables));
      } else {
        // Not a single parameter reference. Push a token rather than dropping the
        // argument: a vanished token shifts every later argument and can drop the
        // enclosing command (e.g. add_interface_port's width arg). `expr ...` bodies
        // stay bare because resolveTclWidth reduces them. Any other command
        // substitution (e.g. `[log2ceil "P"]`) keeps its brackets so hasTclSyntax
        // flags it and it is never written as if it were a literal. Names and widths
        // are checked with hasTclSyntax; free-text fields (descriptions, display
        // names, interface property values) may still carry the bracketed text.
        const substituted = substituteTclVariables(body, variables);
        const log2ceilArg = rewriteLog2ceil
          ? /^\s*log2ceil\s+([\s\S]*?)\s*$/.exec(substituted)
          : null;
        const clog2 = log2ceilArg ? log2ceilToClog2(log2ceilArg[1]) : null;
        tokens.push(clog2 ?? (/^\s*expr\b/.test(body) ? substituted : `[${substituted}]`));
      }
      continue;
    }

    // Plain token
    let val = '';
    while (i < line.length && line[i] !== ' ' && line[i] !== '\t') {
      val += line[i];
      i++;
    }
    tokens.push(substituteTclVariables(val, variables));
  }

  return tokens;
}

/**
 * Applies the two common Tcl variable-reference forms to a word. Unknown
 * variables stay verbatim so an unsupported or out-of-scope reference is not
 * silently discarded. Braced Tcl words bypass this helper in parseTclTokens,
 * matching Tcl's rule that braces suppress substitutions.
 */
export function substituteTclVariables(
  value: string,
  variables: ReadonlyMap<string, string>
): string {
  let result = '';
  let i = 0;

  while (i < value.length) {
    if (value[i] === '\\' && value[i + 1] === '$') {
      result += '$';
      i += 2;
      continue;
    }

    if (value[i] !== '$') {
      result += value[i];
      i++;
      continue;
    }

    let name = '';
    let end = i + 1;
    if (value[end] === '{') {
      const closingBrace = value.indexOf('}', end + 1);
      if (closingBrace === -1) {
        result += '$';
        i++;
        continue;
      }
      name = value.slice(end + 1, closingBrace);
      end = closingBrace + 1;
    } else {
      const nameMatch = /^[A-Za-z0-9_:]+/.exec(value.slice(end));
      if (!nameMatch) {
        result += '$';
        i++;
        continue;
      }
      name = nameMatch[0];
      end += name.length;
    }

    result += variables.get(name) ?? value.slice(i, end);
    i = end;
  }

  return result;
}
