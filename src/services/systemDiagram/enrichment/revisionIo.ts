/**
 * An {@link EnrichmentIo} that reads the definition files as they were at a git revision. The
 * workspace's own io supplies the candidates (its index of the working tree) and `readAt` the
 * text of one file at the revision. Pure: the caller supplies `readAt`.
 *
 * Only the files the design can match are read at the revision: `.ip.yml` files are matched
 * against the graph with the working tree's index, and only the matched ones are read (and
 * parsed) again. HDL and `.qsys` files are read when the pipeline asks for them, so only matched
 * ones cost a read.
 *
 * Limits, all from matching with the working tree's index:
 * - a definition that exists only at the revision (it was deleted since), or whose VLNV or name
 *   changed since, is not found; a matched `.ip.yml` whose VLNV at the revision is another one
 *   is read, and the pipeline then does not match it;
 * - the caller's `readAt` decides whether a file moved since the revision is followed; the git
 *   reader follows a move that is committed or staged when the comparison starts, not an
 *   untracked file, a move made later in the session, or one combined with edits below git's
 *   rename similarity;
 * - an HDL file larger than 1 MiB at the revision is skipped, as the working-tree index skips it;
 * - an HDL file is matched by the entity or module names of its working-tree text, and its
 *   ports are then read from the text at the revision, where its first unit may differ.
 *
 * Failures: a file that is not at the revision is normal (`readAt` returns undefined): an
 * `.ip.yml` is dropped, `readText` throws {@link FileAbsentError}. `readAt` rejecting means git
 * could not answer: the error propagates (as {@link SourceFailedError} from `readText`) so the
 * caller does not mistake it for missing definitions.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import { SourceFailedError, FileAbsentError, type EnrichmentIo } from './enrichmentIo';
import { HDL_MAX_BYTES, ipEntryFromText, type IpEntry } from './fileEntries';
import { matchDefinitions } from './matchDefinitions';

/** The text of a file at the revision; undefined when the file is not there. */
export type ReadAt<R> = (ref: R) => Promise<string | undefined>;

const READ_POOL_SIZE = 8;

async function mapPool<T, U>(items: readonly T[], map: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_POOL_SIZE, items.length) }, worker));
  return results;
}

async function ipEntryAt<R>(entry: IpEntry<R>, readAt: ReadAt<R>): Promise<IpEntry<R> | undefined> {
  const text = await readAt(entry.ref);
  if (text === undefined) {
    return undefined;
  }
  const { file, displayName, uri, ref } = entry;
  try {
    return ipEntryFromText(text, { file, displayName, uri, ref });
  } catch {
    // The index skips a file that does not parse, too.
    return undefined;
  }
}

export function revisionIo<R>(io: EnrichmentIo<R>, readAt: ReadAt<R>): EnrichmentIo<R> {
  /** The files `listHdlFiles` gave: the size limit applies to them, not to `.qsys` files. */
  const hdlRefs = new Set<R>();
  return {
    listIpFiles: async (graph: SystemGraph, designFile: string) => {
      const candidates = await io.listIpFiles(graph, designFile);
      const matched = new Set(matchDefinitions(graph, candidates, [], designFile).ip.values());
      const atRevision = await mapPool(
        candidates.filter((entry) => matched.has(entry)),
        (entry) => ipEntryAt(entry, readAt)
      );
      return atRevision.filter((entry): entry is IpEntry<R> => entry !== undefined);
    },
    listHdlFiles: async () => {
      const entries = await io.listHdlFiles();
      entries.forEach((entry) => hdlRefs.add(entry.ref));
      return entries;
    },
    listQsysFiles: () => io.listQsysFiles(),
    readText: async (ref) => {
      let text: string | undefined;
      try {
        text = await readAt(ref);
      } catch (error) {
        throw new SourceFailedError(error instanceof Error ? error.message : String(error));
      }
      if (text === undefined) {
        throw new FileAbsentError();
      }
      if (hdlRefs.has(ref) && new TextEncoder().encode(text).byteLength > HDL_MAX_BYTES) {
        throw new FileAbsentError('The HDL file is larger than 1 MiB at the base revision.');
      }
      return text;
    },
  };
}
