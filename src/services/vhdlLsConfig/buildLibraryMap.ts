/**
 * Pure library-map builder: decides which VHDL library each file belongs to, removes duplicate
 * primary units per library, honours the user section, and finds libraries that sources
 * reference but nothing defines. Deterministic output (sorted by library name and file path).
 */

import type { VhdlScan } from './vhdlUnitScanner';
import { selectCopies } from './duplicateRule';
import { proposeLibraryFiles } from './proposeLibraryFiles';
import { scopeLibraries } from './scopeLibraries';
import { shareUnits } from './shareUnits';
import type { UserLibrary } from './userSection';
import { availableLibraries, createUserClassifier, findUserDuplicates } from './userLibraryFiles';

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
  /** Root-relative paths inside those globs to leave out (duplicate copies, template files). */
  exclude: string[];
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

/** Drops template files and duplicate primary units, keeping the best copy (see duplicateRule). */
function selectLibraryFiles(
  name: string,
  placements: Placement[],
  scans: BuildLibraryMapInput['scans'],
  available: ReadonlySet<string>
) {
  const library: GeneratedLibrary = { name, files: [], excluded: [] };
  const byFile = new Map(placements.map((p) => [p.file, p]));
  const copies = [];
  for (const { file, duplicateRank } of placements) {
    const scan = scans.get(file);
    if (scan?.hasPlaceholders) {
      library.excluded.push({ path: file, reason: 'template: contains ${...} placeholders' });
    } else {
      copies.push({ file, duplicateRank, scan });
    }
  }
  const { kept, excluded } = selectCopies(copies, available);
  for (const { file } of kept) {
    const placement = byFile.get(file) as Placement;
    library.files.push({ path: file, provenance: placement.provenance });
  }
  library.excluded.push(...excluded.map((e) => ({ path: e.file, reason: e.reason })));
  library.files.sort((a, b) => byString(a.path, b.path));
  library.excluded.sort((a, b) => byString(a.path, b.path));
  return library;
}

function findMissing(
  libraries: GeneratedLibrary[],
  known: ReadonlySet<string>,
  available: ReadonlySet<string>,
  userMatched: ReadonlySet<string>,
  scans: BuildLibraryMapInput['scans']
): MissingLibrary[] {
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

  const missingNames = [...references.keys()].sort(byString);
  const proposable = new Map([...scans].filter(([file]) => !userMatched.has(file)));
  return missingNames.map((name) => {
    const bySite = (a: { file: string; line: number }, b: { file: string; line: number }): number =>
      byString(a.file, b.file) || a.line - b.line;
    const clauses = references.get(name) ?? [];
    const uses = useSites.get(name) ?? [];
    // Point at the first reference (use clause or instantiation), else at the `library` clause.
    const firstUse = [...(uses.length > 0 ? uses : clauses)].sort(bySite)[0];
    const wanted = usedUnits.get(name) ?? new Set<string>();
    const proposal = proposeLibraryFiles({
      name,
      wanted,
      candidates: proposable,
      matchedByUser: userMatched,
      known: available,
    });
    return {
      name,
      firstUse,
      otherFiles: new Set([...clauses, ...uses].map((s) => s.file)).size - 1,
      candidates: proposal.files,
      exclude: proposal.exclude,
    };
  });
}

/**
 * Moves colliding unlisted units of `defaultlib` into per-folder libraries (see scopeLibraries).
 * Returns the names of the libraries it created.
 */
function splitDefaultLibrary(
  byLibrary: Map<string, Placement[]>,
  userNames: ReadonlySet<string>,
  scans: BuildLibraryMapInput['scans']
): string[] {
  const placements = byLibrary.get(DEFAULT_LIBRARY);
  if (!placements) {
    return [];
  }
  const { defaultFiles, scopes } = scopeLibraries({
    files: placements.map((p) => ({ path: p.file, listed: p.duplicateRank < UNLISTED_RANK })),
    scans,
    takenNames: new Set([...byLibrary.keys(), ...userNames, ...BUILT_IN_LIBRARIES]),
  });
  const byFile = new Map(placements.map((p) => [p.file, p]));
  const placementsOf = (files: string[]): Placement[] =>
    files.map((file) => byFile.get(file) as Placement);
  if (defaultFiles.length > 0) {
    byLibrary.set(DEFAULT_LIBRARY, placementsOf(defaultFiles));
  } else {
    byLibrary.delete(DEFAULT_LIBRARY);
  }
  for (const scope of scopes) {
    byLibrary.set(
      scope.name,
      placementsOf(scope.files).map((p) => ({ ...p, library: scope.name }))
    );
  }
  return scopes.map((s) => s.name);
}

