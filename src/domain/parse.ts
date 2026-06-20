import jsyaml from 'js-yaml';
import type { IpCore } from './ipcore.types';
import type {
  NormalizedMemoryMap,
  NormalizedAddressBlock,
  NormalizedRegister,
  NormalizedField,
  MemoryMapDoc,
  MemoryMapRootStyle,
} from './internal.types';
import { reconcileRowIds, type TableRowWrapper } from '../webview/utils/rowIdentity';

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) {
      return fallback;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseBits(bits: string): { offset: number; width: number } {
  if (!bits || typeof bits !== 'string') {
    return { offset: 0, width: 1 };
  }
  const range = bits.match(/\[(\d+)(?::(\d+))?\]/);
  if (range) {
    const high = parseInt(range[1], 10);
    const low = range[2] ? parseInt(range[2], 10) : high;
    return { offset: Math.min(low, high), width: Math.abs(high - low) + 1 };
  }
  return { offset: 0, width: 1 };
}

function normalizeField(raw: Record<string, unknown>): Omit<NormalizedField, 'rowId'> {
  let offset = parseNumber(raw.offset ?? raw.bit_offset ?? raw.bitOffset ?? raw.bit_range, 0);
  let width = parseNumber(raw.width ?? raw.bit_width ?? raw.bitWidth, 1);

  if (raw.bits && typeof raw.bits === 'string') {
    const parsed = parseBits(raw.bits);
    offset = parsed.offset;
    width = parsed.width;
  }

  const msb = offset + width - 1;
  const bits = raw.bits ?? (width > 1 ? `[${msb}:${offset}]` : `[${offset}]`);

  return {
    name: String(raw.name ?? ''),
    bits: String(bits),
    offset,
    width,
    access: raw.access !== undefined ? String(raw.access) : undefined,
    resetValue: parseNumber(raw.resetValue ?? raw.reset_value ?? raw.reset, 0),
    description: String(raw.description ?? ''),
    enumeratedValues: (raw.enumeratedValues ?? raw.enumerated_values ?? null) as Record<
      string,
      string
    > | null,
    monitorChangeOf: (raw.monitorChangeOf ?? raw.monitor_change_of ?? null) as string | null,
  };
}

function normalizeRegister(
  raw: Record<string, unknown>,
  defaultRegWidth: number
): Omit<NormalizedRegister, 'rowId'> {
  // `count` alone is the array discriminant: flat arrays have count+stride but
  // no nested `registers`; nested arrays have all three. `raw.registers` being
  // absent must not strip count/stride from flat arrays (fixes RV-2).
  const isArray = raw.count !== undefined;

  const size = parseNumber(raw.size, 32);
  const regWidth = size > 0 ? size : defaultRegWidth;

  const fields = Array.isArray(raw.fields)
    ? raw.fields.map((f: unknown) => normalizeField(f as Record<string, unknown>))
    : [];

  const baseReg = {
    name: String(raw.name ?? ''),
    offset: parseNumber(raw.offset ?? raw.address_offset ?? raw.addressOffset, 0),
    size,
    access: raw.access !== undefined ? String(raw.access) : undefined,
    resetValue: parseNumber(raw.resetValue ?? raw.reset_value, 0),
    description: String(raw.description ?? ''),
    fields: fields as NormalizedField[],
  };

  if (isArray) {
    const nested = Array.isArray(raw.registers)
      ? raw.registers.map((r: unknown) => normalizeRegister(r as Record<string, unknown>, regWidth))
      : [];
    return {
      ...baseReg,
      __kind: 'array',
      count: Math.max(1, parseNumber(raw.count, 1)),
      stride: Math.max(1, parseNumber(raw.stride, Math.max(1, Math.floor(regWidth / 8)))),
      registers: nested as NormalizedRegister[],
    };
  }

  return baseReg;
}

function normalizeBlock(raw: Record<string, unknown>): Omit<NormalizedAddressBlock, 'rowId'> {
  const defaultRegWidth = parseNumber(raw.defaultRegWidth ?? raw.default_reg_width, 32);
  const defaultRegBytes = Math.max(1, Math.floor(defaultRegWidth / 8));

  // Determine register list
  const rawRegs = Array.isArray(raw.registers) ? raw.registers : [];
  const normalizedRegsWithoutOffsets = rawRegs.map((r: unknown) =>
    normalizeRegister(r as Record<string, unknown>, defaultRegWidth)
  );

  // Re-stamp sequential offsets if needed, similar to DataNormalizer
  let currentOffset = 0;
  const registers = normalizedRegsWithoutOffsets.map(
    (reg: Omit<NormalizedRegister, 'rowId'>, idx: number) => {
      const rawReg = rawRegs[idx] as Record<string, unknown>;
      const explicitOffset = rawReg.offset ?? rawReg.address_offset ?? rawReg.addressOffset;
      if (explicitOffset !== undefined) {
        currentOffset = parseNumber(explicitOffset, currentOffset);
      }
      const offset = currentOffset;

      if (reg.__kind === 'array') {
        const stride = reg.stride ?? defaultRegBytes;
        const count = reg.count ?? 1;
        currentOffset = offset + count * stride;
      } else {
        const regBytes = reg.size > 0 ? Math.max(1, Math.floor(reg.size / 8)) : defaultRegBytes;
        currentOffset = offset + regBytes;
      }

      return {
        ...reg,
        offset,
      };
    }
  );

  return {
    name: String(raw.name ?? ''),
    baseAddress: parseNumber(raw.baseAddress ?? raw.base_address ?? raw.offset, 0),
    range: (raw.range as number | string | null | undefined) ?? null,
    usage: String(raw.usage ?? 'register'),
    access: raw.access !== undefined ? String(raw.access) : undefined,
    description: String(raw.description ?? ''),
    defaultRegWidth,
    registers: registers as NormalizedRegister[],
  };
}

// Recursive helper to reconcile row IDs
function reconcileMemoryMapHierarchy(
  prevMap: NormalizedMemoryMap | undefined,
  nextBlocks: Array<Omit<NormalizedAddressBlock, 'rowId'>>
): NormalizedAddressBlock[] {
  const prevBlocksWrapper: TableRowWrapper<NormalizedAddressBlock>[] = (
    prevMap?.addressBlocks ?? []
  ).map((b) => ({ rowId: b.rowId, model: b }));

  const reconciledBlocks = reconcileRowIds(
    prevBlocksWrapper,
    nextBlocks as Array<Omit<NormalizedAddressBlock, 'rowId'> & { name: string }>
  );

  return reconciledBlocks.map((bWrapper) => {
    const nextBlock = bWrapper.model as Omit<NormalizedAddressBlock, 'rowId'>;
    const prevBlock = prevMap?.addressBlocks.find((pb) => pb.rowId === bWrapper.rowId);

    const reconciledRegs = reconcileRegisterHierarchy(prevBlock, nextBlock.registers);

    return {
      ...nextBlock,
      rowId: bWrapper.rowId,
      registers: reconciledRegs,
    };
  });
}

function reconcileRegisterHierarchy(
  prevContainer: { registers?: NormalizedRegister[] } | undefined,
  nextRegs: Array<Omit<NormalizedRegister, 'rowId'>>
): NormalizedRegister[] {
  const prevRegsWrapper: TableRowWrapper<NormalizedRegister>[] = (
    prevContainer?.registers ?? []
  ).map((r) => ({ rowId: r.rowId, model: r }));

  const reconciledRegs = reconcileRowIds(
    prevRegsWrapper,
    nextRegs as Array<Omit<NormalizedRegister, 'rowId'> & { name: string }>
  );

  return reconciledRegs.map((rWrapper) => {
    const nextReg = rWrapper.model as Omit<NormalizedRegister, 'rowId'>;
    const prevReg = prevContainer?.registers?.find((pr) => pr.rowId === rWrapper.rowId);

    // Reconcile nested registers if any
    const reconciledNested = nextReg.registers
      ? reconcileRegisterHierarchy(prevReg, nextReg.registers)
      : undefined;

    // Reconcile fields
    const prevFieldsWrapper: TableRowWrapper<NormalizedField>[] = (prevReg?.fields ?? []).map(
      (f) => ({ rowId: f.rowId, model: f })
    );

    const reconciledFields = reconcileRowIds(
      prevFieldsWrapper,
      nextReg.fields as Array<Omit<NormalizedField, 'rowId'> & { name: string }>
    );

    return {
      ...nextReg,
      rowId: rWrapper.rowId,
      fields: reconciledFields.map((fWrapper) => ({
        ...fWrapper.model,
        rowId: fWrapper.rowId,
      })),
      ...(reconciledNested ? { registers: reconciledNested } : {}),
    };
  });
}

/**
 * Normalize a raw parsed memory map object into NormalizedMemoryMap.
 */
export function normalizeMemoryMap(
  rawMap: Record<string, unknown>,
  prevMap?: NormalizedMemoryMap
): NormalizedMemoryMap {
  const rawBlocks = Array.isArray(rawMap.addressBlocks)
    ? rawMap.addressBlocks
    : Array.isArray(rawMap.address_blocks)
      ? rawMap.address_blocks
      : [];

  const nextBlocksWithoutIds = rawBlocks.map((b: unknown) =>
    normalizeBlock(b as Record<string, unknown>)
  );
  const reconciledBlocks = reconcileMemoryMapHierarchy(prevMap, nextBlocksWithoutIds);

  return {
    name: String(rawMap.name ?? ''),
    description: String(rawMap.description ?? ''),
    addressBlocks: reconciledBlocks,
  };
}

/**
 * Parse memory map YAML content, normalizing all aliases to camelCase.
 * Reconciles stable row IDs hierarchically from `prevMap` if provided.
 */
export function parseMemoryMap(text: string, prevMap?: NormalizedMemoryMap): MemoryMapDoc {
  const rootObj = jsyaml.load(text) as Record<string, unknown> | unknown[] | null;
  if (!rootObj) {
    throw new Error('Parsed YAML is empty');
  }

  // Determine root style
  let rootStyle: MemoryMapRootStyle = 'standalone';
  let rawMap: Record<string, unknown> = {};

  if (Array.isArray(rootObj)) {
    rootStyle = 'array';
    rawMap = (rootObj[0] as Record<string, unknown>) ?? {};
  } else if (rootObj && typeof rootObj === 'object') {
    const rootRecord = rootObj;
    if (Array.isArray(rootRecord.memory_maps)) {
      rootStyle = 'nested';
      rawMap = (rootRecord.memory_maps[0] as Record<string, unknown>) ?? {};
    } else if (Array.isArray(rootRecord.memoryMaps)) {
      rootStyle = 'nested';
      rawMap = (rootRecord.memoryMaps[0] as Record<string, unknown>) ?? {};
    } else {
      rawMap = rootRecord;
    }
  }

  const map = normalizeMemoryMap(rawMap, prevMap);

  return {
    rootStyle,
    map,
  };
}

/**
 * Normalize a raw parsed IP Core object into canonical camelCase IpCore.
 */
export function normalizeIpCore(rootObj: Record<string, unknown>): IpCore {
  const busInterfaces = Array.isArray(rootObj.bus_interfaces)
    ? rootObj.bus_interfaces
    : Array.isArray(rootObj.busInterfaces)
      ? rootObj.busInterfaces
      : [];

  const parameters = Array.isArray(rootObj.parameters) ? rootObj.parameters : [];
  const ports = Array.isArray(rootObj.ports) ? rootObj.ports : [];
  const clocks = Array.isArray(rootObj.clocks) ? rootObj.clocks : [];
  const resets = Array.isArray(rootObj.resets) ? rootObj.resets : [];

  const normalizedBusInterfaces = busInterfaces.map((b: unknown) => {
    const bus = b as Record<string, unknown>;
    const useOptionalPorts = bus.use_optional_ports ?? bus.useOptionalPorts ?? [];
    const portWidthOverrides = bus.port_width_overrides ?? bus.portWidthOverrides ?? {};
    const portNameOverrides = bus.port_name_overrides ?? bus.portNameOverrides;
    const absentPorts = bus.absent_ports ?? bus.absentPorts;
    const conduitPorts = bus.conduit_ports ?? bus.conduitPorts;

    const array = bus.array as Record<string, unknown> | undefined;
    const mode = String(bus.mode ?? '').toLowerCase();

    return {
      name: String(bus.name ?? ''),
      type: String(bus.type ?? ''),
      mode,
      physicalPrefix:
        bus.physicalPrefix === null || bus.physical_prefix === null
          ? ''
          : String(
              bus.physicalPrefix ?? bus.physical_prefix ?? (mode === 'conduit' ? '' : 's_axi_')
            ),
      ...(bus.physicalNamePattern ? { physicalNamePattern: String(bus.physicalNamePattern) } : {}),
      useOptionalPorts,
      portWidthOverrides,
      portNameOverrides,
      absentPorts,
      conduitPorts,
      associatedClock: String(bus.associatedClock ?? bus.associated_clock ?? ''),
      associatedReset: String(bus.associatedReset ?? bus.associated_reset ?? ''),
      ...(array
        ? {
            array: {
              count: parseNumber(array.count, 1),
              indexStart: parseNumber(array.indexStart ?? array.index_start, 0),
              namingPattern: String(array.namingPattern ?? array.naming_pattern ?? ''),
              physicalPrefixPattern: String(
                array.physicalPrefixPattern ?? array.physical_prefix_pattern ?? ''
              ),
            },
          }
        : {}),
      ports: Array.isArray(bus.ports) ? bus.ports : undefined,
      ...(bus.busTypeVlnv ? { busTypeVlnv: bus.busTypeVlnv } : {}),
      ...(bus.rawPortMaps ? { rawPortMaps: bus.rawPortMaps } : {}),
    };
  });

  return {
    ...rootObj,
    vlnv: rootObj.vlnv ?? {},
    description: String(rootObj.description ?? ''),
    parameters: parameters.map((p: unknown) => {
      const param = p as Record<string, unknown>;
      return {
        name: String(param.name ?? ''),
        value: param.value ?? param.defaultValue,
        dataType: String(param.dataType ?? ''),
        description: param.description ? String(param.description) : undefined,
        min: param.min !== null && param.min !== undefined ? Number(param.min) : undefined,
        max: param.max !== null && param.max !== undefined ? Number(param.max) : undefined,
        allowedValues: Array.isArray(param.allowedValues) ? param.allowedValues : undefined,
        uiPage: param.uiPage ? String(param.uiPage) : undefined,
        uiGroup: param.uiGroup ? String(param.uiGroup) : undefined,
      };
    }),
    ports: ports.map((p: unknown) => {
      const port = p as Record<string, unknown>;
      return {
        name: String(port.name ?? ''),
        direction: String(port.direction ?? ''),
        width: port.width ?? 1,
        presence: String(port.presence ?? ''),
      };
    }),
    busInterfaces: normalizedBusInterfaces,
    clocks: clocks.map((c: unknown) => {
      const clock = c as Record<string, unknown>;
      return {
        name: String(clock.name ?? ''),
        ...(clock.frequency !== undefined ? { frequency: clock.frequency } : {}),
        ...((clock.associatedReset ?? clock.associated_reset)
          ? { associatedReset: String(clock.associatedReset ?? clock.associated_reset) }
          : {}),
      };
    }),
    resets: resets.map((r: unknown) => {
      const reset = r as Record<string, unknown>;
      return {
        name: String(reset.name ?? ''),
        polarity: String(reset.polarity ?? ''),
        ...((reset.associatedClock ?? reset.associated_clock)
          ? { associatedClock: String(reset.associatedClock ?? reset.associated_clock) }
          : {}),
      };
    }),
    memoryMaps: rootObj.memoryMaps ?? rootObj.memory_maps,
    subcores: (Array.isArray(rootObj.subcores) ? rootObj.subcores : []).map((s: unknown) => {
      if (typeof s === 'string') {
        return { vlnv: s };
      }
      const sc = s as Record<string, unknown>;
      return {
        vlnv: String(sc.vlnv ?? ''),
        ...(sc.path ? { path: String(sc.path) } : {}),
      };
    }),
  } as unknown as IpCore;
}

/**
 * Parse IP Core YAML content, normalizing all aliases to camelCase.
 */
export function parseIpCore(text: string): IpCore {
  const rootObj = jsyaml.load(text) as Record<string, unknown> | null;
  if (!rootObj || typeof rootObj !== 'object') {
    throw new Error('Parsed IP Core YAML is empty or invalid');
  }
  return normalizeIpCore(rootObj);
}
