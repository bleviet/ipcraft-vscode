/**
 * Pure readers that extract VHDL file lists (and the library each source states, if any) from
 * vendor and IPCraft manifests. One reader per format; none throws on malformed input.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { DOMParser } from '@xmldom/xmldom';
import { parseTclTokens } from '../../parser/hwTclTokens';
import { resolveTclPathWord } from '../../parser/tclPathWord';
import { flattenTclContent } from '../../parser/HwTclParser';
import { SPIRIT_NS, normalizeXmlProlog } from '../../parser/ComponentXmlParser';

export interface SourceEntry {
  /** Absolute path. */
  file: string;
  /** Library as stated by the source, raw. */
  library?: string;
}

export interface SourceReadResult {
  entries: SourceEntry[];
  unresolved: number;
}

/** The vendor default library, stated by sources that name none. */
const VENDOR_DEFAULT = 'defaultlib';

const isVhdlPath = (p: string): boolean => /\.vhdl?$/i.test(p);

function empty(): SourceReadResult {
  return { entries: [], unresolved: 0 };
}

function failed(): SourceReadResult {
  return { entries: [], unresolved: 1 };
}

/** Parses XML text; null when it is malformed. */
function parseXml(text: string): Document | null {
  const errors: string[] = [];
  try {
    const doc = new DOMParser({
      onError: (level, msg) => {
        if (level !== 'warning') {
          errors.push(msg);
        }
      },
    }).parseFromString(normalizeXmlProlog(text), 'text/xml');
    return errors.length > 0 || !doc.documentElement ? null : (doc as unknown as Document);
  } catch {
    return null;
  }
}

/** A path word that may still carry Tcl syntax; true when it plausibly names a VHDL file. */
const mentionsVhdl = (raw: string): boolean => /\.vhdl?\b/i.test(raw);

export function readXpr(text: string, filePath: string): SourceReadResult {
  const dir = path.dirname(filePath);
  const srcsDir = path.join(dir, `${path.basename(filePath, path.extname(filePath))}.srcs`);
  const result = empty();
  const doc = parseXml(text);
  if (!doc) {
    return failed();
  }
  const files = Array.from(doc.getElementsByTagName('File'));
  for (const file of files) {
    const rawPath = file.getAttribute('Path');
    if (!rawPath || !isVhdlPath(rawPath)) {
      continue;
    }
    const expanded = rawPath
      .replace(/\$\{?PPRDIR\}?/g, dir.split(path.sep).join('/'))
      .replace(/\$\{?PSRCDIR\}?/g, srcsDir.split(path.sep).join('/'));
    if (expanded.includes('$')) {
      result.unresolved++;
      continue;
    }
    let library = VENDOR_DEFAULT;
    for (const attr of Array.from(file.getElementsByTagName('Attr'))) {
      if (attr.getAttribute('Name') === 'Library') {
        const val = attr.getAttribute('Val');
        library = val === null || val === '' ? VENDOR_DEFAULT : val;
      }
    }
    result.entries.push({ file: path.resolve(dir, expanded), library });
  }
  return result;
}

/** Reads `set_global_assignment -name VHDL_FILE <path> [-library <lib>]` lines of a `.qsf` or `.qip`. */
export function readQuartusAssignments(text: string, filePath: string): SourceReadResult {
  const dir = path.dirname(filePath);
  const substitutions = new Map([['$::quartus(qip_path)', dir]]);
  const result = empty();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.toLowerCase().startsWith('set_global_assignment')) {
      continue;
    }
    const tokens = parseTclTokens(line);
    let rawPath: string | undefined;
    let library = VENDOR_DEFAULT;
    for (let i = 1; i < tokens.length; i++) {
      const flag = tokens[i].toLowerCase();
      if (flag === '-name' && tokens[i + 1]?.toUpperCase() === 'VHDL_FILE') {
        rawPath = tokens[i + 2];
        i += 2;
      } else if (flag === '-library' && tokens[i + 1] !== undefined) {
        library = tokens[++i];
      }
    }
    if (rawPath === undefined || !mentionsVhdl(rawPath)) {
      continue;
    }
    const resolved = resolveTclPathWord(rawPath, substitutions);
    if (resolved === null) {
      result.unresolved++;
    } else if (isVhdlPath(resolved)) {
      result.entries.push({ file: path.resolve(dir, resolved), library });
    }
  }
  return result;
}

export function readComponentXml(text: string, filePath: string): SourceReadResult {
  const dir = path.dirname(filePath);
  const result = empty();
  const doc = parseXml(text);
  if (!doc) {
    return failed();
  }
  const childText = (parent: Element, localName: string): string | undefined => {
    for (const node of Array.from(parent.childNodes) as Element[]) {
      if (node.localName === localName && node.namespaceURI === SPIRIT_NS) {
        return (node.textContent ?? '').trim();
      }
    }
    return undefined;
  };
  for (const file of Array.from(doc.getElementsByTagNameNS(SPIRIT_NS, 'file'))) {
    const name = childText(file, 'name');
    if (!name || /^https?:\/\//i.test(name) || !isVhdlPath(name)) {
      continue;
    }
    const library = childText(file, 'logicalName');
    result.entries.push({
      file: path.resolve(dir, name),
      library: library === '' ? undefined : library,
    });
  }
  return result;
}

export async function readHwTcl(filePath: string): Promise<SourceReadResult> {
  const result = empty();
  let flattened: string;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    flattened = await flattenTclContent(content, filePath, new Set(), false);
  } catch {
    return failed();
  }
  const dir = path.dirname(filePath);
  for (const rawLine of flattened.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#')) {
      continue;
    }
    const tokens = parseTclTokens(line);
    if (tokens[0] !== 'add_fileset_file') {
      continue;
    }
    const pathIdx = tokens.indexOf('PATH');
    if (pathIdx === -1 || pathIdx + 1 >= tokens.length || !mentionsVhdl(tokens[pathIdx + 1])) {
      continue;
    }
    const resolved = resolveTclPathWord(tokens[pathIdx + 1]);
    if (resolved === null) {
      result.unresolved++;
    } else if (isVhdlPath(resolved)) {
      result.entries.push({ file: path.resolve(dir, resolved) });
    }
  }
  return result;
}

export function readIpYml(text: string, filePath: string): SourceReadResult {
  const dir = path.dirname(filePath);
  const result = empty();
  let data: unknown;
  try {
    data = yaml.load(text);
  } catch {
    return failed();
  }
  const fileSets = (data as { fileSets?: unknown } | null)?.fileSets;
  if (!Array.isArray(fileSets)) {
    return result;
  }
  for (const fileSet of fileSets as { files?: unknown }[]) {
    if (!Array.isArray(fileSet?.files)) {
      continue;
    }
    for (const file of fileSet.files as { path?: unknown; logicalName?: unknown }[]) {
      if (typeof file?.path !== 'string' || !isVhdlPath(file.path)) {
        continue;
      }
      result.entries.push({
        file: path.resolve(dir, file.path),
        library: typeof file.logicalName === 'string' ? file.logicalName : undefined,
      });
    }
  }
  return result;
}
