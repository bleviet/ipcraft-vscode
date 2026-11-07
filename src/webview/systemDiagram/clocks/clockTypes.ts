/** Result types of the clock and reset analysis (issue #243). Plain data, JSON-friendly except for shared object identity. */

import type { NetCategory, PinRef } from '../../../domain/systemGraph';
import type { PinEnd } from './physicalNets';

/** Where a frequency was read from. */
export interface FrequencyOrigin {
  /** Parameter key as written, e.g. `CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ`. */
  parameter: string;
  /** Parameter value as written. */
  value: string;
  /** `parameter = value`. */
  text: string;
  /** `script`: a parameter of an IP instance; `declared`: a property of an external port or hierarchy pin. */
  kind: 'script' | 'declared';
  /** Name of the instance, port or hierarchy pin that holds the parameter. */
  owner: string;
  /** Level whose file `line` refers to. */
  level: string;
  line?: number;
}

/** A clock source and every clock pin its nets reach, followed through hierarchy pins and clock-forwarding blocks. */
export interface ClockDomain {
  id: string;
  /** Creation order: the script order of the source nets. */
  index: number;
  /** Source pin name, or `instanceName/pin` when two domains share a pin name; the first net's name when the source is not known. */
  name: string;
  /** `instanceName/pin`, or the port name for a root external port; the first net's name when the source is not known. */
  label: string;
  /** Level of the source pin, or of the first net when the source is not known. */
  sourceLevel: string;
  /** The pin that drives the domain; absent when the script does not say which pin of the net drives it. */
  sourceRef?: PinRef;
  /** Net at the source's level that holds the source pin; the first net of the domain when the source is not known. */
  sourceNetId: string;
  /** The clock enters the design through a root input port: its source, or one of its pins when the source is not known. */
  portClock: boolean;
  hz?: number;
  frequencyFrom?: FrequencyOrigin;
  /** Line of the source instance or port, for "requested by ... at file:line". */
  line?: number;
  /** Every net of the domain, in graph order. */
  netIds: string[];
  /** Pins on the domain other than its source; every pin on it when the source is not known. */
  loads: number;
  /** Number of hierarchy levels the domain's nets span. */
  levels: number;
  color: string;
}

/** A reset net and the clock (if any) that releases it. */
export interface ResetSource {
  id: string;
  index: number;
  /** `instanceName/pin`, or the port name for a root external port; the first net's name when the source is not known. */
  label: string;
  /** The pin that drives the reset; absent when no rule or declared direction names one, and then every pin of the net is a sink. */
  source?: PinEnd;
  /** Level of the source pin, or of the first net when the source is not known. */
  level: string;
  /** Net at the source's level that holds the source pin; the first net of the reset when the source is not known. */
  netId: string;
  /** Asserted and released asynchronously. */
  async: boolean;
  /** Tied to a constant: it never toggles, so no clock releases it. */
  constant?: true;
  /** The domain that releases it; absent when asynchronous, constant or unknown. */
  domain?: ClockDomain;
  /** Provenance text of the rule; absent when no rule knows this source. */
  from?: string;
  /** Line of the net that holds the source pin, or of the first net. */
  line: number;
  netIds: string[];
  sinks: PinEnd[];
}

export type ClockKnownFrom =
  | 'ip.yml'
  | 'definition'
  | 'single clock'
  | 'all clocks one domain'
  | 'CONFIG.ASSOCIATED_BUSIF'
  | 'CONFIG.ASSOCIATED_RESET';

/** The clock of an interface or reset pin. */
export interface PinClock {
  /** Clock pin of the same block (or external clock port); absent when only the domain is known. */
  clockPin?: string;
  /** Absent when the clock pin is not connected. */
  domain?: ClockDomain;
  knownFrom: ClockKnownFrom;
}

/** A clock pin's expected frequency (from the definition) against the domain it sits on. */
export interface ExpectedFrequency {
  /** As written in the definition, e.g. `100MHz`. */
  expected: string;
  expectedHz?: number;
  domain?: ClockDomain;
  status: 'match' | 'mismatch' | 'unknown';
}

export type CrossingKind = 'data' | 'reset' | 'block';
/**
 * `cross`: needs a synchronizer; `related`: the clocks come from one generator, Vivado times the paths;
 * `inside`: a block spans domains (listed, not flagged); `unchecked`: a clock or its relation is not known; `ok`.
 */
export type CrossingStatus = 'cross' | 'related' | 'inside' | 'unchecked' | 'ok';

/** One end of a data or reset crossing. */
export interface CrossingEnd extends PinEnd {
  /** `instanceName/pin`, or the port name for a root external port. */
  label: string;
  /** Diagram node: the instance path, or the boundary id of an external port. */
  nodeId: string;
  /** Clock pin of the same block (or external clock port) the end is clocked by, when known. */
  clockPin?: string;
  domain?: ClockDomain;
  /** Reset source released asynchronously, or reset input that accepts an asynchronous reset. */
  async?: boolean;
  /** Reset source tied to a constant. */
  constant?: true;
  /** How the end's clock or release is known: `ip.yml`, `single clock`, a rule text, ... */
  knownFrom?: string;
  /**
   * Stands for a reset net whose source pin is not known: `label` is the net's name, `instance` is
   * null, `nodeId` is empty, and no pin of the design matches it.
   */
  sourceUnknown?: true;
}

interface CrossingBase {
  /** Stable across re-analysis of an unchanged design. */
  id: string;
  status: CrossingStatus;
  /** Level the crossing belongs to: the level of `netId` (a data crossing is owned by its shallowest net, a reset crossing by its sink), or of the block. */
  level: string;
  /** Member nets of the physical net (data, reset); empty for a block. */
  netIds: string[];
  reason: string;
}

/** A data connection (CDC) or a reset to a sink (RDC) between two ends. */
export interface PinCrossing extends CrossingBase {
  kind: 'data' | 'reset';
  /** The driver, or the reset source (a stand-in for the net when the source is not known). */
  from: CrossingEnd;
  /** The load, or the reset sink. */
  to: CrossingEnd;
  /** Data: the shallowest member net of the physical net, the driver's own net on a tie. Reset: the net that holds the sink. */
  netId: string;
  /** Data: the interface category of the connection. */
  category?: NetCategory;
}

/** A leaf block whose clock inputs span two or more domains. */
export interface BlockCrossing extends CrossingBase {
  kind: 'block';
  status: 'inside';
  instance: string;
  domains: ClockDomain[];
}

export type Crossing = PinCrossing | BlockCrossing;
