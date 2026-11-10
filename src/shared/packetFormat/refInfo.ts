import { splitPacketFormatRef, type PacketFormatRefInfo } from './ipCoreRefs';
import { dirname, joinPath } from './paths';
import { resolve } from './resolver';
import { PacketFormatError, type PacketFileReader } from './types';

/** Resolves one `<file>#<format>` reference relative to the `.ip.yml` at `ipFile`. */
export function resolvePacketFormatRef(
  ref: string,
  ipFile: string,
  read: PacketFileReader
): PacketFormatRefInfo {
  const parts = splitPacketFormatRef(ref);
  if (!parts) {
    return { ref, error: { code: 'SCHEMA', message: `'${ref}' is not '<file>#<format name>'` } };
  }
  const file = joinPath(dirname(ipFile), parts.file);
  try {
    const format = resolve(file, read).formats[parts.format];
    if (!format) {
      return {
        ref,
        error: { code: 'UNKNOWN_REF', message: `unknown format ${parts.format}`, file },
      };
    }
    return { ref, format };
  } catch (e) {
    if (e instanceof PacketFormatError) {
      return { ref, error: { code: e.code, message: e.detail, file: e.file, path: e.path } };
    }
    throw e;
  }
}

/** Info for every distinct `packetFormatRef` of a parsed `.ip.yml`. */
export function collectPacketFormatInfos(
  parsed: unknown,
  ipFile: string,
  read: PacketFileReader
): Record<string, PacketFormatRefInfo> {
  const buses = (parsed as { busInterfaces?: unknown } | null)?.busInterfaces;
  const out: Record<string, PacketFormatRefInfo> = {};
  for (const bus of Array.isArray(buses) ? buses : []) {
    const ref = (bus as { packetFormatRef?: unknown } | null)?.packetFormatRef;
    if (typeof ref === 'string' && !(ref in out)) {
      out[ref] = resolvePacketFormatRef(ref, ipFile, read);
    }
  }
  return out;
}
