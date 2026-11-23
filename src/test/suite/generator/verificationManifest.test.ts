import {
  buildVerificationManifest,
  serializeVerificationManifest,
  type VerificationManifest,
} from '../../../generator/verificationManifest';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';
import { parseMemoryMap } from '../../../domain/parse';
import { resolveVersionRefsInMap } from '../../../shared/versioning/resolveVersionRefs';

// The TS target (es6) has no bigint literals, so build them with BigInt().
const big = (value: number | string): bigint => BigInt(value);

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
      resetValue: big('0x13412'),
      readableMask: big('0x1ffff'),
      writableMask: big('0x300ff'),
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
        resetValue: big('0x55aa'),
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
      resetValue: big('0xdeadbeef'),
      provenance: { resetValue: 'spec' },
    });
  });
});

describe('buildVerificationManifest with resolved $version constants', () => {
  const resolvedMap = (scheme: 'major.minor.patch', version: string): NormalizedMemoryMap =>
    resolveVersionRefsInMap(
      parseMemoryMap(`
- name: CSR
  addressBlocks:
    - name: REGS
      baseAddress: 0
      registers:
        - name: IDENT
          offset: 0
          fields:
            - { name: REV, bits: "[31:24]", resetValue: $version.major, access: read-write }
            - { name: EN, bits: "[0]", resetValue: 1, access: read-write }
        - { name: VERSION, offset: 4, resetValue: $version }
        - name: LOCKED
          offset: 8
          resetValue: 0xffffffff
          fields:
            - { name: REV, bits: "[7:0]", resetValue: $version.minor }
            - { name: REST, bits: "[31:8]", access: read-write }
`).map,
      scheme,
      version
    );

  const manifest = buildVerificationManifest([resolvedMap('major.minor.patch', '1.4.2')], {
    busType: 'axil',
    dataWidth: 32,
    byteEnableSupported: true,
  });
  const reg = (name: string) => manifest.registers.find((r) => r.name === name)!;

  it('reads constant fields, never writes them, and uses the resolved reset', () => {
    const rev = reg('IDENT').fields.find((field) => field.name === 'REV')!;
    expect(rev).toMatchObject({
      access: 'read-only',
      readable: true,
      writable: false,
      writeEffect: 'none',
      resetValue: 1,
    });
    expect(reg('IDENT')).toMatchObject({
      resetValue: big('0x01000001'),
      readableMask: big('0xff000001'),
      writableMask: big('0x1'),
    });
  });

  it('treats a register-level $version as a read-only register with the packed value', () => {
    expect(reg('VERSION')).toMatchObject({
      resetValue: big('0x010402'),
      readableMask: big('0xffffffff'),
      writableMask: big(0),
    });
    expect(reg('VERSION').fields[0]).toMatchObject({ writable: false, writeEffect: 'none' });
  });

  it('keeps a constant at its resolved value under a register-level reset word', () => {
    expect(reg('LOCKED').resetValue).toBe(big('0xffffff04'));
  });
});

describe('buildVerificationManifest with fields wider than 32 bits', () => {
  const wideMap = (): NormalizedMemoryMap =>
    parseMemoryMap(`
- name: WIDE
  addressBlocks:
    - name: REGS
      baseAddress: 0
      defaultRegWidth: 64
      registers:
        - name: FULL
          offset: 0
          fields:
            - { name: DATA, bits: "[63:0]", access: read-write }
        - name: HIGH
          offset: 8
          fields:
            - { name: UPPER, bits: "[63:32]", resetValue: 1, access: read-write }
            - { name: LOW, bits: "[7:0]", access: read-only }
`).map;

  const manifest = buildVerificationManifest([wideMap()], {
    busType: 'axil',
    dataWidth: 64,
    byteEnableSupported: true,
  });
  const reg = (name: string) => manifest.registers.find((r) => r.name === name)!;

  it('keeps all 64 bits of a full-width field mask and the register masks', () => {
    expect(reg('FULL').fields[0].mask).toBe(big('0xffffffffffffffff'));
    expect(reg('FULL')).toMatchObject({
      readableMask: big('0xffffffffffffffff'),
      writableMask: big('0xffffffffffffffff'),
    });
  });

  it('places an upper-half field mask above bit 31', () => {
    expect(reg('HIGH').fields[0].mask).toBe(big('0xffffffff00000000'));
    expect(reg('HIGH')).toMatchObject({
      readableMask: big('0xffffffff000000ff'),
      writableMask: big('0xffffffff00000000'),
    });
  });

  it('composes a register reset value from a field reset above bit 31', () => {
    expect(reg('HIGH').resetValue).toBe(big('0x100000000'));
  });

  it('clamps field masks to the bus data width, not the register size', () => {
    const narrow = buildVerificationManifest([wideMap()], {
      busType: 'axil',
      dataWidth: 32,
      byteEnableSupported: true,
    });
    const full = narrow.registers.find((r) => r.name === 'FULL')!;
    expect(full.fields[0].mask).toBe(big('0xffffffff'));
    expect(full.readableMask).toBe(big('0xffffffff'));
    expect(narrow.registers.find((r) => r.name === 'HIGH')!.fields[0].mask).toBe(big(0));
  });

  it('keeps the register width reported from its size, whatever the bus width', () => {
    expect(reg('FULL').width).toBe(32);
  });
});

describe('serializeVerificationManifest', () => {
  const build = (dataWidth: number, bits: string) =>
    buildVerificationManifest(
      [
        parseMemoryMap(`
- name: M
  addressBlocks:
    - name: REGS
      baseAddress: 0
      defaultRegWidth: ${dataWidth}
      registers:
        - name: R
          offset: 0
          fields:
            - { name: F, bits: "${bits}", resetValue: 5, access: read-write }
`).map,
      ],
      { busType: 'axil', dataWidth, byteEnableSupported: true }
    );

  it('writes 64-bit masks as exact bare JSON integers', () => {
    const text = serializeVerificationManifest(build(64, '[63:0]'));
    expect(text).toContain('"mask": 18446744073709551615,');
    expect(text).toContain('"writableMask": 18446744073709551615,');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('leaves the text of a 32-bit manifest identical to plain JSON.stringify', () => {
    const manifest = build(32, '[31:0]');
    const plain = JSON.stringify(
      manifest,
      (_key, value: unknown) => (typeof value === 'bigint' ? Number(value) : value),
      2
    );
    expect(serializeVerificationManifest(manifest)).toBe(`${plain}\n`);
    expect(serializeVerificationManifest(manifest)).toContain('"mask": 4294967295,');
  });
});
