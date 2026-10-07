import { parseDocument } from 'yaml';
import { collectHexSpellings } from './restoreHexSpellings';
import { serializeEdit } from './serializeEdit';

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
  return serializeEdit(text, doc, hexFix);
}
