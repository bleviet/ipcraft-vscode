/**
 * Known pins of common AMD IPs: the one declarative table of IP pins that are
 * outputs, and the helpers that read it. Vivado `write_bd_tcl` scripts do not
 * record the direction of an IP pin, so the parser (to give such a pin its
 * direction) and the clock analysis (to find the driver of a clock or reset net)
 * both read this table. Pure and free of Node and vscode imports so the
 * extension and the webview can share it. Exact pin patterns only; no name
 * heuristics. Platform Designer pins are not listed: a `.qsys` or `qsys-script`
 * file declares every direction, so none is ever unknown there.
 */

import type { SystemInstance } from './systemGraph';

/** IP name of an instance: the VLNV name part, else the Platform Designer module kind, else the module reference. */
export function ipName(instance: SystemInstance): string | undefined {
  return instance.vlnv?.split(':')[2] ?? instance.component ?? instance.moduleRef;
}

/** A pin of an IP, named by the IP's name and a pin-name pattern. */
export interface PinRule {
  ip: string;
  pin: RegExp;
}

/** Whether any of `rules` names pin `pinName` of `instance`. */
export function matchesPinRule(
  rules: readonly PinRule[],
  instance: SystemInstance,
  pinName: string
): boolean {
  const name = ipName(instance);
  return rules.some((rule) => rule.ip === name && rule.pin.test(pinName));
}

/** Clock outputs: the end of a clock net that drives it. */
export const CLOCK_OUTPUT_PINS: readonly PinRule[] = [
  { ip: 'processing_system7', pin: /^FCLK_CLK\d+$/ },
  { ip: 'zynq_ultra_ps_e', pin: /^pl_clk\d+$/ },
  { ip: 'versal_cips', pin: /^pl\d+_ref_clk$/ },
  { ip: 'clk_wiz', pin: /^clk_out\d+$/ },
  { ip: 'clk_wizard', pin: /^clk_out\d+(?:_o\d+)?$/ },
];

/** Reset outputs of reset generators and of the processing systems. */
const RESET_OUTPUT_PINS: readonly PinRule[] = [
  {
    ip: 'proc_sys_reset',
    pin: /^(?:peripheral_aresetn|interconnect_aresetn|peripheral_reset|bus_struct_reset|mb_reset)$/,
  },
  { ip: 'processing_system7', pin: /^FCLK_RESET\d+_N$/ },
  { ip: 'zynq_ultra_ps_e', pin: /^pl_resetn\d+$/ },
  { ip: 'versal_cips', pin: /^pl\d+_resetn$/ },
];

/** Status outputs of clock IPs. */
export const STATUS_OUTPUT_PINS: readonly PinRule[] = [
  { ip: 'clk_wiz', pin: /^locked$/ },
  { ip: 'clk_wizard', pin: /^locked$/ },
];

/** Outputs of constants, logic and registers that drive resets. */
const LOGIC_OUTPUT_PINS: readonly PinRule[] = [
  { ip: 'xlconstant', pin: /^dout$/ },
  { ip: 'util_vector_logic', pin: /^Res$/ },
  { ip: 'util_reduced_logic', pin: /^Res$/ },
  { ip: 'axi_gpio', pin: /^gpio2?_io_o$/ },
];

/** Every IP pin known to be an output. */
export const KNOWN_OUTPUT_PINS: readonly PinRule[] = [
  ...CLOCK_OUTPUT_PINS,
  ...RESET_OUTPUT_PINS,
  ...STATUS_OUTPUT_PINS,
  ...LOGIC_OUTPUT_PINS,
];

/** Whether pin `pinName` of `instance` is a known output of its IP. */
export function knownOutput(instance: SystemInstance, pinName: string): boolean {
  return matchesPinRule(KNOWN_OUTPUT_PINS, instance, pinName);
}
