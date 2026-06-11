import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { BusInterfaceDef, BusTypeInfo, IpCoreData } from './types';

/**
 * Evaluate an arithmetic width expression that may reference parameter names.
 * Returns the computed integer or undefined when any identifier remains unresolved.
 *
 * Examples:
 *   evalWidthExpr("AxiDataWidth_g",     { AxiDataWidth_g: 32 }) → 32
 *   evalWidthExpr("AxiDataWidth_g/8",   { AxiDataWidth_g: 32 }) → 4
 *   evalWidthExpr("AxiDataWidth_g * 2", { AxiDataWidth_g: 32 }) → 64
 */
export function evalWidthExpr(
  expr: string,
  paramDefaults: Map<string, number> | Record<string, number>
): number | undefined {
  const trimmed = expr.trim();

  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) {
    return asNum;
  }

  const defaults: Record<string, number> =
    paramDefaults instanceof Map ? Object.fromEntries(paramDefaults) : paramDefaults;

  // Substitute known param names, longest first to avoid partial-name collisions
  let resolved = trimmed;
  for (const name of Object.keys(defaults).sort((a, b) => b.length - a.length)) {
    resolved = resolved.replace(new RegExp(`\\b${name}\\b`, 'g'), String(defaults[name]));
  }

  // After substitution only arithmetic tokens should remain
  if (!/^[0-9\s+\-*/().]+$/.test(resolved)) {
    return undefined;
  }

  try {
    const result = (new Function(`return (${resolved})`) as () => unknown)();
    const num = Number(result);
    return Number.isFinite(num) ? Math.trunc(num) : undefined;
  } catch {
    return undefined;
  }
}

// Maps the bus name segment of an ipcraft VLNV string to BusTypeInfo.
// The libraryKey must match the top-level key in the bundled bus_definitions YAML files.
const VLNV_BUS_NAME_MAP: Record<string, BusTypeInfo> = {
  axi4_lite: { libraryKey: 'AXI4_LITE', templateType: 'axil' },
  axi4_full: { libraryKey: 'AXI4_FULL', templateType: 'axi4' },
  axi_stream: { libraryKey: 'AXI_STREAM', templateType: 'axis' },
  avalon_mm: { libraryKey: 'AVALON_MEMORY_MAPPED', templateType: 'avmm' },
  avalon_st: { libraryKey: 'AVALON_STREAMING', templateType: 'avst' },
};

const BUS_TYPE_ALIASES: Record<string, BusTypeInfo> = {
  AXI4L: { libraryKey: 'AXI4_LITE', templateType: 'axil' },
  AXI4LITE: { libraryKey: 'AXI4_LITE', templateType: 'axil' },
  AXILITE: { libraryKey: 'AXI4_LITE', templateType: 'axil' },
  AXIL: { libraryKey: 'AXI4_LITE', templateType: 'axil' },
  AXI4F: { libraryKey: 'AXI4_FULL', templateType: 'axi4' },
  AXI4FULL: { libraryKey: 'AXI4_FULL', templateType: 'axi4' },
  AXI4: { libraryKey: 'AXI4_FULL', templateType: 'axi4' },
  AXI4S: { libraryKey: 'AXI_STREAM', templateType: 'axis' },
  AXISTREAM: { libraryKey: 'AXI_STREAM', templateType: 'axis' },
  AXIS: { libraryKey: 'AXI_STREAM', templateType: 'axis' },
  AVALONMM: { libraryKey: 'AVALON_MEMORY_MAPPED', templateType: 'avmm' },
  AVMM: { libraryKey: 'AVALON_MEMORY_MAPPED', templateType: 'avmm' },
  AVALONMEMORYMAPPED: { libraryKey: 'AVALON_MEMORY_MAPPED', templateType: 'avmm' },
  AVALONSTREAMING: { libraryKey: 'AVALON_STREAMING', templateType: 'avst' },
  AVALONST: { libraryKey: 'AVALON_STREAMING', templateType: 'avst' },
  AVST: { libraryKey: 'AVALON_STREAMING', templateType: 'avst' },
};

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

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseBits(bits: string): { offset: number; width: number } {
  if (!bits || typeof bits !== 'string') {
    return { offset: 0, width: 1 };
  }
  const range = bits.match(/\[(\d+):(\d+)\]/);
  if (range) {
    const high = Number(range[1]);
    const low = Number(range[2]);
    return { offset: Math.min(low, high), width: Math.abs(high - low) + 1 };
  }
  const single = bits.match(/\[(\d+)\]/);
  if (single) {
    const bit = Number(single[1]);
    return { offset: bit, width: 1 };
  }
  return { offset: 0, width: 1 };
}

