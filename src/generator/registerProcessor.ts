import * as fs from 'fs/promises';
import * as path from 'path';
import type { BusInterfaceDef, BusTypeInfo, IpCoreData } from './types';
import { resolveMemoryMapImports } from '../services/imports/resolveMemoryMapImports';
import { normalizeIpCore, normalizeMemoryMap } from '../domain/parse';
import type { NormalizedMemoryMap, NormalizedRegister } from '../domain/internal.types';
import { BUS_REGISTRY } from './buses/builtin';

import { evalWidthExpr } from '../shared/evalWidthExpr';
import { parse, serialize, containsParamRef } from '../shared/widthExprAst';
import { reconstructBusPortNameSet } from '../shared/busPortNameSet';
export { evalWidthExpr };

/**
 * Resolve a string-valued port width to a numeric default and, when it is
 * parameterized, the canonical width expression. A constant expression (no
 * parameter reference, including a constant function such as `clog2(8)`) is
 * folded to a literal and reported with `expr: null` so it routes through the
 * static numeric-width path.
 */
export function resolveStringWidth(
  s: string,
  paramDefaults: Map<string, number> | Record<string, number>
): { numeric: number; expr: string | null } {
  const ast = parse(s);
  const numeric = evalWidthExpr(s, paramDefaults) ?? 1;
  if (ast && !containsParamRef(ast)) {
    return { numeric, expr: null };
  }
  return { numeric, expr: s };
}

/**
 * Build the VHDL and SystemVerilog vector type strings for a parameterized port
 * width expression, expanding any predefined functions per dialect. Falls back
 * to the legacy raw-string wrap for an un-parseable expression.
 */
export function buildParameterizedPortTypes(widthExpr: string): {
  type: string;
  sv_type: string;
} {
  const ast = parse(widthExpr);
  if (!ast) {
    const isCompound = /[+\-*/]/.test(widthExpr);
    const fmt = isCompound ? `(${widthExpr})` : widthExpr;
    return { type: `std_logic_vector(${fmt}-1 downto 0)`, sv_type: `logic [${fmt}-1:0]` };
  }
  const isLeaf = ast.type === 'Number' || ast.type === 'ParamRef';
  const vhdl = serialize(ast, 'vhdl').code;
  const sv = serialize(ast, 'systemverilog').code;
  const fmtVhdl = isLeaf ? vhdl : `(${vhdl})`;
  const fmtSv = isLeaf ? sv : `(${sv})`;
  return {
    type: `std_logic_vector(${fmtVhdl}-1 downto 0)`,
    sv_type: `logic [${fmtSv}-1:0]`,
  };
}

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

