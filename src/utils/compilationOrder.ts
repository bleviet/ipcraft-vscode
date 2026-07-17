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
  /**
   * Unit names this file references via a use clause or direct entity
   * instantiation (lower-cased for VHDL), regardless of library alias.
   * Matching against `declares` happens by name only in topoSort's declMap,
   * so a reference to a library with no matching declared unit in the batch
   * (e.g. `ieee`) simply produces no edge — see resolveFileSetRtlFiles's
   * doc comment for the fallback-path context this feeds.
   */
  uses: Set<string>;
}

/**
 * Extract declared and used names from VHDL source text.
 * Matching is case-insensitive (VHDL is case-insensitive).
 */
export function extractVhdlDependencies(content: string): HdlDependencies {
  const declares = new Set<string>();
  const uses = new Set<string>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/--.*$/, '').trim().toLowerCase();
    if (!line) {
      continue;
    }

    // package pkg_name is
    let m = /^package\s+(\w+)\s+is\b/.exec(line);
    if (m) {
      declares.add(m[1]);
      continue;
    }

    // entity entity_name is
    m = /^entity\s+(\w+)\s+is\b/.exec(line);
    if (m) {
      declares.add(m[1]);
      continue;
    }

    // use <library>.name[.suffix][;] — the library alias may be `work` or a
    // named library (e.g. a vendor package compiled as `library neorv32;`).
    // Matching is by declared-unit name only (see topoSort's declMap), so an
    // unrelated library (e.g. `ieee`) simply has no match and is ignored.
    m = /^use\s+\w+\.(\w+)/.exec(line);
    if (m) {
      uses.add(m[1]);
      continue;
    }

    // direct entity instantiation: label: entity <library>.<entity_name> [(arch)]
    // Not line-anchored — it follows an instantiation label, e.g.
    // "u_core: entity work.foo port map (...)". Distinguished from the "entity
    // NAME is" declaration above by the required library.name dot-form.
    for (const im of line.matchAll(/\bentity\s+\w+\.(\w+)/g)) {
      uses.add(im[1]);
    }
  }

  return { declares, uses };
}

/**
 * Extract declared and used names from SystemVerilog (or plain Verilog —
 * module/`define`/macro-reference constructs are a subset shared by both, so
 * the same extraction serves 'systemverilog' and 'verilog' HdlLanguage
 * values). Matching is case-sensitive (SV/Verilog are case-sensitive).
 */
export function extractSvDependencies(content: string): HdlDependencies {
  const declares = new Set<string>();
  const uses = new Set<string>();

  // Strip block comments before line-by-line processing
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, ' ');

  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) {
      continue;
    }

    // package pkg_name;  (start of a package declaration)
    let m = /^package\s+(\w+)\s*;/.exec(line);
    if (m) {
      declares.add(m[1]);
      continue;
    }

    // module module_name (optional_import_or_params
    m = /^module\s+(\w+)\b/.exec(line);
    if (m) {
      declares.add(m[1]);
      continue;
    }

    // import pkg_name::*; or import pkg_name::symbol;
    m = /^import\s+(\w+)::/.exec(line);
    if (m) {
      uses.add(m[1]);
      continue;
    }

    // `define MACRO_NAME ...  (also covers function-like `define FOO(a,b) ...)
    m = /^`define\s+(\w+)/.exec(line);
    if (m) {
      declares.add(m[1]);
      continue;
    }

    // Bare `MACRO_NAME reference elsewhere in the file (e.g. an expression
    // using a shared opcode/parameter macro from another file, common in
    // plain-Verilog designs that predate SV packages). Skips known
    // compiler-directive keywords so `` `include ``/`` `ifdef `` etc. aren't
    // mistaken for a use of a same-named declared unit — an unrecognized
    // directive is harmless too, since declMap lookup silently ignores any
    // name nothing in the batch declares.
    for (const dm of line.matchAll(/`(\w+)/g)) {
      if (!SV_DIRECTIVE_KEYWORDS.has(dm[1])) {
        uses.add(dm[1]);
      }
    }
  }

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
  declares: Set<string>;
  uses: Set<string>;
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
  items: Array<{ path: string; language: string; content?: string }>,
  readContent: (path: string) => Promise<string | null | undefined>
): Promise<string[]> {
  if (items.length <= 1) {
    return items.map((i) => i.path);
  }

  const units: CompilationUnit[] = await Promise.all(
    items.map(async (item): Promise<CompilationUnit> => {
      const lang = item.language as HdlLanguage;
      if (lang !== 'vhdl' && lang !== 'systemverilog' && lang !== 'verilog') {
        return { path: item.path, declares: new Set(), uses: new Set() };
      }

      let content = item.content;
      if (content === undefined) {
        try {
          content = (await readContent(item.path)) ?? '';
        } catch {
          content = '';
        }
      }

      const { declares, uses } =
        lang === 'vhdl' ? extractVhdlDependencies(content) : extractSvDependencies(content);

      return { path: item.path, declares, uses };
    })
  );

  return topoSort(units);
}

function topoSort(units: CompilationUnit[]): string[] {
  // Map each declared name to the unit that declares it
  const declMap = new Map<string, CompilationUnit>();
  for (const unit of units) {
    for (const name of unit.declares) {
      declMap.set(name, unit);
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
    for (const usedName of unit.uses) {
      const dep = declMap.get(usedName);
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
  type FileEntry = { path?: string; type?: string };
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
      absPath: path.resolve(ipCoreDir, f.path),
      language,
    };
  });

  const infoByAbsPath = new Map(items.map((i) => [i.absPath, { path: i.relPath, type: i.type }]));

  const sortedAbsPaths = await sortByCompilationOrder(
    items.map(({ absPath, language }) => ({ path: absPath, language })),
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