function normalizeBusInterface(raw: Record<string, unknown>): BusInterfaceDef {
  const array = (raw.array as Record<string, unknown> | undefined) ?? undefined;
  const useOptionalPorts =
    (raw.use_optional_ports as string[] | undefined) ??
    (raw.useOptionalPorts as string[] | undefined) ??
    [];
  const portWidthOverrides =
    (raw.port_width_overrides as Record<string, number | string> | undefined) ??
    (raw.portWidthOverrides as Record<string, number | string> | undefined) ??
    {};
  const portNameOverrides =
    (raw.port_name_overrides as Record<string, string> | undefined) ??
    (raw.portNameOverrides as Record<string, string> | undefined) ??
    undefined;
  const absentPorts =
    (raw.absent_ports as string[] | undefined) ??
    (raw.absentPorts as string[] | undefined) ??
    undefined;
  const conduitPorts =
    (raw.conduit_ports as Array<Record<string, unknown>> | undefined) ??
    (raw.conduitPorts as Array<Record<string, unknown>> | undefined) ??
    undefined;
  return {
    name: getString(raw.name),
    type: getString(raw.type),
    mode: getString(raw.mode).toLowerCase(),
    physical_prefix: getString(raw.physical_prefix ?? raw.physicalPrefix ?? 's_axi_'),
    use_optional_ports: useOptionalPorts,
    port_width_overrides: portWidthOverrides,
    port_name_overrides: portNameOverrides,
    absent_ports: absentPorts,
    conduit_ports: conduitPorts,
    associated_clock: getString(raw.associated_clock ?? raw.associatedClock),
    associated_reset: getString(raw.associated_reset ?? raw.associatedReset),
    array: array
      ? {
          count: parseNumber(array.count ?? 1),
          index_start: parseNumber(array.index_start ?? array.indexStart ?? 0),
          naming_pattern: getString(array.naming_pattern ?? array.namingPattern),
          physical_prefix_pattern: getString(
            array.physical_prefix_pattern ?? array.physicalPrefixPattern
          ),
        }
      : undefined,
    ports: Array.isArray(raw.ports) ? (raw.ports as Array<Record<string, unknown>>) : undefined,
  };
}

