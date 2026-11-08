/**
 * Pure sharing of `work.<unit>` declarations across library boundaries. A file written as
 * `use work.X`, `entity work.X`, `architecture a of X`, `configuration c of X` or
 * `package body X` only resolves if a file declaring X is listed in the same library (a component
 * instantiation does not count). For each target library this finds the units its files reference
 * but nothing in it declares, and picks one declaring file from any other library (generated or
 * user-section), then follows that file's own `work.` references. Files of the same source library
 * holding only architectures or package bodies of the picked file's units come along. A file that
 * would declare a unit the target already has is skipped, so no duplicate arises; among several
 * candidates the shorter path wins, then string order. The caller copies the files into the target,
 * never the other way, because a user-section library cannot be written. Deterministic.
 */

import { workReferences, type LocalRefKind, type VhdlScan } from './vhdlUnitScanner';

export interface LibraryFiles {
  name: string;
  /** Root-relative POSIX paths. */
  files: string[];
}

export interface ShareInput {
  /** Libraries that may receive shared files, with their kept files. */
  targets: LibraryFiles[];
  /** Every library's kept files as potential sources: the targets, other generated and user libraries. */
  sources: LibraryFiles[];
  scans: ReadonlyMap<string, VhdlScan | undefined>;
}

export interface SharedFile {
  path: string;
  /** Name of the library the file was taken from. */
  from: string;
}

interface Candidate {
  path: string;
  lib: string;
}

/** A component instantiation binds through the package declaring the component, not `work`. */
const SHARED_KINDS: ReadonlySet<LocalRefKind> = new Set(['architecture', 'body', 'configuration']);
/** Files holding the architectures or package body of a unit travel with it. */
const SECONDARY_KINDS: ReadonlySet<LocalRefKind> = new Set(['architecture', 'body']);
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function shareUnits(input: ShareInput): Map<string, SharedFile[]> {
  const declaredBy = (file: string): string[] =>
    input.scans.get(file)?.units.map((u) => u.name) ?? [];
  const refsOf = (file: string): string[] =>
    [...workReferences(input.scans.get(file), SHARED_KINDS)].sort(byString);
  /** True when the file has architectures or bodies and every one of them belongs to `units`. */
  const bindsTo = (file: string, units: ReadonlySet<string>): boolean => {
    const secondary = (input.scans.get(file)?.localRefs ?? []).filter((r) =>
      SECONDARY_KINDS.has(r.kind)
    );
    return secondary.length > 0 && secondary.every((r) => units.has(r.name));
  };

  // One entry per path, under the lexicographically first library (other than the target) listing it.
  const libsByPath = new Map<string, Set<string>>();
  for (const source of input.sources) {
    for (const file of source.files) {
      libsByPath.set(file, (libsByPath.get(file) ?? new Set()).add(source.name));
    }
  }
  const firstLib = (file: string, exclude: string): string | undefined =>
    [...(libsByPath.get(file) ?? [])].filter((l) => l !== exclude).sort(byString)[0];

  const result = new Map<string, SharedFile[]>();
  for (const target of [...input.targets].sort((a, b) => byString(a.name, b.name))) {
    const own = new Set(target.files);
    const declared = new Set(target.files.flatMap(declaredBy));

    const index = new Map<string, Candidate[]>();
    for (const file of libsByPath.keys()) {
      const lib = firstLib(file, target.name);
      if (own.has(file) || lib === undefined) {
        continue;
      }
      for (const unit of new Set(declaredBy(file))) {
        const list = index.get(unit) ?? [];
        list.push({ path: file, lib });
        index.set(unit, list);
      }
    }

    const pending = [...new Set(target.files.flatMap(refsOf))]
      .filter((n) => !declared.has(n))
      .sort(byString);
    const handled = new Set<string>();
    const added: SharedFile[] = [];
    const addedPaths = new Set<string>();
    for (let i = 0; i < pending.length; i++) {
      const name = pending[i];
      if (handled.has(name)) {
        continue;
      }
      handled.add(name);
      const pick = [...(index.get(name) ?? [])]
        .sort((a, b) => a.path.length - b.path.length || byString(a.path, b.path))
        .find((c) => !declaredBy(c.path).some((u) => declared.has(u)));
      if (!pick) {
        continue;
      }
      const picked = [pick.path];
      const units = new Set(declaredBy(pick.path));
      const sourceFiles = input.sources.find((l) => l.name === pick.lib)?.files ?? [];
      for (const file of [...sourceFiles].sort(byString)) {
        if (!own.has(file) && !addedPaths.has(file) && file !== pick.path && bindsTo(file, units)) {
          picked.push(file);
        }
      }
      for (const file of picked) {
        if (file !== pick.path && declaredBy(file).some((u) => declared.has(u))) {
          continue;
        }
        added.push({ path: file, from: pick.lib });
        addedPaths.add(file);
        declaredBy(file).forEach((u) => declared.add(u));
        pending.push(...refsOf(file).filter((n) => !declared.has(n)));
      }
    }
    if (added.length > 0) {
      result.set(
        target.name,
        added.sort((a, b) => byString(a.path, b.path))
      );
    }
  }
  return result;
}
