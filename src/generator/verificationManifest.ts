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
  mask: number;
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
  resetValue: number;
  readableMask: number;
  writableMask: number;
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

function widthMask(width: number): number {
  if (width >= 32) {
    return 0xffffffff;
  }
  return 2 ** width - 1;
}

function normalizeAccess(access: string | undefined): string {
  return (access ?? 'read-write').toLowerCase().replace(/_/g, '-');
}

function fieldMask(field: NormalizedField, registerWidth: number): number {
  const availableWidth = Math.max(0, Math.min(field.width, registerWidth - field.offset));
  if (availableWidth === 0) {
    return 0;
  }
  return (widthMask(availableWidth) << field.offset) >>> 0;
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

function projectField(field: NormalizedField, registerWidth: number): VerificationField {
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
    mask: fieldMask(field, registerWidth),
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
  registerWidth: number
): number {
  if (fields.length === 0 || reg.resetValue !== 0) {
    return (reg.resetValue & widthMask(registerWidth)) >>> 0;
  }
  return fields.reduce((value, field) => {
    const fieldValue = (field.resetValue << field.bitOffset) & field.mask;
    return ((value & ~field.mask) | fieldValue) >>> 0;
  }, 0);
}

function projectLeafRegister(
  reg: NormalizedRegister,
  offset: number,
  name: string,
  defaultWidth: number,
  arrayDimensions: VerificationArrayDimension[]
): VerificationRegister {
  const registerWidth = reg.size > 0 ? reg.size : defaultWidth;
  const fields =
    reg.fields.length > 0
      ? reg.fields.map((field) => projectField(field, registerWidth))
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
            registerWidth
          ),
        ];
  const readableMask = fields.reduce(
    (mask, field) => (field.readable ? mask | field.mask : mask),
    0
  );
  const writableMask = fields.reduce(
    (mask, field) => (field.writable ? mask | field.mask : mask),
    0
  );

  return {
    name,
    offset,
    width: registerWidth,
    resetValue: composeResetValue(reg, fields, registerWidth),
    readableMask: readableMask >>> 0,
    writableMask: writableMask >>> 0,
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
      projectLeafRegister(reg, currentOffset + index * stride, name, defaultWidth, arrayDimensions)
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
        expandRegister(reg, block.baseAddress, '', block.defaultRegWidth, [], registers);
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
