/**
 * Pure library-map builder: decides which VHDL library each file belongs to, removes duplicate
 * primary units per library, honours the user section, and finds libraries that sources
 * reference but nothing defines. Deterministic output (sorted by library name and file path).
 */

import * as path from 'path';
import type { VhdlScan } from './vhdlUnitScanner';
import { createUserLibraryMatcher, type UserLibrary } from './userSection';

export type ClaimRank = 1 | 2 | 3 | 4;

export interface Claim {
  /** Root-relative POSIX path. */
  file: string;
  rank: ClaimRank;
  /** Library as stated by the source, raw. */
  library?: string;
  /** Root-relative POSIX path of the manifest. */
  source: string;
}

export interface BuildLibraryMapInput {
  claims: Claim[];
  /** Every VHDL file under the root (root-relative POSIX). */
  vhdlFiles: string[];
  /** Scan per file; undefined when the file was not scanned (too large). */
  scans: ReadonlyMap<string, VhdlScan | undefined>;
  userLibraries: UserLibrary[];
}

export interface LibraryFile {
  path: string;
  provenance: string;
}

export interface ExcludedFile {
  path: string;
  reason: string;
}

export interface GeneratedLibrary {
  name: string;
  files: LibraryFile[];
  excluded: ExcludedFile[];
}

export interface MissingLibrary {
  name: string;
  firstUse: { file: string; line: number };
  otherFiles: number;
  /** Glob patterns such as `libs/dsp/*.vhd` for directories that declare the used packages. */
  candidates: string[];
}

export interface LibraryMap {
  libraries: GeneratedLibrary[];
  missing: MissingLibrary[];
}

export const DEFAULT_LIBRARY = 'defaultlib';
const UNLISTED_RANK = 5;
const BUILT_IN_LIBRARIES = new Set(['ieee', 'std', 'work']);

export function normalizeLibraryName(name: string): string {
  const lower = name.toLowerCase();
  return lower === 'xil_defaultlib' || lower === 'work' ? DEFAULT_LIBRARY : lower;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Placement {
  file: string;
  library: string;
  provenance: string;
  duplicateRank: number;
}

function placeFile(file: string, claims: Claim[]): Placement[] {
  const sorted = [...claims].sort((a, b) => a.rank - b.rank || byString(a.source, b.source));
  const duplicateRank = sorted[0]?.rank ?? UNLISTED_RANK;
  const stating = sorted.filter((c) => c.library !== undefined);
  if (stating.length === 0) {
    return [
      {
        file,
        library: DEFAULT_LIBRARY,
        provenance: sorted[0]?.source ?? 'unlisted',
        duplicateRank,
      },
    ];
  }
  const bestRank = stating[0].rank;
  const provenanceByLibrary = new Map<string, string>();
  for (const claim of stating) {
    if (claim.rank === bestRank) {
      const lib = normalizeLibraryName(claim.library as string);
      if (!provenanceByLibrary.has(lib)) {
        provenanceByLibrary.set(lib, claim.source);
      }
    }
  }
  return [...provenanceByLibrary].map(([library, provenance]) => ({
    file,
    library,
    provenance,
    duplicateRank,
  }));
}

function removeDuplicates(
  name: string,
  placements: Placement[],
  scans: BuildLibraryMapInput['scans']
) {
  const ordered = [...placements].sort(
    (a, b) =>
      a.duplicateRank - b.duplicateRank || a.file.length - b.file.length || byString(a.file, b.file)
  );
  const taken = new Map<string, { kind: string; file: string }>();
  const library: GeneratedLibrary = { name, files: [], excluded: [] };
  for (const placement of ordered) {
    const units = scans.get(placement.file)?.units ?? [];
    const clash = units.find((u) => taken.has(u.name));
    if (clash) {
      const owner = taken.get(clash.name) as { kind: string; file: string };
      library.excluded.push({
        path: placement.file,
        reason: `duplicate of ${owner.kind} ${clash.name} in ${owner.file}`,
      });
      continue;
    }
    for (const unit of units) {
      taken.set(unit.name, { kind: unit.kind, file: placement.file });
    }
    library.files.push({ path: placement.file, provenance: placement.provenance });
  }
  library.files.sort((a, b) => byString(a.path, b.path));
  library.excluded.sort((a, b) => byString(a.path, b.path));
  return library;
}

function findMissing(
  libraries: GeneratedLibrary[],
  userLibraries: UserLibrary[],
  scans: BuildLibraryMapInput['scans']
): MissingLibrary[] {
  const known = new Set([
    ...BUILT_IN_LIBRARIES,
    ...libraries.map((l) => l.name),
    ...userLibraries.map((l) => l.name),
  ]);
  const keptFiles = libraries.flatMap((l) => l.files.map((f) => f.path));
  const references = new Map<string, { file: string; line: number }[]>();
  const useSites = new Map<string, { file: string; line: number }[]>();
  const usedUnits = new Map<string, Set<string>>();
  for (const file of [...new Set(keptFiles)].sort(byString)) {
    const scan = scans.get(file);
    if (!scan) {
      continue;
    }
    for (const clause of scan.libraries) {
      const name = clause.name.toLowerCase();
      if (!known.has(name)) {
        pushTo(references, name, { file, line: clause.line });
      }
    }
    for (const use of scan.uses) {
      const name = use.library.toLowerCase();
      if (!known.has(name)) {
        pushTo(useSites, name, { file, line: use.line });
        usedUnits.set(name, (usedUnits.get(name) ?? new Set()).add(use.unit));
      }
    }
  }

  return [...references.keys()].sort(byString).map((name) => {
    const bySite = (a: { file: string; line: number }, b: { file: string; line: number }): number =>
      byString(a.file, b.file) || a.line - b.line;
    const clauses = references.get(name) ?? [];
    const uses = useSites.get(name) ?? [];
    // Point at the first reference (use clause or instantiation), else at the `library` clause.
    const firstUse = [...(uses.length > 0 ? uses : clauses)].sort(bySite)[0];
    const wanted = usedUnits.get(name) ?? new Set<string>();
    const candidates = new Set<string>();
    for (const [file, scan] of scans) {
      if (scan?.units.some((u) => wanted.has(u.name))) {
        const dir = path.posix.dirname(file);
        candidates.add(`${dir === '.' ? '' : `${dir}/`}*${path.posix.extname(file)}`);
      }
    }
    return {
      name,
      firstUse,
      otherFiles: new Set([...clauses, ...uses].map((s) => s.file)).size - 1,
      candidates: [...candidates].sort(byString),
    };
  });
}

export function buildLibraryMap(input: BuildLibraryMapInput): LibraryMap {
  const claimsByFile = new Map<string, Claim[]>();
  for (const claim of input.claims) {
    pushTo(claimsByFile, claim.file, claim);
  }
  const files = [...new Set([...input.vhdlFiles, ...claimsByFile.keys()])].sort(byString);

  const userMatchers = input.userLibraries.map(createUserLibraryMatcher);
  const userNames = new Set(input.userLibraries.map((l) => l.name));
  const byLibrary = new Map<string, Placement[]>();
  for (const file of files) {
    if (userMatchers.some((matches) => matches(file))) {
      continue;
    }
    for (const placement of placeFile(file, claimsByFile.get(file) ?? [])) {
      if (!userNames.has(placement.library)) {
        pushTo(byLibrary, placement.library, placement);
      }
    }
  }

  const libraries = [...byLibrary.keys()]
    .sort(byString)
    .map((name) => removeDuplicates(name, byLibrary.get(name) as Placement[], input.scans));
  return { libraries, missing: findMissing(libraries, input.userLibraries, input.scans) };
}
