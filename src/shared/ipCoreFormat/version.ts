import type { IpCore } from '../../domain/ipcore.types';

/** A file format version an `.ip.yml` can declare in `apiVersion`. */
export type IpCoreFormatVersion = NonNullable<IpCore['apiVersion']>;

/** Every format version this IPCraft reads, oldest first. Mirrors the `apiVersion` schema enum. */
export const IP_CORE_FORMAT_VERSIONS: readonly IpCoreFormatVersion[] = ['1.0', '1.1'];

/** The latest format version this IPCraft supports; importers write it and upgrades target it. */
export const IP_CORE_FORMAT_VERSION: IpCoreFormatVersion = '1.1';

/** The version of a file that declares no `apiVersion`. */
export const IP_CORE_LEGACY_FORMAT_VERSION: IpCoreFormatVersion = '1.0';

export type IpCoreFormatVersionResult =
  | { ok: true; version: IpCoreFormatVersion }
  | { ok: false; message: string };

function isSupportedVersion(value: unknown): value is IpCoreFormatVersion {
  return IP_CORE_FORMAT_VERSIONS.includes(value as IpCoreFormatVersion);
}

/**
 * Reads the file format version of a parsed `.ip.yml`. An absent `apiVersion` is the legacy
 * 1.0; a newer, unknown, or non-string value is an error (a tool must not read a version it
 * does not know).
 */
export function readIpCoreFormatVersion(data: Record<string, unknown>): IpCoreFormatVersionResult {
  const declared = data.apiVersion;
  if (declared === undefined) {
    return { ok: true, version: IP_CORE_LEGACY_FORMAT_VERSION };
  }
  if (isSupportedVersion(declared)) {
    return { ok: true, version: declared };
  }
  if (typeof declared !== 'string') {
    return {
      ok: false,
      message: `apiVersion must be a quoted string such as '${IP_CORE_FORMAT_VERSION}' (found ${JSON.stringify(declared)}).`,
    };
  }
  return {
    ok: false,
    message: `This file declares apiVersion ${declared}, but this IPCraft supports up to ${IP_CORE_FORMAT_VERSION}. Upgrade IPCraft to open it.`,
  };
}
