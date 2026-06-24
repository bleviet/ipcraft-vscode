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
      const primaryIndex = mmIdx >= 0 ? mmIdx : 0;
      busPrefix = normalizePrefix(expandedBusInterfaces[primaryIndex].physicalPrefix ?? '');

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

        activePorts.forEach((port) => {
          port.tcl_width = toTclWidth(port.width, port.width_expr, parameterNames);
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
    };
  },
};
