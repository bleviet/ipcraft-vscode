/**
 * The IP core version as generation sees it: the scheme and version text every `$version`
 * consumer reads, and the version-related part of the template context.
 */
import type { NormalizedMemoryMap } from '../domain/internal.types';
import { parseVersionScheme, type VersionScheme } from '../shared/versioning/versionScheme';
import type { IpCoreData } from './types';
import { xguiVersionSuffix } from './xguiFileName';

export function ipCoreVersionInfo(ipCore: IpCoreData): { scheme: VersionScheme; version: string } {
  return {
    scheme: parseVersionScheme(ipCore.vlnv?.versionScheme),
    version: String(ipCore.vlnv?.version ?? ''),
  };
}

/** `version_scheme`, `version_history` and `version_file_suffix` of the template context. */
export function buildVersionTemplateContext(
  ipCore: IpCoreData,
  maps: readonly NormalizedMemoryMap[]
): {
  version_scheme: VersionScheme;
  version_history: Array<{
    version: string;
    register_set: string;
    crc8: number | null;
    crc16: number | null;
  }>;
  version_file_suffix: string;
} {
  const history = maps.find((map) => map.versionHistory)?.versionHistory;
  return {
    version_scheme: ipCoreVersionInfo(ipCore).scheme,
    version_history: (history?.versions ?? []).map((entry) => ({
      version: entry.version,
      register_set: entry.registerSet,
      crc8: entry.crc8 ?? null,
      crc16: entry.crc16 ?? null,
    })),
    // The Vivado toolchain names the XGUI script after the same default.
    version_file_suffix: xguiVersionSuffix(String(ipCore.vlnv?.version ?? '1.0')),
  };
}
