/**
 * Known pins of common AMD IPs: the one declarative table of IP pins that are
 * outputs, and the helpers that read it. Vivado `write_bd_tcl` scripts do not
 * record the direction of an IP pin, so the parser (to give such a pin its
 * direction) and the clock analysis (to find the driver of a clock or reset net)
 * both read this table. Pure and free of Node and vscode imports so the
 * extension and the webview can share it. Exact pin patterns only; no name
 * heuristics. A rule applies to an AMD IP instance only (see {@link ipName}),
 * never to a module reference. Platform Designer pins are not listed: a `.qsys`
 * or `qsys-script` file declares every direction, so none is ever unknown there.
 */

import type { SystemInstance } from './systemGraph';

/** Vendor of the VLNV of the IPs the rules name. */
const AMD_VENDOR = 'xilinx.com';

/**
 * IP name that a rule can match: the VLNV name part of an AMD (`xilinx.com`) IP, else
 * the Platform Designer module kind. Undefined for a module reference (the user's own
 * RTL), a hierarchy, and an IP of another vendor, so no rule applies to them.
 */
export function ipName(instance: SystemInstance): string | undefined {
  if (instance.kind !== 'ip') {
    return undefined;
  }
  const [vendor, , name] = instance.vlnv?.split(':') ?? [];
  if (name === undefined) {
    return instance.component;
  }
  return vendor === AMD_VENDOR ? name : undefined;
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

/**
 * Reset outputs of reset generators and of the processing systems. Named, so that the
 * reset rules of the clock analysis build on these patterns and add what they know
 * about each (which clock releases it).
 */
export const RESET_OUTPUTS = {
  procSysReset: {
    ip: 'proc_sys_reset',
    pin: /^(?:peripheral_aresetn|interconnect_aresetn|peripheral_reset|bus_struct_reset|mb_reset)$/,
  },
  processingSystem7: { ip: 'processing_system7', pin: /^FCLK_RESET\d+_N$/ },
  zynqUltraPs: { ip: 'zynq_ultra_ps_e', pin: /^pl_resetn\d+$/ },
  versalCips: { ip: 'versal_cips', pin: /^pl\d+_resetn$/ },
} satisfies Record<string, PinRule>;

/** Status outputs of clock IPs. */
export const STATUS_OUTPUT_PINS: readonly PinRule[] = [
  { ip: 'clk_wiz', pin: /^locked$/ },
  { ip: 'clk_wizard', pin: /^locked$/ },
];

/** Outputs of constants, logic and registers that drive resets; named like {@link RESET_OUTPUTS}. */
export const LOGIC_OUTPUTS = {
  xlconstant: { ip: 'xlconstant', pin: /^dout$/ },
  utilVectorLogic: { ip: 'util_vector_logic', pin: /^Res$/ },
  utilReducedLogic: { ip: 'util_reduced_logic', pin: /^Res$/ },
  axiGpio: { ip: 'axi_gpio', pin: /^gpio2?_io_o$/ },
} satisfies Record<string, PinRule>;

/** Every IP pin known to be an output. */
export const KNOWN_OUTPUT_PINS: readonly PinRule[] = [
  ...CLOCK_OUTPUT_PINS,
  ...Object.values(RESET_OUTPUTS),
  ...STATUS_OUTPUT_PINS,
  ...Object.values(LOGIC_OUTPUTS),
];

/** Whether pin `pinName` of `instance` is a known output of its IP. */
export function knownOutput(instance: SystemInstance, pinName: string): boolean {
  return matchesPinRule(KNOWN_OUTPUT_PINS, instance, pinName);
}