export function normalizeIpCoreData(raw: Record<string, unknown>): IpCoreData {
  const busInterfaces = ((raw.bus_interfaces as unknown[]) ??
    (raw.busInterfaces as unknown[]) ??
    []) as Array<Record<string, unknown>>;
  const parameters = ((raw.parameters as unknown[]) ?? []) as Array<Record<string, unknown>>;
  const ports = ((raw.ports as unknown[]) ?? []) as Array<Record<string, unknown>>;
  const clocks = ((raw.clocks as unknown[]) ?? []) as Array<Record<string, unknown>>;
  const resets = ((raw.resets as unknown[]) ?? []) as Array<Record<string, unknown>>;

  return {
    ...(raw as IpCoreData),
    vlnv: (raw.vlnv as IpCoreData['vlnv']) ?? {},
    description: getString(raw.description),
    parameters: parameters.map((param) => ({
      name: getString(param.name),
      value: (param.value ?? param.defaultValue ?? undefined) as number | string | undefined,
      data_type: getString(param.data_type ?? param.dataType),
      description: param.description ? getString(param.description) : undefined,
    })),
    ports: ports.map((port) => ({
      name: getString(port.name),
      direction: getString(port.direction),
      width: (port.width ?? 1) as number | string,
      presence: getString(port.presence),
    })),
    bus_interfaces: busInterfaces.map(normalizeBusInterface),
    clocks: clocks.map((clock) => ({
      name: getString(clock.name),
      ...((clock.frequency ?? null) !== null
        ? { frequency: getString(clock.frequency) || null }
        : {}),
      ...((clock.associatedReset ?? clock.associated_reset)
        ? { associated_reset: getString(clock.associatedReset ?? clock.associated_reset) }
        : {}),
    })),
    resets: resets.map((reset) => ({
      name: getString(reset.name),
      polarity: getString(reset.polarity),
      ...((reset.associatedClock ?? reset.associated_clock)
        ? { associated_clock: getString(reset.associatedClock ?? reset.associated_clock) }
        : {}),
    })),
    memory_maps: (raw.memory_maps ?? raw.memoryMaps ?? undefined) as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
    subcores: ((raw.subcores as unknown[]) ?? []).map((sc) => {
      if (typeof sc === 'string') {
        return { vlnv: sc };
      }
      const obj = sc as Record<string, unknown>;
      return {
        vlnv: getString(obj.vlnv),
        ...(obj.path ? { path: getString(obj.path) } : {}),
      };
    }),
  };
}

export function normalizeBusType(typeName: string): BusTypeInfo {
  // Handle ipcraft VLNV format: ipcraft.busif.{name}.{version}
  const vlnvMatch = /^ipcraft\.busif\.(.+?)\.\d/.exec(typeName);
  if (vlnvMatch) {
    return (
      VLNV_BUS_NAME_MAP[vlnvMatch[1].toLowerCase()] ?? {
        libraryKey: '',
        templateType: 'custom',
      }
    );
  }
  const normalized = typeName.toUpperCase().replace(/[\s_.-]/g, '');
  return BUS_TYPE_ALIASES[normalized] ?? { libraryKey: '', templateType: 'custom' };
}

const MEMORY_MAPPED_TEMPLATE_TYPES = new Set(['axil', 'axi4', 'avmm']);

export function getBusTypeForTemplate(ipCore: IpCoreData): string {
  let firstSlave: string | undefined;
  for (const bus of ipCore.bus_interfaces ?? []) {
    if ((bus.mode ?? '').toLowerCase() === 'slave') {
      const templateType = normalizeBusType(getString(bus.type)).templateType;
      firstSlave ??= templateType;
      // Prefer the first memory-mapped slave — that's the bus for which a wrapper template exists.
      if (MEMORY_MAPPED_TEMPLATE_TYPES.has(templateType)) {
        return templateType;
      }
    }
  }
  return firstSlave ?? 'axil';
}

