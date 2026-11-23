import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Node,
  type Pair,
  type YAMLMap,
} from 'yaml';

/** Zero-based inclusive line span of a YAML node. */
export interface LineSpan {
  start: number;
  end: number;
}

export interface FieldSite extends LineSpan {
  /** `field`: declared in `beats`; `refine`: a `refine:` entry or a field added by one. */
  kind: 'field' | 'refine';
  format: string;
  /** Beat section (declared fields only). */
  section?: string;
  /** Signal key as written (declared fields only). */
  signal?: string;
  /** Dotted field path without section names. */
  path: string;
  /** Line of the `name:` entry (or the key of a refine entry). */
  nameLine: number;
}

export interface NamedSite extends LineSpan {
  name: string;
}

export interface PacketFileSites {
  formats: NamedSite[];
  fields: FieldSite[];
  /** `*.pktmap.yml` entries of `sources:` keyed by the selector value as written. */
  sources: NamedSite[];
}

class Locator {
  readonly lc = new LineCounter();

  span(node: Node | Pair | null | undefined): LineSpan | undefined {
    const range = isPair(node)
      ? [
          (node.key as Node | undefined)?.range?.[0],
          (node.value as Node | null | undefined)?.range?.[1] ??
            (node.key as Node | undefined)?.range?.[1],
        ]
      : [node?.range?.[0], node?.range?.[1]];
    const [from, to] = range;
    if (from === undefined || to === undefined) {
      return undefined;
    }
    return {
      start: this.lc.linePos(from).line - 1,
      end: this.lc.linePos(Math.max(from, to - 1)).line - 1,
    };
  }
}

function text(node: unknown): string | undefined {
  return isScalar(node) && node.value !== null && node.value !== undefined
    ? String(node.value)
    : undefined;
}

function getNode(map: YAMLMap, key: string): Node | null | undefined {
  return map.get(key, true);
}

/** Positions of the formats, fields, refine entries and map sources of a packet file, for hovers and diagnostics. */
export function findSites(source: string): PacketFileSites {
  const loc = new Locator();
  const doc = parseDocument(source, { version: '1.2', schema: 'core', lineCounter: loc.lc });
  const out: PacketFileSites = { formats: [], fields: [], sources: [] };
  if (!isMap(doc.contents)) {
    return out;
  }
  const walkFields = (
    seq: Node | null | undefined,
    base: Omit<FieldSite, 'path' | 'start' | 'end' | 'nameLine'>,
    parent: string
  ): void => {
    if (!isSeq(seq)) {
      return;
    }
    for (const item of seq.items) {
      const span = loc.span(item as Node);
      if (!isMap(item) || !span) {
        continue;
      }
      const name = text(getNode(item, 'name'));
      if (name === undefined) {
        continue;
      }
      const path = parent ? `${parent}.${name}` : name;
      const nameLine =
        loc.span(item.items.find((p) => text(p.key) === 'name'))?.start ?? span.start;
      out.fields.push({ ...base, ...span, path, nameLine });
      walkFields(getNode(item, 'fields'), base, path);
    }
  };
  const formats = getNode(doc.contents, 'packetFormats');
  for (const f of isSeq(formats) ? formats.items : []) {
    const span = loc.span(f as Node);
    const name = isMap(f) ? text(getNode(f, 'name')) : undefined;
    if (!isMap(f) || !span || name === undefined) {
      continue;
    }
    out.formats.push({ name, ...span });
    const beats = getNode(f, 'beats');
    for (const beat of isSeq(beats) ? beats.items : []) {
      const section = isMap(beat) ? text(getNode(beat, 'name')) : undefined;
      const signals = isMap(beat) ? getNode(beat, 'signals') : undefined;
      for (const pair of isMap(signals) ? signals.items : []) {
        walkFields(
          pair.value as Node | null,
          { kind: 'field', format: name, section, signal: text(pair.key) },
          ''
        );
      }
    }
    const refine = getNode(f, 'refine');
    for (const pair of isMap(refine) ? refine.items : []) {
      const path = text(pair.key);
      const span2 = loc.span(pair);
      if (path === undefined || !span2) {
        continue;
      }
      out.fields.push({ kind: 'refine', format: name, path, ...span2, nameLine: span2.start });
      if (isMap(pair.value)) {
        walkFields(getNode(pair.value, 'fields'), { kind: 'refine', format: name }, path);
      }
    }
  }
  const sources = getNode(doc.contents, 'sources');
  for (const pair of isMap(sources) ? sources.items : []) {
    const span = loc.span(pair);
    const name = text(pair.key);
    if (span && name !== undefined) {
      out.sources.push({ name, ...span });
    }
  }
  return out;
}

/** The innermost (smallest) span that contains `line`. */
export function innermost<T extends LineSpan>(items: readonly T[], line: number): T | undefined {
  return items
    .filter((s) => s.start <= line && line <= s.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}

const norm = (signal: string): string =>
  ['tdata', 'data'].includes(signal.toLowerCase()) ? 'data' : signal.toLowerCase();

/**
 * Best line span for a {@link PacketFormatError} path (`packetFormats.<fmt>.beats.<section>.<signal>.<field>`,
 * `packetFormats.<fmt>.refine.<path>`, `sources.<key>`, ...), or undefined when nothing matches.
 */
export function locatePath(
  sites: PacketFileSites,
  errorPath: string | undefined
): LineSpan | undefined {
  if (!errorPath) {
    return undefined;
  }
  const src = /^sources\.(.+)$/.exec(errorPath);
  if (src) {
    return sites.sources.find((s) => s.name === src[1]);
  }
  const fmtName = [...sites.formats]
    .sort((a, b) => b.name.length - a.name.length)
    .find(
      (f) =>
        errorPath === `packetFormats.${f.name}` || errorPath.startsWith(`packetFormats.${f.name}.`)
    );
  if (!fmtName) {
    return undefined;
  }
  const rest = errorPath.slice(`packetFormats.${fmtName.name}`.length + 1);
  const own = sites.fields.filter((f) => f.format === fmtName.name);
  const prefix = (candidate: string): boolean =>
    rest === candidate || rest.startsWith(`${candidate}.`);
  let best: FieldSite | undefined;
  let bestLen = -1;
  for (const f of own) {
    const key =
      f.kind === 'refine'
        ? `refine.${f.path}`
        : `beats.${f.section ?? ''}.${f.signal ?? ''}.${f.path}`;
    const alt =
      f.kind === 'field' && prefix(`beats.${f.section}.${norm(f.signal ?? '')}.${f.path}`);
    const match = prefix(key);
    if ((match || alt) && key.length > bestLen) {
      best = f;
      bestLen = key.length;
    }
  }
  return best ?? fmtName;
}
