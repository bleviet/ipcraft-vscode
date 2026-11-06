/**
 * Declarative rules of the clock and reset analysis (issue #243): which IP pin
 * drives which frequency, which blocks forward a clock, which clock releases a
 * reset, and which reset inputs are asynchronous. Rules read only values the
 * script sets; a missing value means "unknown", never a vendor default. Every
 * rule carries the short provenance text the UI shows.
 */

import type { SystemInstance, SystemPin } from '../../../domain/systemGraph';
import { parseFrequency } from './frequency';

/** Port parameters that tie a root interface or reset port to its clock port (script data, not a name heuristic). */
export const PORT_FREQUENCY_PARAMETER = 'CONFIG.FREQ_HZ';
export const PORT_INTERFACES_PARAMETER = 'CONFIG.ASSOCIATED_BUSIF';
export const PORT_RESETS_PARAMETER = 'CONFIG.ASSOCIATED_RESET';

/** IP name of an instance: the VLNV name part, else the Platform Designer module kind, else the module reference. */
export function ipName(instance: SystemInstance): string | undefined {
  return instance.vlnv?.split(':')[2] ?? instance.component ?? instance.moduleRef;
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
  /** Instance pin of the clock that releases the reset; absent = asynchronous. */
  clockPin?: string;
  /** Instance parameter that must hold one of `values` for the release to be synchronous; else asynchronous. */
  synchronousWhen?: { parameter: string; values: readonly string[] };
  /** Provenance text. */
  from: string;
}

/** Which clock releases a reset output. */
export const RESET_SOURCE_RULES: readonly ResetSourceRule[] = [
  {
    ip: 'proc_sys_reset',
    pin: /^(?:peripheral_aresetn|interconnect_aresetn|peripheral_reset|bus_struct_reset|mb_reset)$/,
    clockPin: 'slowest_sync_clk',
    from: 'proc_sys_reset slowest_sync_clk',
  },
  { ip: 'processing_system7', pin: /^FCLK_RESET\d+_N$/, from: 'PS reset, asynchronous' },
  { ip: 'zynq_ultra_ps_e', pin: /^pl_resetn\d+$/, from: 'PS reset, asynchronous' },
  {
    ip: 'clock_source',
    pin: /^clk_reset$/,
    clockPin: 'clk',
    synchronousWhen: { parameter: 'resetSynchronousEdges', values: ['DEASSERT', 'BOTH'] },
    from: 'clock_source resetSynchronousEdges',
  },
];

/** How a reset output is released. */
export interface ResetRelease {
  /** Asserted and released asynchronously. */
  async: boolean;
  /** Instance pin of the clock that releases it; absent when asynchronous. */
  clockPin?: string;
  from: string;
}

/** Release of reset output `pinName` of `instance`; undefined without a rule. */
export function resetRelease(instance: SystemInstance, pinName: string): ResetRelease | undefined {
  const name = ipName(instance);
  const rule = RESET_SOURCE_RULES.find(
    (candidate) => candidate.ip === name && candidate.pin.test(pinName)
  );
  if (!rule) {
    return undefined;
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

export const ASYNC_RESET_SINKS: readonly { ip: string; pin: RegExp }[] = [
  { ip: 'proc_sys_reset', pin: /^(?:ext_reset_in|aux_reset_in)$/ },
  { ip: 'clock_source', pin: /^clk_in_reset$/ },
];

/** Whether reset input `pinName` of `instance` accepts an asynchronous reset. */
export function isAsyncResetSink(instance: SystemInstance, pinName: string): boolean {
  const name = ipName(instance);
  return ASYNC_RESET_SINKS.some((rule) => rule.ip === name && rule.pin.test(pinName));
}
