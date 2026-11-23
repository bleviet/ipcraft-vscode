import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from 'yaml';
import { errorMarkdown, formatMarkdown } from './hoverMarkdown';
import { pktFieldMarkdown, pktmapSourceMarkdown } from './hoverPkt';
import { resolvePacketFormatRef } from './refInfo';
import { resolve } from './resolver';
import { findSites, innermost } from './sites';
import { isMapFile } from './paths';
import { PacketFormatError, type PacketFileReader } from './types';

export type HoverFileKind = 'ip' | 'pkt' | 'pktmap';

/** Which hover applies to a file name, if any. */
export function hoverKindOf(fileName: string): HoverFileKind | undefined {
  if (fileName.endsWith('.ip.yml')) {
    return 'ip';
  }
  if (isMapFile(fileName)) {
    return 'pktmap';
  }
  return fileName.endsWith('.pkt.yml') ? 'pkt' : undefined;
}

export interface PacketHover {
  markdown: string;
  /** Zero-based line span the hover applies to. */
  startLine: number;
  endLine: number;
}

/** Interface items of an `.ip.yml` that carry a `packetFormatRef`, with the lines of their `name` and ref entries. */
function ipRefSites(
  text: string
): Array<{ ref: string; start: number; end: number; lines: number[] }> {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  const buses = isMap(doc.contents) ? doc.contents.get('busInterfaces', true) : undefined;
  const line = (n: Node | null | undefined): number | undefined =>
    n?.range ? lc.linePos(n.range[0]).line - 1 : undefined;
  const out: Array<{ ref: string; start: number; end: number; lines: number[] }> = [];
  for (const item of isSeq(buses) ? buses.items : []) {
    if (!isMap(item) || !item.range) {
      continue;
    }
    const refNode = item.get('packetFormatRef', true);
    const ref = isScalar(refNode) ? refNode.value : undefined;
    if (typeof ref !== 'string') {
      continue;
    }
    const lines = [line(item.get('name', true) as Node | null), line(refNode as Node)].filter(
      (l): l is number => l !== undefined
    );
    out.push({ ref, start: lines[0] ?? 0, end: lines[0] ?? 0, lines });
  }
  return out;
}

/**
 * Markdown hover for `line` (zero based) of a packet-format related YAML file, or undefined.
 * `read` serves other files; the hovered file's own `text` is used for `file` itself.
 */
export function packetHover(
  kind: HoverFileKind,
  file: string,
  text: string,
  line: number,
  read: PacketFileReader
): PacketHover | undefined {
  const reader: PacketFileReader = (p) => (p === file ? text : read(p));
  if (kind === 'ip') {
    const site = ipRefSites(text).find((s) => s.lines.includes(line));
    if (!site) {
      return undefined;
    }
    const info = resolvePacketFormatRef(site.ref, file, reader);
    const markdown = info.format
      ? formatMarkdown(info.format)
      : errorMarkdown(site.ref, info.error?.message ?? 'unresolved');
    return { markdown, startLine: line, endLine: line };
  }
  let doc;
  try {
    doc = resolve(file, reader);
  } catch (e) {
    if (e instanceof PacketFormatError) {
      return undefined;
    }
    throw e;
  }
  const sites = findSites(text);
  if (kind === 'pkt') {
    const site = innermost(sites.fields, line);
    const markdown = site ? pktFieldMarkdown(site, doc) : undefined;
    return site && markdown ? { markdown, startLine: site.start, endLine: site.end } : undefined;
  }
  const source = innermost(sites.sources, line);
  const markdown = source && doc.map ? pktmapSourceMarkdown(source.name, doc.map, doc) : undefined;
  return source && markdown
    ? { markdown, startLine: source.start, endLine: source.end }
    : undefined;
}
