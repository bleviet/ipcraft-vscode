/**
 * Pure user-section concerns of the library map. A file is `included` by the user libraries whose
 * `files` globs match it and `exclude` globs do not, or (when no manifest names it) `removedBy`
 * the first library by name whose `exclude` removes it. An unlisted file that declares units, all
 * of which a file included by a user library also declares, is a duplicate the user library wins
 * (OSVVM `deprecated/` copies). `availableLibraries` adds the libraries whose used units a
 * workspace file provides. Deterministic.
 */

import { workReferences, type LocalRefKind, type VhdlScan } from './vhdlUnitScanner';
import { createUserLibraryMatcher, type UserLibrary } from './userSection';

export interface UserVerdict {
  /** Names of the user libraries that include the file. */
  included?: string[];
  /** First user library (by name) whose exclude removes an unlisted file. */
  removedBy?: string;
}

const dirOf = (file: string): string => file.slice(0, Math.max(0, file.lastIndexOf('/')));
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Compiles the globs once; `listed` tells whether a manifest names the file. */
export function createUserClassifier(
  userLibraries: UserLibrary[]
): (file: string, listed: boolean) => UserVerdict | undefined {
  const matchers = userLibraries.map(createUserLibraryMatcher);
  return (file, listed) => {
    const matches = userLibraries.map((l, i) => ({ name: l.name, match: matchers[i](file) }));
    const included = matches.filter((m) => m.match === 'included').map((m) => m.name);
    if (included.length > 0) {
      return { included };
    }
    const removedBy = matches
      .filter((m) => m.match === 'excluded')
      .map((m) => m.name)
      .sort(byString)[0];
    return removedBy !== undefined && !listed ? { removedBy } : undefined;
  };
}

/** A component instance binds through its package's library, not a same-named local copy. */
const WITNESS_KINDS: ReadonlySet<LocalRefKind> = new Set(['architecture', 'body', 'configuration']);

/**
 * Of the `defaultlib` files, the unlisted copies of units a user library provides that nothing
 * live uses. A copy is unlisted, declares units, has every unit declared by a non-template file a
 * user library includes, and shares no unit with an unlisted file in another folder (that
 * collision belongs to the per-folder split). Witnesses are the other `defaultlib` files that
 * declare a unit themselves; companions without units (architectures, bodies) prove nothing. A
 * copy is live when a witness refers to one of its units through `work` or a binding,
 * or through a library that is not in `known` (a missing library whose proposal would offer the
 * copy). Live copies become witnesses, until stable. The rest (OSVVM `deprecated/`) is returned.
 */
export function findUserDuplicates(
  defaultFiles: readonly { file: string; unlisted: boolean }[],
  userFiles: ReadonlyMap<string, string[]>,
  scans: ReadonlyMap<string, VhdlScan | undefined>,
  known: ReadonlySet<string>
): { path: string; reason: string }[] {
  const owners = new Map<string, { kind: string; file: string; library: string }>();
  for (const library of [...userFiles.keys()].sort(byString)) {
    for (const file of [...(userFiles.get(library) as string[])].sort(byString)) {
      const scan = scans.get(file);
      // A template cannot provide a unit.
      for (const unit of scan?.hasPlaceholders ? [] : (scan?.units ?? [])) {
        if (!owners.has(unit.name)) {
          owners.set(unit.name, { kind: unit.kind, file, library });
        }
      }
    }
  }
  const dirsByUnit = new Map<string, Set<string>>();
  for (const { file, unlisted } of defaultFiles) {
    for (const unit of unlisted ? (scans.get(file)?.units ?? []) : []) {
      dirsByUnit.set(unit.name, (dirsByUnit.get(unit.name) ?? new Set()).add(dirOf(file)));
    }
  }
  const isCopy = ({ file, unlisted }: { file: string; unlisted: boolean }): boolean => {
    const scan = scans.get(file);
    const units = scan?.units ?? [];
    return (
      unlisted &&
      !scan?.hasPlaceholders &&
      units.length > 0 &&
      units.every(
        (u) =>
          owners.has(u.name) &&
          [...(dirsByUnit.get(u.name) as Set<string>)].every((d) => d === dirOf(file))
      )
    );
  };
  const copies = defaultFiles
    .filter(isCopy)
    .map((f) => f.file)
    .sort(byString);
  const referred = new Set<string>();
  const witness = (file: string): void => {
    const scan = scans.get(file);
    workReferences(scan, WITNESS_KINDS).forEach((n) => referred.add(n));
    for (const use of scan?.uses ?? []) {
      if (!known.has(use.library.toLowerCase())) {
        referred.add(use.unit);
      }
    }
  };
  const copySet = new Set(copies);
  defaultFiles
    .filter((f) => !copySet.has(f.file) && (scans.get(f.file)?.units.length ?? 0) > 0)
    .forEach((f) => witness(f.file));
  const live = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of copies) {
      if (!live.has(file) && scans.get(file)?.units.some((u) => referred.has(u.name))) {
        live.add(file);
        witness(file);
        changed = true;
      }
    }
  }
  return copies
    .filter((file) => !live.has(file))
    .map((file) => {
      const first = (scans.get(file) as VhdlScan).units[0];
      const owner = owners.get(first.name) as { kind: string; file: string; library: string };
      return {
        path: file,
        reason: `duplicate of ${owner.kind} ${first.name} in ${owner.file} (libraries.${owner.library})`,
      };
    });
}

/**
 * Libraries a copy may name without penalty: `known` plus any library whose used units a
 * non-template workspace file declares, ignoring files a user library claims (such a library is
 * one a missing-library proposal would provide).
 */
export function availableLibraries(
  known: ReadonlySet<string>,
  userMatched: ReadonlySet<string>,
  scans: ReadonlyMap<string, VhdlScan | undefined>
): Set<string> {
  const declared = new Set<string>();
  for (const [file, scan] of scans) {
    if (scan && !scan.hasPlaceholders && !userMatched.has(file)) {
      scan.units.forEach((u) => declared.add(u.name));
    }
  }
  const available = new Set(known);
  for (const scan of scans.values()) {
    for (const use of scan?.uses ?? []) {
      if (declared.has(use.unit)) {
        available.add(use.library.toLowerCase());
      }
    }
  }
  return available;
}
