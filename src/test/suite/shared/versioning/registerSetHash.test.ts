import { parseMemoryMap } from '../../../../domain/parse';
import {
  REGISTER_SET_HASH_PREFIX,
  canonicalJson,
  hashRegisterSet,
  projectRegisterSet,
} from '../../../../shared/versioning/registerSetHash';

const BASE = `
- name: CSR
  description: Control and status
  addressBlocks:
    - name: REGS
      baseAddress: 0x1000
      range: 4096
      usage: register
      defaultRegWidth: 32
      registers:
        - name: VERSION
          offset: 0
          access: read-only
          resetValue: $version
          description: Core version
        - name: CTRL
          offset: 4
          access: read-write
          description: Control
          fields:
            - name: EN
              bits: "[0:0]"
              access: read-write
              resetValue: 1
              description: Enable
            - name: MODE
              bits: "[7:4]"
              access: read-write
              resetValue: 0x3
              enumeratedValues:
                0: A
                3: B
        - name: LUT
          offset: 8
          count: 4
          stride: 4
          fields:
            - name: V
              bits: "[7:0]"
`;

function hashOf(text: string): string {
  return hashRegisterSet(parseMemoryMap(text).map.addressBlocks);
}

/** Replace the first occurrence, failing loudly when BASE no longer contains it. */
function edit(from: string, to: string): string {
  expect(BASE).toContain(from);
  return BASE.replace(from, to);
}

describe('hashRegisterSet', () => {
  const baseHash = hashOf(BASE);

  it('has the rs1-<16 hex> shape', () => {
    expect(baseHash).toMatch(/^rs1-[0-9a-f]{16}$/);
    expect(baseHash.startsWith(`${REGISTER_SET_HASH_PREFIX}-`)).toBe(true);
  });

  it('is stable for identical input', () => {
    expect(hashOf(BASE)).toBe(baseHash);
  });

  describe('is unchanged by', () => {
    it('comments and blank lines', () => {
      const text = `# header comment\n${BASE.replace('- name: VERSION', '# the version\n\n        - name: VERSION')}\n# trailer\n`;
      expect(hashOf(text)).toBe(baseHash);
    });

    it('YAML formatting (flow style, quoting, indentation)', () => {
      const flow = `[{ name: CSR, addressBlocks: [{ name: REGS, baseAddress: 0x1000, range: 4096, usage: register, defaultRegWidth: 32, registers: [
{ name: VERSION, offset: 0, access: read-only, resetValue: '$version' },
{ name: CTRL, offset: 4, access: read-write, fields: [{ name: EN, bits: '[0:0]', access: read-write, resetValue: 1 }, { name: MODE, bits: '[7:4]', access: read-write, resetValue: 3 }] },
{ name: LUT, offset: 8, count: 4, stride: 4, fields: [{ name: V, bits: '[7:0]' }] } ] }] }]`;
      expect(hashOf(flow)).toBe(baseHash);
    });

    it('key order', () => {
      const reordered = edit(
        '        - name: CTRL\n          offset: 4\n          access: read-write\n',
        '        - access: read-write\n          offset: 4\n          name: CTRL\n'
      );
      expect(hashOf(reordered)).toBe(baseHash);
    });

    it('hex versus decimal spelling', () => {
      expect(hashOf(edit('baseAddress: 0x1000', 'baseAddress: 4096'))).toBe(baseHash);
      expect(hashOf(edit('resetValue: 0x3', 'resetValue: 3'))).toBe(baseHash);
      expect(hashOf(edit('offset: 8', 'offset: 0x8'))).toBe(baseHash);
    });

    it('bits spelled as offset and width', () => {
      const spelled = edit('bits: "[7:4]"', 'offset: 4\n              width: 4');
      expect(hashOf(spelled)).toBe(baseHash);
    });

    it('a single-bit field spelled [n] or [n:n]', () => {
      expect(hashOf(edit('bits: "[0:0]"', 'bits: "[0]"'))).toBe(baseHash);
    });

    it('descriptions, enumerated values and monitorChangeOf', () => {
      let text = edit('description: Core version', 'description: Something else entirely');
      text = text.replace('description: Control and status', 'description: Renamed doc');
      text = text.replace('0: A', '0: ZERO').replace('description: Enable', '');
      expect(hashOf(text)).toBe(baseHash);
    });

    it('the memory map name and description', () => {
      expect(hashOf(BASE.replace('name: CSR', 'name: OTHER'))).toBe(baseHash);
    });

    it('an omitted default (explicit 0 reset, absent reset)', () => {
      expect(hashOf(edit('bits: "[7:0]"', 'bits: "[7:0]"\n              resetValue: 0'))).toBe(
        baseHash
      );
    });
  });

  describe('changes with', () => {
    it.each([
      [
        'a register offset',
        'offset: 4\n          access: read-write',
        'offset: 12\n          access: read-write',
      ],
      ['a field width', 'bits: "[7:4]"', 'bits: "[7:3]"'],
      ['a field offset', 'bits: "[7:4]"', 'bits: "[8:5]"'],
      ['a register access', 'access: read-only', 'access: read-write'],
      [
        'a field access',
        'name: EN\n              bits: "[0:0]"\n              access: read-write',
        'name: EN\n              bits: "[0:0]"\n              access: read-only',
      ],
      ['a field reset value', 'resetValue: 0x3', 'resetValue: 0x4'],
      [
        'a register reset value',
        'access: read-only\n          resetValue: $version',
        'access: read-only\n          resetValue: 5',
      ],
      ['token text', 'resetValue: $version', 'resetValue: $version.major'],
      ['a name', 'name: CTRL', 'name: CTRL2'],
      ['a field name', 'name: EN', 'name: ENABLE'],
      ['an array count', 'count: 4', 'count: 8'],
      ['an array stride', 'stride: 4', 'stride: 8'],
      ['the block base address', 'baseAddress: 0x1000', 'baseAddress: 0x2000'],
      ['the block range', 'range: 4096', 'range: 8192'],
      ['the block default register width', 'defaultRegWidth: 32', 'defaultRegWidth: 64'],
      [
        'the register size',
        'name: CTRL\n          offset: 4',
        'name: CTRL\n          size: 16\n          offset: 4',
      ],
    ])('%s', (_label, from, to) => {
      expect(hashOf(edit(from, to))).not.toBe(baseHash);
    });

    it('a token on a field', () => {
      expect(hashOf(edit('resetValue: 1\n', 'resetValue: $version.minor\n'))).not.toBe(baseHash);
    });

    it('different token kinds hash differently', () => {
      const a = hashOf(edit('resetValue: $version', 'resetValue: $version.major'));
      const b = hashOf(edit('resetValue: $version', 'resetValue: $version.minor'));
      expect(a).not.toBe(b);
    });

    it('field order', () => {
      const swapped = `
- name: CSR
  addressBlocks:
    - name: REGS
      registers:
        - name: R
          offset: 0
          fields:
            - { name: B, bits: "[1:1]" }
            - { name: A, bits: "[0:0]" }
`;
      const original = swapped.replace(
        '- { name: B, bits: "[1:1]" }\n            - { name: A, bits: "[0:0]" }',
        '- { name: A, bits: "[0:0]" }\n            - { name: B, bits: "[1:1]" }'
      );
      expect(hashOf(swapped)).not.toBe(hashOf(original));
    });

    it('register and block order', () => {
      const two = (first: string, second: string): string => `
- name: CSR
  addressBlocks:
    - name: REGS
      registers:
        - { name: ${first}, offset: 0 }
        - { name: ${second}, offset: 4 }
`;
      expect(hashOf(two('A', 'B'))).not.toBe(hashOf(two('B', 'A')));
    });
  });
});

