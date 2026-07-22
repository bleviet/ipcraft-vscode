import type { ContextResolver, ResolverInput } from './types';
import {
  expandBusInterfaces,
  checkDuplicatePhysicalPrefixes,
  getActiveBusPortsFromDefinition,
  normalizeBusType,
  resolveStringWidth,
  buildParameterizedPortTypes,
} from '../registerProcessor';
import type { BusInterfaceDef, BusPortDefinition } from '../types';
import { parse, serialize, widthExprUsesMathReal } from '../../shared/widthExprAst';

function getString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && 'value' in value) {
    return String((value as Record<string, unknown>).value);
  }
  return String(value);
}

function normalizePrefix(prefix: string): string {
  if (!prefix) {
    return 's_axi';
  }
  return prefix.endsWith('_') ? prefix.slice(0, -1) : prefix;
}

function toTclWidthExpression(exprStr: string, paramNames: string[]): string {
  const ast = parse(exprStr);
  if (!ast) {
    return exprStr;
  }
  const upperParamNames = paramNames.map((p) => p.toUpperCase());
  let hasParam = false;
  const converted = serialize(ast, 'tcl', {
    paramRef: (name) => {
      const upper = name.toUpperCase();
      if (upperParamNames.includes(upper)) {
        hasParam = true;
        return `[get_parameter_value ${upper}]`;
      }
      return name;
    },
  }).code;
  if (!hasParam) {
    return exprStr;
  }
  const isSimpleRef = /^\[get_parameter_value [a-zA-Z0-9_]+\]$/.test(converted.trim());
  return isSimpleRef ? converted : `[expr ${converted}]`;
}

function toTclWidth(
  width: number | string | null,
  widthExpr: string | null,
  paramNames: string[]
): string {
  if (widthExpr) {
    return toTclWidthExpression(widthExpr, paramNames);
  }
  if (typeof width === 'string') {
    return toTclWidthExpression(width, paramNames);
  }
  return String(width ?? 1);
}

interface TemplatePort extends Record<string, unknown> {
  name: string;
  direction: string;
  width: number | string | null;
  width_expr: string | null;
  is_parameterized: boolean;
  tcl_width?: string;
  logical_name?: string;
  role?: string;
  needs_swap?: boolean;
  /** 'byte' reverses byte lanes (data payload); 'bit' reverses individual bits, one per
   *  byte lane (WSTRB/TKEEP/byteenable), so the mask stays aligned with the swapped bytes. */
  swap_kind?: 'byte' | 'bit';
}

/** A data payload is byte-swappable only when it is a fixed vector of whole bytes. */
function needsByteSwap(
  endianness: string | undefined,
  width: number | string | null,
  direction: string
): boolean {
  return (
    endianness === 'big' &&
    typeof width === 'number' &&
    width > 1 &&
    width % 8 === 0 &&
    (direction === 'in' || direction === 'out')
  );
}

/** A per-byte qualifier (one bit per data byte lane) is reversed whenever its data is
 *  swapped. Any multi-bit vector is reversible; a 1-bit mask reversal is a no-op, so skip it. */
function needsBitReverse(
  endianness: string | undefined,
  width: number | string | null,
  direction: string
): boolean {
  return (
    endianness === 'big' &&
    typeof width === 'number' &&
    width > 1 &&
    (direction === 'in' || direction === 'out')
  );
}

function resolvePortsForInterface(
  libraryKey: string,
  ifaceType: string,
  busDefinitions: ResolverInput['busDefinitions']
): BusPortDefinition[] {
  const knownPorts = libraryKey ? busDefinitions[libraryKey]?.ports : undefined;
  if (knownPorts) {
    return knownPorts;
  }
  for (const def of Object.values(busDefinitions)) {
    const bt = (def as { busType?: Record<string, string> }).busType;
    if (!bt?.vendor || !bt.library || !bt.name || !bt.version) {
      continue;
    }
    if (`${bt.vendor}:${bt.library}:${bt.name}:${bt.version}` === ifaceType) {
      return def.ports ?? [];
    }
  }
  return [];
}

