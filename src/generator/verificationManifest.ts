import type {
  NormalizedField,
  NormalizedMemoryMap,
  NormalizedRegister,
} from '../domain/internal.types';

export type VerificationProvenance = 'spec' | 'generatorPolicy' | 'busBinding';

export interface VerificationFact<T> {
  value: T;
  provenance: VerificationProvenance;
}

export interface VerificationField {
  name: string;
  bitOffset: number;
  bitWidth: number;
  mask: bigint;
  access: string;
  resetValue: number;
  readable: boolean;
  writable: boolean;
  writeEffect: 'replace' | 'clearOnOne' | 'setOnOne' | 'none';
  hardwareSoftwarePriority?: 'hardwareSet' | 'hardwareClear';
  provenance: {
    layout: VerificationProvenance;
    access: VerificationProvenance;
    resetValue: VerificationProvenance;
    writeEffect: VerificationProvenance;
    hardwareSoftwarePriority?: VerificationProvenance;
  };
}

export interface VerificationArrayDimension {
  name: string;
  index: number;
  lowerBound: number;
  upperBound: number;
  stride: number;
}

export interface VerificationRegister {
  name: string;
  offset: number;
  width: number;
  resetValue: bigint;
  readableMask: bigint;
  writableMask: bigint;
  fields: VerificationField[];
  arrayDimensions: VerificationArrayDimension[];
  provenance: {
    identity: VerificationProvenance;
    layout: VerificationProvenance;
    resetValue: VerificationProvenance;
    masks: VerificationProvenance;
    arrayBounds?: VerificationProvenance;
  };
}

export interface VerificationManifest {
  schemaVersion: 1;
  source: {
    model: 'normalizedMemoryMap';
    provenance: VerificationProvenance;
  };
  bus: {
    type: VerificationFact<string>;
    dataWidth: VerificationFact<number>;
    byteEnable: VerificationFact<{
      supported: boolean;
      laneCount: number;
      behavior: 'perByteWriteMask' | 'allBytesEnabled';
    }>;
  };
  policies: {
    reservedBitsReadAsZero: VerificationFact<boolean>;
    unmappedReadsReturnZero: VerificationFact<boolean>;
    writeOneToClearPriority: VerificationFact<'hardwareSet'>;
    selfClearingPriority: VerificationFact<'hardwareClear'>;
  };
  registers: VerificationRegister[];
}

export interface VerificationBusBinding {
  busType: string;
  dataWidth: number;
  byteEnableSupported: boolean;
}

const READABLE_ACCESS = new Set([
  'read-write',
  'rw',
  'read-only',
  'ro',
  'read-write-1-to-clear',
  'read-write-self-clearing',
]);
const WRITABLE_ACCESS = new Set([
  'read-write',
  'rw',
  'write-only',
  'wo',
  'write-1-to-clear',
  'read-write-1-to-clear',
  'write-self-clearing',
  'read-write-self-clearing',
]);

// Masks and reset values are bigint: a register (and a field) can be wider than
// the 32 bits JavaScript bitwise operators keep, and 2^64-1 is not a safe number.
function widthMask(width: number): bigint {
  return (BigInt(1) << BigInt(width)) - BigInt(1);
}

function normalizeAccess(access: string | undefined): string {
  return (access ?? 'read-write').toLowerCase().replace(/_/g, '-');
}

function fieldMask(field: NormalizedField, dataWidth: number): bigint {
  const availableWidth = Math.max(0, Math.min(field.width, dataWidth - field.offset));
  if (availableWidth === 0) {
    return BigInt(0);
  }
  return widthMask(availableWidth) << BigInt(field.offset);
}

function writeEffect(access: string): 'replace' | 'clearOnOne' | 'setOnOne' | 'none' {
  if (access === 'write-1-to-clear' || access === 'read-write-1-to-clear') {
    return 'clearOnOne';
  }
  if (access === 'write-self-clearing' || access === 'read-write-self-clearing') {
    return 'setOnOne';
  }
  return WRITABLE_ACCESS.has(access) ? 'replace' : 'none';
}

function projectField(field: NormalizedField, dataWidth: number): VerificationField {
  const access = normalizeAccess(field.access);
  const effect = writeEffect(access);
  const hardwareSoftwarePriority =
    effect === 'clearOnOne'
      ? ('hardwareSet' as const)
      : effect === 'setOnOne'
        ? ('hardwareClear' as const)
        : undefined;

  return {
    name: field.name,
    bitOffset: field.offset,
    bitWidth: field.width,
    mask: fieldMask(field, dataWidth),
    access,
    resetValue: field.resetValue,
    readable: READABLE_ACCESS.has(access),
    writable: WRITABLE_ACCESS.has(access),
    writeEffect: effect,
    hardwareSoftwarePriority,
    provenance: {
      layout: 'spec',
      access: 'spec',
      resetValue: 'spec',
      writeEffect: 'generatorPolicy',
      ...(hardwareSoftwarePriority ? { hardwareSoftwarePriority: 'generatorPolicy' as const } : {}),
    },
  };
}

function composeResetValue(
  reg: NormalizedRegister,
  fields: VerificationField[],
  dataWidth: number
): bigint {
  if (fields.length === 0 || reg.resetValue !== 0) {
    return BigInt(reg.resetValue) & widthMask(dataWidth);
  }
  return fields.reduce((value, field) => {
    const fieldValue = (BigInt(field.resetValue) << BigInt(field.bitOffset)) & field.mask;
    return (value & ~field.mask) | fieldValue;
  }, BigInt(0));
}

