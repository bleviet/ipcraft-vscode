/**
 * Hand-written types for the system design diff (see
 * docs/concepts/brainstorm/system-design-diff.md): the change list between two
 * revisions of a {@link SystemGraph}. JSON-serializable only, because the
 * command line writes it as the JSON report.
 */

import type { SystemGraph } from './systemGraph';

export type ChangeStatus = 'added' | 'removed' | 'changed';

/** A value in one or both revisions; `base` absent = added, `current` absent = removed. */
export interface ValueChange {
  /** Parameter key as written, or the attribute name of an external port. */
  key: string;
  base?: string;
  current?: string;
}

export interface PinChange {
  pin: string;
  status: ChangeStatus;
  /** Pins on the same nets (on any level), sorted: `instanceName/pin` for an instance of the pin's level, `pin` for a boundary pin of it, otherwise absolute (`/path/to/instance/pin`, `/level/pin`; the root level is `/pin`); present when the pin exists in that revision. `basePeers` are written with the base's own names (a renamed block appears under its old name); for a pin or port that changed only in an attribute, both lists use the current names. */
  basePeers?: string[];
  currentPeers?: string[];
  /**
   * Declared attributes (direction, signalType, vlnv, interfaceType, width) and then
   * parameters that differ; present for external ports and for pins that exist on both
   * sides of a hierarchy, where a difference makes the pin `changed`.
   */
  attributes?: ValueChange[];
  /** The pin as seen from inside the hierarchy: its connections on the hierarchy's own level. */
  inside?: true;
}

export interface InstanceChange {
  /** Absolute instance path, e.g. `/dsp_pipeline/fir_0`. */
  path: string;
  /** Level that contains the instance. */
  level: string;
  /** `version`: only the version of the type differs. `renamed`: the same block under a new name (see `basePath`). */
  status: ChangeStatus | 'version' | 'renamed';
  /** `renamed`: the path of the block in the base revision; `path` is its path in the current one. */
  basePath?: string;
  /** Type as shown to the user in each revision; absent when the instance does not exist there. */
  baseType?: string;
  currentType?: string;
  parameters: ValueChange[];
  /**
   * `added` / `removed` instance: its connected pins (those with at least one peer),
   * as `added` (with `currentPeers`) or `removed` (with `basePeers`). Otherwise the pins
   * that moved; a pin is not listed when it only joined or left a net of pins that kept
   * their connections, or when its peers differ only by pins of added or removed blocks.
   * Sorted by pin name. A `renamed` block has no parameters and no pins.
   */
  pins: PinChange[];
}

/** An external port: a boundary pin of the root level. */
export interface PortChange extends PinChange {
  /** Always present; all declared attributes and parameters when the port is added or removed. */
  attributes: ValueChange[];
}

export interface SegmentValues {
  offset?: string;
  range?: string;
}

export interface SegmentChange {
  addressSpace: string;
  segment: string;
  status: ChangeStatus;
  base?: SegmentValues;
  current?: SegmentValues;
}

export interface SystemGraphDiffSide {
  name: string;
  format: SystemGraph['source']['format'];
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  version: number;
  renamed: number;
}

export interface SystemGraphDiff {
  base: SystemGraphDiffSide;
  current: SystemGraphDiffSide;
  /** The two revisions were read from different formats, which know different things. */
  formatsDiffer: boolean;
  /** Sorted by path. */
  instances: InstanceChange[];
  /** External ports, sorted by name. */
  ports: PortChange[];
  /** Sorted by address space, then segment. */
  segments: SegmentChange[];
  summary: DiffSummary;
}
