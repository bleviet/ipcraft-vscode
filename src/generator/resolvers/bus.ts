import type { ContextResolver, ResolverInput } from './types';
import {
  expandBusInterfaces,
  checkDuplicatePhysicalPrefixes,
  getActiveBusPortsFromDefinition,
  projectResolvedBusPorts,
  resolveStringWidth,
  buildParameterizedPortTypes,
} from '../registerProcessor';
import { needsBitReverse, needsLaneSwap } from './endiannessPolicy';
import type { BusInterfaceDef, ProjectedBusPort } from '../types';
import { parse, serialize, widthExprUsesMathReal } from '../../shared/widthExprAst';
import { buildInterruptPorts } from './interrupts';
import { busSupportsMemoryMap } from '../../shared/busVlnv';
import { BYTE_LANE_WIDTH, resolveBusInterface, resolveDataLane } from '../../shared/busContracts';
import type { BusInterface, Parameter } from '../../domain/ipcore.types';
import { buildBoundaryTransforms } from './boundaryTransforms';

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
  /** 'lane' reverses fixed-width lanes; 'bit' reverses individual qualifier bits. */
  swap_kind?: 'lane' | 'bit';
  lane_width?: number | string;
  lane_kind?: 'byte' | 'symbol';
}

/** Snake-case conversion is deliberately confined to the template boundary. */
function toTemplateBusPort(port: ProjectedBusPort): TemplatePort {
  const numericWidth = typeof port.width === 'number' ? port.width : Number(port.width ?? 1);
  return {
    logical_name: port.canonicalName,
    name: port.name,
    interface_role: port.interfaceRole,
    ...(port.effectivePolarity ? { effective_polarity: port.effectivePolarity } : {}),
    physical_suffix: port.physicalSuffix,
    direction: port.direction,
    sv_direction: port.svDirection,
    width: port.width,
    width_expr: port.widthExpr,
    is_parameterized: port.isParameterized,
    default_width: port.isParameterized ? numericWidth - 1 : null,
    type: port.type,
    sv_type: port.svType,
    tcl_width: port.tclWidth,
    endianness: port.endianness,
    needs_swap: port.needsSwap,
    ...(port.role ? { role: port.role } : {}),
    ...(port.swapKind ? { swap_kind: port.swapKind } : {}),
    ...(port.laneWidth !== undefined ? { lane_width: port.laneWidth } : {}),
    ...(port.laneKind ? { lane_kind: port.laneKind } : {}),
    needs_polarity_inversion: port.needsPolarityInversion,
  };
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
        // The concrete width is unknown until elaboration. Always emit the generic
        // reflow for a directional big-endian port; the HDL asserts byte alignment.
        needs_swap: needsLaneSwap(endianness, numericDefault, BYTE_LANE_WIDTH, direction, true),
        swap_kind: 'lane' as const,
        lane_width: BYTE_LANE_WIDTH,
        lane_kind: 'byte' as const,
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
      needs_swap: needsLaneSwap(endianness, width, BYTE_LANE_WIDTH, direction),
      swap_kind: 'lane' as const,
      lane_width: BYTE_LANE_WIDTH,
      lane_kind: 'byte' as const,
    };
  });
}

