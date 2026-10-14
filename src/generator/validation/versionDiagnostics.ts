/**
 * Generation-time diagnostics for IP core versions: the `$version` reference gate and the
 * vendor-tool warning for versions the tools may reject. Pure; IpCoreScaffolder reports the
 * results through the generator's existing channel (GenerateResult `issues` / `warnings`).
 */
import { normalizeMemoryMap } from '../../domain/parse';
import type { NormalizedMemoryMap } from '../../domain/internal.types';
import type { IpcraftIssue } from '../../shared/issues';
import {
  blocksHaveVersionRef,
  validateVersionRefs,
  type VersionRefIssue,
} from '../../shared/versioning/validateVersionRefs';
import { validateVersion } from '../../shared/versioning/versionScheme';
import type { IpCoreData } from '../types';
import { ipCoreVersionInfo } from '../versionContext';

const NUMERIC_VERSION = /^\d+(\.\d+)*$/;

const parseSnapshot = (blocks: unknown[]) =>
  normalizeMemoryMap({ addressBlocks: blocks }).addressBlocks;

/** `<map>.<block>.<register>[.<field>]` for a path into a normalized memory map. */
function describePath(map: NormalizedMemoryMap, path: ReadonlyArray<string | number>): string {
  const names: string[] = [map.name];
  let node: unknown = map;
  for (const segment of path) {
    node = (node as Record<string | number, unknown> | undefined)?.[segment];
    const name = (node as { name?: unknown } | undefined)?.name;
    if (typeof segment === 'number' && typeof name === 'string') {
      names.push(name);
    }
  }
  return names.join('.');
}

/**
 * Checks every `$version` reference of the (unresolved) memory maps against the core's scheme and
 * version. Errors must block generation; warnings are surfaced only. The core version itself is
 * checked here when a reference needs it: resolution leaves refs of an invalid version at 0.
 */
export function checkVersionRefsForGeneration(
  ipCore: IpCoreData,
  maps: readonly NormalizedMemoryMap[]
): IpcraftIssue[] {
  const { scheme, version } = ipCoreVersionInfo(ipCore);
  const issues: IpcraftIssue[] = [];
  const push = (map: NormalizedMemoryMap, issue: VersionRefIssue) =>
    issues.push({
      code: issue.code,
      severity: issue.severity,
      source: 'references',
      path: [map.name, ...issue.path],
      message: `${describePath(map, issue.path)}: ${issue.message}`,
    });

  for (const map of maps) {
    const versionError = validateVersion(scheme, version);
    if (versionError !== null && blocksHaveVersionRef(map.addressBlocks)) {
      push(map, {
        severity: 'error',
        code: 'versionRef.invalidVersion',
        path: [],
        message: `vlnv.version '${version}' is not valid for version scheme ${scheme}: ${versionError}`,
      });
    }
    for (const issue of validateVersionRefs(
      map.addressBlocks,
      scheme,
      map.versionHistory ? { value: map.versionHistory, parseSnapshot } : undefined
    )) {
      push(map, issue);
    }
  }
  return issues;
}

/** Warning for a Vivado / Quartus target when the core version is not purely dotted-numeric. */
export function vendorVersionWarning(targetId: string, version: string): string | null {
  const tool = targetId === 'vivado' ? 'Vivado' : targetId === 'quartus' ? 'Quartus' : null;
  if (tool === null || version === '' || NUMERIC_VERSION.test(version)) {
    return null;
  }
  return `${tool} expects a numeric IP version; '${version}' may be rejected`;
}
