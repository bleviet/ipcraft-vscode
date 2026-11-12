/** Pure text matching for the Search instances box: its options, wildcards and the compiled matcher. */

export interface SearchOptions {
  /** Upper and lower case differ. */
  matchCase: boolean;
  /** A match starts and ends at the edge of an identifier (letters, digits, underscore). */
  wholeWord: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = { matchCase: false, wholeWord: false };

/** Whether a name or type matches the search. */
export type TextMatcher = (text: string) => boolean;

/** A query edge that whole word anchors: an identifier character or a wildcard. */
const WORD_EDGE = /[\w*?]/;

/**
 * The matcher of `query`, or null when it is blank. The trimmed query matches anywhere in a
 * text; `*` stands for any run of characters and `?` for exactly one. With whole word, an
 * edge of the query that is punctuation (`:7.1`) is not anchored, as in the VS Code find box.
 */
export function compileSearch(query: string, options: SearchOptions): TextMatcher | null {
  const trimmed = query.trim();
  if (trimmed === '') {
    return null;
  }
  let pattern = trimmed
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (options.wholeWord) {
    const start = WORD_EDGE.test(trimmed[0]) ? '(?<!\\w)' : '';
    const end = WORD_EDGE.test(trimmed[trimmed.length - 1]) ? '(?!\\w)' : '';
    pattern = `${start}(?:${pattern})${end}`;
  }
  const regex = new RegExp(pattern, options.matchCase ? '' : 'i');
  return (text) => regex.test(text);
}
