/**
 * Hand-written types for the system design diff (see
 * docs/concepts/brainstorm/system-design-diff.md): the change list between two
 * revisions of a {@link SystemGraph}. JSON-serializable only, because the
 * command line writes it as the JSON report.
 */

import type { SystemGraph, SystemInstance, SystemNet, SystemPin } from './systemGraph';

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
   * `changed` pins and ports: the peers only the current revision has (written as `currentPeers`)
   * and only the base has (written as `basePeers`, with the base's own names), sorted, omitted when
   * empty. Decided by peer identity: a renamed block is the same peer, so it is neither.
   */
  gained?: string[];
  lost?: string[];
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
  /**
   * `version`: only the version of the type differs. `renamed`: the same block under a new name
   * (see `basePath`). `moved`: the same block, with the same name, under another parent level.
   */
  status: ChangeStatus | 'version' | 'renamed' | 'moved';
  /** `renamed`, `moved`: the path of the block in the base revision; `path` is its path in the current one. */
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
   * Sorted by pin name. A `renamed` block has no parameters and no pins; a `moved` block has no
   * parameters, and its pins are those whose connections changed with the move.
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
  /** Set by the caller, only when the side was read under another path (the file was renamed). */
  path?: string;
  /** Set by the caller when the file did not exist on this side: the side is an empty design. */
  missing?: true;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  version: number;
  renamed: number;
  moved: number;
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

/** A pin that no net touches on its level: `undriven` is a sink, `unused` a source or a pin without a role. */
export interface UnconnectedFinding {
  kind: 'undriven' | 'unused';
  /** Level that holds the pin. */
  level: string;
  /** Instance path; null for a boundary pin of `level`. */
  instance: string | null;
  pin: string;
  /** `instanceName/pin` (the last segment of the instance path) for an instance pin, the pin name for a boundary pin. */
  label: string;
}

/** A data connection or a reset that goes to a sink in another clock domain, without a known synchronizer. */
export interface CrossingFinding {
  kind: 'dataCrossing' | 'resetCrossing';
  /** Level the crossing belongs to. */
  level: string;
  /** Labels of the two ends: `instanceName/pin`, or the port name of a root external port. */
  from: string;
  to: string;
  /** Instance path of each end; null for an external port or a reset whose source is not known. */
  fromInstance: string | null;
  toInstance: string | null;
  /** Labels of the clock domains of the ends; absent when the end's clock is not known. */
  fromClock?: string;
  toClock?: string;
  /** The analysis's explanation of the crossing. */
  reason: string;
}

export type Finding = UnconnectedFinding | CrossingFinding;

/**
 * The findings that differ between two revisions, each list sorted by kind (undriven, unused,
 * data crossing, reset crossing), then level, then label.
 */
export interface FindingsDiff {
  /** Findings only the current revision has. */
  new: Finding[];
  /** Findings only the base has, written with the current names of renamed blocks. */
  resolved: Finding[];
}

/**
 * What only the base has, to draw as ghosts next to the current graph (see `unionAdditions`):
 * the layout of a comparison is made from the current graph plus these.
 */
export interface UnionAdditions {
  /** Blocks only the base has, as the base wrote them, on a level the current graph has. */
  instances: SystemInstance[];
  /** Pins only the base has, on blocks the current graph has: the ends of the wires of `nets`. */
  pins: { instance: string; pin: SystemPin }[];
  /** External ports only the base has: `level` is always the root (`/`). */
  boundaryPins: { level: string; pin: SystemPin }[];
  /** Connections only the base has, one net per base net. */
  nets: SystemNet[];
}
