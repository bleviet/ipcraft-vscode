/**
 * Turns an IP core and its imported `.mm.yml` files into planner inputs, and a plan back into
 * path edits. Shared by the VS Code release service and the CLI policy; does no file IO and has
 * no `vscode` dependency.
 */
import * as yaml from 'js-yaml';
import { normalizeMemoryMap } from '../../domain/parse';
import { normalizeIpCoreData } from '../../generator/registerProcessor';
import { ipCoreVersionInfo } from '../../generator/versionContext';
import { hashRegisterSet } from '../../shared/versioning/registerSetHash';
import {
  isVersionedMap,
  type MapReleaseInput,
  type MapReleasePlan,
  type ReleaseDecision,
} from '../../shared/versioning/planRelease';
import { validateVersion, type VersionScheme } from '../../shared/versioning/versionScheme';
import type { PathEdit } from '../../yamledit';
import { resolveMemoryMapImportPath, selectImportedMaps } from '../imports/resolveMemoryMapImports';

export interface ImportedMapFile {
  absPath: string;
  /**
   * The array entry's keys other than `import`, merged over the first map of its file like
   * generation does. Undefined for the `memoryMaps: { import }` shortcut, which loads every map.
   */
  entryOverrides?: Record<string, unknown>;
}

export interface CoreReleaseInfo {
  scheme: VersionScheme;
  version: string;
  imports: ImportedMapFile[];
}

export interface MapRelease {
  /** YAML path of the map object inside its file. */
  path: (string | number)[];
  input: MapReleaseInput;
}

type Raw = Record<string, unknown>;

function loadObject(text: string): Raw | undefined {
  try {
    const data = yaml.load(text);
    return data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Raw)
      : undefined;
  } catch {
    return undefined;
  }
}

function importPath(entry: unknown): string | undefined {
  const field = entry !== null && typeof entry === 'object' ? (entry as Raw).import : undefined;
  return typeof field === 'string' ? field : undefined;
}

/**
 * The version, scheme and imported `.mm.yml` files of an IP core. Inline maps are not listed:
 * their schema cannot hold a `versionHistory`. Undefined when the text is not a YAML mapping.
 */
export function readCoreReleaseInfo(ipText: string, baseDir: string): CoreReleaseInfo | undefined {
  const raw = loadObject(ipText);
  if (!raw) {
    return undefined;
  }
  const { scheme, version } = ipCoreVersionInfo(normalizeIpCoreData(raw));
  const memoryMaps = raw.memoryMaps;
  const imports: ImportedMapFile[] = [];
  const seen = new Set<string>();
  const add = (field: string | undefined, entryOverrides?: Raw): void => {
    if (field === undefined) {
      return;
    }
    const absPath = resolveMemoryMapImportPath(baseDir, field);
    if (!seen.has(absPath)) {
      seen.add(absPath);
      imports.push({ absPath, ...(entryOverrides ? { entryOverrides } : {}) });
    }
  };
  if (Array.isArray(memoryMaps)) {
    memoryMaps.forEach((entry: unknown) => {
      const field = importPath(entry);
      if (field !== undefined) {
        const { import: _import, ...entryOverrides } = entry as Raw;
        add(field, entryOverrides);
      }
    });
  } else {
    add(importPath(memoryMaps));
  }
  return { scheme, version, imports };
}

/**
 * Planner inputs for the maps generation loads from one `.mm.yml` text (see
 * `selectImportedMaps`); `mapName` is the name generation uses, after entry overrides. Throws
 * when the text is not valid YAML.
 */
export function buildMapReleases(
  mmText: string,
  entryOverrides?: Record<string, unknown>
): MapRelease[] {
  return selectImportedMaps(yaml.load(mmText), entryOverrides).map(({ path: mapPath, raw }) => {
    const map = normalizeMemoryMap(raw);
    return {
      path: mapPath,
      input: {
        mapName: map.name,
        history: map.versionHistory,
        currentHash: hashRegisterSet(map.addressBlocks),
        snapshot: Array.isArray(raw.addressBlocks) ? (raw.addressBlocks as unknown[]) : [],
        versioned: isVersionedMap(map),
      },
    };
  });
}

/** The reason `version` cannot be recorded under `scheme`, or undefined when it can. */
export function invalidCoreVersionMessage(
  scheme: VersionScheme,
  version: string
): string | undefined {
  const error = validateVersion(scheme, version);
  return error === null
    ? undefined
    : `vlnv.version '${version}' is not valid for version scheme ${scheme}: ${error}`;
}

/** One `versionHistory` edit per planned write; `plans` is aligned with `releases`. */
export function historyEdits(
  releases: readonly MapRelease[],
  plans: readonly MapReleasePlan[]
): PathEdit[] {
  return releases.flatMap((release, index) => {
    const nextHistory = plans[index]?.nextHistory;
    return nextHistory ? [{ path: [...release.path, 'versionHistory'], value: nextHistory }] : [];
  });
}

/** One line per map that was written, for logs and messages; empty when nothing was written. */
export function describeRecorded(
  plan: MapReleasePlan,
  coreVersion: string,
  decision: ReleaseDecision | undefined
): string[] {
  const { state, nextHistory, mapName } = plan;
  if (!state || !nextHistory) {
    return [];
  }
  if (state.kind === 'pending' && decision === 'overwrite') {
    return [`${mapName}: overwrote version ${coreVersion}`];
  }
  return [`${mapName}: recorded version ${coreVersion}`];
}
