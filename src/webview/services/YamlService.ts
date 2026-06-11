import jsyaml from 'js-yaml';
import { parseDocument, visit, isMap, isSeq, type Document, type Scalar } from 'yaml';
import { formatBitsLike } from '../utils/BitFieldUtils';

/** A single path-targeted edit for {@link YamlService.applyPathEdits}. */
export interface PathEdit {
  path: (string | number)[];
  value: unknown;
}

/**
 * Detect whether the document indents sequence items relative to their
 * parent key (`key:\n  - a`) or keeps them at the same level (`key:\n- a`).
 */
function detectIndentSeq(text: string): boolean {
  const m = text.match(/^([ \t]*)(?![#\s-])[^\n]*:[ \t]*\n(?:[ \t]*(?:#[^\n]*)?\n)*([ \t]*)- /m);
  return m ? m[2].length > m[1].length : true;
}

/** Plain-JS view of a document node (or pass-through for scalar values). */
function toJS(node: unknown): unknown {
  return node !== null && typeof node === 'object' && 'toJSON' in node
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Merge a plain JS value into an existing document node, reusing existing
 * nodes wherever their content already matches. Reused nodes keep their
 * comments, scalar styles (hex spellings, quoting) and formatting; only
 * genuinely changed parts are re-created.
 */
function mergeNode(doc: Document, current: unknown, value: unknown): unknown {
  if (sameJson(toJS(current), value)) {
    return current;
  }

  // Sequence: match incoming elements to existing items (exact content first,
  // then by `name` for recursive merge) so untouched elements keep their nodes.
  if (Array.isArray(value) && isSeq(current)) {
    const used = new Set<number>();
    const items = (value as unknown[]).map((v) => {
      for (let i = 0; i < current.items.length; i++) {
        if (!used.has(i) && sameJson(toJS(current.items[i]), v)) {
          used.add(i);
          return current.items[i];
        }
      }
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const name = (v as Record<string, unknown>).name;
        if (typeof name === 'string') {
          for (let i = 0; i < current.items.length; i++) {
            if (used.has(i)) {
              continue;
            }
            const js = toJS(current.items[i]);
            if (
              js !== null &&
              typeof js === 'object' &&
              (js as Record<string, unknown>).name === name
            ) {
              used.add(i);
              return mergeNode(doc, current.items[i], v);
            }
          }
        }
      }
      return doc.createNode(v);
    });
    current.items = items;
    return current;
  }

  // Mapping: update changed keys in place, drop removed ones, append new ones.
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && isMap(current)) {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) {
        continue;
      }
      const curVal = current.get(k, true);
      if (!sameJson(toJS(curVal), v)) {
        current.set(k, mergeNode(doc, curVal, v));
      }
    }
    for (const pair of [...current.items]) {
      const k = toJS(pair.key);
      if (typeof k === 'string' && !(k in obj && obj[k] !== undefined)) {
        current.delete(k);
      }
    }
    return current;
  }

  return doc.createNode(value);
}

/**
 * Service for YAML serialization and parsing operations
 */
export class YamlService {
  /**
   * Apply path-targeted edits to YAML text while preserving the formatting
   * and comments of everything that is not touched.
   *
   * Unlike parse -> mutate -> dump (which reformats the whole document and
   * drops all comments), this edits the parsed document in place, so diffs
   * stay minimal. Edits whose value already equals the current value are
   * skipped; if no edit changes anything, the original text is returned
   * unchanged (callers can compare by identity to suppress no-op updates).
   */
  static applyPathEdits(text: string, edits: PathEdit[]): string {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      console.warn('Cannot apply edit: YAML parse failed', doc.errors[0]?.message);
      return text;
    }

    let changed = false;
    for (const { path, value } of edits) {
      const cleaned = YamlService.cleanForYaml(value);
      const current = doc.getIn(path, true);
      if (sameJson(toJS(current), cleaned)) {
        continue;
      }
      const merged = mergeNode(doc, current, cleaned);
      if (merged !== current) {
        doc.setIn(path, merged);
      }
      changed = true;
    }
    if (!changed) {
      return text;
    }

    // The stringifier lowercases hex literals and drops leading zeros even on
    // untouched scalars; collect their original spellings and restore them.
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

    let out = doc.toString({ indentSeq: detectIndentSeq(text), lineWidth: 80 });
    for (const [rendered, source] of hexFix) {
      if (rendered !== source) {
        out = out.replace(new RegExp(`\\b${rendered}\\b`, 'g'), source);
      }
    }
    return out;
  }

  /**
   * Dump a JavaScript object to YAML string.
   * NOTE: This will not preserve comments or formatting from the original YAML.
   */
  static dump(data: unknown): string {
    const cleaned = YamlService.cleanForYaml(data);
    return jsyaml.dump(cleaned, {
      noRefs: true,
      sortKeys: false,
      lineWidth: -1,
      indent: 2,
      noArrayIndent: true,
    });
  }

  /**
   * Parse a YAML string to a JavaScript value.
   */
  static parse(text: string): unknown {
    return jsyaml.load(text);
  }

  /**
   * Safely parse YAML text, returning null on error.
   */
  static safeParse(text: string): unknown | null {
    try {
      return jsyaml.load(text);
    } catch (err) {
      console.warn('YAML parse error:', err);
      return null;
    }
  }

  /**
   * Clean object before YAML serialization.
   * Removes computed properties that shouldn't be in the YAML output.
   */
  static cleanForYaml(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => YamlService.cleanForYaml(item));
    }

    const record = obj as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    // Check if we need to convert bit_offset/bit_width to bits
    const hasBitOffset = Object.prototype.hasOwnProperty.call(record, 'bit_offset');
    const hasBitWidth = Object.prototype.hasOwnProperty.call(record, 'bit_width');
    const shouldAddBits = hasBitOffset && hasBitWidth;

    let bitsValue: string | undefined;
    if (shouldAddBits) {
      const bit_offset = Number(record['bit_offset']);
      const bit_width = Number(record['bit_width']);

      if (Number.isFinite(bit_offset) && Number.isFinite(bit_width)) {
        bitsValue = formatBitsLike(bit_offset, bit_width);
      }
    }

    // Iterate through properties in original order, inserting bits after name
    let nameProcessed = false;
    for (const key in record) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        continue;
      }

      // Skip internal bit field representation - we'll add 'bits' instead
      if (key === 'bit_offset' || key === 'bit_width' || key === 'bit_range') {
        continue;
      }

      // Add the property
      cleaned[key] = YamlService.cleanForYaml(record[key]);

      // After adding 'name', insert 'bits' if needed
      if (key === 'name' && !nameProcessed && bitsValue) {
        cleaned['bits'] = bitsValue;
        nameProcessed = true;
      }
    }

    // If we didn't encounter 'name' but still need to add bits, add it now
    if (shouldAddBits && bitsValue && !nameProcessed) {
      // Insert bits at the beginning by recreating the object
      const temp = { bits: bitsValue, ...cleaned };
      return temp;
    }

    return cleaned;
  }
}
