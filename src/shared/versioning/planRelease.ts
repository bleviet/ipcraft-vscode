/**
 * Pure planner for the register-set release flow: given each memory map's history and current
 * register-set hash, decides what `versionHistory` to write for the IP core's version.
 *
 * Tracking is opt-in per map: a map is versioned when it has a `versionHistory` key or holds a
 * `$version` reference anywhere. Maps that are not versioned are never planned a write.
 */
import type { NormalizedMemoryMap } from '../../domain/internal.types';
import { blocksHaveVersionRef } from './validateVersionRefs';
import {
  appendVersion,
  overwriteVersion,
  releaseState,
  type ReleaseState,
  type VersionHistory,
} from './versionHistory';

export type ReleaseDecision = 'adopt' | 'overwrite';

export interface MapReleaseInput {
  mapName: string;
  history: VersionHistory | undefined;
  currentHash: string;
  /** The map's `addressBlocks` as parsed from the YAML (raw, tokens symbolic). */
  snapshot: unknown[];
  versioned: boolean;
}

export interface MapReleasePlan {
  mapName: string;
  /** Undefined for a map that is not versioned. */
  state: ReleaseState | undefined;
  /** Undefined = nothing to write. */
  nextHistory?: VersionHistory;
}

type PendingState = Extract<ReleaseState, { kind: 'pending' }>;

export function isVersionedMap(map: NormalizedMemoryMap): boolean {
  return map.versionHistory !== undefined || blocksHaveVersionRef(map.addressBlocks);
}

/** The release state of each input against `coreVersion`; undefined for maps not versioned. */
export function releaseStates(
  inputs: readonly MapReleaseInput[],
  coreVersion: string
): Array<ReleaseState | undefined> {
  return inputs.map((input) =>
    input.versioned ? releaseState(input.history, input.currentHash, coreVersion) : undefined
  );
}

/** The versioned maps whose register layout changed since the version they are compared against. */
export function pendingMaps(
  inputs: readonly MapReleaseInput[],
  coreVersion: string
): Array<{ mapName: string; state: PendingState }> {
  const states = releaseStates(inputs, coreVersion);
  return inputs.flatMap((input, index) => {
    const state = states[index];
    return state?.kind === 'pending' ? [{ mapName: input.mapName, state }] : [];
  });
}

/** True when a versioned map needs the user's adopt/overwrite decision. */
export function needsDecision(inputs: readonly MapReleaseInput[], coreVersion: string): boolean {
  return pendingMaps(inputs, coreVersion).length > 0;
}

function planMap(
  input: MapReleaseInput,
  state: ReleaseState,
  coreVersion: string,
  decision: ReleaseDecision | undefined
): VersionHistory | undefined {
  const { history, currentHash, snapshot } = input;
  switch (state.kind) {
    case 'up-to-date':
      return undefined;
    case 'empty':
    case 'version-bump-only':
      return appendVersion(history, coreVersion, currentHash, snapshot);
    case 'pending': {
      if (decision === undefined) {
        throw new Error(`Map ${input.mapName} needs an adopt or overwrite decision.`);
      }
      if (decision === 'adopt') {
        // appendVersion throws when coreVersion is already recorded: the caller must have
        // obtained a new version first.
        return appendVersion(history, coreVersion, currentHash, snapshot);
      }
      if (!state.coreVersionRecorded) {
        throw new Error(
          `Map ${input.mapName}: cannot overwrite version ${coreVersion}, it is not recorded.`
        );
      }
      return overwriteVersion(history as VersionHistory, coreVersion, currentHash, snapshot);
    }
  }
}

/** One plan per input, in input order. Inputs are not mutated. */
export function planRelease(
  inputs: readonly MapReleaseInput[],
  coreVersion: string,
  decision?: ReleaseDecision
): MapReleasePlan[] {
  const states = releaseStates(inputs, coreVersion);
  return inputs.map((input, index) => {
    const state = states[index];
    if (!state) {
      return { mapName: input.mapName, state };
    }
    const nextHistory = planMap(input, state, coreVersion, decision);
    return { mapName: input.mapName, state, ...(nextHistory ? { nextHistory } : {}) };
  });
}