describe('projectRegisterSet', () => {
  it('keeps only driver-relevant keys', () => {
    const blocks = parseMemoryMap(BASE).map.addressBlocks;
    const projected = JSON.parse(canonicalJson(projectRegisterSet(blocks))) as Array<
      Record<string, unknown>
    >;
    expect(Object.keys(projected[0]).sort()).toEqual(
      ['baseAddress', 'defaultRegWidth', 'name', 'range', 'registers', 'usage'].sort()
    );
    const registers = projected[0].registers as Array<Record<string, unknown>>;
    for (const register of registers) {
      for (const key of Object.keys(register)) {
        expect([
          'name',
          'offset',
          'size',
          'access',
          'resetValue',
          'versionRef',
          'count',
          'stride',
          'fields',
          'registers',
        ]).toContain(key);
      }
    }
    expect(registers[0]).toMatchObject({ name: 'VERSION', versionRef: '$version', resetValue: 0 });
    const fields = registers[1].fields as Array<Record<string, unknown>>;
    expect(Object.keys(fields[1]).sort()).toEqual(
      ['access', 'name', 'offset', 'resetValue', 'width'].sort()
    );
    expect(JSON.stringify(projected)).not.toMatch(/rowId|__kind|description|enumeratedValues|bits/);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and uses no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}'
    );
  });

  it('omits null and undefined object properties', () => {
    expect(canonicalJson({ a: null, b: undefined, c: 0, d: '', e: false })).toBe(
      '{"c":0,"d":"","e":false}'
    );
  });

  it('keeps array order and writes null for empty slots', () => {
    expect(canonicalJson([3, 1, undefined, null, 2])).toBe('[3,1,null,null,2]');
  });

  it('serializes scalars', () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(5)).toBe('5');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });
});