/** Compute user ports (custom `ports:` entries) with HDL type strings and TCL widths. */
export function buildUserPorts(
  ipCore: ResolverInput['ipCore'],
  paramNames: string[]
): Array<Record<string, unknown>> {
  const params = ipCore?.parameters ?? [];
  const paramDefaults = new Map<string, number>();
  params.forEach((param) => {
    if (param?.name && param?.value !== undefined) {
      paramDefaults.set(String(param.name), Number(param.value));
    }
  });

  const ports = ipCore?.ports ?? [];
  return ports.map((port) => {
    const direction = getString(port.direction).toLowerCase();
    const svDirection = direction === 'in' ? 'input' : direction === 'out' ? 'output' : 'inout';
    const widthValue = port.width ?? 1;
    const endianness = port.endianness === 'big' ? 'big' : 'little';

    // A string width may be a parameter reference, an arithmetic expression, or
    // a predefined function call. A constant expression folds to a literal.
    const resolved =
      typeof widthValue === 'string'
        ? resolveStringWidth(widthValue, paramDefaults)
        : { numeric: Number(widthValue), expr: null };

    if (resolved.expr !== null) {
      const numericDefault = resolved.numeric || 32;
      const types = buildParameterizedPortTypes(resolved.expr);
      return {
        name: String(port.name),
        direction,
        sv_direction: svDirection,
        type: types.type,
        sv_type: types.sv_type,
        width: numericDefault,
        width_expr: resolved.expr,
        is_parameterized: true,
        default_width: numericDefault - 1,
        tcl_width: toTclWidth(numericDefault, resolved.expr, paramNames),
        endianness,
        // The concrete width is unknown until elaboration, so gate on the default and
        // let the top level emit a width-generic byte-reversal generate loop.
        needs_swap: needsByteSwap(endianness, numericDefault, direction),
        swap_kind: 'byte' as const,
      };
    }

    const width = resolved.numeric;
    return {
      name: String(port.name),
      direction,
      sv_direction: svDirection,
      type: width === 1 ? 'std_logic' : `std_logic_vector(${width - 1} downto 0)`,
      sv_type: width === 1 ? 'logic' : `logic [${width - 1}:0]`,
      width,
      width_expr: null,
      is_parameterized: false,
      default_width: null,
      tcl_width: toTclWidth(width, null, paramNames),
      endianness,
      needs_swap: needsByteSwap(endianness, width, direction),
      swap_kind: 'byte' as const,
    };
  });
}

export function buildInterruptPorts(
  ipCore: ResolverInput['ipCore']
): Array<Record<string, unknown>> {
  const interrupts = (ipCore as Record<string, unknown>)?.interrupts as
    | Array<Record<string, unknown>>
    | undefined;
  if (!interrupts || interrupts.length === 0) {
    return [];
  }
  return interrupts.map((intr) => ({
    name: String(intr.name ?? ''),
    direction: String(intr.direction ?? 'out').toLowerCase(),
    sensitivity: String(intr.sensitivity ?? 'LEVEL_HIGH'),
  }));
}

