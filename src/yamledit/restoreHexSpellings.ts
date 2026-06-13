import { visit, type Document, type Scalar } from 'yaml';

/**
 * Collect original hex spellings (case and zero-padding) from AST Scalar nodes.
 */
export function collectHexSpellings(doc: Document): Map<string, string> {
  const hexFix = new Map<string, string>();
  visit(doc, {
    Scalar(_key, node: Scalar) {
      if (
        node.format === 'HEX' &&
        typeof node.source === 'string' &&
        typeof node.value === 'number'
      ) {
        hexFix.set(`0x${node.value.toString(16)}`, node.source);
      }
    },
  });
  return hexFix;
}

/**
 * Restore original hex spellings in serialized YAML text.
 */
export function restoreHexSpellings(text: string, hexFix: Map<string, string>): string {
  let out = text;
  for (const [rendered, source] of hexFix) {
    if (rendered !== source) {
      out = out.replace(new RegExp(`\\b${rendered}\\b`, 'gi'), source);
    }
  }
  return out;
}