export function hasMemoryMappedSlaveInterface(ipCore: IpCoreData): boolean {
  for (const bus of ipCore.bus_interfaces ?? []) {
    if ((bus.mode ?? '').toLowerCase() === 'slave') {
      const templateType = normalizeBusType(getString(bus.type)).templateType;
      if (MEMORY_MAPPED_TEMPLATE_TYPES.has(templateType)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether any two expanded bus interfaces share the same physical_prefix,
 * which would produce duplicate port names in generated HDL.
 * Returns a descriptive error string on collision, or null when all prefixes are unique.
 */
export function checkDuplicatePhysicalPrefixes(ipCore: IpCoreData): string | null {
  const expanded = expandBusInterfaces(ipCore);
  const seen = new Map<string, string>(); // prefix → first interface name
  const duplicates: string[] = [];

  for (const iface of expanded) {
    const prefix = iface.physical_prefix ?? '';
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
  const busInterfaces = ipCore.bus_interfaces ?? [];
  const expanded: BusInterfaceDef[] = [];

  for (const iface of busInterfaces) {
    const arrayDef = iface.array;
    if (arrayDef) {
      const count = Number(arrayDef.count ?? 1);
      const start = Number(arrayDef.index_start ?? 0);
      for (let i = 0; i < count; i += 1) {
        const idx = start + i;
        const namePattern = arrayDef.naming_pattern ?? `${String(iface.name)}_{index}`;
        const prefixPattern =
          arrayDef.physical_prefix_pattern ??
          `${String(iface.physical_prefix ?? 's_axi_')}{index}_`;
        expanded.push({
          name: String(namePattern).replace('{index}', String(idx)),
          type: getString(iface.type),
          mode: getString(iface.mode).toLowerCase(),
          physical_prefix: String(prefixPattern).replace('{index}', String(idx)),
          use_optional_ports: iface.use_optional_ports ?? [],
          port_width_overrides: iface.port_width_overrides ?? {},
          port_name_overrides: iface.port_name_overrides,
          absent_ports: iface.absent_ports,
          conduit_ports: iface.conduit_ports,
          associated_clock: iface.associated_clock,
          associated_reset: iface.associated_reset,
        });
      }
      continue;
    }

    expanded.push({
      name: iface.name,
      type: getString(iface.type),
      mode: getString(iface.mode).toLowerCase(),
      physical_prefix: iface.physical_prefix ?? 's_axi_',
      use_optional_ports: iface.use_optional_ports ?? [],
      port_width_overrides: iface.port_width_overrides ?? {},
      port_name_overrides: iface.port_name_overrides,
      absent_ports: iface.absent_ports,
      conduit_ports: iface.conduit_ports,
      associated_clock: iface.associated_clock,
      associated_reset: iface.associated_reset,
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
): Promise<Array<Record<string, unknown>>> {
  const memoryMaps = ipCore.memory_maps;
  if (!memoryMaps) {
    return [];
  }

  const baseDir = path.dirname(inputPath);

  // Legacy shortcut: memoryMaps: { import: "path.mm.yml" } — single global import.
  if (!Array.isArray(memoryMaps) && 'import' in memoryMaps) {
    const importPath = path.resolve(baseDir, memoryMaps.import as string);
    const content = await fs.readFile(importPath, 'utf8');
    const parsed = yaml.load(content);
    if (Array.isArray(parsed)) {
      return parsed as Array<Record<string, unknown>>;
    }
    return parsed ? [parsed as Record<string, unknown>] : [];
  }

  const entries: Array<Record<string, unknown>> = Array.isArray(memoryMaps)
    ? memoryMaps
    : [memoryMaps];

  // For each entry, if it has an `import` field, load the file and merge
  // so the entry's `name` overrides what's in the file.
  const resolved: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    const importField = entry.import;
    if (importField && typeof importField === 'string') {
      const importPath = path.resolve(baseDir, importField);
      const content = await fs.readFile(importPath, 'utf8');
      const parsed = yaml.load(content);
      // Loaded content may be a single map object or an array (take first item).
      const loaded: Record<string, unknown> = Array.isArray(parsed)
        ? ((parsed[0] as Record<string, unknown>) ?? {})
        : ((parsed as Record<string, unknown>) ?? {});
      // Merge: entry-level fields (including `name`) take precedence over the file.
      const { import: _ignored, ...entryWithoutImport } = entry;
      resolved.push({ ...loaded, ...entryWithoutImport });
    } else {
      resolved.push(entry);
    }
  }

  return resolved;
}

export async function prepareRegisters(
  ipCore: IpCoreData,
  inputPath: string
): Promise<Array<Record<string, unknown>>> {
  const memoryMaps = await resolveMemoryMaps(ipCore, inputPath);
  const registers: Array<Record<string, unknown>> = [];

  const processRegister = (reg: Record<string, unknown>, baseOffset: number, prefix: string) => {
    const currentOffset =
      baseOffset + parseNumber(reg.address_offset ?? reg.addressOffset ?? reg.offset ?? 0);
    const regName = reg.name ?? 'REG';

    const nestedRegs = reg.registers ?? [];
    if (Array.isArray(nestedRegs) && nestedRegs.length > 0) {
      const countValue = Number(reg.count ?? 1);
      const count = Number.isFinite(countValue) && countValue > 0 ? countValue : 1;
      const strideValue = Number(reg.stride ?? 0);
      const stride = Number.isFinite(strideValue) ? strideValue : 0;
      for (let i = 0; i < count; i += 1) {
        const instanceOffset = currentOffset + i * stride;
        const instancePrefix =
          count > 1 ? `${prefix}${String(regName)}_${i}_` : `${prefix}${String(regName)}_`;
        (nestedRegs as Array<Record<string, unknown>>).forEach((child) => {
          processRegister(child, instanceOffset, instancePrefix);
        });
      }
      return;
    }

    // Flat register array (count > 1 without child registers): replicate the
    // register as <NAME>_<i> instances, mirroring the group-array expansion.
    const flatCountValue = Number(reg.count ?? 1);
    const flatCount =
      Number.isFinite(flatCountValue) && flatCountValue > 0 ? Math.trunc(flatCountValue) : 1;
    if (flatCount > 1 && !reg.__expanded_array_instance) {
      const strideValue = Number(reg.stride ?? 0);
      // Default stride: one 32-bit register slot (4 bytes).
      const stride = Number.isFinite(strideValue) && strideValue > 0 ? strideValue : 4;
      for (let i = 0; i < flatCount; i += 1) {
        processRegister(
          {
            ...reg,
            name: `${String(regName)}_${i}`,
            offset:
              parseNumber(reg.address_offset ?? reg.addressOffset ?? reg.offset ?? 0) + i * stride,
            count: 1,
            __expanded_array_instance: true,
          },
          baseOffset,
          prefix
        );
      }
      return;
    }

    const fields = ((reg.fields as Array<Record<string, unknown>>) ?? []).map((field) => {
      // Schema allows either a bits string ("[7:0]") or numeric offset/width.
      let bitOffset = field.bit_offset ?? field.bitOffset ?? field.bit_range ?? field.offset;
      let bitWidth = field.bit_width ?? field.bitWidth ?? field.width;

      if (bitOffset === undefined || bitWidth === undefined) {
        const parsedBits = parseBits(getString(field.bits));
        if (bitOffset === undefined) {
          bitOffset = parsedBits.offset;
        }
        if (bitWidth === undefined) {
          bitWidth = parsedBits.width;
        }
      }

      const access = getString(field.access ?? reg.access ?? 'read-write');
      const resetValue = field.reset_value ?? field.resetValue ?? field.reset ?? 0;

      return {
        name: field.name,
        offset: Number(bitOffset ?? 0),
        width: Number(bitWidth ?? 1),
        access: access.toLowerCase(),
        reset_value: resetValue,
        description: field.description ?? '',
        monitorChangeOf: field.monitorChangeOf ?? field.monitor_change_of ?? null,
      };
    });

    const regAccess = getString(reg.access ?? 'read-write');
    registers.push({
      name: `${prefix}${String(regName)}`,
      offset: currentOffset,
      access: regAccess.toLowerCase(),
      description: reg.description ?? '',
      fields,
    });
  };

  memoryMaps.forEach((map) => {
    const blocks =
      (map.addressBlocks as Array<Record<string, unknown>>) ??
      (map.addressBlocks as Array<Record<string, unknown>>) ??
      [];
    blocks.forEach((block) => {
      const baseOffset = parseNumber(block.base_address ?? block.baseAddress ?? block.offset ?? 0);
      const regs = (block.registers as Array<Record<string, unknown>>) || [];
      regs.forEach((reg) => processRegister(reg, baseOffset, ''));
    });
  });

  return registers.sort((a, b) => (a.offset as number) - (b.offset as number));
}