export const busResolver: ContextResolver = {
  name: 'bus',

  resolve(input: ResolverInput): Record<string, unknown> {
    const { ipCore, busDefinitions, registry } = input;
    const prefixError = checkDuplicatePhysicalPrefixes(ipCore);
    if (prefixError) {
      throw new Error(prefixError);
    }

    const expandedBusInterfaces = expandBusInterfaces(ipCore);
    const parameterNames = (ipCore?.parameters ?? []).map((p) => String(p.name));

    const busPorts: Array<Record<string, unknown>> = [];
    const secondaryBusPorts: Array<Record<string, unknown>> = [];
    const secondaryBusInterfaces: Array<Record<string, unknown>> = [];
    let busPrefix = 's_axi';

    const elaboratePortWidths: Array<{
      iface_name: string;
      port_name: string;
      logical_name: string;
      direction: string;
      tcl_width: string;
    }> = [];

    if (expandedBusInterfaces.length > 0) {
      const mmIdx = expandedBusInterfaces.findIndex(
        (iface) =>
          (iface.mode ?? '').toLowerCase() === 'slave' &&
          registry.isMemoryMapped(normalizeBusType(getString(iface.type)).templateType)
      );
      // The "primary" interface is the memory-mapped slave wired to the generated bus
      // wrapper. With no memory-mapped slave there is no wrapper, so every interface is
      // secondary (wired straight to the core) — primaryIndex = -1 matches nothing below.
      const primaryIndex = mmIdx;
      if (primaryIndex >= 0) {
        busPrefix = normalizePrefix(expandedBusInterfaces[primaryIndex].physicalPrefix ?? '');
      }

      expandedBusInterfaces.forEach((iface, index) => {
        const busTypeInfo = normalizeBusType(getString(iface.type));
        const conduitPorts = iface.conduitPorts as
          | Array<{ name: string; width?: number | string; direction?: string; presence?: string }>
          | undefined;
        const busPortDefs =
          conduitPorts && conduitPorts.length > 0
            ? conduitPorts
            : resolvePortsForInterface(
                busTypeInfo.libraryKey,
                getString(iface.type),
                busDefinitions
              );

        const activePorts = getActiveBusPortsFromDefinition(
          busPortDefs,
          iface.useOptionalPorts ?? [],
          iface.physicalPrefix ?? '',
          iface.mode ?? '',
          iface.portWidthOverrides ?? {},
          ipCore?.parameters as
            | { name: string; value?: number | string; data_type?: string }[]
            | undefined,
          iface.portNameOverrides,
          iface.absentPorts
        ) as unknown as (TemplatePort & Record<string, unknown>)[];

        const ifaceEndianness = iface.endianness === 'big' ? 'big' : 'little';
        activePorts.forEach((port) => {
          port.tcl_width = toTclWidth(port.width, port.width_expr, parameterNames);
          if (port.role === 'data') {
            // Data payload: reverse whole byte lanes.
            port.endianness = ifaceEndianness;
            port.needs_swap = needsByteSwap(ifaceEndianness, port.width, port.direction);
            port.swap_kind = 'byte';
          } else if (port.role === 'byteQualifier') {
            // Per-byte mask (WSTRB/TKEEP/byteenable): reverse bits so each mask bit stays
            // aligned with the byte lane it gates after the data byte swap.
            port.endianness = ifaceEndianness;
            port.needs_swap = needsBitReverse(ifaceEndianness, port.width, port.direction);
            port.swap_kind = 'bit';
          }
        });
        (iface as BusInterfaceDef & Record<string, unknown>).ports = activePorts;

        if (index === primaryIndex) {
          busPorts.push(...activePorts);
        } else {
          secondaryBusPorts.push(...activePorts);
          secondaryBusInterfaces.push({
            name: iface.name ?? '',
            mode: iface.mode ?? '',
            ports: activePorts,
          });
        }
      });
    }

    for (const iface of expandedBusInterfaces) {
      const ifaceName = String((iface as Record<string, unknown>).name ?? '');
      const ifacePorts = (iface as Record<string, unknown>).ports as TemplatePort[] | undefined;
      if (ifacePorts) {
        for (const port of ifacePorts) {
          if (port.is_parameterized && port.tcl_width) {
            elaboratePortWidths.push({
              iface_name: ifaceName,
              port_name: port.name,
              logical_name: String(port.logical_name ?? port.name),
              direction: port.direction,
              tcl_width: port.tcl_width,
            });
          }
        }
      }
    }

    const userPorts = buildUserPorts(ipCore, parameterNames);
    for (const port of userPorts) {
      if (port.is_parameterized && port.tcl_width) {
        elaboratePortWidths.push({
          iface_name: port.name as string,
          port_name: port.name as string,
          logical_name: port.name as string,
          direction: port.direction as string,
          tcl_width: port.tcl_width as string,
        });
      }
    }

    // A parameterized width using a VHDL math_real function (clog2/log2/ceil/
    // floor) requires `use ieee.math_real.all;` in the entity context clause.
    const usesMathReal = [...busPorts, ...secondaryBusPorts, ...userPorts].some(
      (port) =>
        port.is_parameterized === true &&
        typeof port.width_expr === 'string' &&
        widthExprUsesMathReal(port.width_expr)
    );

    // Big-endian ports need an intermediate `_be` signal at the top level. Fixed-width
    // data payloads go through the package's per-width swap_bytes_<width>() function (one
    // per distinct width, not a single unconstrained function, to keep generated HDL simple
    // and toolchain-portable); parameterized data and all byte-qualifier masks use a
    // width-generic reflow loop at the top level (see package.vhdl.j2/pkg.sv.j2, top.*.j2).
    const endianSwapPorts = [...busPorts, ...secondaryBusPorts, ...userPorts]
      .filter((port) => port.needs_swap === true)
      .map((port) => ({
        name: port.name,
        type: port.type,
        sv_type: port.sv_type,
        direction: port.direction,
        width: port.width,
        is_parameterized: port.is_parameterized,
        swap_kind: port.swap_kind ?? 'byte',
      }));
    // Only fixed-width byte swaps use a swap_bytes_<width>() function; bit reversals and
    // parameterized byte swaps are emitted inline as generate loops.
    const endianSwapWidths = [
      ...new Set(
        endianSwapPorts
          .filter((port) => port.swap_kind === 'byte' && port.is_parameterized !== true)
          .map((port) => port.width as number)
      ),
    ].sort((a, b) => a - b);

    return {
      bus_prefix: expandedBusInterfaces.length > 0 ? busPrefix : 's_axi',
      bus_ports: busPorts,
      secondary_bus_ports: secondaryBusPorts,
      secondary_bus_interfaces: secondaryBusInterfaces,
      expanded_bus_interfaces: expandedBusInterfaces,
      elaborate_port_widths: elaboratePortWidths,
      user_ports: userPorts,
      interrupt_ports: buildInterruptPorts(ipCore),
      uses_math_real: usesMathReal,
      endian_swap_ports: endianSwapPorts,
      endian_swap_widths: endianSwapWidths,
      has_endian_swap: endianSwapPorts.length > 0,
    };
  },
};
