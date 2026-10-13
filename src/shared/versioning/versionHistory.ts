/**
 * Pure transforms and queries over a memory map's `versionHistory`: release state, adopting or
 * overwriting a version, and the stability check of the registers that hold `$version` refs.
 *
 * The latest version is the last entry of `versions` (list order) for every version scheme.
 */
import type { NormalizedAddressBlock } from '../../domain/internal.types';
import type { VersionEntry, VersionHistory } from './versionHistoryTypes';
import type { VersionRef } from './versionScheme';

export type { VersionEntry, VersionHistory } from './versionHistoryTypes';

export type ReleaseState =
  | { kind: 'empty' }
  | { kind: 'up-to-date' }
  | { kind: 'version-bump-only' }
  | { kind: 'pending'; reference: VersionEntry; currentHash: string; coreVersionRecorded: boolean };

export interface VersionRegisterField {
  name: string;
  offset: number;
  width: number;
  ref: VersionRef;
}

export interface VersionRegisterInfo {
  blockName: string;
  registerName: string;
  /** Block base address plus register offset. */
  address: number;
  fields: VersionRegisterField[];
  registerRef?: VersionRef;
}

export interface VersionRegisterChange {
  /** The earliest recorded version that uses the compared register set. */
  version: string;
  kind: 'address' | 'layout' | 'missing' | 'added';
  detail: string;
}

/**
 * Compares the current register set's hash with a reference entry: the entry recorded for
 * `coreVersion` when there is one (so regenerating an older release is not pending, and an
 * overwritten non-latest version settles), else the latest entry (a new core version whose
 * layout is unchanged is a `version-bump-only`).
 */
export function releaseState(
  history: VersionHistory | undefined,
  currentHash: string,
  coreVersion: string
): ReleaseState {
  const latest = history?.versions[history.versions.length - 1];
  if (!history || !latest) {
    return { kind: 'empty' };
  }
  const recorded = history.versions.find((entry) => entry.version === coreVersion);
  const reference = recorded ?? latest;
  if (currentHash === reference.registerSet) {
    return { kind: recorded ? 'up-to-date' : 'version-bump-only' };
  }
  return { kind: 'pending', reference, currentHash, coreVersionRecorded: recorded !== undefined };
}

/** Records `version` against `hash`; identical layouts share one stored snapshot. */
export function appendVersion(
  history: VersionHistory | undefined,
  version: string,
  hash: string,
  snapshot: unknown[]
): VersionHistory {
  const registerSets = history?.registerSets ?? {};
  const versions = history?.versions ?? [];
  if (versions.some((entry) => entry.version === version)) {
    throw new Error(`Version ${version} is already recorded in the version history.`);
  }
  return {
    registerSets:
      hash in registerSets
        ? { ...registerSets }
        : { ...registerSets, [hash]: { addressBlocks: snapshot } },
    versions: [...versions, { version, registerSet: hash }],
  };
}

/**
 * Re-points the entry recorded for `version` to `hash` and drops every register set no entry
 * references. A set that already exists keeps its stored snapshot: it may back other versions.
 */
export function overwriteVersion(
  history: VersionHistory,
  version: string,
  hash: string,
  snapshot: unknown[]
): VersionHistory {
  if (!history.versions.some((entry) => entry.version === version)) {
    throw new Error(`Cannot overwrite version ${version}: it is not recorded in the history.`);
  }
  const versions = history.versions.map((entry) =>
    entry.version === version ? { ...entry, registerSet: hash } : entry
  );
  const candidates =
    hash in history.registerSets
      ? history.registerSets
      : { ...history.registerSets, [hash]: { addressBlocks: snapshot } };
  const referenced = new Set(versions.map((entry) => entry.registerSet));
  const registerSets: VersionHistory['registerSets'] = {};
  for (const key of Object.keys(candidates)) {
    if (referenced.has(key)) {
      registerSets[key] = candidates[key];
    }
  }
  return { registerSets, versions };
}

