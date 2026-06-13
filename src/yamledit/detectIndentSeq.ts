/**
 * Detect whether the document indents sequence items relative to their
 * parent key (`key:\n  - a`) or keeps them at the same level (`key:\n- a`).
 */
export function detectIndentSeq(text: string): boolean {
  const m = text.match(/^([ \t]*)(?![#\s-])[^\n]*:[ \t]*\n(?:[ \t]*(?:#[^\n]*)?\n)*([ \t]*)- /m);
  return m ? m[2].length > m[1].length : true;
}
