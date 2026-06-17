import * as fs from 'fs/promises';
import * as path from 'path';
import type { BusInterfaceDef, BusTypeInfo, IpCoreData } from './types';
import { resolveMemoryMapImports } from '../services/imports/resolveMemoryMapImports';
import { normalizeIpCore, normalizeMemoryMap } from '../domain/parse';
import type { NormalizedMemoryMap, NormalizedRegister } from '../domain/internal.types';
import { BUS_REGISTRY } from './buses/builtin';

import { evalWidthExpr } from '../shared/evalWidthExpr';
export { evalWidthExpr };

function getString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return String((value as Record<string, unknown>).value);
  }
  return String(value);
}

const SW_WRITE_ACCESSES = new Set([
  'read-write',
  'write-only',
  'rw',
  'wo',
  'read-write-1-to-clear',
  'write-1-to-clear',
  'read-write-self-clearing',
  'write-self-clearing',
]);
const HW_READ_ONLY_ACCESSES = new Set(['read-only', 'ro']);
const SW_READ_ACCESSES = new Set([
  'read-write',
  'rw',
  'read-only',
  'ro',
  'read-write-1-to-clear',
  'read-write-self-clearing',
]);

function deriveRegisterAccess(fieldAccesses: string[]): string {
  if (fieldAccesses.length === 0) {
    return 'read-write';
  }
  if (fieldAccesses.every((a) => HW_READ_ONLY_ACCESSES.has(a))) {
    return 'read-only';
  }
  // Preserve SC type when all fields share the same SC access so the VHDL
  // template can distinguish SC-only registers from plain write-only ones.
  if (fieldAccesses.every((a) => a === 'write-self-clearing')) {
    return 'write-self-clearing';
  }
  if (fieldAccesses.every((a) => a === 'read-write-self-clearing')) {
    return 'read-write-self-clearing';
  }
  const hasSwWrite = fieldAccesses.some((a) => SW_WRITE_ACCESSES.has(a));
  const hasSwRead = fieldAccesses.some((a) => SW_READ_ACCESSES.has(a));
  if (hasSwWrite && hasSwRead) {
    return 'read-write';
  }
  if (hasSwWrite) {
    return 'write-only';
  }
  return 'read-only';
}

export function normalizeIpCoreData(raw: Record<string, unknown>): IpCoreData {
  return normalizeIpCore(raw) as unknown as IpCoreData;
}

export function normalizeBusType(typeName: string): BusTypeInfo {
  return BUS_REGISTRY.normalize(typeName);
}

export function getBusTypeForTemplate(ipCore: IpCoreData): string {
  let firstSlave: string | undefined;
  for (const bus of ipCore.busInterfaces ?? []) {
    if ((bus.mode ?? '').toLowerCase() === 'slave') {
      const templateType = normalizeBusType(getString(bus.type)).templateType;
      firstSlave ??= templateType;
      if (BUS_REGISTRY.isMemoryMapped(templateType)) {
        return templateType;
      }
    }
  }
  return firstSlave ?? 'axil';
}