export const busResolver: ContextResolver = {
  name: 'bus',

  resolve(input: ResolverInput): Record<string, unknown> {
    const { ipCore, busLibrary } = input;
    const prefixError = checkDuplicatePhysicalPrefixes(ipCore, busLibrary);
    if (prefixError) {
      throw new Error(prefixError);
    }

    const expandedBusInterfaces = expandBusInterfaces(ipCore);
    const parameterNames = (ipCore?.parameters ?? []).map((p) => String(p.name));
    const parameterDefaults = Object.fromEntries(
      (ipCore?.parameters ?? []).flatMap((parameter) =>
        parameter.name && typeof parameter.value === 'number'
          ? [[String(parameter.name), parameter.value]]
          : []
      )
    );

    const busPorts: Array<Record<string, unknown>> = [];
    const secondaryBusPorts: Array<Record<string, unknown>> = [];
    const secondaryBusInterfaces: Array<Record<string, unknown>> = [];
    const projectedBusPorts: ProjectedBusPort[] = [];
    const explicitConduitPorts: TemplatePort[] = [];
    let busPrefix = 's_axi';
    let primaryMemoryMappedIndex = -1;

    const elaboratePortWidths: Array<{
      iface_name: string;
      port_name: string;
      logical_name: string;
      interface_role: string;
      direction: string;
      tcl_width: string;
    }> = [];

    if (expandedBusInterfaces.length > 0) {
      primaryMemoryMappedIndex = expandedBusInterfaces.findIndex((iface) =>
        busSupportsMemoryMap(getString(iface.type), getString(iface.mode), busLibrary)
      );
      // Preserve the public template-context convention: the memory-mapped slave is
      // primary when present, otherwise the first interface is primary. Top/core
      // templates decide whether that primary interface goes through a bus wrapper.
      const primaryIndex = primaryMemoryMappedIndex >= 0 ? primaryMemoryMappedIndex : 0;
      busPrefix = normalizePrefix(expandedBusInterfaces[primaryIndex].physicalPrefix ?? '');

      expandedBusInterfaces.forEach((iface, index) => {
        const contractResolution = resolveBusInterface({
          busInterface: iface as unknown as BusInterface,
          busIndex: index,
          parameters: (ipCore.parameters ?? []) as unknown as Parameter[],
          library: busLibrary,
        });
        const interfaceProperties = Object.keys(
          contractResolution.match?.contract.interfaceProperties ?? {}
        )
          .sort()
          .flatMap((name) => {
            const property = contractResolution.properties[name];
            if (property?.value === undefined) {
              return [];
            }
            return [
              {
                name,
                value: property.value,
                tcl_value:
                  typeof property.value === 'boolean'
                    ? property.value
                      ? 'true'
                      : 'false'
                    : String(property.value),
              },
            ];
          });
        (iface as BusInterfaceDef & Record<string, unknown>).interface_properties =
          interfaceProperties;
        const contract = contractResolution.match?.contract;
        const isConsumer = contract
          ? contractResolution.normalizedMode === contract.modePolicy.consumer
          : iface.mode === 'slave' || iface.mode === 'sink' || iface.mode === 'conduit';
        (iface as BusInterfaceDef & Record<string, unknown>).normalized_mode =
          contractResolution.normalizedMode ?? iface.mode;
        (iface as BusInterfaceDef & Record<string, unknown>).is_consumer = isConsumer;
        (iface as BusInterfaceDef & Record<string, unknown>).altera_end_type =
          contract?.interfaceKind === 'conduit' || isConsumer ? 'end' : 'start';
        const conduitPorts = iface.conduitPorts as
          | Array<{
              name: string;
              width?: number | string;
              direction?: string;
              presence?: string;
              role?: 'data' | 'byteQualifier';
            }>
          | undefined;
        const ifaceEndianness = iface.endianness === 'big' ? 'big' : 'little';
        const dataLane = resolveDataLane(contractResolution, iface);
        let activePorts: (TemplatePort & Record<string, unknown>)[];
        if (conduitPorts && conduitPorts.length > 0) {
          activePorts = getActiveBusPortsFromDefinition(
            conduitPorts,
            iface.useOptionalPorts ?? [],
            iface.physicalPrefix ?? '',
            iface.mode ?? '',
            iface.portWidthOverrides ?? {},
            ipCore?.parameters as
              | { name: string; value?: number | string; data_type?: string }[]
              | undefined,
            iface.portNameOverrides,
            iface.absentPorts
          ).map((port) => ({
            ...port,
            interface_role: port.logical_name,
            physical_suffix: String(port.name).slice(String(iface.physicalPrefix ?? '').length),
            tcl_width: toTclWidth(
              port.width as number | string | null,
              port.width_expr as string | null,
              parameterNames
            ),
            needs_polarity_inversion: false,
          })) as unknown as (TemplatePort & Record<string, unknown>)[];
          for (const port of activePorts) {
            if (port.role === 'data') {
              port.endianness = ifaceEndianness;
              port.needs_swap = needsLaneSwap(
                ifaceEndianness,
                port.width,
                dataLane.width,
                port.direction,
                port.is_parameterized
              );
              port.swap_kind = 'lane';
              port.lane_width = dataLane.width;
              port.lane_kind = dataLane.kind;
            } else if (port.role === 'byteQualifier') {
              port.endianness = ifaceEndianness;
              port.needs_swap = needsBitReverse(
                ifaceEndianness,
                port.width,
                port.direction,
                port.is_parameterized
              );
              port.swap_kind = 'bit';
              port.lane_width = 1;
              port.lane_kind = dataLane.kind;
            } else {
              port.needs_swap = false;
            }
          }
          explicitConduitPorts.push(...activePorts);
        } else {
          const projectedPorts = projectResolvedBusPorts(
            contractResolution.activePorts,
            iface.physicalPrefix ?? '',
            parameterDefaults,
            {
              endianness: ifaceEndianness,
              laneWidth: dataLane.width,
              laneKind: dataLane.kind,
            }
          );
          projectedBusPorts.push(...projectedPorts);
          activePorts = projectedPorts.map(toTemplateBusPort);
        }
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
              interface_role: String(port.interface_role ?? port.logical_name ?? port.name),
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
          interface_role: port.name as string,
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

    const interruptPorts = buildInterruptPorts(
      ipCore,
      busLibrary,
      expandedBusInterfaces,
      primaryMemoryMappedIndex
    );
    const allTemplatePorts = [...busPorts, ...secondaryBusPorts, ...userPorts];
    const reservedNames = new Set(
      [
        ...allTemplatePorts.map((port) => port.name),
        ...interruptPorts.map((port) => port.name),
        ...(ipCore.clocks ?? []).map((clock) => clock.name ?? ''),
        ...(ipCore.resets ?? []).map((reset) => reset.name ?? ''),
        ...parameterNames,
        (ipCore.clocks ?? []).length === 0 ? 'clk' : '',
        (ipCore.resets ?? []).length === 0 ? 'rst' : '',
      ]
        .filter(Boolean)
        .map((name) => String(name).toLowerCase())
    );
    const projectedLegacySwapPorts: ProjectedBusPort[] = [...explicitConduitPorts, ...userPorts]
      .filter((port) => port.needs_swap === true && port.direction !== 'inout')
      .map((port) => ({
        canonicalName: String(port.name),
        name: String(port.name),
        interfaceRole: String(port.name),
        physicalSuffix: String(port.name),
        direction: port.direction as 'in' | 'out',
        svDirection: port.sv_direction as 'input' | 'output',
        type: String(port.type),
        svType: String(port.sv_type),
        width: port.width as number | string | null,
        widthExpr: port.width_expr as string | null,
        isParameterized: port.is_parameterized === true,
        tclWidth: String(port.tcl_width),
        endianness: port.endianness as 'little' | 'big',
        needsSwap: true,
        swapKind: (port.swap_kind as 'lane' | 'bit' | undefined) ?? 'lane',
        laneWidth: (port.lane_width as number | string | undefined) ?? BYTE_LANE_WIDTH,
        laneKind: (port.lane_kind as 'byte' | 'symbol' | undefined) ?? 'byte',
        needsPolarityInversion: false,
      }));
    const boundaryTransforms = buildBoundaryTransforms(
      [...projectedBusPorts, ...projectedLegacySwapPorts],
      reservedNames
    );
    const transformsByName = new Map(boundaryTransforms.ports.map((port) => [port.name, port]));
    for (const port of allTemplatePorts) {
      const transform = transformsByName.get(String(port.name));
      if (transform) {
        port.internal_name = transform.internalName;
      }
    }

    const boundaryTransformPorts = boundaryTransforms.ports.map((port) => ({
      name: port.name,
      internal_name: port.internalName,
      direction: port.direction,
      type: port.type,
      sv_type: port.svType,
      width: port.width,
      width_expr: port.widthExpr,
      is_parameterized: port.isParameterized,
      invert: port.invert,
      ...(port.swapKind ? { swap_kind: port.swapKind } : {}),
      ...(port.laneWidth !== undefined ? { lane_width: port.laneWidth } : {}),
      ...(port.laneKind ? { lane_kind: port.laneKind } : {}),
    }));
    const swappablePorts = boundaryTransforms.ports.filter((port) => port.swapKind !== undefined);
    // Only fixed-width byte swaps use a swap_bytes_<width>() function; bit reversals and
    // parameterized byte swaps are emitted inline as generate loops.
    const endianSwapWidths = [
      ...new Set(
        swappablePorts
          .filter(
            (port) =>
              port.swapKind === 'lane' && port.laneKind === 'byte' && port.isParameterized !== true
          )
          .map((port) => port.width as number)
      ),
    ].sort((a, b) => a - b);
    const endianSwapPorts = swappablePorts.map((port) => ({
      name: port.name,
      internal_name: port.internalName,
      type: port.type,
      sv_type: port.svType,
      direction: port.direction,
      width: port.width,
      is_parameterized: port.isParameterized,
      swap_kind: port.swapKind,
      lane_width: port.laneWidth ?? BYTE_LANE_WIDTH,
    }));

    return {
      bus_prefix: expandedBusInterfaces.length > 0 ? busPrefix : 's_axi',
      bus_ports: busPorts,
      secondary_bus_ports: secondaryBusPorts,
      secondary_bus_interfaces: secondaryBusInterfaces,
      expanded_bus_interfaces: expandedBusInterfaces,
      elaborate_port_widths: elaboratePortWidths,
      user_ports: userPorts,
      interrupt_ports: interruptPorts,
      uses_math_real: usesMathReal,
      endian_swap_ports: endianSwapPorts,
      endian_swap_widths: endianSwapWidths,
      has_endian_swap: endianSwapPorts.length > 0,
      boundary_transform_ports: boundaryTransformPorts,
      has_boundary_transform: boundaryTransformPorts.length > 0,
    };
  },
};
