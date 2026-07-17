/**
 * Compilation-order utilities for VHDL and SystemVerilog file sets.
 *
 * Extracts declared identifiers (packages, entities, modules) and their
 * inter-file dependencies (use / import clauses) from HDL source text,
 * then performs a DFS-based topological sort so that each file appears
 * after all files it depends on.
 *
 * On cycle detection the original order is returned unchanged.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export type HdlLanguage = 'vhdl' | 'systemverilog' | 'verilog';

// ── Dependency extraction ─────────────────────────────────────────────────────

export interface HdlDependencies {
  /** Primary-design-unit names declared in this file (lower-cased for VHDL). */
  declares: Set<string>;
  /** Referenced unit or macro names (lower-cased for VHDL). */
  uses: Set<string>;
}

type SymbolKind = 'vhdl-package' | 'vhdl-entity' | 'vhdl-context' | 'sv-package' | 'macro';

interface HdlSymbol {
  name: string;
  kind: SymbolKind;
  library?: string;
}

interface ParsedHdlDependencies extends HdlDependencies {
  declaredSymbols: HdlSymbol[];
  referencedSymbols: HdlSymbol[];
}

function makeParsedDependencies(
  declaredSymbols: HdlSymbol[],
  referencedSymbols: HdlSymbol[],
  extraDeclarations: string[] = []
): ParsedHdlDependencies {
  return {
    declares: new Set([...declaredSymbols.map((symbol) => symbol.name), ...extraDeclarations]),
    uses: new Set(referencedSymbols.map((symbol) => symbol.name)),
    declaredSymbols,
    referencedSymbols,
  };
}

function normalizeVhdlLibrary(logicalName: string | undefined): string {
  const normalized = logicalName?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : 'work';
}

function parseVhdlDependencies(
  content: string,
  logicalName: string | undefined = undefined
): ParsedHdlDependencies {
  const declaredSymbols: HdlSymbol[] = [];
  const referencedSymbols: HdlSymbol[] = [];
  const source = content
    .replace(/"(?:[^"]|"")*"/g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .toLowerCase();
  const currentLibrary = normalizeVhdlLibrary(logicalName);
  const resolveLibrary = (library: string): string =>
    library.toLowerCase() === 'work' ? currentLibrary : library.toLowerCase();
  const declare = (name: string, kind: SymbolKind): void => {
    declaredSymbols.push({ name: name.toLowerCase(), kind, library: currentLibrary });
  };
  const reference = (library: string, name: string, kind: SymbolKind): void => {
    referencedSymbols.push({
      name: name.toLowerCase(),
      kind,
      library: resolveLibrary(library),
    });
  };

  for (const match of source.matchAll(/\bpackage\s+(?!body\b)(\w+)\s+is\b/g)) {
    declare(match[1], 'vhdl-package');
  }
  for (const match of source.matchAll(/\bentity\s+(\w+)\s+is\b/g)) {
    declare(match[1], 'vhdl-entity');
  }
  for (const match of source.matchAll(/\bcontext\s+(\w+)\s+is\b/g)) {
    declare(match[1], 'vhdl-context');
  }

  for (const match of source.matchAll(/\bpackage\s+body\s+(\w+)\s+is\b/g)) {
    reference('work', match[1], 'vhdl-package');
  }
  for (const match of source.matchAll(/\barchitecture\s+\w+\s+of\s+(\w+)\s+is\b/g)) {
    reference('work', match[1], 'vhdl-entity');
  }
  for (const match of source.matchAll(/\bconfiguration\s+\w+\s+of\s+(\w+)\s+is\b/g)) {
    reference('work', match[1], 'vhdl-entity');
  }
  for (const match of source.matchAll(/\bpackage\s+\w+\s+is\s+new\s+(\w+)\s*\.\s*(\w+)/g)) {
    reference(match[1], match[2], 'vhdl-package');
  }

  for (const clause of source.matchAll(/\buse\s+([^;]+);/g)) {
    for (const match of clause[1].matchAll(/(?:^|,)\s*(\w+)\s*\.\s*(\w+)/g)) {
      reference(match[1], match[2], 'vhdl-package');
    }
  }
  for (const match of source.matchAll(/\bentity\s+(\w+)\s*\.\s*(\w+)/g)) {
    reference(match[1], match[2], 'vhdl-entity');
  }
  for (const match of source.matchAll(/\bcontext\s+(\w+)\s*\.\s*(\w+)\s*;/g)) {
    reference(match[1], match[2], 'vhdl-context');
  }

  return makeParsedDependencies(declaredSymbols, referencedSymbols);
}

/**
 * Extract declared and used names from VHDL source text.
 * Matching is case-insensitive (VHDL is case-insensitive).
 */
export function extractVhdlDependencies(content: string): HdlDependencies {
  const { declares, uses } = parseVhdlDependencies(content);
  return { declares, uses };
}

