import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { BusInterfaceDef, BusTypeInfo, IpCoreData } from './types';

const BUS_TYPE_ALIASES: Record<string, BusTypeInfo> = {
  AXI4L: { libraryKey: 'AXI4L', templateType: 'axil' },
  AXI4LITE: { libraryKey: 'AXI4L', templateType: 'axil' },
  AXILITE: { libraryKey: 'AXI4L', templateType: 'axil' },
  AXIL: { libraryKey: 'AXI4L', templateType: 'axil' },
  AVALONMM: { libraryKey: 'AVALON_MM', templateType: 'avmm' },
  AVMM: { libraryKey: 'AVALON_MM', templateType: 'avmm' },
  AVALON_MM: { libraryKey: 'AVALON_MM', templateType: 'avmm' },
  'AVALON-MM': { libraryKey: 'AVALON_MM', templateType: 'avmm' },
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
    (raw.port_width_overrides as Record<string, number> | undefined) ??
    (raw.portWidthOverrides as Record<string, number> | undefined) ??
    {};
  return {
    name: getString(raw.name),
    type: getString(raw.type),
    mode: getString(raw.mode).toLowerCase(),
    physical_prefix: getString(raw.physical_prefix ?? raw.physicalPrefix ?? 's_axi_'),
    use_optional_ports: useOptionalPorts,
    port_width_overrides: portWidthOverrides,
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
      value: (param.value ?? undefined) as number | string | undefined,
      data_type: getString(param.data_type ?? param.dataType),
    })),
    ports: ports.map((port) => ({
      name: getString(port.name),
      direction: getString(port.direction),
      width: (port.width ?? 1) as number | string,
      presence: getString(port.presence),
    })),
    bus_interfaces: busInterfaces.map(normalizeBusInterface),
    clocks: clocks.map((clock) => ({ name: getString(clock.name) })),
    resets: resets.map((reset) => ({
      name: getString(reset.name),
      polarity: getString(reset.polarity),
    })),
    memory_maps: (raw.memory_maps ?? raw.memoryMaps ?? undefined) as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  };
}

export function normalizeBusType(typeName: string): BusTypeInfo {
  const normalized = typeName.toUpperCase().replace(/[\s_-]/g, '');
  return BUS_TYPE_ALIASES[normalized] ?? BUS_TYPE_ALIASES.AXI4L;
}

export function getBusTypeForTemplate(ipCore: IpCoreData): string {
  for (const bus of ipCore.bus_interfaces ?? []) {
    if ((bus.mode ?? '').toLowerCase() === 'slave') {
      return normalizeBusType(getString(bus.type)).templateType;
    }
  }
  return 'axil';
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
      associated_clock: iface.associated_clock,
      associated_reset: iface.associated_reset,
    });
  }

  return expanded;
}

export function getVhdlPortType(width: number, logicalName: string): string {
  if (['AWADDR', 'ARADDR', 'address'].includes(logicalName)) {
    return 'std_logic_vector(C_ADDR_WIDTH-1 downto 0)';
  }
  if (['WDATA', 'RDATA', 'writedata', 'readdata'].includes(logicalName)) {
    return 'std_logic_vector(C_DATA_WIDTH-1 downto 0)';
  }
  if (logicalName === 'WSTRB') {
    return 'std_logic_vector((C_DATA_WIDTH/8)-1 downto 0)';
  }
  if (width === 1) {
    return 'std_logic';
  }
  return `std_logic_vector(${width - 1} downto 0)`;
}

export function getActiveBusPortsFromDefinition(
  ports: Array<{ name: string; width?: number; direction?: string; presence?: string }>,
  useOptionalPorts: string[],
  physicalPrefix: string,
  mode: string,
  portWidthOverrides: Record<string, number>
): Array<Record<string, unknown>> {
  const optionalSet = new Set(useOptionalPorts || []);
  const activePorts: Array<Record<string, unknown>> = [];

  ports.forEach((port) => {
    const logicalName = port.name;
    if (['ACLK', 'ARESETn', 'clk', 'reset'].includes(logicalName)) {
      return;
    }

    const presence = port.presence ?? 'required';
    const isRequired = presence === 'required';
    const isSelected = optionalSet.has(logicalName);
    if (!isRequired && !isSelected) {
      return;
    }

    let direction = port.direction ?? 'in';
    if (mode === 'slave') {
      direction = direction === 'out' ? 'in' : direction === 'in' ? 'out' : direction;
    }

    let width = port.width ?? 1;
    if (portWidthOverrides?.[logicalName] !== undefined) {
      width = portWidthOverrides[logicalName];
    }

    activePorts.push({
      logical_name: logicalName,
      name: `${physicalPrefix}${logicalName.toLowerCase()}`,
      direction,
      width,
      type: getVhdlPortType(Number(width), logicalName),
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

  if (!Array.isArray(memoryMaps) && 'import' in memoryMaps) {
    const baseDir = path.dirname(inputPath);
    const importPath = path.resolve(baseDir, memoryMaps.import as string);
    const content = await fs.readFile(importPath, 'utf8');
    const parsed = yaml.load(content);
    if (Array.isArray(parsed)) {
      return parsed as Array<Record<string, unknown>>;
    }
    return parsed ? [parsed as Record<string, unknown>] : [];
  }

  return Array.isArray(memoryMaps) ? memoryMaps : [memoryMaps];
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

    const fields = ((reg.fields as Array<Record<string, unknown>>) ?? []).map((field) => {
      let bitOffset = field.bit_offset ?? field.bitOffset ?? field.bit_range;
      let bitWidth = field.bit_width ?? field.bitWidth;

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
      (map.address_blocks as Array<Record<string, unknown>>) ??
      [];
    blocks.forEach((block) => {
      const baseOffset = parseNumber(block.base_address ?? block.baseAddress ?? block.offset ?? 0);
      const regs = (block.registers as Array<Record<string, unknown>>) || [];
      regs.forEach((reg) => processRegister(reg, baseOffset, ''));
    });
  });

  return registers.sort((a, b) => (a.offset as number) - (b.offset as number));
}
