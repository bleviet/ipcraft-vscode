import { basename, dirname, joinPath, relativePath } from './paths';
import { resolve } from './resolver';
import type { PacketFileReader } from './types';
import { parseYaml, isRaw } from './util';

/** A `<file>#<format>` an interface could point to, as listed in the picker. */
export interface PacketFormatCandidate {
  /** Value for `packetFormatRef`: path relative to the `.ip.yml`, `#`, format name. */
  ref: string;
  file: string;
  name: string;
  description: string;
  dataWidth: number;
  /** Empty: any streaming bus. */
  busTypes: string[];
}

/** What a picker filters by; a missing fact never excludes a candidate. */
export interface CandidateFilter {
  dataWidth?: number;
  /** Names the bus type is known as (contract key, short name). */
  busTypeNames?: readonly string[];
}

export function filterCandidates(
  candidates: readonly PacketFormatCandidate[],
  filter: CandidateFilter
): PacketFormatCandidate[] {
  const names = (filter.busTypeNames ?? []).map((n) => n.toLowerCase());
  return candidates.filter(
    (c) =>
      (filter.dataWidth === undefined || c.dataWidth === filter.dataWidth) &&
      (names.length === 0 ||
        c.busTypes.length === 0 ||
        c.busTypes.some((t) => names.includes(t.toLowerCase())))
  );
}

/** The formats a `*.pkt.yml` file defines itself (not its imports), resolved; undefined when the file is invalid. */
export function candidatesOfFile(
  ipFile: string,
  pktFile: string,
  read: PacketFileReader
): PacketFormatCandidate[] {
  try {
    const text = read(pktFile);
    const doc = text === undefined ? undefined : parseYaml(text, pktFile);
    const own = isRaw(doc) && Array.isArray(doc.packetFormats) ? doc.packetFormats : [];
    const resolved = resolve(pktFile, read).formats;
    const rel = relativePath(dirname(ipFile), joinPath('', pktFile));
    return own.flatMap((f) => {
      const name = isRaw(f) && typeof f.name === 'string' ? f.name : '';
      const fmt = resolved[name];
      return fmt
        ? [
            {
              ref: `${rel}#${name}`,
              file: basename(pktFile),
              name,
              description: fmt.description,
              dataWidth: fmt.dataWidth,
              busTypes: fmt.busTypes,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}
