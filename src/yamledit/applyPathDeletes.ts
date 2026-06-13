import { parseDocument } from 'yaml';
import { detectIndentSeq } from './detectIndentSeq';
import { collectHexSpellings, restoreHexSpellings } from './restoreHexSpellings';

/**
 * Delete specified paths from YAML text while preserving the formatting
 * and comments of everything that is not touched.
 */
export function applyPathDeletes(text: string, paths: (string | number)[][]): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    console.warn('Cannot apply delete: YAML parse failed', doc.errors[0]?.message);
    return text;
  }

  let changed = false;
  for (const path of paths) {
    const exists = doc.hasIn(path);
    if (exists) {
      doc.deleteIn(path);
      changed = true;
    }
  }

  if (!changed) {
    return text;
  }

  const hexFix = collectHexSpellings(doc);
  // lineWidth: 0 disables folding so untouched long scalars are not reflowed; see
  // the matching note in applyPathEdits.ts.
  let out = doc.toString({ indentSeq: detectIndentSeq(text), lineWidth: 0 });
  out = restoreHexSpellings(out, hexFix);
  return out;
}
