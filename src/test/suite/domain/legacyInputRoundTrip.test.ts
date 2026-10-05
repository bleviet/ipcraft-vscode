import * as yaml from 'yaml';
import { parseMemoryMap } from '../../../domain/parse';
import { serializeMemoryMap, serializeValue } from '../../../domain/serialize';
import { insertElement } from '../../../webview/algorithms/MutationService';
import { YamlService } from '../../../webview/services/YamlService';
import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';
import type { LayoutMemoryMap } from '../../../webview/algorithms/LayoutEngine';
import { migrateMemoryMapYaml } from '../../../shared/ipCoreFormat';

/**
 * Legacy `.mm.yml` written entirely in snake_case. `ipcraft migrate`
 * (migrateMemoryMapYaml) converts it to canonical camelCase; runtime code then reads
 * camelCase only.
 */
const LEGACY_YAML = `# header comment
name: legacy_map
description: A map saved by an older tool
address_blocks:
  - name: CTRL
    base_address: 0x1000 # keep hex
    default_reg_width: 32
    registers:
      - name: STATUS
        address_offset: 0x0
        reset_value: 0x5
        fields:
          - name: BUSY
            bit_offset: 0
            bit_width: 1
            reset_value: 0
          - name: MODE
            bit_offset: 1
            bit_width: 2
            enumerated_values:
              reset_value: not a key
      - name: DATA
        address_offset: 4
`;

/** Collect every mapping key in a YAML text at any depth. */
function allKeys(text: string): string[] {
  const keys: string[] = [];
  const stack: unknown[] = [yaml.parse(text)];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...(node as unknown[]));
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        keys.push(key);
        stack.push(child);
      }
    }
  }
  return keys;
}

describe('migrating a legacy snake_case memory map', () => {
  const migrated = migrateMemoryMapYaml(LEGACY_YAML);

  it('renames every legacy key and keeps comments and hex spellings', () => {
    expect(migrated.changed).toBe(true);
    expect(migrated.mutationCount).toBe(12);
    const keys = allKeys(migrated.text).filter((k) => k !== 'reset_value');
    expect(keys.filter((k) => /_[a-z]/.test(k))).toEqual([]);
    // The enum value name that looks like a legacy key is untouched.
    expect(allKeys(migrated.text)).toContain('reset_value');
    expect(migrated.text).toContain('# header comment');
    expect(migrated.text).toContain('baseAddress: 0x1000 # keep hex');
    expect(migrated.text).toContain('offset: 0x0');
    expect(migrated.text).toContain('resetValue: 0x5');
  });

  it('is read correctly by parseMemoryMap afterwards', () => {
    const { map } = parseMemoryMap(migrated.text);
    const block = map.addressBlocks[0];
    expect(block.baseAddress).toBe(0x1000);
    expect(block.defaultRegWidth).toBe(32);
    const status = block.registers[0];
    expect(status.resetValue).toBe(5);
    expect(status.fields.map((f) => [f.name, f.offset, f.width])).toEqual([
      ['BUSY', 0, 1],
      ['MODE', 1, 2],
    ]);
    expect(status.fields[1].enumeratedValues).toEqual({ reset_value: 'not a key' });
    expect(block.registers[1].offset).toBe(4);
  });

  it('is idempotent', () => {
    const again = migrateMemoryMapYaml(migrated.text);
    expect(again).toEqual({ text: migrated.text, changed: false, mutationCount: 0 });
  });

  it('serializes to canonical YAML without snake_case keys', () => {
    const { map, rootStyle } = parseMemoryMap(migrated.text);
    const serialized = JSON.stringify(serializeMemoryMap(map, rootStyle));
    for (const token of ['address_offset', 'base_address', 'bit_offset', 'bit_width']) {
      expect(serialized).not.toContain(`"${token}"`);
    }
  });

  it('ignores a legacy key that was not migrated', () => {
    const { map } = parseMemoryMap(
      'name: m\naddressBlocks:\n  - name: B\n    registers:\n      - name: R\n        fields:\n          - name: F\n            bit_offset: 3\n'
    );
    expect(map.addressBlocks[0].registers[0].fields[0].offset).toBe(0);
  });
});

describe('edit round-trip on migrated text (webview handler pipeline)', () => {
  function insertRegisterAfter(text: string, blockIndex: number, regIndex: number): string {
    const rootObj = YamlService.safeParse(text);
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const mapObj = (
      selectionRootPath.length > 0 ? YamlPathResolver.getAtPath(root, selectionRootPath) : root
    ) as LayoutMemoryMap;

    const result = insertElement(mapObj, 'register', 'after', regIndex, { blockIndex });
    expect(result.errors).toEqual([]);

    const blocks = (result.memoryMap.addressBlocks ?? []) as Array<Record<string, unknown>>;
    const regs = (blocks[blockIndex].registers ?? []) as Array<Record<string, unknown>>;
    const value = regs.map((r) => serializeValue(r, 32) as Record<string, unknown>);
    return YamlService.applyPathEdits(text, [
      { path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'], value },
    ]);
  }

  const migratedText = migrateMemoryMapYaml(LEGACY_YAML).text;

  it('inserts a register without duplicate keys or data loss', () => {
    const newText = insertRegisterAfter(migratedText, 0, 0);

    expect((newText.match(/^addressBlocks:/gm) ?? []).length).toBe(1);
    expect(newText).not.toContain('address_blocks');
    expect(yaml.parseDocument(newText).errors).toEqual([]);

    const { map } = parseMemoryMap(newText);
    expect(map.addressBlocks[0].registers.map((r) => r.name)).toContain('STATUS');
    expect(map.addressBlocks[0].registers.map((r) => r.name)).toContain('DATA');
    expect(map.addressBlocks[0].registers).toHaveLength(3);
    expect(map.addressBlocks[0].registers.map((r) => r.offset)).toEqual([0, 4, 8]);
  });

  it('preserves schema-additional custom metadata through a register insert', () => {
    const withCustom = migrateMemoryMapYaml(`name: legacy
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
`).text;
    const newText = insertRegisterAfter(withCustom, 0, 0);
    expect(newText).toContain('customBlockData: keep-block');
    expect(newText).toContain('customRegisterData: keep-reg');
    expect(newText).toContain('customFieldData: keep-field');
  });

  it('edits scalar offsets in place on migrated text', () => {
    const newText = YamlService.applyPathEdits(migratedText, [
      { path: ['addressBlocks', 0, 'registers', 1, 'offset'], value: 8 },
    ]);
    const { map } = parseMemoryMap(newText);
    expect(map.addressBlocks[0].registers[1].offset).toBe(8);
    expect(newText).not.toContain('address_offset');
  });
});
