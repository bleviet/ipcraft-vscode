/**
 * Legacy SOPC Builder `_hw.tcl` support: `add_port_to_interface <iface> <port>
 * <role>` declares no direction or width, so ports are resolved from the HDL
 * file named by `set_source_file`, restricted to the `set_module` top module.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parseTclTokens } from './hwTclTokens';
import { extractVerilogInterface } from './VerilogParser';

export interface LegacyPort {
  direction: string;
  width: number | string | undefined;
}

export interface LegacyPortsResult {
  ports: Map<string, LegacyPort> | null;
  /** Set when `ports` is null: why the ports could not be resolved. */
  warning?: string;
}

/** True when the flattened content declares legacy `add_port_to_interface` ports. */
export function hasLegacyPortDeclarations(content: string): boolean {
  return /^\s*add_port_to_interface\b/m.test(content);
}

/**
 * Slices `source` to `module <name>` ... `endmodule`. Returns the whole source
 * when no name is given or the module is not found.
 */
export function sliceVerilogModule(source: string, moduleName?: string): string {
  if (!moduleName) {
    return source;
  }
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`\\bmodule\\s+${escaped}\\b`).exec(source);
  if (!start) {
    return source;
  }
  const end = /\bendmodule\b/.exec(source.slice(start.index));
  return end
    ? source.slice(start.index, start.index + end.index + end[0].length)
    : source.slice(start.index);
}

function commandArg(content: string, command: string): string | undefined {
  for (const raw of content.split('\n')) {
    const tokens = parseTclTokens(raw.trim());
    if (tokens[0] === command && tokens.length >= 2) {
      return tokens[1];
    }
  }
  return undefined;
}

/** Reads the port directions and widths of the HDL top module of a legacy `_hw.tcl`. */
export async function readLegacyPorts(content: string, tclDir: string): Promise<LegacyPortsResult> {
  const unresolved = (why: string): LegacyPortsResult => ({
    ports: null,
    warning: `Ports declared with add_port_to_interface could not be resolved: ${why}.`,
  });
  const sourceFile = commandArg(content, 'set_source_file');
  if (!sourceFile) {
    return unresolved('the file declares no set_source_file');
  }
  if (!/\.s?v$/i.test(sourceFile)) {
    return unresolved(`source file "${sourceFile}" is not Verilog or SystemVerilog`);
  }
  let source: string;
  try {
    source = await fs.readFile(path.resolve(tclDir, sourceFile), 'utf8');
  } catch {
    return unresolved(`source file "${sourceFile}" could not be read`);
  }
  const sliced = sliceVerilogModule(source, commandArg(content, 'set_module'));
  const ports = new Map<string, LegacyPort>();
  for (const p of extractVerilogInterface(sliced).ports) {
    ports.set(p.name, { direction: p.direction, width: p.width });
  }
  return { ports };
}