function deriveRegisterAccess(fieldAccesses: string[], explicitAccess?: string): string {
  if (explicitAccess) {
    return explicitAccess;
  }
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
 * Checks whether any two expanded bus interfaces would emit conflicting physical
 * port names in generated HDL. Two interfaces sharing the same physicalPrefix are
 * only a real conflict when their reconstructed physical port names actually
 * intersect — distinct instances of the same protocol (e.g. two Avalon-ST sinks)
 * can legitimately share a prefix as long as portNameOverrides disambiguate them.
 * When an interface can't be reconstructed (conduit / unrecognized bus type),
 * falls back to the legacy raw-prefix comparison for that pair.
 * Returns a descriptive error string on collision, or null when there is none.
 */
export function checkDuplicatePhysicalPrefixes(ipCore: IpCoreData): string | null {
  const expanded = expandBusInterfaces(ipCore).filter((iface) => Boolean(iface.physicalPrefix));
  const nameSets = expanded.map((iface) => reconstructBusPortNameSet(iface));
  const duplicates: string[] = [];

  for (let i = 0; i < expanded.length; i++) {
    for (let j = i + 1; j < expanded.length; j++) {
      const setI = nameSets[i];
      const setJ = nameSets[j];
      const collides =
        setI && setJ
          ? [...setI].some((n) => setJ.has(n))
          : (expanded[i].physicalPrefix ?? '').toLowerCase() ===
            (expanded[j].physicalPrefix ?? '').toLowerCase();
      if (collides) {
        duplicates.push(
          `'${expanded[i].physicalPrefix ?? ''}' (shared by '${expanded[i].name ?? ''}' and '${expanded[j].name ?? ''}')`
        );
      }
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
    const mode = getString(iface.mode).toLowerCase();
    // Conduit ports are typically authored with their final, literal physical
    // names already (e.g. via conduitPorts), so an unset prefix means "no
    // prefix" — not the AXI-style 's_axi_' default used for standard buses.
    const defaultPrefix = mode === 'conduit' ? '' : 's_axi_';
    const arrayDef = iface.array;
    if (arrayDef) {
      const count = Number(arrayDef.count ?? 1);
      const start = Number(arrayDef.indexStart ?? 0);
      for (let i = 0; i < count; i += 1) {
        const idx = start + i;
        const namePattern = arrayDef.namingPattern ?? `${String(iface.name)}_{index}`;
        const prefixPattern =
          arrayDef.physicalPrefixPattern ??
          `${String(iface.physicalPrefix ?? defaultPrefix)}{index}_`;
        expanded.push({
          name: String(namePattern).replace('{index}', String(idx)),
          type: getString(iface.type),
          busTypeVlnv: iface.busTypeVlnv,
          rawPortMaps: iface.rawPortMaps,
          mode,
          physicalPrefix: String(prefixPattern).replace('{index}', String(idx)),
          useOptionalPorts: iface.useOptionalPorts ?? [],
          portWidthOverrides: iface.portWidthOverrides ?? {},
          portNameOverrides: iface.portNameOverrides,
          absentPorts: iface.absentPorts,
          conduitPorts: iface.conduitPorts ?? [],
          associatedClock: iface.associatedClock,
          associatedReset: iface.associatedReset,
          memoryMapRef: iface.memoryMapRef,
          endianness: iface.endianness,
        });
      }
      continue;
    }

    expanded.push({
      name: iface.name,
      type: getString(iface.type),
      busTypeVlnv: iface.busTypeVlnv,
      rawPortMaps: iface.rawPortMaps,
      mode,
      physicalPrefix: iface.physicalPrefix ?? defaultPrefix,
      useOptionalPorts: iface.useOptionalPorts ?? [],
      portWidthOverrides: iface.portWidthOverrides ?? {},
      portNameOverrides: iface.portNameOverrides,
      absentPorts: iface.absentPorts,
      conduitPorts: iface.conduitPorts ?? [],
      associatedClock: iface.associatedClock,
      associatedReset: iface.associatedReset,
      memoryMapRef: iface.memoryMapRef,
      endianness: iface.endianness,
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
  ports: Array<{
    name: string;
    width?: number | string;
    direction?: string;
    presence?: string;
    role?: string;
  }>,
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
        const resolved = resolveStringWidth(override, paramDefaults);
        width = resolved.numeric;
        widthExpr = resolved.expr;
      } else {
        width = override;
      }
    } else if (typeof width === 'string') {
      // Port width is a parameter name or arithmetic expression (e.g. "XCVR_DW",
      // "AxiDataWidth_g/8", or "clog2(DEPTH)"). Evaluate to a numeric default for
      // type generation and keep the original expression as widthExpr for generic
      // references in templates. A constant expression folds to a literal.
      const resolved = resolveStringWidth(width, paramDefaults);
      width = resolved.numeric;
      widthExpr = resolved.expr;
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
      // Parameterized width — expand predefined functions per dialect and
      // parenthesize non-leaf expressions so the trailing "-1" binds correctly.
      const types = buildParameterizedPortTypes(widthExpr);
      vhdlType = types.type;
      svType = types.sv_type;
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
      role: port.role,
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

    const regAccess = deriveRegisterAccess(
      fields.map((f) => f.access),
      reg.access
    );
    registers.push({
      name: `${prefix}${String(regName)}`,
      offset: currentOffset,
      access: regAccess,
      description: reg.description ?? '',
      reset_value: reg.resetValue,
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
              projectedFields.map((f) => getString(f.access) || 'read-write'),
              r.access
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
