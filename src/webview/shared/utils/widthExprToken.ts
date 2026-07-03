/**
 * Cursor-relative identifier token detection for the width-expression
 * autocomplete dropdown (function names / parameter names).
 *
 * Only ever looks backward from the cursor — it never touches text after the
 * cursor — so typing in the middle of an expression only ever completes what
 * has been typed so far, never text that comes after the caret.
 */

export interface WidthExprToken {
  start: number;
  end: number;
  text: string;
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Returns the identifier-like token ending exactly at `cursor`, or `null` if
 * the character immediately before the cursor isn't an identifier character,
 * or the token is purely digits (e.g. `8` should never trigger suggestions).
 */
export function getIdentifierTokenAtCursor(text: string, cursor: number): WidthExprToken | null {
  if (cursor <= 0 || cursor > text.length) {
    return null;
  }
  const prevChar = text[cursor - 1];
  if (!IDENTIFIER_CHAR.test(prevChar)) {
    return null;
  }

  let start = cursor;
  while (start > 0 && IDENTIFIER_CHAR.test(text[start - 1])) {
    start--;
  }

  const tokenText = text.slice(start, cursor);
  if (DIGITS_ONLY.test(tokenText)) {
    return null;
  }

  return { start, end: cursor, text: tokenText };
}
