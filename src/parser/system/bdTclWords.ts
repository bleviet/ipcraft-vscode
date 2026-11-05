/**
 * Pure word helpers for the block design Tcl reader: command splitting,
 * variable substitution on non-braced words, bracketed sub-commands and
 * `-flag value` option parsing. Built on the shared hw.tcl helpers.
 */

import { parseTclList, splitWords, type Word } from '../hwTclLoops';
import { substituteTclVariables } from '../hwTclTokens';
import { unquoteTclWord } from '../hwTclExpr';

export type { Word };
export { splitWords, parseTclList };

/** Value of a word: braced words verbatim, others unquoted and `$var`-substituted. */
export function wordValue(word: Word, vars: ReadonlyMap<string, string>): string {
  return word.kind === 'brace'
    ? word.text
    : substituteTclVariables(unquoteTclWord(word.text), vars);
}

/** True for a non-braced word of the form `[cmd ...]`. */
export function isBracketed(word: Word): boolean {
  return word.kind === 'other' && word.text.startsWith('[') && word.text.endsWith(']');
}

/** The words inside a bracketed word. */
export function bracketWords(word: Word): Word[] {
  return splitWords(word.text.slice(1, -1));
}

export interface ParsedOptions {
  /** Flag name to its value word (`null` for flags that take no value). */
  flags: Map<string, Word | null>;
  positional: Word[];
}

/** Splits `-flag [value]` options from positional words; `valueFlags` take one value. */
export function parseOptions(
  words: readonly Word[],
  valueFlags: ReadonlySet<string>
): ParsedOptions {
  const flags = new Map<string, Word | null>();
  const positional: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.kind === 'other' && /^-[A-Za-z_]/.test(w.text)) {
      if (valueFlags.has(w.text) && i + 1 < words.length) {
        flags.set(w.text, words[++i]);
      } else {
        flags.set(w.text, null);
      }
    } else {
      positional.push(w);
    }
  }
  return { flags, positional };
}

interface ListItem {
  kind: 'brace' | 'command' | 'quoted' | 'bare';
  text: string;
}

/** Quote- and brace-aware Tcl list tokenizer (braced and quoted items lose their delimiters). */
function tokenizeList(text: string): ListItem[] {
  const items: ListItem[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
    } else if (text[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === '\\') {
          j++;
        } else if (text[j] === '{') {
          depth++;
        } else if (text[j] === '}' && --depth === 0) {
          break;
        }
      }
      items.push({ kind: 'brace', text: text.slice(i + 1, j) });
      i = j + 1;
    } else if (text[i] === '"') {
      let item = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && j + 1 < text.length) {
          j++;
        }
        item += text[j];
      }
      items.push({ kind: 'quoted', text: item });
      i = j + 1;
    } else {
      let j = i;
      let bracketDepth = 0;
      for (; j < text.length && (bracketDepth > 0 || !/\s/.test(text[j])); j++) {
        if (text[j] === '[') {
          bracketDepth++;
        } else if (text[j] === ']') {
          bracketDepth--;
        }
      }
      const raw = text.slice(i, j);
      items.push({ kind: raw.startsWith('[') ? 'command' : 'bare', text: raw });
      i = j;
    }
  }
  return items;
}

/**
 * Key/value pairs of a `-dict` argument. In `[list K V ...]` braced items stay
 * literal while quoted and bare items get `$var` substitution; a braced
 * `{K V ...}` list is taken literally.
 */
export function dictEntries(word: Word, vars: ReadonlyMap<string, string>): [string, string][] {
  let items: ListItem[];
  if (isBracketed(word)) {
    const inner = word.text.slice(1, -1).trim();
    if (!/^list(?:\s|$)/.test(inner)) {
      return [];
    }
    items = tokenizeList(inner.slice(4)).map((item) =>
      item.kind === 'brace' || item.kind === 'command'
        ? item
        : { ...item, text: substituteTclVariables(item.text, vars) }
    );
  } else {
    items = tokenizeList(word.text);
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < items.length; i += 2) {
    pairs.push([items[i].text, items[i + 1].text]);
  }
  return pairs;
}
