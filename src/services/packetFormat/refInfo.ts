import * as fs from 'fs';
import {
  collectPacketFormatInfos as collect,
  resolvePacketFormatRef as resolveRef,
  type PacketFileReader,
  type PacketFormatRefInfo,
} from '../../shared/packetFormat';

/** Reads from disk; undefined for a missing or unreadable file. */
export const readFromDisk: PacketFileReader = (absolutePath) => {
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

/** Resolves one `<file>#<format>` reference relative to the `.ip.yml` at `ipFile`, reading from disk. */
export function resolvePacketFormatRef(ref: string, ipFile: string): PacketFormatRefInfo {
  return resolveRef(ref, ipFile, readFromDisk);
}

/** Info for every distinct `packetFormatRef` of a parsed `.ip.yml`, reading from disk. */
export function collectPacketFormatInfos(
  parsed: unknown,
  ipFile: string
): Record<string, PacketFormatRefInfo> {
  return collect(parsed, ipFile, readFromDisk);
}
