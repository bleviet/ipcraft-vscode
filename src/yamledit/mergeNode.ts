import { isMap, isSeq, isScalar, type Document } from 'yaml';

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
export function mergeNode(doc: Document, current: unknown, value: unknown): unknown {
  if (sameJson(toJS(current), value)) {
    return current;
  }

  if (isScalar(current)) {
    current.value = value;
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
