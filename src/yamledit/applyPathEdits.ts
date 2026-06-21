import { parseDocument, isScalar } from 'yaml';
import { detectIndentSeq } from './detectIndentSeq';
import { collectHexSpellings, restoreHexSpellings } from './restoreHexSpellings';
import { mergeNode } from './mergeNode';

export interface PathEdit {
  path: (string | number)[];
  value: unknown;
}

function toJS(node: unknown): unknown {
  return node !== null && typeof node === 'object' && 'toJSON' in node
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function parsePossibleHex(val: string): number | null {
  const cleaned = val.trim();
  if (cleaned.startsWith('0x') || cleaned.startsWith('0X')) {
    const parsed = parseInt(cleaned, 16);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Apply path-targeted edits to YAML text while preserving the formatting
 * and comments of everything that is not touched.
 */
export function applyPathEdits(text: string, edits: PathEdit[]): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    console.warn('Cannot apply edit: YAML parse failed', doc.errors[0]?.message);
    return text;
  }

  // Collect hex spellings BEFORE any mutations so the map keys the pre-edit
  // rendered value → original source string. Collecting after mergeNode would
  // key the new value, causing restoreHexSpellings to silently revert edits.
  const hexFix = collectHexSpellings(doc);

  let changed = false;
  for (const { path, value } of edits) {
    const current = doc.getIn(path, true);
    let finalValue = value;
    let forceHex = false;
    if (typeof value === 'string') {
      const parsed = parsePossibleHex(value);
      if (parsed !== null) {
        finalValue = parsed;
        forceHex = true;
      }
    }

    if (sameJson(toJS(current), finalValue)) {
      continue;
    }
    const merged = mergeNode(doc, current, finalValue);
    if (forceHex && isScalar(merged)) {
      merged.format = 'HEX';
    }
    if (merged !== current) {
      doc.setIn(path, merged);
    }
    changed = true;
  }

  if (!changed) {
    return text;
  }
  // lineWidth: 0 disables line folding. The pre-V-2 serializer used the `yaml`
  // default (80), which silently re-wraps any scalar longer than 80 columns —
  // reflowing untouched long descriptions and breaking the "one edit, one changed
  // line" goal. Disabling folding keeps every untouched line intact (pinned by the
  // "long untouched line" test in yamledit.test.ts).
  let out = doc.toString({ indentSeq: detectIndentSeq(text), lineWidth: 0 });
  out = restoreHexSpellings(out, hexFix);
  return out;
}
