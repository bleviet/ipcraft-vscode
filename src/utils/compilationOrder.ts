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

export type HdlLanguage = 'vhdl' | 'systemverilog';

// ── Name-based compile-order rank ─────────────────────────────────────────────

/**
 * Fast synchronous rank based on file-name suffix convention.
 * Lower rank = must be compiled first.
 *   0  _pkg.*      — shared-types package
 *   1  _regs.*     — generated register file (uses package)
 *   2  _core.*     — user logic stub (uses package + regs)
 *   3  _<bus>.*    — bus wrapper (axil/avmm/axi4/…) instantiates core
 *   4  everything else (top-level entity or unknown)
 *
 * Used as a quick sort when file content is unavailable for full dependency
 * analysis.  Files at the same rank keep their original relative order.
 */
export function hdlCompileRank(filePath: string): number {
  const base = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (/_pkg\.(vhd|sv|v)$/.test(base)) {
    return 0;
  }
  if (/_regs\.(vhd|sv|v)$/.test(base)) {
    return 1;
  }
  if (/_core\.(vhd|sv|v)$/.test(base)) {
    return 2;
  }
  if (/_(?:axil|avmm|axi4|axi3|apb|wishbone|ahb)\.(vhd|sv|v)$/.test(base)) {
    return 3;
  }
  return 4;
}

// ── Dependency extraction ─────────────────────────────────────────────────────

export interface HdlDependencies {
  /** Primary-design-unit names declared in this file (lower-cased for VHDL). */
  declares: Set<string>;
  /** work-library names that this file references (lower-cased for VHDL). */
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

    // use work.name[.suffix][;]
    m = /^use\s+work\.(\w+)/.exec(line);
    if (m) {
      uses.add(m[1]);
    }
  }

  return { declares, uses };
}

/**
 * Extract declared and used names from SystemVerilog source text.
 * Matching is case-sensitive (SV is case-sensitive).
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
    }
  }

  return { declares, uses };
}

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
      if (lang !== 'vhdl' && lang !== 'systemverilog') {
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
