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
  /** Source pin name, or `instanceName/pin` when two domains share a pin name. */
  name: string;
  /** `instanceName/pin`, or the port name for a root external port. */
  label: string;
  sourceLevel: string;
  sourceRef: PinRef;
  /** Net at the source's level that holds the source pin. */
  sourceNetId: string;
  hz?: number;
  frequencyFrom?: FrequencyOrigin;
  /** Line of the source instance or port, for "requested by ... at file:line". */
  line?: number;
  /** Every net of the domain, in graph order. */
  netIds: string[];
  /** Pins on the domain other than its source. */
  loads: number;
  /** Number of hierarchy levels the domain's nets span. */
  levels: number;
  color: string;
}

/** A reset output and the clock (if any) that releases it. */
export interface ResetSource {
  id: string;
  index: number;
  /** `instanceName/pin`, or the port name for a root external port. */
  label: string;
  source: PinEnd;
  /** Net at the source's level that holds the source pin. */
  netId: string;
  /** Asserted and released asynchronously. */
  async: boolean;
  /** The domain that releases it; absent when asynchronous or unknown. */
  domain?: ClockDomain;
  /** Provenance text of the rule; absent when no rule knows this source. */
  from?: string;
  /** Line of the net that holds the source pin. */
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
/** `cross`: needs a synchronizer; `inside`: a block spans domains (listed, not flagged); `unchecked`: a clock is unknown; `ok`. */
export type CrossingStatus = 'cross' | 'inside' | 'unchecked' | 'ok';

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
  /** How the end's clock or release is known: `ip.yml`, `single clock`, a rule text, ... */
  knownFrom?: string;
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
  /** The driver, or the reset source. */
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