function projectLeafRegister(
  reg: NormalizedRegister,
  offset: number,
  name: string,
  defaultWidth: number,
  dataWidth: number,
  arrayDimensions: VerificationArrayDimension[]
): VerificationRegister {
  const registerWidth = reg.size > 0 ? reg.size : defaultWidth;
  const fields =
    reg.fields.length > 0
      ? reg.fields.map((field) => projectField(field, dataWidth))
      : [
          projectField(
            {
              rowId: '',
              name: reg.name,
              bits: `[${registerWidth - 1}:0]`,
              offset: 0,
              width: registerWidth,
              access: reg.access,
              resetValue: reg.resetValue,
              description: reg.description,
            },
            dataWidth
          ),
        ];
  const readableMask = fields.reduce(
    (mask, field) => (field.readable ? mask | field.mask : mask),
    BigInt(0)
  );
  const writableMask = fields.reduce(
    (mask, field) => (field.writable ? mask | field.mask : mask),
    BigInt(0)
  );

  return {
    name,
    offset,
    width: registerWidth,
    resetValue: composeResetValue(reg, fields, dataWidth),
    readableMask,
    writableMask,
    fields,
    arrayDimensions,
    provenance: {
      identity: 'spec',
      layout: 'spec',
      resetValue: 'spec',
      masks: 'generatorPolicy',
      ...(arrayDimensions.length > 0 ? { arrayBounds: 'spec' as const } : {}),
    },
  };
}

function expandRegister(
  reg: NormalizedRegister,
  baseOffset: number,
  prefix: string,
  defaultWidth: number,
  dataWidth: number,
  dimensions: VerificationArrayDimension[],
  out: VerificationRegister[]
): void {
  const currentOffset = baseOffset + reg.offset;
  const count = reg.count ?? 1;
  const stride = reg.stride ?? Math.max(1, defaultWidth / 8);

  if (reg.registers && reg.registers.length > 0) {
    for (let index = 0; index < count; index += 1) {
      const childPrefix = count > 1 ? `${prefix}${reg.name}_${index}_` : `${prefix}${reg.name}_`;
      const childDimensions =
        count > 1
          ? [
              ...dimensions,
              {
                name: reg.name,
                index,
                lowerBound: 0,
                upperBound: count - 1,
                stride,
              },
            ]
          : dimensions;
      for (const child of reg.registers) {
        expandRegister(
          child,
          currentOffset + index * stride,
          childPrefix,
          defaultWidth,
          dataWidth,
          childDimensions,
          out
        );
      }
    }
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const isArray = count > 1;
    const arrayDimensions = isArray
      ? [
          ...dimensions,
          {
            name: reg.name,
            index,
            lowerBound: 0,
            upperBound: count - 1,
            stride,
          },
        ]
      : dimensions;
    const name = isArray ? `${prefix}${reg.name}_${index}` : `${prefix}${reg.name}`;
    out.push(
      projectLeafRegister(
        reg,
        currentOffset + index * stride,
        name,
        defaultWidth,
        dataWidth,
        arrayDimensions
      )
    );
  }
}

export function buildVerificationManifest(
  maps: NormalizedMemoryMap[],
  binding: VerificationBusBinding
): VerificationManifest {
  const registers: VerificationRegister[] = [];
  for (const map of maps) {
    for (const block of map.addressBlocks) {
      for (const reg of block.registers) {
        expandRegister(
          reg,
          block.baseAddress,
          '',
          block.defaultRegWidth,
          binding.dataWidth,
          [],
          registers
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    source: {
      model: 'normalizedMemoryMap',
      provenance: 'spec',
    },
    bus: {
      type: { value: binding.busType, provenance: 'busBinding' },
      dataWidth: { value: binding.dataWidth, provenance: 'busBinding' },
      byteEnable: {
        value: {
          supported: binding.byteEnableSupported,
          laneCount: Math.ceil(binding.dataWidth / 8),
          behavior: binding.byteEnableSupported ? 'perByteWriteMask' : 'allBytesEnabled',
        },
        provenance: 'busBinding',
      },
    },
    policies: {
      reservedBitsReadAsZero: { value: true, provenance: 'generatorPolicy' },
      unmappedReadsReturnZero: { value: true, provenance: 'generatorPolicy' },
      writeOneToClearPriority: { value: 'hardwareSet', provenance: 'generatorPolicy' },
      selfClearingPriority: { value: 'hardwareClear', provenance: 'generatorPolicy' },
    },
    registers: registers.sort((left, right) => left.offset - right.offset),
  };
}

const BIGINT_SENTINEL = '__ipcraft_bigint__';
const BIGINT_SENTINEL_PATTERN = new RegExp(`"${BIGINT_SENTINEL}(-?\\d+)"`, 'g');

/**
 * Serialize the manifest as JSON, writing bigint masks and reset values as bare
 * integer literals. The Python consumers parse them exactly; `JSON.rawJSON` is
 * unavailable on the Node 16 runtime of VS Code 1.80.
 */
export function serializeVerificationManifest(manifest: VerificationManifest): string {
  const json = JSON.stringify(
    manifest,
    (_key, value: unknown) => (typeof value === 'bigint' ? `${BIGINT_SENTINEL}${value}` : value),
    2
  );
  return `${json.replace(BIGINT_SENTINEL_PATTERN, '$1')}\n`;
}
