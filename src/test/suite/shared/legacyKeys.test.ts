import * as yaml from 'yaml';
import { renameLegacyKeys } from '../../../shared/ipCoreFormat/legacyKeys';

function rename(text: string, kind: 'ipCore' | 'memoryMap') {
  const result = renameLegacyKeys(text, kind);
  return { ...result, data: yaml.parse(result.text) as unknown };
}

describe('renameLegacyKeys: memory map', () => {
  it('renames map, block, register, field and nested template register keys', () => {
    const text = `# c
address_blocks:
  - base_address: 0x10
    default_reg_width: 64
    registers:
      - address_offset: 0x4
        reset_value: 0xff # hex
        fields:
          - bit_offset: 1
            bit_width: 2
            bit_range: '[2:1]'
            reset_value: 1
            enumerated_values: { reset_value: a, bit_width: b }
            monitor_change_of: X
      - count: 2
        registers:
          - address_offset: 0
            reset_value: 3
`;
    const { data, renamedCount, text: out } = rename(text, 'memoryMap');
    expect(renamedCount).toBe(13);
    expect(data).toEqual({
      addressBlocks: [
        {
          baseAddress: 16,
          defaultRegWidth: 64,
          registers: [
            {
              offset: 4,
              resetValue: 255,
              fields: [
                {
                  offset: 1,
                  width: 2,
                  bitRange: '[2:1]',
                  resetValue: 1,
                  enumeratedValues: { reset_value: 'a', bit_width: 'b' },
                  monitorChangeOf: 'X',
                },
              ],
            },
            { count: 2, registers: [{ offset: 0, resetValue: 3 }] },
          ],
        },
      ],
    });
    expect(out).toContain('# c');
    expect(out).toContain('baseAddress: 0x10');
    expect(out).toContain('resetValue: 0xff # hex');
  });

  it('keeps the canonical pair and drops the legacy pair on conflict', () => {
    const { data, renamedCount } = rename(
      'addressBlocks:\n  - baseAddress: 1\n    base_address: 2\n',
      'memoryMap'
    );
    expect(renamedCount).toBe(1);
    expect(data).toEqual({ addressBlocks: [{ baseAddress: 1 }] });
  });

  it('returns identical text when nothing is renamed', () => {
    const text = 'addressBlocks:   [ ]  # odd spacing\n';
    expect(renameLegacyKeys(text, 'memoryMap')).toEqual({ text, renamedCount: 0 });
  });

  it('handles list-of-maps roots', () => {
    const { data } = rename('- address_blocks:\n    - base_address: 1\n- name: b\n', 'memoryMap');
    expect(data).toEqual([{ addressBlocks: [{ baseAddress: 1 }] }, { name: 'b' }]);
  });

  it('handles wrapper roots with memory_maps or memoryMaps', () => {
    const legacy = rename(
      'memory_maps:\n  - address_blocks:\n      - base_address: 1\n',
      'memoryMap'
    );
    expect(legacy.data).toEqual({ memoryMaps: [{ addressBlocks: [{ baseAddress: 1 }] }] });
    const camel = rename(
      'memoryMaps:\n  - address_blocks:\n      - base_address: 1\n',
      'memoryMap'
    );
    expect(camel.data).toEqual({ memoryMaps: [{ addressBlocks: [{ baseAddress: 1 }] }] });
  });

  it('throws on invalid YAML', () => {
    expect(() => renameLegacyKeys('a: [unclosed', 'memoryMap')).toThrow(/Invalid YAML/);
  });
});

describe('renameLegacyKeys: ip core', () => {
  it('renames root, bus, bus array, clock and reset keys', () => {
    const text = `apiVersion: '1.1'
file_sets:
  - name: rtl
busInterfaces:
  - name: s
    use_optional_ports: [a]
    port_width_overrides: { A: 2 }
    port_name_overrides: { A: b }
    absent_ports: [c]
    conduit_ports: []
    physical_prefix: p_
    associated_clock: clk
    associated_reset: rst
    array:
      count: 2
      index_start: 1
      naming_pattern: 'x{index}'
      physical_prefix_pattern: 'y{index}'
clocks:
  - name: clk
    associated_reset: rst
resets:
  - name: rst
    associated_clock: clk
`;
    const { data, renamedCount } = rename(text, 'ipCore');
    expect(renamedCount).toBe(14);
    expect(data).toEqual({
      apiVersion: '1.1',
      fileSets: [{ name: 'rtl' }],
      busInterfaces: [
        {
          name: 's',
          useOptionalPorts: ['a'],
          portWidthOverrides: { A: 2 },
          portNameOverrides: { A: 'b' },
          absentPorts: ['c'],
          conduitPorts: [],
          physicalPrefix: 'p_',
          associatedClock: 'clk',
          associatedReset: 'rst',
          array: {
            count: 2,
            indexStart: 1,
            namingPattern: 'x{index}',
            physicalPrefixPattern: 'y{index}',
          },
        },
      ],
      clocks: [{ name: 'clk', associatedReset: 'rst' }],
      resets: [{ name: 'rst', associatedClock: 'clk' }],
    });
  });

  it('renames inline memory maps but not imports', () => {
    const text = `memory_maps:
  - import: ./a.mm.yml
  - name: inline
    address_blocks:
      - base_address: 0
        registers:
          - address_offset: 0
            fields:
              - bit_offset: 0
`;
    const { data } = rename(text, 'ipCore');
    expect(data).toEqual({
      memoryMaps: [
        { import: './a.mm.yml' },
        {
          name: 'inline',
          addressBlocks: [{ baseAddress: 0, registers: [{ offset: 0, fields: [{ offset: 0 }] }] }],
        },
      ],
    });
  });

  it('keeps the canonical key on conflict and is a no-op for camelCase files', () => {
    const { data, renamedCount } = rename(
      'busInterfaces:\n  - physicalPrefix: a_\n    physical_prefix: b_\n',
      'ipCore'
    );
    expect(renamedCount).toBe(1);
    expect(data).toEqual({ busInterfaces: [{ physicalPrefix: 'a_' }] });

    const text = 'busInterfaces:\n  -   physicalPrefix: a_\n';
    expect(renameLegacyKeys(text, 'ipCore')).toEqual({ text, renamedCount: 0 });
  });
});

describe('renameLegacyKeys untouched-node formatting (#231)', () => {
  it('leaves unrelated flow sequences and folded scalars unchanged', () => {
    const text = `description: >-
  First line
  second line.
busInterfaces:
  - name: s_axis_in
    physical_prefix: s_
    useOptionalPorts: [TLAST]
    absentPorts: [A]
`;
    const result = renameLegacyKeys(text, 'ipCore');
    expect(result.renamedCount).toBe(1);
    expect(result.text).toBe(text.replace('physical_prefix', 'physicalPrefix'));
  });
});
