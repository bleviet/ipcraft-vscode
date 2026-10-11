import { extractVhdlInterface } from '../../parser/VhdlParser';
import { extractVerilogInterface } from '../../parser/VerilogParser';
import type { InterfaceDrift } from '../../shared/staging';

export type HdlLanguage = 'vhdl' | 'verilog';

export interface TextRegion {
  start: number;
  end: number;
}

export function hdlLanguageOf(relativePath: string): HdlLanguage | undefined {
  const lower = relativePath.toLowerCase();
  if (/\.(vhd|vhdl)$/.test(lower)) {
    return 'vhdl';
  }
  if (/\.(v|sv|svh|vh)$/.test(lower)) {
    return 'verilog';
  }
  return undefined;
}

interface NamedItem {
  name: string;
  signature: string;
}

const norm = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function parseInterface(
  text: string,
  lang: HdlLanguage
): { hasUnit: boolean; ports: NamedItem[]; params: NamedItem[] } {
  const parsed = lang === 'vhdl' ? extractVhdlInterface(text) : extractVerilogInterface(text);
  const unitName = 'entityName' in parsed ? parsed.entityName : parsed.moduleName;
  return {
    hasUnit: unitName !== null,
    ports: parsed.ports.map((p) => ({
      name: p.name,
      signature: `${norm(p.direction)}|${norm(p.type)}|${norm(p.width)}`,
    })),
    params: parsed.parameters.map((p) => ({
      name: p.name,
      signature: `${norm(p.type)}|${norm(p.value)}`,
    })),
  };
}

function diffNamed(
  current: NamedItem[],
  generated: NamedItem[],
  into: InterfaceDrift,
  prefix: string
): void {
  const currentByName = new Map(current.map((i) => [i.name.toLowerCase(), i]));
  const generatedByName = new Map(generated.map((i) => [i.name.toLowerCase(), i]));
  for (const [key, item] of generatedByName) {
    const existing = currentByName.get(key);
    if (!existing) {
      into.added.push(prefix + item.name);
    } else if (existing.signature !== item.signature) {
      into.changed.push(prefix + item.name);
    }
  }
  for (const [key, item] of currentByName) {
    if (!generatedByName.has(key)) {
      into.removed.push(prefix + item.name);
    }
  }
}

/**
 * Differences between the entity/module interface of the on-disk file and of the
 * newly generated content (ports and generics/parameters, matched by lowercase name).
 * Generics/parameters are reported as `name` too; ports likewise.
 */
export function diffHdlInterface(
  current: string,
  generated: string,
  lang: HdlLanguage
): InterfaceDrift | undefined {
  const cur = parseInterface(current, lang);
  const gen = parseInterface(generated, lang);
  if (!cur.hasUnit && !gen.hasUnit) {
    return undefined;
  }
  const drift: InterfaceDrift = { added: [], removed: [], changed: [] };
  diffNamed(cur.ports, gen.ports, drift, '');
  diffNamed(cur.params, gen.params, drift, '');
  return drift.added.length || drift.removed.length || drift.changed.length ? drift : undefined;
}

/** Blanks comments (same length, newlines kept) so scanning never sees comment text. */
function maskComments(text: string, lang: HdlLanguage): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  if (lang === 'vhdl') {
    return text.replace(/--[^\n]*/g, blank);
  }
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, blank);
}

function findVhdlRegion(text: string): TextRegion | undefined {
  const masked = maskComments(text, 'vhdl');
  const starts = [...masked.matchAll(/\bentity\s+(\w+)\s+is\b/gi)];
  if (starts.length !== 1) {
    return undefined;
  }
  const [head, name] = starts[0];
  const start = starts[0].index;
  const from = start + head.length;
  const endRe = new RegExp(`\\bend\\s*(?:entity\\b)?\\s*(?:${name}\\b)?\\s*;`, 'gi');
  endRe.lastIndex = from;
  const end = endRe.exec(masked);
  return end ? { start, end: end.index + end[0].length } : undefined;
}

function findVerilogRegion(text: string): TextRegion | undefined {
  const masked = maskComments(text, 'verilog');
  const starts = [...masked.matchAll(/\bmodule\s+\w+/gi)];
  if (starts.length !== 1) {
    return undefined;
  }
  const start = starts[0].index;
  let depth = 0;
  let segmentStart = start;
  for (let i = start + starts[0][0].length; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ';' && depth === 0) {
      // `module m import pkg::*; #(...) (...);` -- an import clause ends in `;` too.
      if (/\bimport\b[^()]*$/.test(masked.slice(segmentStart, i))) {
        segmentStart = i + 1;
        continue;
      }
      return { start, end: i + 1 };
    }
  }
  return undefined;
}

/** Character span of the entity (VHDL) or module header (Verilog/SV); undefined unless found exactly once. */
export function findInterfaceRegion(text: string, lang: HdlLanguage): TextRegion | undefined {
  return lang === 'vhdl' ? findVhdlRegion(text) : findVerilogRegion(text);
}

/**
 * `current` with only its entity/module header replaced by the one from `generated`;
 * everything else (library clauses, comments, architecture/body) stays from `current`.
 */
export function syncInterfaceRegion(
  current: string,
  generated: string,
  lang: HdlLanguage
): string | undefined {
  const cur = findInterfaceRegion(current, lang);
  const gen = findInterfaceRegion(generated, lang);
  if (!cur || !gen) {
    return undefined;
  }
  let region = generated.slice(gen.start, gen.end);
  if (current.includes('\r\n') && !region.includes('\r\n')) {
    region = region.replace(/\n/g, '\r\n');
  }
  return current.slice(0, cur.start) + region + current.slice(cur.end);
}
