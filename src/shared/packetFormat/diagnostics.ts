import { resolve } from './resolver';
import { findSites, locatePath } from './sites';
import { PacketFormatError, type PacketFileReader } from './types';

export interface PacketFileDiagnostic {
  code: string;
  message: string;
  /** Zero-based line span in the checked file. */
  startLine: number;
  endLine: number;
}

/**
 * Semantic diagnostics of a `*.pkt.yml` / `*.pktmap.yml`: the resolver's error, placed on the field path it names
 * when that is in this file, else on the first line (with the offending file named in the message).
 */
export function packetFileDiagnostics(
  file: string,
  text: string,
  read: PacketFileReader
): PacketFileDiagnostic[] {
  try {
    resolve(file, (p) => (p === file ? text : read(p)));
    return [];
  } catch (e) {
    if (!(e instanceof PacketFormatError)) {
      throw e;
    }
    const here = e.file === undefined || e.file === file;
    const span = here ? locatePath(findSites(text), e.path) : undefined;
    const where = here ? '' : `${e.file}: `;
    return [
      {
        code: e.code,
        message: `${where}${e.detail}`,
        startLine: span?.start ?? 0,
        endLine: span?.end ?? 0,
      },
    ];
  }
}
