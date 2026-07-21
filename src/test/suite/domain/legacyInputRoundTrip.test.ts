import { parseMemoryMap, canonicalizeLegacyKeys } from '../../../domain/parse';
import { serializeMemoryMap, serializeValue } from '../../../domain/serialize';
import { insertElement, deleteElement } from '../../../webview/algorithms/MutationService';
import { YamlService } from '../../../webview/services/YamlService';
import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';
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

/**
 * Reproduces the webview's structural-edit handlers (handleRegisterAction /
 * handleBlockAction in src/webview/index.tsx), which parse the raw document text
 * and drive the camelCase-only mutation services. A legacy `address_blocks` file
 * must (a) not report "Block not found" and (b) be written back in place without
 * spawning a duplicate `addressBlocks` key that would hide the original blocks.
 */
describe('legacy raw-action structural edits (webview handler pipeline)', () => {
  function insertRegisterAfter(text: string, blockIndex: number, regIndex: number): string {
    const rootObj = YamlService.safeParse(text);
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const rawMapObj = (
      selectionRootPath.length > 0 ? YamlPathResolver.getAtPath(root, selectionRootPath) : root
    ) as Record<string, unknown>;
    const mapObj = canonicalizeLegacyKeys(rawMapObj) as LayoutMemoryMap;

    const result = insertElement(mapObj, 'register', 'after', regIndex, { blockIndex });
    expect(result.errors).toEqual([]);

    const blocks = (result.memoryMap.addressBlocks ?? []) as Array<Record<string, unknown>>;
    const regs = (blocks[blockIndex].registers ?? []) as Array<Record<string, unknown>>;
    const value = regs.map((r) => serializeValue(r, 32) as Record<string, unknown>);
    // Canonical edit path; YamlService.applyPathEdits maps it onto the on-disk key.
    return YamlService.applyPathEdits(text, [
      { path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'], value },
    ]);
  }

  it('inserts a register into a legacy address_blocks file without data loss', () => {
    const newText = insertRegisterAfter(LEGACY_YAML, 0, 0);

    // The on-disk legacy key is preserved; no duplicate canonical key appears.
    expect(newText).toContain('address_blocks:');
    expect(newText).not.toMatch(/^\s*addressBlocks:/m);

    // Re-reading through the boundary yields the original registers plus the new one.
    const { map } = parseMemoryMap(newText);
    const regNames = map.addressBlocks[0].registers.map((r) => r.name);
    expect(regNames).toContain('STATUS');
    expect(regNames).toContain('DATA');
    expect(regNames.length).toBe(3);
    // Offsets are repacked contiguously across the whole block.
    expect(map.addressBlocks[0].registers.map((r) => r.offset)).toEqual([0, 4, 8]);
  });

  it('is idempotent in shape: a second insert still targets the legacy key', () => {
    const once = insertRegisterAfter(LEGACY_YAML, 0, 0);
    const twice = insertRegisterAfter(once, 0, 0);
    expect(twice).toContain('address_blocks:');
    expect(twice).not.toMatch(/^\s*addressBlocks:/m);
    const { map } = parseMemoryMap(twice);
    expect(map.addressBlocks[0].registers.length).toBe(4);
  });

  const TWO_BLOCK_LEGACY = `name: legacy
address_blocks:
  - name: A
    base_address: 0
    registers:
      - name: R0
        address_offset: 0
  - name: B
    base_address: 4
    registers:
      - name: R0
        address_offset: 0
`;

  it('reorders blocks in a legacy file without spawning a duplicate key', () => {
    // Mirrors handleReorder's block branch, which writes the whole addressBlocks
    // array via a canonical path.
    const rootObj = YamlService.safeParse(TWO_BLOCK_LEGACY);
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const blocks = (YamlPathResolver.getAtPath(root, [...selectionRootPath, 'addressBlocks']) ??
      []) as Array<Record<string, unknown>>;
    const reordered = [blocks[1], blocks[0]];
    const sanitized = reordered.map((b) => serializeValue(b) as Record<string, unknown>);
    const newText = YamlService.applyPathEdits(TWO_BLOCK_LEGACY, [
      { path: [...selectionRootPath, 'addressBlocks'], value: sanitized },
    ]);

    expect(newText).toContain('address_blocks:');
    expect(newText).not.toMatch(/^\s*addressBlocks:/m);
    const { map } = parseMemoryMap(newText);
    expect(map.addressBlocks.map((b) => b.name)).toEqual(['B', 'A']);
  });

  it('preserves schema-additional custom metadata through a register insert', () => {
    const withCustom = `name: legacy
address_blocks:
  - name: A
    base_address: 0
    customBlockData: keep-block
    registers:
      - name: R0
        address_offset: 0
        customRegisterData: keep-reg
        fields:
          - name: F0
            bit_offset: 0
            bit_width: 1
            customFieldData: keep-field
`;
    const newText = insertRegisterAfter(withCustom, 0, 0);
    // The untouched block-level custom key stays put (format-preserving write).
    expect(newText).toContain('customBlockData: keep-block');
    // The rewritten register array must retain the custom register/field data.
    expect(newText).toContain('customRegisterData: keep-reg');
    expect(newText).toContain('customFieldData: keep-field');
  });

  it('does not rename entries of an opaque enumeratedValues map that collide with legacy key names', () => {
    // enumeratedValues keys are enum-VALUE names chosen by the user, not schema
    // property names. A user naming an enum value "reset_value" must not have it
    // silently rewritten to "resetValue" by key canonicalization.
    const raw = {
      addressBlocks: [
        {
          name: 'A',
          baseAddress: 0,
          registers: [
            {
              name: 'R0',
              offset: 0,
              fields: [
                {
                  name: 'F0',
                  bits: '[0:0]',
                  enumeratedValues: {
                    reset_value: 'means reset',
                    address_offset: 'means offset',
                    bit_width: 'means width',
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const out = canonicalizeLegacyKeys(raw) as {
      addressBlocks: Array<{
        registers: Array<{ fields: Array<{ enumeratedValues: Record<string, string> }> }>;
      }>;
    };
    const enumMap = out.addressBlocks[0].registers[0].fields[0].enumeratedValues;
    expect(enumMap).toEqual({
      reset_value: 'means reset',
      address_offset: 'means offset',
      bit_width: 'means width',
    });
  });

  it('does not rename keys inside arbitrary nested custom metadata objects', () => {
    const raw = {
      addressBlocks: [
        {
          name: 'A',
          base_address: 0,
          registers: [
            {
              name: 'R0',
              address_offset: 0,
              customRegisterData: { reset_value: 'not a schema field', nested: { bit_offset: 1 } },
            },
          ],
        },
      ],
    };

    const out = canonicalizeLegacyKeys(raw) as {
      addressBlocks: Array<{
        registers: Array<{ customRegisterData: Record<string, unknown> }>;
      }>;
    };
    expect(out.addressBlocks[0].registers[0].customRegisterData).toEqual({
      reset_value: 'not a schema field',
      nested: { bit_offset: 1 },
    });
  });
});

/**
 * Scalar (non-structural) edits on legacy register offsets / field offsets and
 * widths, exercised via useYamlUpdateHandler's write path (YamlService.applyPathEdits
 * -> YamlPathResolver.resolvePath). `offset` is ambiguous across the model
 * (`address_offset` on registers vs. `bit_offset` on fields); resolution must use
 * the target object's own keys, not just the canonical path shape.
 */
describe('legacy scalar offset/width edits (BlockEditor / RegisterArrayEditor / RegisterTableRow path)', () => {
  it('edits a legacy register offset in place without creating a duplicate offset key', () => {
    const text = `name: legacy
address_blocks:
  - name: A
    base_address: 0
    registers:
      - name: R0
        address_offset: 0
`;
    const newText = YamlService.applyPathEdits(text, [
      { path: ['addressBlocks', 0, 'registers', 0, 'offset'], value: 4 },
    ]);

    expect(newText).toContain('address_offset: 4');
    // A standalone `offset:` key (not part of `address_offset:`) would mean a
    // duplicate canonical key was created alongside the legacy one.
    expect(newText).not.toMatch(/^\s*offset:/m);
    expect((newText.match(/offset:/g) ?? []).length).toBe(1);
  });

  it('edits a legacy field offset in place without creating a duplicate offset key', () => {
    const text = `name: legacy
address_blocks:
  - name: A
    base_address: 0
    registers:
      - name: R0
        offset: 0
        fields:
          - name: F0
            bit_offset: 0
            bit_width: 1
`;
    const newText = YamlService.applyPathEdits(text, [
      { path: ['addressBlocks', 0, 'registers', 0, 'fields', 0, 'offset'], value: 2 },
    ]);

    expect(newText).toContain('bit_offset: 2');
    expect(newText).not.toMatch(/^\s+offset: 2$/m);
  });

  it('edits a legacy field width in place without creating a duplicate width key', () => {
    const text = `name: legacy
address_blocks:
  - name: A
    base_address: 0
    registers:
      - name: R0
        offset: 0
        fields:
          - name: F0
            bit_offset: 0
            bit_width: 1
`;
    const newText = YamlService.applyPathEdits(text, [
      { path: ['addressBlocks', 0, 'registers', 0, 'fields', 0, 'width'], value: 4 },
    ]);

    expect(newText).toContain('bit_width: 4');
    expect(newText).not.toMatch(/^\s+width: 4$/m);
  });

  it('resolves offset differently for a register vs. a field on the same document', () => {
    const rootObj = YamlService.safeParse(LEGACY_YAML);
    const { root } = YamlPathResolver.getMapRootInfo(rootObj);

    const registerPath = YamlPathResolver.resolvePath(root, [
      'addressBlocks',
      0,
      'registers',
      0,
      'offset',
    ]);
    expect(registerPath[registerPath.length - 1]).toBe('address_offset');

    const fieldPath = YamlPathResolver.resolvePath(root, [
      'addressBlocks',
      0,
      'registers',
      0,
      'fields',
      0,
      'offset',
    ]);
    expect(fieldPath[fieldPath.length - 1]).toBe('bit_offset');
  });
});
