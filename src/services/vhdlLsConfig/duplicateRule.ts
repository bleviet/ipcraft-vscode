/**
 * Pure duplicate rule shared by the generated libraries and the missing-library proposals (one
 * source of truth). Files that declare the same primary unit are walked best first (`compareCopies`).
 * A file stays when it declares at least one unit nobody took yet, and then takes all its units; it
 * is excluded only when every unit it declares is already taken. A file that still contributes a
 * unit therefore stays even if another of its units duplicates one: the language server reports
 * that duplicate, which is better than leaving the contributed unit unresolved.
 */

import type { VhdlScan } from './vhdlUnitScanner';

/** A file that may declare a unit name, with what the duplicate rule needs. */
export interface Copy {
  file: string;
  /** Lower is preferred (manifest-named files first); proposals pass equal ranks. */
  duplicateRank: number;
  scan: VhdlScan | undefined;
}

export interface ExcludedCopy {
  file: string;
  reason: string;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function unknownLibraries(copy: Copy, available: ReadonlySet<string>): number {
  return (copy.scan?.libraries ?? []).filter((l) => !available.has(l.name)).length;
}

/**
 * Orders copies best first: manifest-named, then fewer `library` clauses naming a library that is
 * not available (not generated, user-section or built-in, and no workspace file declares the units
 * used from it, as with a vendor library), then shorter path, then string order.
 */
export function compareCopies(a: Copy, b: Copy, available: ReadonlySet<string>): number {
  return (
    a.duplicateRank - b.duplicateRank ||
    unknownLibraries(a, available) - unknownLibraries(b, available) ||
    a.file.length - b.file.length ||
    byString(a.file, b.file)
  );
}

/** Splits copies into those kept (best first) and those excluded, with the reason. */
export function selectCopies(
  copies: readonly Copy[],
  available: ReadonlySet<string>
): { kept: Copy[]; excluded: ExcludedCopy[] } {
  const taken = new Map<string, { kind: string; file: string }>();
  const kept: Copy[] = [];
  const excluded: ExcludedCopy[] = [];
  for (const copy of [...copies].sort((a, b) => compareCopies(a, b, available))) {
    const units = copy.scan?.units ?? [];
    const clash = units.find((u) => taken.has(u.name));
    if (clash && units.every((u) => taken.has(u.name))) {
      const owner = taken.get(clash.name) as { kind: string; file: string };
      excluded.push({
        file: copy.file,
        reason: `duplicate of ${owner.kind} ${clash.name} in ${owner.file}`,
      });
      continue;
    }
    for (const unit of units) {
      if (!taken.has(unit.name)) {
        taken.set(unit.name, { kind: unit.kind, file: copy.file });
      }
    }
    kept.push(copy);
  }
  return { kept, excluded };
}