export function hasMemoryMappedSlaveInterface(ipCore: IpCoreData): boolean {
  for (const bus of ipCore.busInterfaces ?? []) {
    if ((bus.mode ?? '').toLowerCase() === 'slave') {
      const templateType = normalizeBusType(getString(bus.type)).templateType;
      if (BUS_REGISTRY.isMemoryMapped(templateType)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether any two expanded bus interfaces share the same physicalPrefix,
 * which would produce duplicate port names in generated HDL.
 * Returns a descriptive error string on collision, or null when all prefixes are unique.
 */
export function checkDuplicatePhysicalPrefixes(ipCore: IpCoreData): string | null {
  const expanded = expandBusInterfaces(ipCore);
  const seen = new Map<string, string>(); // prefix → first interface name
  const duplicates: string[] = [];

  for (const iface of expanded) {
    const prefix = iface.physicalPrefix ?? '';
    if (!prefix) {
      continue;
    }
    if (seen.has(prefix)) {
      duplicates.push(`'${prefix}' (shared by '${seen.get(prefix)}' and '${iface.name ?? ''}')`);
    } else {
      seen.set(prefix, iface.name ?? '');
    }
  }

  if (duplicates.length > 0) {
    return (
      `Duplicate physicalPrefix values would produce conflicting port names: ` +
      duplicates.join(', ')
    );
  }
  return null;
}

export function expandBusInterfaces(ipCore: IpCoreData): BusInterfaceDef[] {
  const busInterfaces = ipCore.busInterfaces ?? [];
  const expanded: BusInterfaceDef[] = [];

  for (const iface of busInterfaces) {
    const arrayDef = iface.array;
    if (arrayDef) {
      const count = Number(arrayDef.count ?? 1);
      const start = Number(arrayDef.indexStart ?? 0);
      for (let i = 0; i < count; i += 1) {
        const idx = start + i;
        const namePattern = arrayDef.namingPattern ?? `${String(iface.name)}_{index}`;
        const prefixPattern =
          arrayDef.physicalPrefixPattern ?? `${String(iface.physicalPrefix ?? 's_axi_')}{index}_`;
        expanded.push({
          name: String(namePattern).replace('{index}', String(idx)),
          type: getString(iface.type),
          busTypeVlnv: iface.busTypeVlnv,
          rawPortMaps: iface.rawPortMaps,
          mode: getString(iface.mode).toLowerCase(),
          physicalPrefix: String(prefixPattern).replace('{index}', String(idx)),
          useOptionalPorts: iface.useOptionalPorts ?? [],
          portWidthOverrides: iface.portWidthOverrides ?? {},
          portNameOverrides: iface.portNameOverrides,
          absentPorts: iface.absentPorts,
          conduitPorts: iface.conduitPorts,
          associatedClock: iface.associatedClock,
          associatedReset: iface.associatedReset,
        });
      }
      continue;
    }

    expanded.push({
      name: iface.name,
      type: getString(iface.type),
      busTypeVlnv: iface.busTypeVlnv,
      rawPortMaps: iface.rawPortMaps,
      mode: getString(iface.mode).toLowerCase(),
      physicalPrefix: iface.physicalPrefix ?? 's_axi_',
      useOptionalPorts: iface.useOptionalPorts ?? [],
      portWidthOverrides: iface.portWidthOverrides ?? {},
      portNameOverrides: iface.portNameOverrides,
      absentPorts: iface.absentPorts,
      conduitPorts: iface.conduitPorts,
      associatedClock: iface.associatedClock,
      associatedReset: iface.associatedReset,
    });
  }

  return expanded;
}

export function getVhdlPortType(width: number, _logicalName: string): string {
  if (width === 1) {
    return 'std_logic';
  }
  return `std_logic_vector(${width - 1} downto 0)`;
}

export function getSvPortType(width: number, _logicalName: string): string {
  if (width === 1) {
    return 'logic';
  }
  return `logic [${width - 1}:0]`;
}

export function getActiveBusPortsFromDefinition(
  ports: Array<{ name: string; width?: number | string; direction?: string; presence?: string }>,
  useOptionalPorts: string[],
  physicalPrefix: string,
  mode: string,
  portWidthOverrides: Record<string, number | string>,
  parameters?: Array<{ name: string; value?: number | string; data_type?: string }>,
  portNameOverrides?: Record<string, string>,
  absentPorts?: string[]
): Array<Record<string, unknown>> {
  const optionalSet = new Set(useOptionalPorts || []);
  const absentSet = new Set((absentPorts ?? []).map((n) => n.toUpperCase()));
  const activePorts: Array<Record<string, unknown>> = [];

  // Build a lookup for resolving parameter references to their default values
  const paramDefaults: Record<string, number> = {};
  if (parameters) {
    for (const p of parameters) {
      if (p.name && typeof p.value === 'number') {
        paramDefaults[p.name] = p.value;
      }
    }
  }

  ports.forEach((port) => {
    const logicalName = port.name;
    if (['ACLK', 'ARESETn', 'clk', 'reset'].includes(logicalName)) {
      return;
    }

    if (absentSet.has(logicalName.toUpperCase())) {
      return;
    }

    const presence = port.presence ?? 'required';
    const isRequired = presence === 'required';
    const isSelected = optionalSet.has(logicalName);
    if (!isRequired && !isSelected) {
      return;
    }

    let direction = port.direction ?? 'in';
    if (mode === 'slave' || mode === 'sink') {
      direction = direction === 'out' ? 'in' : direction === 'in' ? 'out' : direction;
    }

    let width: number | string = port.width ?? 1;
    let widthExpr: string | null = null;
    if (portWidthOverrides?.[logicalName] !== undefined) {
      const override = portWidthOverrides[logicalName];
      if (typeof override === 'string') {
        // Resolve parameter reference or expression; preserve as widthExpr for templates
        width = evalWidthExpr(override, paramDefaults) ?? 1;
        widthExpr = override;
      } else {
        width = override;
      }
    } else if (typeof width === 'string') {
      // Port width is a parameter name or arithmetic expression (e.g. "XCVR_DW" or
      // "AxiDataWidth_g/8"). Evaluate to a numeric default for type generation and
      // keep the original expression as widthExpr for generic references in templates.
      widthExpr = width;
      width = evalWidthExpr(width, paramDefaults) ?? 1;
    }

    // WSTRB width is DATA_WIDTH/8. The YAML convention stores only the data-width
    // parameter name (e.g. "AxiDataWidth_g") so the parser can strip "/8" without
    // losing the parameter reference. Re-apply "/8" here so that widthExpr, width,
    // tcl_width, and all generated outputs are all consistent and correct.
    if (logicalName === 'WSTRB' && widthExpr !== null) {
      widthExpr = `${widthExpr}/8`;
      width = evalWidthExpr(widthExpr, paramDefaults) ?? 1;
    }

    const numWidth = Number(width);

    // Compute HDL type strings — use the parameter expression when parameterized,
    // otherwise use the concrete numeric width from the bus definition.
    let vhdlType: string;
    let svType: string;
    if (widthExpr !== null) {
      // Compound expressions (e.g. "AxiDataWidth_g/8") need outer parens so the
      // subtraction binds to the whole expression, not just its last operand.
      const isCompound = /[+\-*/]/.test(widthExpr);
      const fmtExpr = isCompound ? `(${widthExpr})` : widthExpr;
      vhdlType = `std_logic_vector(${fmtExpr}-1 downto 0)`;
      svType = `logic [${fmtExpr}-1:0]`;
    } else {
      vhdlType = getVhdlPortType(numWidth, logicalName);
      svType = getSvPortType(numWidth, logicalName);
    }

    const physicalSuffix = portNameOverrides?.[logicalName] ?? logicalName.toLowerCase();
    activePorts.push({
      logical_name: logicalName,
      name: `${physicalPrefix}${physicalSuffix}`,
      direction,
      sv_direction: direction === 'in' ? 'input' : direction === 'out' ? 'output' : 'inout',
      width: numWidth,
      width_expr: widthExpr,
      is_parameterized: widthExpr !== null,
      default_width: widthExpr !== null ? numWidth - 1 : null,
      type: vhdlType,
      sv_type: svType,
    });
  });

  return activePorts;
}

export async function resolveMemoryMaps(
  ipCore: IpCoreData,
  inputPath: string
): Promise<NormalizedMemoryMap[]> {
  const baseDir = path.dirname(inputPath);
  const reader = {
    readText: (absPath: string) => fs.readFile(absPath, 'utf8'),
  };

  const { resolved, errors } = await resolveMemoryMapImports({
    memoryMaps: ipCore.memoryMaps,
    baseDir,
    reader,
  });

  if (errors.length > 0) {
    // Warn and continue with the maps that did resolve; throwing here would
    // discard all successfully-resolved maps when only one import fails.
    console.warn(
      `Memory map import errors (continuing with ${resolved.length} resolved): ${errors.join('; ')}`
    );
  }

  return resolved.map((rawMap) => normalizeMemoryMap(rawMap));
}

export async function prepareRegisters(
  ipCore: IpCoreData,
  inputPath: string
): Promise<Array<Record<string, unknown>>> {
  const memoryMaps = await resolveMemoryMaps(ipCore, inputPath);
  const registers: Array<Record<string, unknown>> = [];

  const processRegister = (reg: NormalizedRegister, baseOffset: number, prefix: string) => {
    const currentOffset = baseOffset + reg.offset;
    const regName = reg.name ?? 'REG';

    if (reg.registers && reg.registers.length > 0) {
      const count = reg.count ?? 1;
      const stride = reg.stride ?? 0;
      for (let i = 0; i < count; i += 1) {
        const instanceOffset = currentOffset + i * stride;
        const instancePrefix =
          count > 1 ? `${prefix}${String(regName)}_${i}_` : `${prefix}${String(regName)}_`;
        reg.registers.forEach((child) => {
          processRegister(child, instanceOffset, instancePrefix);
        });
      }
      return;
    }

    // Flat register array (count > 1 without child registers): replicate the
    // register as <NAME>_<i> instances, mirroring the group-array expansion.
    const flatCount = reg.count ?? 1;
    if (flatCount > 1 && !(reg as unknown as Record<string, unknown>).__expanded_array_instance) {
      const stride = reg.stride ?? 4;
      for (let i = 0; i < flatCount; i += 1) {
        processRegister(
          {
            ...reg,
            name: `${String(regName)}_${i}`,
            offset: reg.offset + i * stride,
            count: 1,
            __expanded_array_instance: true,
          } as NormalizedRegister,
          baseOffset,
          prefix
        );
      }
      return;
    }

    const fields = (reg.fields ?? []).map((field) => {
      const access = getString(field.access ?? 'read-write');

      return {
        name: field.name,
        offset: field.offset,
        width: field.width,
        access: access.toLowerCase(),
        reset_value: field.resetValue,
        description: field.description ?? '',
        monitorChangeOf: field.monitorChangeOf ?? null,
      };
    });

    const regAccess = deriveRegisterAccess(fields.map((f) => f.access));
    registers.push({
      name: `${prefix}${String(regName)}`,
      offset: currentOffset,
      access: regAccess,
      description: reg.description ?? '',
      fields,
    });
  };

  memoryMaps.forEach((map) => {
    (map.addressBlocks ?? []).forEach((block) => {
      const baseOffset = block.baseAddress;
      (block.registers ?? []).forEach((reg) => processRegister(reg, baseOffset, ''));
    });
  });

  return registers.sort((a, b) => (a.offset as number) - (b.offset as number));
}

type ProjectedRegister = {
  name: string;
  offset: number;
  address_offset: number;
  addressOffset: number;
  size: number;
  access: string | undefined;
  resetValue: number;
  reset_value: number;
  description: string;
  fields: Array<{
    name: string;
    bits: string;
    offset: number;
    bit_offset: number;
    bitOffset: number;
    width: number;
    bit_width: number;
    bitWidth: number;
    access: string | undefined;
    resetValue: number;
    reset_value: number;
    description: string;
    monitorChangeOf?: string | null;
  }>;
  count?: number;
  stride?: number;
  registers?: ProjectedRegister[];
};

export function projectMemoryMapsForTemplate(maps: NormalizedMemoryMap[]): unknown[] {
  return maps.map((map) => ({
    name: map.name,
    description: map.description,
    address_blocks: (map.addressBlocks ?? []).map((block) => ({
      name: block.name,
      base_address: block.baseAddress,
      baseAddress: block.baseAddress,
      range: block.range,
      usage: block.usage,
      registers: (block.registers ?? []).map((reg) => {
        const projectReg = (r: NormalizedRegister): ProjectedRegister => {
          const projectedFields = (r.fields ?? []).map((f) => ({
            name: f.name,
            bits: f.bits,
            offset: f.offset,
            bit_offset: f.offset,
            bitOffset: f.offset,
            width: f.width,
            bit_width: f.width,
            bitWidth: f.width,
            access: f.access,
            resetValue: f.resetValue,
            reset_value: f.resetValue,
            description: f.description,
            monitorChangeOf: f.monitorChangeOf,
          }));
          const base: ProjectedRegister = {
            name: r.name,
            offset: r.offset,
            address_offset: r.offset,
            addressOffset: r.offset,
            size: r.size,
            access: deriveRegisterAccess(
              projectedFields.map((f) => getString(f.access) || 'read-write')
            ),
            resetValue: r.resetValue,
            reset_value: r.resetValue,
            description: r.description,
            fields: projectedFields,
          };
          if (r.__kind === 'array') {
            return {
              ...base,
              count: r.count,
              stride: r.stride,
              registers: (r.registers ?? []).map(projectReg),
            };
          }
          return base;
        };
        return projectReg(reg);
      }),
    })),
  }));
}
