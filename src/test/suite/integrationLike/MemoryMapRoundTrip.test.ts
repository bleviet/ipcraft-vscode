/**
 * Round-trip regression: editing a memory map through the webview pipeline
 * (add block, add registers) must keep the YAML valid against
 * ipcraft-spec/schemas/memory_map.schema.json, free of runtime-only keys,
 * and must preserve the formatting/comments of everything untouched.
 *
 * Mirrors the data flow of index.tsx:
 *   parse -> normalize -> UI mutation -> repack -> sanitize -> applyPathEdits
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { YamlService } from '../../../webview/services/YamlService';
import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';
import { DataNormalizer } from '../../../webview/services/DataNormalizer';
import { SpatialInsertionService } from '../../../webview/services/SpatialInsertionService';
import {
  recomputeRegisterLayout,
  type LayoutMemoryMap,
  type LayoutRegister,
} from '../../../webview/algorithms/LayoutEngine';
import { insertElement } from '../../../webview/algorithms/MutationService';
import {
  sanitizeRegisterForYaml,
  sanitizeBlockForYaml,
} from '../../../webview/services/YamlSanitizer';

const examplesDir = path.resolve(__dirname, '../../../../ipcraft-spec/examples');
const basicFile = path.join(examplesDir, 'basic_peripheral/basic_peripheral.mm.yml');
const axiFile = path.join(examplesDir, 'comprehensive_axi/comprehensive_axi.mm.yml');
const schemaFile = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/memory_map.schema.json'
);

function parseAndNormalize(text: string) {
  const parsed = YamlService.parse(text) as Record<string, unknown> | unknown[];
  const map = Array.isArray(parsed) ? parsed[0] : parsed;
  return DataNormalizer.normalizeMemoryMap(map);
}

function blockRegWidth(block: Record<string, unknown> | undefined): number {
  const raw = block?.defaultRegWidth ?? block?.default_reg_width;
  return typeof raw === 'number' && raw > 0 ? raw : 32;
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
  const { selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  const sanitized = (result.items as unknown as Record<string, unknown>[]).map((b) =>
    sanitizeBlockForYaml(b)
  );
  return YamlService.applyPathEdits(text, [
    { path: [...selectionRootPath, 'addressBlocks'], value: sanitized },
  ]);
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
  const rawBlock = YamlPathResolver.getAtPath(root, [
    ...selectionRootPath,
    'addressBlocks',
    blockIndex,
  ]) as Record<string, unknown>;
  const width = blockRegWidth(rawBlock);
  const laidOut = recomputeRegisterLayout(newRegs as LayoutRegister[], width);
  const sanitized = laidOut.map((r) =>
    sanitizeRegisterForYaml(r as Record<string, unknown>, width)
  );
  return YamlService.applyPathEdits(text, [
    { path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'], value: sanitized },
  ]);
}

/** Outline context menu "Insert Below" + handleRegisterAction. */
function uiAddRegisterOutline(text: string, blockIndex: number): string {
  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  const mapObj = YamlPathResolver.getAtPath(root, selectionRootPath) as LayoutMemoryMap;
  const regs = (mapObj.addressBlocks ?? [])[blockIndex]?.registers ?? [];
  const result = insertElement(mapObj, 'register', 'after', regs.length - 1, { blockIndex });
  expect(result.errors).toEqual([]);

  const blocks = (result.memoryMap.addressBlocks ??
    result.memoryMap.address_blocks ??
    []) as Record<string, unknown>[];
  const block = blocks[blockIndex];
  const width = blockRegWidth(block);
  const sanitized = ((block.registers ?? []) as Record<string, unknown>[]).map((r) =>
    sanitizeRegisterForYaml(r, width)
  );
  return YamlService.applyPathEdits(text, [
    { path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'], value: sanitized },
  ]);
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
    let text = fs.readFileSync(basicFile, 'utf8');
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
    let text = fs.readFileSync(basicFile, 'utf8');
    text = uiAddBlock(text);

    for (let i = 1; i <= 3; i++) {
      text = uiAddRegisterOutline(text, 1);
      expectClean(text);
    }
  });

  it('adding a register to one block leaves the rest of the file untouched', () => {
    const src = fs.readFileSync(axiFile, 'utf8');
    const out = uiAddRegisterOutline(src, 1); // DMA_REGS

    expect(validate(YamlService.parse(out))).toBe(true);
    // New register appended after the DMA array (2 * stride 32 = 0x40).
    expect(out).toMatch(/name: reg1\n\s+offset: 64/);

    // Header comment, hex spellings, indented-sequence style and the whole
    // untouched CORE_REGS block must be byte-identical.
    expect(out).toContain('# Memory map exercising every register-map schema property:');
    expect(out).toContain('resetValue: 0xC0FFEE01');
    expect(out).toContain('resetValue: 0x01');
    expect(out).toContain('    - name: CORE_REGS');
    // Byte-identical except the one human-folded description (the stringifier
    // re-folds long block scalars at its own break points).
    const chunk1 = src.slice(src.indexOf('- name: CORE_REGS'), src.indexOf('- name: IRQ_EVENT'));
    const chunk2 = src.slice(src.indexOf('- name: CH_GAIN'), src.indexOf('- name: DMA_REGS'));
    expect(out).toContain(chunk1);
    expect(out).toContain(chunk2);

    // No-op edit returns the identical string.
    const noop = YamlService.applyPathEdits(src, [{ path: [0, 'name'], value: 'CSR' }]);
    expect(noop).toBe(src);
  });
});
