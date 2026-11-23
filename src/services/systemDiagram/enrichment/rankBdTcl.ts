/**
 * Ranks the Tcl scripts that may generate a container's block design. Pure.
 * Evidence, strongest first: the user's link, the script listed in a CMake
 * project together with the design, a matching `set design_name`, and (only
 * for a script without a `design_name`) a matching file name.
 */

import * as path from 'path';
import type { BdTclEvidence } from '../../../domain/systemGraph';
import type { BdTclEntry } from './fileEntries';
import { treeDistance } from './matchDefinitions';

export interface RankedBdTcl<R> {
  entry: BdTclEntry<R>;
  evidence: BdTclEvidence;
}

export interface BdTclRanking<R> {
  /** Strongest evidence first, then nearest to the design; one per file. */
  candidates: RankedBdTcl<R>[];
  chosen?: RankedBdTcl<R>;
  /** Set when the best evidence level has a tie that distance does not break. */
  ambiguous?: RankedBdTcl<R>[];
}

const ORDER: readonly BdTclEvidence[] = ['link', 'cmake', 'design_name', 'file_name'];

export function rankBdTcl<R>(
  bdName: string,
  designFile: string,
  sources: {
    link?: BdTclEntry<R>;
    /** Tcl files listed with `designFile` in a CMake project. */
    project: readonly BdTclEntry<R>[];
    /** The workspace Tcl index. */
    workspace: readonly BdTclEntry<R>[];
  }
): BdTclRanking<R> {
  const design = path.resolve(designFile);
  const byFile = new Map<string, RankedBdTcl<R>>();
  const add = (entry: BdTclEntry<R>, evidence: BdTclEvidence) => {
    const key = path.resolve(entry.file);
    if (key !== design && !byFile.has(key)) {
      byFile.set(key, { entry, evidence });
    }
  };
  if (sources.link) {
    add(sources.link, 'link');
  }
  sources.project
    .filter((entry) => entry.designName === bdName)
    .forEach((entry) => add(entry, 'cmake'));
  sources.workspace
    .filter((entry) => entry.designName === bdName)
    .forEach((entry) => add(entry, 'design_name'));
  sources.workspace
    .filter(
      (entry) => entry.designName === undefined && path.basename(entry.file) === `${bdName}.tcl`
    )
    .forEach((entry) => add(entry, 'file_name'));

  const distance = (ranked: RankedBdTcl<R>) => treeDistance(ranked.entry.file, designFile);
  const candidates = [...byFile.values()].sort(
    (a, b) =>
      ORDER.indexOf(a.evidence) - ORDER.indexOf(b.evidence) ||
      distance(a) - distance(b) ||
      a.entry.file.localeCompare(b.entry.file)
  );
  if (candidates.length === 0) {
    return { candidates };
  }
  if (candidates[0].evidence === 'link') {
    return { candidates, chosen: candidates[0] };
  }
  const best = candidates.filter(
    (ranked) =>
      ranked.evidence === candidates[0].evidence && distance(ranked) === distance(candidates[0])
  );
  return best.length === 1 ? { candidates, chosen: best[0] } : { candidates, ambiguous: best };
}