/**
 * Registers that hold a `$version` ref, on the register or on one of its fields.
 * Register arrays are not descended into: a `$version` ref inside an array is a diagnostics
 * concern, not a version register.
 */
export function findVersionRegisters(blocks: NormalizedAddressBlock[]): VersionRegisterInfo[] {
  const found: VersionRegisterInfo[] = [];
  for (const block of blocks) {
    for (const register of block.registers) {
      if (register.__kind === 'array') {
        continue;
      }
      const fields = register.fields.flatMap((field) =>
        field.versionRef
          ? [{ name: field.name, offset: field.offset, width: field.width, ref: field.versionRef }]
          : []
      );
      if (!register.versionRef && fields.length === 0) {
        continue;
      }
      found.push({
        blockName: block.name,
        registerName: register.name,
        address: block.baseAddress + register.offset,
        fields,
        ...(register.versionRef ? { registerRef: register.versionRef } : {}),
      });
    }
  }
  return found;
}

function registerKey(info: VersionRegisterInfo): string {
  return `${info.blockName}.${info.registerName}`;
}

function describeLayoutDifference(
  recorded: VersionRegisterInfo,
  current: VersionRegisterInfo
): string[] {
  const differences: string[] = [];
  if (recorded.registerRef !== current.registerRef) {
    differences.push(
      `register reset ${recorded.registerRef ?? 'none'} -> ${current.registerRef ?? 'none'}`
    );
  }
  const currentFields = new Map(current.fields.map((field) => [field.name, field]));
  for (const field of recorded.fields) {
    const now = currentFields.get(field.name);
    if (!now) {
      differences.push(`field ${field.name} removed`);
    } else if (now.offset !== field.offset || now.width !== field.width || now.ref !== field.ref) {
      differences.push(
        `field ${field.name} offset ${field.offset} width ${field.width} ${field.ref} -> offset ${now.offset} width ${now.width} ${now.ref}`
      );
    }
    currentFields.delete(field.name);
  }
  for (const name of currentFields.keys()) {
    differences.push(`field ${name} added`);
  }
  return differences;
}

/**
 * Compares each recorded register set's version registers with the current ones. Registers are
 * matched by block and register name. `added` is not an error (a driver of that older version
 * cannot read the register) but is reported. `parseSnapshot` is injected so this module does not
 * depend on the domain parser.
 */
export function versionRegisterChanges(
  history: VersionHistory,
  current: NormalizedAddressBlock[],
  parseSnapshot: (blocks: unknown[]) => NormalizedAddressBlock[]
): VersionRegisterChange[] {
  const currentByKey = new Map(
    findVersionRegisters(current).map((info) => [registerKey(info), info])
  );
  const changes: VersionRegisterChange[] = [];
  const seen = new Set<string>();

  for (const entry of history.versions) {
    if (seen.has(entry.registerSet)) {
      continue;
    }
    seen.add(entry.registerSet);
    const snapshot = history.registerSets[entry.registerSet];
    if (!snapshot) {
      continue;
    }
    const recordedByKey = new Map(
      findVersionRegisters(parseSnapshot(snapshot.addressBlocks)).map((info) => [
        registerKey(info),
        info,
      ])
    );
    const report = (kind: VersionRegisterChange['kind'], detail: string): void => {
      changes.push({ version: entry.version, kind, detail });
    };

    for (const [key, recorded] of recordedByKey) {
      const now = currentByKey.get(key);
      if (!now) {
        report('missing', `Version register ${key} is not in the current register set`);
        continue;
      }
      if (now.address !== recorded.address) {
        report(
          'address',
          `Version register ${key} moved from 0x${recorded.address.toString(16)} to 0x${now.address.toString(16)}`
        );
      }
      const differences = describeLayoutDifference(recorded, now);
      if (differences.length > 0) {
        report('layout', `Version register ${key} layout changed: ${differences.join('; ')}`);
      }
    }
    for (const key of currentByKey.keys()) {
      if (!recordedByKey.has(key)) {
        report('added', `Version register ${key} did not exist in this version`);
      }
    }
  }
  return changes;
}
