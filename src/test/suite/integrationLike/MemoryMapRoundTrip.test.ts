/**
 * Round-trip regression: editing a memory map through the webview pipeline
 * (add block, add registers) must keep the YAML valid against
 * ipcraft-spec/schemas/memory_map.schema.json and free of runtime-only keys.
 *
 * Mirrors the data flow of index.tsx:
 *   parse -> normalize -> UI mutation -> setAtPath -> repack -> sanitize -> dump
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { YamlService } from '../../../webview/services/YamlService';
import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';
import { DataNormalizer } from '../../../webview/services/DataNormalizer';
import { SpatialInsertionService } from '../../../webview/services/SpatialInsertionService';
import {
  recomputeAddressLayout,
  type LayoutMemoryMap,
} from '../../../webview/algorithms/LayoutEngine';
import { insertElement } from '../../../webview/algorithms/MutationService';
import { sanitizeMemoryMapForYaml } from '../../../webview/services/YamlSanitizer';

const exampleFile = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/examples/basic_peripheral/basic_peripheral.mm.yml'
);
const schemaFile = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/memory_map.schema.json'
);

function parseAndNormalize(text: string) {
  const parsed = YamlService.parse(text) as Record<string, unknown> | unknown[];
  const map = Array.isArray(parsed) ? parsed[0] : parsed;
  return DataNormalizer.normalizeMemoryMap(map);
}

/** MemoryMapEditor "add block after last" + handleUpdateWithRepack blocks branch. */
function uiAddBlock(text: string): string {
  const mm = parseAndNormalize(text);
  const liveBlocks = mm.addressBlocks as unknown as Parameters<
    typeof SpatialInsertionService.insertBlock
  >[1];
  const result = SpatialInsertionService.insertBlock('after', liveBlocks, liveBlocks.length - 1);
  expect(result.error).toBeUndefined();

  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  YamlPathResolver.setAtPath(root, [...selectionRootPath, 'addressBlocks'], result.items);
  const mapObj = YamlPathResolver.getAtPath(root, selectionRootPath) as Record<string, unknown>;
  YamlPathResolver.setAtPath(root, selectionRootPath, sanitizeMemoryMapForYaml(mapObj));
  return YamlService.dump(root);
}

/** BlockEditor "add register" + handleUpdateWithRepack registers branch. */
function uiAddRegister(text: string, blockIndex: number): string {
  const mm = parseAndNormalize(text);
  const block = (mm.addressBlocks as unknown as Record<string, unknown>[])[blockIndex];
  const liveRegisters = (block.registers ?? []) as Record<string, unknown>[];
  let maxN = 0;
  for (const r of liveRegisters) {
    const match = String(r.name ?? '').match(/^reg(\d+)$/i);
    if (match) {
      maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }
  const newRegs = [
    ...liveRegisters,
    { name: `reg${maxN + 1}`, access: 'read-write', description: '', offset: 0, address_offset: 0 },
  ];

  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  YamlPathResolver.setAtPath(
    root,
    [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'],
    newRegs
  );
  const mapObj = YamlPathResolver.getAtPath(root, selectionRootPath) as LayoutMemoryMap;
  const { data } = recomputeAddressLayout(mapObj);
  YamlPathResolver.setAtPath(
    root,
    selectionRootPath,
    sanitizeMemoryMapForYaml(data as Record<string, unknown>)
  );
  return YamlService.dump(root);
}

/** Outline context menu "Insert Below" + handleRegisterAction. */
function uiAddRegisterOutline(text: string, blockIndex: number): string {
  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  const mapObj = YamlPathResolver.getAtPath(root, selectionRootPath) as LayoutMemoryMap;
  const regs = (mapObj.addressBlocks ?? [])[blockIndex]?.registers ?? [];
  const result = insertElement(mapObj, 'register', 'after', regs.length - 1, { blockIndex });
  expect(result.errors).toEqual([]);
  YamlPathResolver.setAtPath(
    root,
    selectionRootPath,
    sanitizeMemoryMapForYaml(result.memoryMap as Record<string, unknown>)
  );
  return YamlService.dump(root);
}

describe('memory map YAML round-trip stays schema-clean', () => {
  // The spec schema nests $defs under `items` while $refs use root-relative
  // pointers (#/$defs/...); hoist them so ajv can resolve.
  const rawSchema = JSON.parse(fs.readFileSync(schemaFile, 'utf8')) as {
    items?: { $defs?: object };
  } & Record<string, unknown>;
  const schema = { ...rawSchema, $defs: rawSchema.items?.$defs };
  const ajv = new Ajv({ strict: false, allowUnionTypes: true });
  const validate = ajv.compile(schema);

  const expectClean = (text: string) => {
    const doc = YamlService.parse(text);
    expect(validate(doc)).toBe(true);
    for (const key of [
      'address_offset',
      'base_address',
      'bit_offset',
      'bit_width',
      'bit_range',
      '__kind',
      'reset_value:',
      'enumerated_values:',
      'monitorChangeOf: null',
    ]) {
      expect(text).not.toContain(key);
    }
  };

  it('add block then three registers via BlockEditor path', () => {
    let text = fs.readFileSync(exampleFile, 'utf8');
    text = uiAddBlock(text);
    expectClean(text);

    for (let i = 1; i <= 3; i++) {
      text = uiAddRegister(text, 1);
      expectClean(text);
    }

    // defaultRegWidth from the source file must survive the rewrites.
    expect(text).toContain('defaultRegWidth: 32');
    expect(text).toContain('baseAddress:');
    // Original field strings intact.
    expect(text).toContain("bits: '[31:4]'");
  });

  it('add block then three registers via outline context menu path', () => {
    let text = fs.readFileSync(exampleFile, 'utf8');
    text = uiAddBlock(text);

    for (let i = 1; i <= 3; i++) {
      text = uiAddRegisterOutline(text, 1);
      expectClean(text);
    }
  });
});
