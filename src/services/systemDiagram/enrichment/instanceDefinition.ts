/**
 * Pin lists of an instance's definition, derived from an `.ip.yml` or from the
 * ports of an HDL file. No vscode imports. It runs only extension-side:
 * `classifyClocksResets` lives in `VhdlParser.ts`, which imports `fs/promises`,
 * so this module is not for the webview.
 */

import type { PinDirection, SignalType, SystemPin } from '../../../domain/systemGraph';
import { arrayedBusNames } from '../../../shared/busInterfaceArray';
import type { IpCore } from '../../../domain/ipcore.types';
import { classifyClocksResets, type ParsedPort } from '../../../parser/VhdlParser';

export interface DefinitionPin {
  name: string;
  isInterface: boolean;
  direction: PinDirection;
  vlnv?: string;
  interfaceType?: string;
  signalType?: SignalType;
  width?: SystemPin['width'];
}

export interface InstanceDefinition {
  kind: 'ip.yml' | 'hdl';
  /** Absolute path. */
  file: string;
  /** `Uri.toString()` of the file. */
  uri: string;
  /** Workspace-relative path. */
  displayName: string;
  pins: DefinitionPin[];
}

function widthOf(width: number | string | undefined): SystemPin['width'] {
  return typeof width === 'number' && width > 1 ? { from: width - 1, to: 0 } : undefined;
}

function directionOf(direction: string | undefined, fallback: PinDirection): PinDirection {
  return direction === 'in' || direction === 'out' || direction === 'inout' ? direction : fallback;
}

function modeDirection(mode: string): PinDirection {
  if (mode === 'master' || mode === 'source') {
    return 'master';
  }
  return mode === 'slave' || mode === 'sink' ? 'slave' : 'unknown';
}

function scalar(
  port: { name: string; direction?: string; width?: number | string },
  signalType: SignalType | undefined,
  fallback: PinDirection
): DefinitionPin {
  const width = widthOf(port.width);
  return {
    name: port.name,
    isInterface: false,
    direction: directionOf(port.direction, fallback),
    ...(signalType !== undefined && { signalType }),
    ...(width !== undefined && { width }),
  };
}

export function definitionFromIpCore(
  ipCore: IpCore,
  file: string,
  uri: string,
  displayName: string
): InstanceDefinition {
  const pins: DefinitionPin[] = [];
  for (const bus of ipCore.busInterfaces ?? []) {
    // Only a vendor VLNV is a `vlnv`; IPCraft's own `ipcraft:busif:*` types are not.
    const isVendorVlnv = bus.type.split(':').length === 4 && !bus.type.startsWith('ipcraft:');
    const names = bus.array
      ? arrayedBusNames({ ...bus, array: bus.array }).map((arrayed) => arrayed.name)
      : [bus.name];
    for (const name of names) {
      pins.push({
        name,
        isInterface: true,
        direction: modeDirection(bus.mode.toLowerCase()),
        ...(isVendorVlnv ? { vlnv: bus.type } : { interfaceType: bus.type }),
      });
    }
  }
  for (const clock of ipCore.clocks ?? []) {
    pins.push(scalar(clock, 'clk', 'in'));
  }
  for (const reset of ipCore.resets ?? []) {
    pins.push(scalar(reset, 'rst', 'in'));
  }
  for (const interrupt of ipCore.interrupts ?? []) {
    pins.push(scalar(interrupt, 'intr', 'out'));
  }
  for (const port of ipCore.ports ?? []) {
    pins.push(scalar(port, undefined, 'in'));
  }
  return { kind: 'ip.yml', file, uri, displayName, pins };
}

export function definitionFromHdl(
  ports: ParsedPort[],
  file: string,
  uri: string,
  displayName: string
): InstanceDefinition {
  const { clocks, resets } = classifyClocksResets(ports);
  const clockNames = new Set(clocks.map((clock) => clock.name));
  const resetNames = new Set(resets.map((reset) => reset.name));
  const pins = ports.map((port): DefinitionPin => {
    let signalType: SignalType | undefined;
    if (clockNames.has(port.name)) {
      signalType = 'clk';
    } else if (resetNames.has(port.name)) {
      signalType = 'rst';
    }
    return scalar(port, signalType, 'unknown');
  });
  return { kind: 'hdl', file, uri, displayName, pins };
}
