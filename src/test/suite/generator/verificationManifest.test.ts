import {
  buildVerificationManifest,
  type VerificationManifest,
} from '../../../generator/verificationManifest';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';

function buildMap(): NormalizedMemoryMap {
  return {
    name: 'TEST',
    description: '',
    addressBlocks: [
      {
        rowId: 'block',
        name: 'REGS',
        baseAddress: 0x100,
        usage: 'register',
        description: '',
        defaultRegWidth: 32,
        registers: [
          {
            rowId: 'mixed',
            name: 'MIXED',
            offset: 0,
            size: 32,
            resetValue: 0,
            description: '',
            fields: [
              {
                rowId: 'rw',
                name: 'RW',
                bits: '[7:0]',
                offset: 0,
                width: 8,
                access: 'read-write',
                resetValue: 0x12,
                description: '',
              },
              {
                rowId: 'ro',
                name: 'RO',
                bits: '[15:8]',
                offset: 8,
                width: 8,
                access: 'read-only',
                resetValue: 0x34,
                description: '',
              },
              {
                rowId: 'w1c',
                name: 'W1C',
                bits: '[16:16]',
                offset: 16,
                width: 1,
                access: 'read-write-1-to-clear',
                resetValue: 1,
                description: '',
              },
              {
                rowId: 'sc',
                name: 'SC',
                bits: '[17:17]',
                offset: 17,
                width: 1,
                access: 'write-self-clearing',
                resetValue: 0,
                description: '',
              },
            ],
          },
          {
            rowId: 'array',
            name: 'CHANNEL',
            offset: 0x20,
            size: 32,
            resetValue: 0,
            description: '',
            fields: [],
            __kind: 'array',
            count: 2,
            stride: 0x10,
            registers: [
              {
                rowId: 'config',
                name: 'CONFIG',
                offset: 4,
                size: 16,
                resetValue: 0x55aa,
                access: 'read-write',
                description: '',
                fields: [],
              },
            ],
          },
          {
            rowId: 'register-reset',
            name: 'SCRATCH',
            offset: 0x60,
            size: 32,
            resetValue: 0xdeadbeef,
            access: 'read-write',
            description: '',
            fields: [
              {
                rowId: 'value',
                name: 'VALUE',
                bits: '[31:0]',
                offset: 0,
                width: 32,
                access: 'read-write',
                resetValue: 0,
                description: '',
              },
            ],
          },
          {
            rowId: 'group',
            name: 'GROUP',
            offset: 0x80,
            size: 32,
            resetValue: 0,
            description: '',
            fields: [],
            __kind: 'array',
            count: 1,
            stride: 4,
            registers: [
              {
                rowId: 'group-status',
                name: 'STATUS',
                offset: 0,
                size: 32,
                resetValue: 0,
                access: 'read-only',
                description: '',
                fields: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('buildVerificationManifest', () => {
  let manifest: VerificationManifest;

  beforeEach(() => {
    manifest = buildVerificationManifest([buildMap()], {
      busType: 'axil',
      dataWidth: 32,
      byteEnableSupported: true,
    });
  });

  it('derives reset values and readable/writable masks from normalized field semantics', () => {
    const mixed = manifest.registers[0];
    expect(mixed).toMatchObject({
      name: 'MIXED',
      offset: 0x100,
      width: 32,
      resetValue: 0x13412,
      readableMask: 0x1ffff,
      writableMask: 0x300ff,
    });
    expect(mixed.fields.map((field) => [field.name, field.writeEffect])).toEqual([
      ['RW', 'replace'],
      ['RO', 'none'],
      ['W1C', 'clearOnOne'],
      ['SC', 'setOnOne'],
    ]);
    expect(mixed.fields[2]).toMatchObject({
      hardwareSoftwarePriority: 'hardwareSet',
      provenance: {
        access: 'spec',
        writeEffect: 'generatorPolicy',
        hardwareSoftwarePriority: 'generatorPolicy',
      },
    });
    expect(mixed.fields[3]).toMatchObject({
      hardwareSoftwarePriority: 'hardwareClear',
    });
  });

  it('expands register arrays while retaining reviewable bounds and stride', () => {
    expect(manifest.registers.filter((reg) => reg.arrayDimensions.length > 0)).toMatchObject([
      {
        name: 'CHANNEL_0_CONFIG',
        offset: 0x124,
        width: 16,
        resetValue: 0x55aa,
        arrayDimensions: [
          { name: 'CHANNEL', index: 0, lowerBound: 0, upperBound: 1, stride: 0x10 },
        ],
        provenance: { arrayBounds: 'spec' },
      },
      {
        name: 'CHANNEL_1_CONFIG',
        offset: 0x134,
        arrayDimensions: [
          { name: 'CHANNEL', index: 1, lowerBound: 0, upperBound: 1, stride: 0x10 },
        ],
      },
    ]);
  });

  it('does not label a count-one nested group as an array dimension', () => {
    expect(manifest.registers.find((reg) => reg.name === 'GROUP_STATUS')).toMatchObject({
      offset: 0x180,
      arrayDimensions: [],
      provenance: {
        identity: 'spec',
        layout: 'spec',
        resetValue: 'spec',
        masks: 'generatorPolicy',
      },
    });
    expect(
      manifest.registers.find((reg) => reg.name === 'GROUP_STATUS')?.provenance
    ).not.toHaveProperty('arrayBounds');
  });

  it('labels specification, generator-policy, and bus-binding facts', () => {
    expect(manifest.source).toEqual({
      model: 'normalizedMemoryMap',
      provenance: 'spec',
    });
    expect(manifest.bus).toMatchObject({
      type: { value: 'axil', provenance: 'busBinding' },
      dataWidth: { value: 32, provenance: 'busBinding' },
      byteEnable: {
        value: { supported: true, laneCount: 4, behavior: 'perByteWriteMask' },
        provenance: 'busBinding',
      },
    });
    expect(manifest.policies).toMatchObject({
      reservedBitsReadAsZero: { value: true, provenance: 'generatorPolicy' },
      writeOneToClearPriority: { value: 'hardwareSet', provenance: 'generatorPolicy' },
      selfClearingPriority: { value: 'hardwareClear', provenance: 'generatorPolicy' },
    });
  });

  it('preserves a whole-register reset when the register also declares fields', () => {
    expect(manifest.registers.find((reg) => reg.name === 'SCRATCH')).toMatchObject({
      resetValue: 0xdeadbeef,
      provenance: { resetValue: 'spec' },
    });
  });
});
