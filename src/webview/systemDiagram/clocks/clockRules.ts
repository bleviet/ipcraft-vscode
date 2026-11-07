/**
 * Declarative rules of the clock and reset analysis (issue #243): which IP pin
 * drives a clock, which drives which frequency, which blocks forward or generate
 * a clock, which pins are no clocks, which clock releases a reset, and which
 * reset inputs are asynchronous. Which IP pins are outputs at all is the shared
 * table in `domain/knownIpPins`. Rules read only values the script sets; a
 * missing value means "not set", never a vendor default. Every rule carries the
 * short provenance text the UI shows.
 */

import {
  CLOCK_OUTPUT_PINS,
  STATUS_OUTPUT_PINS,
  ipName,
  matchesPinRule,
  type PinRule,
} from '../../../domain/knownIpPins';
import type { SystemInstance, SystemPin } from '../../../domain/systemGraph';
import { parseFrequency } from './frequency';

/** Port parameters that tie a root interface or reset port to its clock port (script data, not a name heuristic). */
export const PORT_FREQUENCY_PARAMETER = 'CONFIG.FREQ_HZ';
export const PORT_INTERFACES_PARAMETER = 'CONFIG.ASSOCIATED_BUSIF';
export const PORT_RESETS_PARAMETER = 'CONFIG.ASSOCIATED_RESET';

/**
 * Platform Designer clock outputs. Their directions are always declared, so they are
 * not in the known-output table of `knownIpPins`; the clock analysis still reads
 * them as clock outputs.
 */
const PLATFORM_DESIGNER_CLOCK_OUTPUTS: readonly PinRule[] = [
  { ip: 'clock_source', pin: /^clk$/ },
  { ip: 'altera_clock_bridge', pin: /^out_clk$/ },
];

/**
 * Whether `pinName` of `instance` is a clock output pin: the end of a clock net that
 * drives it. The script does not list the driver first, so these rules (and declared
 * directions) decide it. The Vivado outputs come from the known-output table.
 */
export function isClockOutput(instance: SystemInstance, pinName: string): boolean {
  return (
    matchesPinRule(CLOCK_OUTPUT_PINS, instance, pinName) ||
    matchesPinRule(PLATFORM_DESIGNER_CLOCK_OUTPUTS, instance, pinName)
  );
}

/**
 * Status pins of clock IPs: the status outputs, and `dcm_locked` that takes one. A
 * net on them may be named like a clock but is not one, so it is no clock domain.
 */
export const NOT_CLOCK_PINS: readonly PinRule[] = [
  ...STATUS_OUTPUT_PINS,
  { ip: 'proc_sys_reset', pin: /^dcm_locked$/ },
];

/** Whether `pinName` of `instance` carries a status, not a clock. */
export function isNotClockPin(instance: SystemInstance, pinName: string): boolean {
  return matchesPinRule(NOT_CLOCK_PINS, instance, pinName);
}

export interface ClockGenerator {
  ip: string;
  /** Input pins that take the clock the generator derives its outputs from; its outputs are in `CLOCK_OUTPUT_PINS`. */
  input: RegExp;
}

/**
 * Blocks that generate clocks from a clock. Vivado times the paths between the
 * outputs of one generator, and between its input clock and its outputs.
 */
export const CLOCK_GENERATORS: readonly ClockGenerator[] = [
  { ip: 'clk_wiz', input: /^clk_in\d+(?:_[pnd])?$/ },
  { ip: 'clk_wizard', input: /^clk_in\d+(?:_[pnd])?$/ },
];

/** The generator rule of `instance`; undefined for any other block. */
export function generatorOf(instance: SystemInstance): ClockGenerator | undefined {
  const name = ipName(instance);
  return CLOCK_GENERATORS.find((rule) => rule.ip === name);
}

export interface ClockSourceRule {
  ip: string;
  pin: RegExp;
  /** Instance parameter holding the frequency; `$1` stands for the first group of `pin`. */
  parameter: string;
  unit: 'Hz' | 'MHz';
}

/** Frequency of a clock output pin of an IP. */
export const CLOCK_SOURCE_RULES: readonly ClockSourceRule[] = [
  {
    ip: 'processing_system7',
    pin: /^FCLK_CLK(\d+)$/,
    parameter: 'CONFIG.PCW_FPGA$1_PERIPHERAL_FREQMHZ',
    unit: 'MHz',
  },
  {
    ip: 'zynq_ultra_ps_e',
    pin: /^pl_clk(\d+)$/,
    parameter: 'CONFIG.PSU__CRL_APB__PL$1_REF_CTRL__FREQMHZ',
    unit: 'MHz',
  },
  {
    ip: 'clk_wiz',
    pin: /^clk_out(\d+)$/,
    parameter: 'CONFIG.CLKOUT$1_REQUESTED_OUT_FREQ',
    unit: 'MHz',
  },
  { ip: 'clock_source', pin: /^clk$/, parameter: 'clockFrequency', unit: 'Hz' },
];

/** A frequency a rule read from the script. */
export interface RuleFrequency {
  hz: number;
  /** Parameter key as written. */
  parameter: string;
  /** Parameter value as written. */
  value: string;
}

/** Frequency of output pin `pinName` of `instance`; undefined without a rule or without the parameter in the script. */
export function sourceFrequency(
  instance: SystemInstance,
  pinName: string
): RuleFrequency | undefined {
  const name = ipName(instance);
  for (const rule of CLOCK_SOURCE_RULES) {
    if (rule.ip !== name || !rule.pin.test(pinName)) {
      continue;
    }
    const parameter = pinName.replace(rule.pin, rule.parameter);
    const value = instance.parameters[parameter];
    const hz = value === undefined ? undefined : parseFrequency(`${value}${rule.unit}`);
    if (value !== undefined && hz !== undefined) {
      return { hz, parameter, value };
    }
  }
  return undefined;
}

