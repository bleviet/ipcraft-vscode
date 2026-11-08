/**
 * Pure choice of source folders for ONE missing library. From the units the sources use from it
 * (`wanted`) it picks the fewest folders that declare them (greedy set cover; ties go to the folder
 * whose path shares the most words with the library name, then the shorter path).
 *
 * Then it adds folders for units that are referenced through `work.` but declared in no picked
 * folder (component instantiations do not count). Only needed files are followed: those declaring
 * a wanted unit, plus the files declaring what a needed file references. Unrelated siblings in a
 * picked folder are ignored. Only files kept by the duplicate rule (see duplicateRule) count, so a
 * losing copy never pulls a folder.
 *
 * `exclude` lists the losing copies, template files with `${...}` placeholders, and files a
 * user-section library already claims, restricted to the extensions of the emitted globs.
 * Deterministic: every iteration is sorted.
 */

import * as path from 'path';
import { selectCopies, type Copy } from './duplicateRule';
import { workReferences, type LocalRefKind, type VhdlScan } from './vhdlUnitScanner';

export interface ProposeInput {
  /** Normalised name of the missing library. */
  name: string;
  /** Units used from the library. */
  wanted: ReadonlySet<string>;
  /** Every scanned file eligible as a source (root-relative POSIX paths). */
  candidates: ReadonlyMap<string, VhdlScan | undefined>;
  /** Files matched by a user-section library: never candidates, but listed when a glob covers them. */
  matchedByUser: ReadonlySet<string>;
  /** Libraries that are available (see compareCopies). */
  known: ReadonlySet<string>;
}

export interface LibraryProposal {
  /** Globs such as `libs/dsp/*.vhd`, sorted. */
  files: string[];
  /** Root-relative paths of files inside the globs to leave out, sorted. */
  exclude: string[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** A component instantiation binds through the package declaring the component, not `work`. */
const CLOSURE_KINDS: ReadonlySet<LocalRefKind> = new Set(['architecture', 'body', 'configuration']);

const dirOf = (file: string): string => {
  const dir = path.posix.dirname(file);
  return dir === '.' ? '' : dir;
};

function affinity(name: string, dir: string): number {
  const wanted = new Set(name.toLowerCase().split('_').filter(Boolean));
  const words = new Set(
    dir
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
  return [...wanted].filter((w) => words.has(w)).length;
}

export function proposeLibraryFiles(input: ProposeInput): LibraryProposal {
  const eligible = [...input.candidates]
    .filter(([, scan]) => scan !== undefined && !scan.hasPlaceholders)
    .map(([file, scan]) => ({ file, scan: scan as VhdlScan }))
    .sort((a, b) => byString(a.file, b.file));

  const filesByDir = new Map<string, typeof eligible>();
  const unitsByDir = new Map<string, Set<string>>();
  const dirsByUnit = new Map<string, Set<string>>();
  for (const entry of eligible) {
    const dir = dirOf(entry.file);
    filesByDir.set(dir, [...(filesByDir.get(dir) ?? []), entry]);
    for (const unit of entry.scan.units) {
      unitsByDir.set(dir, (unitsByDir.get(dir) ?? new Set()).add(unit.name));
      dirsByUnit.set(unit.name, (dirsByUnit.get(unit.name) ?? new Set()).add(dir));
    }
  }

  /** Best directory first among `dirs`: name affinity, then shorter, then string order. */
  const bestDir = (dirs: Iterable<string>): string | undefined =>
    [...dirs].sort(
      (a, b) =>
        affinity(input.name, b) - affinity(input.name, a) || a.length - b.length || byString(a, b)
    )[0];

  const picked = new Set<string>();
  const uncovered = new Set([...input.wanted].filter((u) => dirsByUnit.has(u)));
  while (uncovered.size > 0) {
    const scores = new Map<string, number>();
    for (const [dir, units] of unitsByDir) {
      const score = [...units].filter((u) => uncovered.has(u)).length;
      if (score > 0) {
        scores.set(dir, score);
      }
    }
    const top = Math.max(0, ...scores.values());
    const dir = bestDir([...scores].filter(([, s]) => s === top).map(([d]) => d)) as string;
    picked.add(dir);
    unitsByDir.get(dir)?.forEach((u) => uncovered.delete(u));
  }
  if (picked.size === 0) {
    return { files: [], exclude: [] };
  }

  const globOf = (file: string): string => {
    const dir = dirOf(file);
    return `${dir === '' ? '' : `${dir}/`}*${path.posix.extname(file)}`;
  };
  const survivorsOf = () => {
    const inPicked = [...picked].flatMap((d) => filesByDir.get(d) ?? []);
    const copies = inPicked.map((e): Copy => ({ file: e.file, duplicateRank: 0, scan: e.scan }));
    return { inPicked, ...selectCopies(copies, input.known) };
  };

  const pulled = new Set<string>();
  const declares = (copy: Copy, units: ReadonlySet<string>): boolean =>
    (copy.scan?.units ?? []).some((u) => units.has(u.name));

  for (;;) {
    const { kept } = survivorsOf();
    const declared = new Set(kept.flatMap((c) => c.scan?.units.map((u) => u.name) ?? []));
    // Needed files: those declaring a wanted or pulled unit, then (repeatedly) the survivors that
    // declare what a needed file references. Only needed files bring references.
    const needed = new Set(kept.filter((c) => declares(c, input.wanted) || declares(c, pulled)));
    const unresolved = new Set<string>();
    for (const copy of needed) {
      const refs = workReferences(copy.scan, CLOSURE_KINDS);
      for (const unit of refs) {
        if (!declared.has(unit) && dirsByUnit.has(unit)) {
          unresolved.add(unit);
        }
      }
      kept.filter((c) => declares(c, refs)).forEach((c) => needed.add(c));
    }
    const unit = [...unresolved].sort(byString)[0];
    const dir = bestDir([...(dirsByUnit.get(unit) ?? [])].filter((d) => !picked.has(d)));
    if (dir === undefined) {
      break;
    }
    pulled.add(unit);
    picked.add(dir);
  }

  const { inPicked, excluded } = survivorsOf();
  const globs = new Set(inPicked.map((e) => globOf(e.file)));
  const exclude = new Set(excluded.map((e) => e.file));
  const unparsable = [...input.candidates]
    .filter(([, scan]) => scan?.hasPlaceholders)
    .map(([file]) => file);
  for (const file of [...unparsable, ...input.matchedByUser]) {
    if (picked.has(dirOf(file))) {
      exclude.add(file);
    }
  }
  return {
    files: [...globs].sort(byString),
    exclude: [...exclude].filter((f) => globs.has(globOf(f))).sort(byString),
  };
}