/** Lists in each target library the files that declare units its files reference (see shareUnits). */
function addSharedUnits(
  libraries: GeneratedLibrary[],
  targetNames: ReadonlySet<string>,
  userFiles: Map<string, string[]>,
  scans: BuildLibraryMapInput['scans']
): void {
  const generated = libraries.map((l) => ({ name: l.name, files: l.files.map((f) => f.path) }));
  const shared = shareUnits({
    targets: generated.filter((l) => targetNames.has(l.name)),
    sources: [...generated, ...[...userFiles].map(([name, files]) => ({ name, files }))],
    scans,
  });
  for (const library of libraries) {
    const added = shared.get(library.name);
    if (added) {
      library.files.push(
        ...added.map((f) => ({ path: f.path, provenance: `shared from ${f.from}` }))
      );
      library.files.sort((a, b) => byString(a.path, b.path));
    }
  }
}

export function buildLibraryMap(input: BuildLibraryMapInput): LibraryMap {
  const claimsByFile = new Map<string, Claim[]>();
  for (const claim of input.claims) {
    pushTo(claimsByFile, claim.file, claim);
  }
  const files = [...new Set([...input.vhdlFiles, ...claimsByFile.keys()])].sort(byString);

  const classify = createUserClassifier(input.userLibraries);
  const userNames = new Set(input.userLibraries.map((l) => l.name));
  const userFiles = new Map<string, string[]>(input.userLibraries.map((l) => [l.name, []]));
  const userMatched = new Set<string>();
  const byLibrary = new Map<string, Placement[]>();
  const removedByUser: ExcludedFile[] = [];
  for (const file of files) {
    const verdict = classify(file, claimsByFile.has(file));
    if (verdict?.included) {
      verdict.included.forEach((name) => (userFiles.get(name) as string[]).push(file));
      userMatched.add(file);
      continue;
    }
    if (verdict?.removedBy !== undefined) {
      // Unlisted and removed by a user library's exclude: it must not leak into defaultlib, and
      // it is no proposal candidate. A user-defined defaultlib already explains the removal.
      userMatched.add(file);
      if (!userNames.has(DEFAULT_LIBRARY)) {
        removedByUser.push({ path: file, reason: `excluded by libraries.${verdict.removedBy}` });
      }
      continue;
    }
    for (const placement of placeFile(file, claimsByFile.get(file) ?? [])) {
      if (!userNames.has(placement.library)) {
        pushTo(byLibrary, placement.library, placement);
      }
    }
  }

  const duplicates = findUserDuplicates(
    (byLibrary.get(DEFAULT_LIBRARY) ?? []).map((p) => ({
      file: p.file,
      unlisted: p.duplicateRank >= UNLISTED_RANK,
    })),
    userFiles,
    input.scans,
    new Set([...byLibrary.keys(), ...userNames, ...BUILT_IN_LIBRARIES])
  );
  if (duplicates.length > 0) {
    const gone = new Set(duplicates.map((d) => d.path));
    gone.forEach((file) => userMatched.add(file));
    const rest = (byLibrary.get(DEFAULT_LIBRARY) ?? []).filter((p) => !gone.has(p.file));
    if (rest.length > 0) {
      byLibrary.set(DEFAULT_LIBRARY, rest);
    } else {
      byLibrary.delete(DEFAULT_LIBRARY);
    }
    if (!userNames.has(DEFAULT_LIBRARY)) {
      removedByUser.push(...duplicates);
    }
  }

  const scopeNames = splitDefaultLibrary(byLibrary, userNames, input.scans);

  const known = new Set([...byLibrary.keys(), ...userNames, ...BUILT_IN_LIBRARIES]);
  if (removedByUser.length > 0) {
    known.add(DEFAULT_LIBRARY);
  }
  const available = availableLibraries(known, userMatched, input.scans);
  const libraries = [...byLibrary.keys()]
    .sort(byString)
    .map((name) =>
      selectLibraryFiles(name, byLibrary.get(name) as Placement[], input.scans, available)
    );
  if (removedByUser.length > 0) {
    let defaultLib = libraries.find((l) => l.name === DEFAULT_LIBRARY);
    if (!defaultLib) {
      defaultLib = { name: DEFAULT_LIBRARY, files: [], excluded: [] };
      libraries.push(defaultLib);
      libraries.sort((a, b) => byString(a.name, b.name));
    }
    defaultLib.excluded.push(...removedByUser);
    defaultLib.excluded.sort((a, b) => byString(a.path, b.path));
  }
  addSharedUnits(libraries, new Set([DEFAULT_LIBRARY, ...scopeNames]), userFiles, input.scans);
  return {
    libraries,
    missing: findMissing(libraries, known, available, userMatched, input.scans),
  };
}