/** Frequency declared on a boundary pin (root external port or hierarchy pin). */
export function boundaryFrequency(pin: SystemPin): RuleFrequency | undefined {
  const value = pin.parameters[PORT_FREQUENCY_PARAMETER];
  const hz = value === undefined ? undefined : parseFrequency(value);
  return value !== undefined && hz !== undefined
    ? { hz, parameter: PORT_FREQUENCY_PARAMETER, value }
    : undefined;
}

export interface ClockPassThrough {
  ip: string;
  input: string;
  output: string;
}

/** IP pins that forward a clock unchanged: the output joins the input's domain. */
export const CLOCK_PASS_THROUGH: readonly ClockPassThrough[] = [
  { ip: 'clock_source', input: 'clk_in', output: 'clk' },
];

export function passThroughOf(instance: SystemInstance): ClockPassThrough | undefined {
  const name = ipName(instance);
  return CLOCK_PASS_THROUGH.find((rule) => rule.ip === name);
}

export interface ResetSourceRule {
  ip: string;
  pin: RegExp;
  /** Instance pin of the clock that releases the reset; absent = asynchronous, unless `driver` says otherwise. */
  clockPin?: string;
  /** Instance parameter that must hold one of `values` for the release to be synchronous; else asynchronous. */
  synchronousWhen?: { parameter: string; values: readonly string[] };
  /**
   * An output that is no reset generator. `constant`: it is tied to a constant and never
   * toggles, so it needs no release clock. `logic`: it is the output of logic or a register
   * that is known to drive the net, but no rule says which clock releases it.
   */
  driver?: 'constant' | 'logic';
  /** Provenance text. */
  from: string;
}

/** Which clock releases a reset output, and the outputs of constants and logic that drive resets. */
export const RESET_SOURCE_RULES: readonly ResetSourceRule[] = [
  {
    ip: 'proc_sys_reset',
    pin: /^(?:peripheral_aresetn|interconnect_aresetn|peripheral_reset|bus_struct_reset|mb_reset)$/,
    clockPin: 'slowest_sync_clk',
    from: 'proc_sys_reset slowest_sync_clk',
  },
  { ip: 'processing_system7', pin: /^FCLK_RESET\d+_N$/, from: 'PS reset, asynchronous' },
  { ip: 'zynq_ultra_ps_e', pin: /^pl_resetn\d+$/, from: 'PS reset, asynchronous' },
  { ip: 'versal_cips', pin: /^pl\d+_resetn$/, from: 'PS reset, asynchronous' },
  {
    ip: 'clock_source',
    pin: /^clk_reset$/,
    clockPin: 'clk',
    synchronousWhen: { parameter: 'resetSynchronousEdges', values: ['DEASSERT', 'BOTH'] },
    from: 'clock_source resetSynchronousEdges',
  },
  { ip: 'xlconstant', pin: /^dout$/, driver: 'constant', from: 'xlconstant, tied to a constant' },
  {
    ip: 'util_vector_logic',
    pin: /^Res$/,
    driver: 'logic',
    from: 'util_vector_logic, logic output',
  },
  {
    ip: 'util_reduced_logic',
    pin: /^Res$/,
    driver: 'logic',
    from: 'util_reduced_logic, logic output',
  },
  { ip: 'axi_gpio', pin: /^gpio2?_io_o$/, driver: 'logic', from: 'axi_gpio, GPIO output' },
];

/** How a reset output is released. */
export interface ResetRelease {
  /** Asserted and released asynchronously. */
  async: boolean;
  /** Instance pin of the clock that releases it; absent when asynchronous or unknown. */
  clockPin?: string;
  /** Tied to a constant: it never toggles, so no clock releases it. */
  constant?: true;
  from: string;
}

/** Release of reset output `pinName` of `instance`; undefined without a rule. Neither asynchronous nor tied to a clock for a `driver` rule. */
export function resetRelease(instance: SystemInstance, pinName: string): ResetRelease | undefined {
  const name = ipName(instance);
  const rule = RESET_SOURCE_RULES.find(
    (candidate) => candidate.ip === name && candidate.pin.test(pinName)
  );
  if (!rule) {
    return undefined;
  }
  if (rule.driver !== undefined) {
    return {
      async: false,
      ...(rule.driver === 'constant' && { constant: true as const }),
      from: rule.from,
    };
  }
  const condition = rule.synchronousWhen;
  const value = condition ? instance.parameters[condition.parameter] : undefined;
  const from = condition
    ? `${rule.from} ${value === undefined ? 'not set' : `= ${value}`}`
    : rule.from;
  const synchronous =
    rule.clockPin !== undefined &&
    (condition === undefined || (value !== undefined && condition.values.includes(value)));
  return synchronous ? { async: false, clockPin: rule.clockPin, from } : { async: true, from };
}

export const ASYNC_RESET_SINKS: readonly PinRule[] = [
  { ip: 'proc_sys_reset', pin: /^(?:ext_reset_in|aux_reset_in)$/ },
  { ip: 'clk_wiz', pin: /^(?:reset|resetn)$/ },
  { ip: 'clk_wizard', pin: /^(?:reset|resetn)$/ },
  { ip: 'clock_source', pin: /^clk_in_reset$/ },
];

/** Whether reset input `pinName` of `instance` accepts an asynchronous reset. */
export function isAsyncResetSink(instance: SystemInstance, pinName: string): boolean {
  return matchesPinRule(ASYNC_RESET_SINKS, instance, pinName);
}
