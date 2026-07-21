import { parseMemoryMap } from '../../../domain/parse';
import { serializeMemoryMap, serializeValue } from '../../../domain/serialize';
import { insertElement, deleteElement } from '../../../webview/algorithms/MutationService';
import type { LayoutMemoryMap } from '../../../webview/algorithms/LayoutEngine';

/**
 * Legacy `.mm.yml` written entirely in snake_case. The compatibility boundary
 * (parseMemoryMap) must read it and normalize every property to canonical
 * camelCase. Everything downstream then works on camelCase only.
 */
const LEGACY_YAML = `
name: legacy_map
description: A map saved by an older tool
address_blocks:
  - name: CTRL
    base_address: 0
    default_reg_width: 32
    registers:
      - name: STATUS
        address_offset: 0
        reset_value: 5
        fields:
          - name: BUSY
            bit_offset: 0
            bit_width: 1
          - name: MODE
            bit_offset: 1
            bit_width: 2
      - name: DATA
        address_offset: 4
`;

const LEGACY_SNAKE_TOKENS = [
  'address_offset',
  'base_address',
  'default_reg_width',
  'address_blocks',
  'reset_value',
  'bit_offset',
  'bit_width',
  'bit_range',
];

/** Assert an object tree contains no snake_case keys at any depth. */
function expectNoSnakeKeys(value: unknown): void {
  const stack: unknown[] = [value];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...(node as unknown[]));
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        expect(key).not.toMatch(/_[a-z]/);
        stack.push(child);
      }
    }
  }
}

describe('legacy snake_case memory-map input', () => {
  it('reads legacy input and normalizes it to canonical camelCase', () => {
    const { map } = parseMemoryMap(LEGACY_YAML);

    expect(map.name).toBe('legacy_map');
    const block = map.addressBlocks[0];
    expect(block.name).toBe('CTRL');
    expect(block.baseAddress).toBe(0);
    expect(block.defaultRegWidth).toBe(32);

    const status = block.registers[0];
    expect(status.name).toBe('STATUS');
    expect(status.offset).toBe(0);
    expect(status.resetValue).toBe(5);
    expect(status.fields.map((f) => f.name)).toEqual(['BUSY', 'MODE']);

    // The normalized model itself must be free of any snake_case spelling.
    expectNoSnakeKeys(map);
  });

  it('serializes legacy input to canonical YAML with no snake_case or duplicate keys', () => {
    const { map, rootStyle } = parseMemoryMap(LEGACY_YAML);
    const serialized = serializeMemoryMap(map, rootStyle);

    expectNoSnakeKeys(serialized);

    // A duplicate spelling would surface as the snake token in the JSON text.
    const asText = JSON.stringify(serialized);
    for (const token of LEGACY_SNAKE_TOKENS) {
      expect(asText).not.toContain(`"${token}"`);
    }

    // No data loss: names, canonical offsets and reset value survive.
    const blocks = (serialized as { addressBlocks: Array<Record<string, unknown>> }).addressBlocks;
    expect(blocks[0].name).toBe('CTRL');
    expect(blocks[0].baseAddress).toBe(0);
    const regs = blocks[0].registers as Array<Record<string, unknown>>;
    expect(regs.map((r) => r.name)).toEqual(['STATUS', 'DATA']);
    expect(regs[0].resetValue).toBe(5);
    expect(regs[0].offset).toBe(0);
    expect(regs[1].offset).toBe(4);
  });

  it('edits normalized legacy input and round-trips without reintroducing snake_case', () => {
    const { map, rootStyle } = parseMemoryMap(LEGACY_YAML);

    // The mutation services operate on the normalized (camelCase) model.
    const layoutMap = map as unknown as LayoutMemoryMap;
    const inserted = insertElement(layoutMap, 'register', 'after', 0, { blockIndex: 0 }).memoryMap;
    const afterDelete = deleteElement(inserted, 'register', 1, { blockIndex: 0 }).memoryMap;

    const serialized = serializeValue(afterDelete);
    expectNoSnakeKeys(serialized);

    const blocks = (serialized as { addressBlocks: Array<Record<string, unknown>> }).addressBlocks;
    const regs = blocks[0].registers as Array<Record<string, unknown>>;
    // STATUS (kept) + one freshly inserted register, offsets repacked contiguously.
    expect(regs[0].name).toBe('STATUS');
    expect(regs[0].offset).toBe(0);
    expect(regs[1].offset).toBe(4);

    const serializedForStyle = serializeMemoryMap(afterDelete, rootStyle);
    expectNoSnakeKeys(serializedForStyle);
  });
});