function parseSvDependencies(content: string): ParsedHdlDependencies {
  const declaredSymbols: HdlSymbol[] = [];
  const referencedSymbols: HdlSymbol[] = [];
  const moduleNames: string[] = [];
  const stripped = content
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ');

  for (const match of stripped.matchAll(/\bpackage\s+(\w+)\s*(?:#\s*\([^;]*\)\s*)?;/g)) {
    declaredSymbols.push({ name: match[1], kind: 'sv-package' });
  }
  for (const match of stripped.matchAll(/\bmodule\s+(\w+)\b/g)) {
    moduleNames.push(match[1]);
  }
  for (const match of stripped.matchAll(/\b(?:import\s+)?(\w+)\s*::\s*(?:\w+|\*)/g)) {
    referencedSymbols.push({ name: match[1], kind: 'sv-package' });
  }

  for (const rawLine of stripped.split(/\r?\n/)) {
    const define = /^\s*`define\s+(\w+)/.exec(rawLine);
    let macroText = rawLine;
    if (define) {
      declaredSymbols.push({ name: define[1], kind: 'macro' });
      macroText = rawLine.slice(define.index + define[0].length);
    }

    const conditional = /^\s*`(?:ifdef|ifndef|elsif|undef)\s+(\w+)/.exec(rawLine);
    if (conditional) {
      referencedSymbols.push({ name: conditional[1], kind: 'macro' });
    }

    for (const match of macroText.matchAll(/`(\w+)/g)) {
      if (!SV_DIRECTIVE_KEYWORDS.has(match[1])) {
        referencedSymbols.push({ name: match[1], kind: 'macro' });
      }
    }
  }

  return makeParsedDependencies(declaredSymbols, referencedSymbols, moduleNames);
}

/**
 * Extract declared and used names from SystemVerilog (or plain Verilog —
 * module/`define`/macro-reference constructs are a subset shared by both, so
 * the same extraction serves 'systemverilog' and 'verilog' HdlLanguage
 * values). Matching is case-sensitive (SV/Verilog are case-sensitive).
 */
export function extractSvDependencies(content: string): HdlDependencies {
  const { declares, uses } = parseSvDependencies(content);
  return { declares, uses };
}

const SV_DIRECTIVE_KEYWORDS = new Set([
  'define',
  'undef',
  'undefineall',
  'include',
  'ifdef',
  'ifndef',
  'else',
  'elsif',
  'endif',
  'timescale',
  'default_nettype',
  'resetall',
  'celldefine',
  'endcelldefine',
  'unconnected_drive',
  'nounconnected_drive',
  'pragma',
  'line',
  'begin_keywords',
  'end_keywords',
  '__FILE__',
  '__LINE__',
]);

// ── Topological sort ──────────────────────────────────────────────────────────

interface CompilationUnit {
  path: string;
  declaredSymbols: HdlSymbol[];
  referencedSymbols: HdlSymbol[];
}

export interface CompilationOrderItem {
  path: string;
  language: string;
  content?: string;
  /** VHDL logical library for this file. Unset entries compile into `work`. */
  logicalName?: string;
}

/**
 * Sort file paths into compilation order.
 *
 * @param items    Files to sort.  Each item carries its absolute (or
 *                 otherwise stable) path, language, and optionally
 *                 pre-loaded content.
 * @param readContent  Async callback that returns file content given a path,
 *                     or null/undefined when the file is unreadable.
 *
 * Non-HDL files (SDC, TCL, …) are treated as having no dependencies and
 * their relative position is preserved.  If a circular dependency is
 * detected the original order is returned unchanged.
 */
export async function sortByCompilationOrder(
  items: CompilationOrderItem[],
  readContent: (path: string) => Promise<string | null | undefined>
): Promise<string[]> {
  if (items.length <= 1) {
    return items.map((i) => i.path);
  }

  const units: CompilationUnit[] = await Promise.all(
    items.map(async (item): Promise<CompilationUnit> => {
      const lang = item.language as HdlLanguage;
      if (lang !== 'vhdl' && lang !== 'systemverilog' && lang !== 'verilog') {
        return { path: item.path, declaredSymbols: [], referencedSymbols: [] };
      }

      let content = item.content;
      if (content === undefined) {
        try {
          content = (await readContent(item.path)) ?? '';
        } catch {
          content = '';
        }
      }

      const { declaredSymbols, referencedSymbols } =
        lang === 'vhdl'
          ? parseVhdlDependencies(content, item.logicalName)
          : parseSvDependencies(content);

      return { path: item.path, declaredSymbols, referencedSymbols };
    })
  );

  return topoSort(units);
}

function topoSort(units: CompilationUnit[]): string[] {
  // Keys include symbol kind and VHDL logical library so same-named units in
  // different libraries cannot steal one another's dependency edges.
  const declMap = new Map<string, CompilationUnit>();
  for (const unit of units) {
    for (const symbol of unit.declaredSymbols) {
      declMap.set(symbolKey(symbol), unit);
    }
  }

  const visited = new Set<CompilationUnit>();
  const visiting = new Set<CompilationUnit>(); // for cycle detection
  const result: string[] = [];
  let hasCycle = false;

  function visit(unit: CompilationUnit): void {
    if (visited.has(unit)) {
      return;
    }
    if (visiting.has(unit)) {
      hasCycle = true;
      return;
    }
    visiting.add(unit);
    for (const reference of unit.referencedSymbols) {
      const dep = declMap.get(symbolKey(reference));
      if (dep && dep !== unit) {
        visit(dep);
        if (hasCycle) {
          return;
        }
      }
    }
    visiting.delete(unit);
    visited.add(unit);
    result.push(unit.path);
  }

  for (const unit of units) {
    if (!visited.has(unit)) {
      visit(unit);
    }
    if (hasCycle) {
      return units.map((u) => u.path);
    }
  }

  return result;
}

function symbolKey(symbol: HdlSymbol): string {
  return `${symbol.kind}\0${symbol.library ?? ''}\0${symbol.name}`;
}

// ── FileSet resolution (fallback path) ────────────────────────────────────────

/**
 * Infer an HDL language from a file's extension. Used only to rescue fileSets
 * entries whose declared `type` is missing or unrecognized (e.g. imported from
 * a component.xml with an unmapped spirit:fileType); never overrides an
 * explicit recognized `type`.
 */
export function hdlLanguageFromPath(filePath: string): HdlLanguage | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'vhd' || ext === 'vhdl') {
    return 'vhdl';
  }
  if (ext === 'sv' || ext === 'svh') {
    return 'systemverilog';
  }
  if (ext === 'v' || ext === 'vh') {
    return 'verilog';
  }
  return undefined;
}

/** One `fileSets[].files[]` entry, resolved to compilation order. */
export interface FileSetRtlFile {
  /** Path as declared in the .ip.yml fileSet, relative to ipCoreDir. */
  path: string;
  /** Declared `type` field from the fileSet entry (e.g. 'vhdl', 'systemverilog', 'verilog'). */
  type: string | undefined;
  /** VHDL logical library declared for this file. */
  logicalName: string | undefined;
}

/**
 * Resolve a named fileSet's files into real compilation order by reading actual
 * file content and running the VUnit-style dependency-graph topological sort —
 * the fallback path used when a vendor toolchain has no scaffolder-precomputed
 * `rtlFiles` list to work from (e.g. import/no-generate mode).
 *
 * Language resolution per file: explicit `vhdl`/`systemverilog`/`verilog` type wins;
 * otherwise the extension is used to rescue a missing/unrecognized type. Files that
 * still can't be resolved to a parseable HDL language are still included — just
 * passed through dependency-free with their relative position preserved, exactly
 * like sortByCompilationOrder already does for non-HDL files such as `.sdc`/`.tcl`.
 *
 * Unreadable files degrade to null content (treated as dependency-free) rather than
 * throwing, so one missing file doesn't fail the whole sort.
 */
export async function resolveFileSetRtlFiles(
  ipCoreData: Record<string, unknown>,
  ipCoreDir: string,
  fileSetName: string
): Promise<FileSetRtlFile[]> {
  type FileEntry = { path?: string; type?: string; logicalName?: string };
  type FileSetEntry = { name?: string; files?: FileEntry[] };

  const fileSets = ipCoreData.fileSets as FileSetEntry[] | undefined;
  if (!Array.isArray(fileSets)) {
    return [];
  }
  const match = fileSets.find((entry) => entry.name === fileSetName);
  const rawFiles = (match?.files ?? []).filter(
    (f): f is FileEntry & { path: string } => typeof f.path === 'string' && f.path.length > 0
  );
  if (rawFiles.length === 0) {
    return [];
  }

  const items = rawFiles.map((f) => {
    const explicitLang =
      f.type === 'vhdl' || f.type === 'systemverilog' || f.type === 'verilog' ? f.type : undefined;
    const language = explicitLang ?? hdlLanguageFromPath(f.path) ?? f.type ?? 'unknown';
    return {
      relPath: f.path,
      type: f.type,
      logicalName: f.logicalName,
      absPath: path.resolve(ipCoreDir, f.path),
      language,
    };
  });

  const infoByAbsPath = new Map(
    items.map((i) => [i.absPath, { path: i.relPath, type: i.type, logicalName: i.logicalName }])
  );

  const sortedAbsPaths = await sortByCompilationOrder(
    items.map(({ absPath, language, logicalName }) => ({
      path: absPath,
      language,
      logicalName,
    })),
    async (p) => {
      try {
        return await fs.readFile(p, 'utf8');
      } catch {
        return null;
      }
    }
  );

  return sortedAbsPaths.map((absPath) => infoByAbsPath.get(absPath)!);
}
