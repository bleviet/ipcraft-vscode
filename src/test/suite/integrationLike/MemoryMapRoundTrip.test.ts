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
import { act, renderHook } from '@testing-library/react';
import { YamlService } from '../../../webview/services/YamlService';
import { YamlPathResolver } from '../../../webview/services/YamlPathResolver';
import { parseMemoryMap } from '../../../domain/parse';
import { serializeMemoryMap, serializeValue } from '../../../domain/serialize';
import { SpatialInsertionService } from '../../../webview/services/SpatialInsertionService';
import {
  recomputeRegisterLayout,
  type LayoutMemoryMap,
  type LayoutRegister,
} from '../../../webview/algorithms/LayoutEngine';
import { insertElement } from '../../../webview/algorithms/MutationService';
import { useYamlUpdateHandler } from '../../../webview/hooks/useYamlUpdateHandler';
import type { Selection } from '../../../webview/hooks/useSelection';

const examplesDir = path.resolve(__dirname, '../../../../ipcraft-spec/examples');
const basicFile = path.join(examplesDir, 'basic_peripheral/basic_peripheral.mm.yml');
const axiFile = path.join(examplesDir, 'comprehensive_axi/comprehensive_axi.mm.yml');
const schemaFile = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/memory_map.schema.json'
);

function parseAndNormalize(text: string) {
  return parseMemoryMap(text).map;
}

function blockRegWidth(block: Record<string, unknown> | undefined): number {
  const raw = block?.defaultRegWidth;
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
  const sanitized = (result.items as unknown as Record<string, unknown>[]).map(
    (b) => serializeValue(b) as Record<string, unknown>
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
    { name: `reg${maxN + 1}`, access: 'read-write', description: '', offset: 0 },
  ];

  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  const rawBlock = YamlPathResolver.getAtPath(root, [
    ...selectionRootPath,
    'addressBlocks',
    blockIndex,
  ]) as Record<string, unknown>;
  const width = blockRegWidth(rawBlock);
  const laidOut = recomputeRegisterLayout(newRegs, width);
  const sanitized = laidOut.map(
    (r) => serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
  );
  return YamlService.applyPathEdits(text, [
    { path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'], value: sanitized },
  ]);
}

/**
 * RegisterArrayEditor stride/count edit + handleUpdateWithRepack repack branch.
 * Mirrors the exact data-flow of index.tsx when a user edits the Stride or
 * Count field on a selected register array: the new scalar is stamped on the
 * array node, then the sibling registers list is repacked via
 * recomputeRegisterLayout so every register after the array gets a fresh
 * offset.
 */
function uiEditArrayDimension(
  text: string,
  blockIndex: number,
  regIndex: number,
  field: 'stride' | 'count',
  value: number
): string {
  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);

  // Stamp the new stride/count onto the parsed array node.
  const arrayPath = [...selectionRootPath, 'addressBlocks', blockIndex, 'registers', regIndex];
  const arrayNode = YamlPathResolver.getAtPath(root, arrayPath) as
    | Record<string, unknown>
    | undefined;
  if (!arrayNode) {
    return text;
  }
  arrayNode[field] = value;

  // Repack the block's registers so siblings after the array get fresh offsets.
  const blockPath = [...selectionRootPath, 'addressBlocks', blockIndex];
  const block = YamlPathResolver.getAtPath(root, blockPath) as Record<string, unknown> | undefined;
  const width = blockRegWidth(block);
  const laidOut = recomputeRegisterLayout((block?.registers ?? []) as LayoutRegister[], width);
  const sanitized = laidOut.map(
    (r) => serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
  );
  return YamlService.applyPathEdits(text, [
    { path: [...blockPath, 'registers'], value: sanitized },
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

  const blocks = (result.memoryMap.addressBlocks ?? []) as Record<string, unknown>[];
  const block = blocks[blockIndex];
  const width = blockRegWidth(block);
  const sanitized = ((block.registers ?? []) as Record<string, unknown>[]).map(
    (r) => serializeValue(r, width) as Record<string, unknown>
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

  it('preserves parent stride when it already accommodates the expanded template', () => {
    // block 1 is DMA_REGS, parentRegIndex 0 is DMA
    // DMA has count: 2, stride: 32, and 4 sub-registers (16-byte template).
    // After inserting a 5th register, the template grows to 20 bytes, which
    // still fits within the existing stride of 32 — so stride is unchanged.
    // (recomputeRegisterLayout only grows stride, never shrinks it, and only
    // when currentStride < alignedFootprint.)
    const src = fs.readFileSync(axiFile, 'utf8');
    const out = uiAddRegisterInsideArrayOutline(src, 1, 0);

    expect(validate(YamlService.parse(out))).toBe(true);
    expect(out).toContain('stride: 32'); // DMA stride unchanged (32 >= 20-byte template)
  });

  it('editing a flat array stride repacks sibling register offsets', () => {
    // block 0 is CORE_REGS, register 6 is CH_GAIN (flat array: count 4, stride 4).
    // CH_GAIN occupies bytes 0x5C..0x6B (the last register before it, SCRATCH,
    // ends at 0x5C after IRQ_EVENT at 0x38). After bumping stride from 4 to 8,
    // the array footprint doubles (4 * 8 = 32 bytes) and any register after it
    // must shift. CH_GAIN is the last register in CORE_REGS so this test adds
    // a trailing register first to exercise the repack.
    const src = fs.readFileSync(axiFile, 'utf8');
    const withTrailing = uiAddRegisterOutline(src, 0); // append reg after CH_GAIN
    const out = uiEditArrayDimension(withTrailing, 0, 6, 'stride', 8);

    expect(validate(YamlService.parse(out))).toBe(true);
    expect(out).toContain('stride: 8');
    // The trailing register must have moved by the stride delta (4 extra
    // bytes per array element * 4 elements = 16 bytes).
    const doc = YamlService.parse(out) as Array<{
      addressBlocks: Array<{
        registers: Array<{ offset: number; count?: number; stride?: number }>;
      }>;
    }>;
    const regs = doc[0].addressBlocks[0].registers;
    const trailing = regs[regs.length - 1];
    const chGainEnd = regs[6].offset + (regs[6].count ?? 1) * (regs[6].stride ?? 4);
    expect(trailing.offset).toBe(chGainEnd);
  });

  it('editing a flat array count repacks sibling register offsets', () => {
    // Same setup: CH_GAIN at block 0 register 6 (count 4, stride 4).
    // Increasing count from 4 to 8 doubles the footprint.
    const src = fs.readFileSync(axiFile, 'utf8');
    const withTrailing = uiAddRegisterOutline(src, 0);
    const out = uiEditArrayDimension(withTrailing, 0, 6, 'count', 8);

    expect(validate(YamlService.parse(out))).toBe(true);
    expect(out).toContain('count: 8');
    const doc = YamlService.parse(out) as Array<{
      addressBlocks: Array<{
        registers: Array<{ offset: number; count?: number; stride?: number }>;
      }>;
    }>;
    const regs = doc[0].addressBlocks[0].registers;
    const trailing = regs[regs.length - 1];
    const chGainEnd = regs[6].offset + (regs[6].count ?? 1) * (regs[6].stride ?? 4);
    expect(trailing.offset).toBe(chGainEnd);
  });
});

function uiAddRegisterInsideArrayOutline(
  text: string,
  blockIndex: number,
  parentRegIndex: number
): string {
  const rootObj = YamlService.safeParse(text);
  const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
  const mapObj = YamlPathResolver.getAtPath(root, selectionRootPath) as LayoutMemoryMap;

  // Insert register inside the parent array at targetIndex -1 (append)
  const result = insertElement(
    mapObj,
    'register',
    'after',
    -1,
    { blockIndex, registerIndex: parentRegIndex },
    'register'
  );
  expect(result.errors).toEqual([]);

  const blocks = (result.memoryMap.addressBlocks ?? []) as Record<string, unknown>[];
  const block = blocks[blockIndex];
  const width = blockRegWidth(block);

  const edits = [];
  const parentReg = (block.registers as Record<string, unknown>[])?.[parentRegIndex];
  const regs = (Array.isArray(parentReg.registers) ? parentReg.registers : []) as Record<
    string,
    unknown
  >[];
  const value = regs.map((r) => serializeValue(r, width) as Record<string, unknown>);
  edits.push({
    path: [
      ...selectionRootPath,
      'addressBlocks',
      blockIndex,
      'registers',
      parentRegIndex,
      'registers',
    ],
    value,
  });

  if (parentReg.stride !== undefined) {
    edits.push({
      path: [
        ...selectionRootPath,
        'addressBlocks',
        blockIndex,
        'registers',
        parentRegIndex,
        'stride',
      ],
      value: parentReg.stride,
    });
  }

  return YamlService.applyPathEdits(text, edits);
}

describe('$version tokens and versionHistory survive the webview write paths', () => {
  const HASH = 'rs1-3f9a0c41d2b7e6a5';
  const HISTORY = `  versionHistory:
    registerSets:
      ${HASH}:
        addressBlocks:
          - name: REGS
            registers:
              - name: ID
                offset: 4
                fields:
                  - name: MAJOR
                    bits: '[23:16]'
                    resetValue: $version.major
    versions:
      - version: 1.4.1
        registerSet: ${HASH}
`;
  const SOURCE = `# version register map
- name: CSR
  addressBlocks:
    - name: REGS
      baseAddress: 0
      registers:
        - name: VERSION
          offset: 0
          access: read-only
          resetValue: $version
        - name: ID
          offset: 4
          fields:
            - name: MAJOR
              bits: '[23:16]'
              access: read-only
              resetValue: $version.major
            - name: MINOR
              bits: '[15:8]'
              access: read-only
              resetValue: $version.minor
            - name: FLAGS
              bits: '[7:0]'
              resetValue: 5
${HISTORY}`;

  const rawSchema = JSON.parse(fs.readFileSync(schemaFile, 'utf8')) as {
    items?: { $defs?: object };
  } & Record<string, unknown>;
  const validateMap = new Ajv({ strict: false, allowUnionTypes: true }).compile({
    ...rawSchema,
    $defs: rawSchema.items?.$defs,
  });

  type Reg = {
    resetValue?: unknown;
    fields?: Array<{ name: string; bits: string; resetValue?: unknown }>;
  };
  const registersOf = (text: string): Reg[] =>
    (YamlService.parse(text) as Array<{ addressBlocks: Array<{ registers: Reg[] }> }>)[0]
      .addressBlocks[0].registers;

  /** Every token is still attached to its register/field, no versionRef leaked, schema-valid. */
  const expectTokensIntact = (text: string): void => {
    const regs = registersOf(text);
    expect(regs.some((r) => r.resetValue === '$version')).toBe(true);
    const fields = regs.flatMap((r) => r.fields ?? []);
    expect(fields.find((f) => f.name === 'MAJOR')?.resetValue).toBe('$version.major');
    expect(fields.find((f) => f.name === 'MINOR')?.resetValue).toBe('$version.minor');
    expect(fields.find((f) => f.name === 'FLAGS')?.resetValue).toBe(5);
    expect(text).not.toContain('versionRef');
    expect(validateMap(YamlService.parse(text))).toBe(true);
  };

  /** Path edits leave the history block byte-identical. */
  const expectHistoryUntouched = (text: string): void => {
    expect(text).toContain(HISTORY);
  };

  const registerSelection: Selection = {
    id: 'block-0-reg-1',
    type: 'register',
    object: { name: 'ID' },
    breadcrumbs: ['CSR', 'REGS', 'ID'],
    path: ['addressBlocks', 0, 'registers', 1],
  };

  function runHandler(
    apply: (handler: (path: (string | number)[], value: unknown) => void) => void
  ): string {
    const rawTextRef = { current: SOURCE };
    const selectionRef = { current: registerSelection as Selection | null };
    const sendUpdate = jest.fn();
    const { result } = renderHook(() =>
      useYamlUpdateHandler({
        selectionRef,
        rawTextRef,
        updateRawText: (t: string) => {
          rawTextRef.current = t;
        },
        sendUpdate,
      })
    );
    act(() => apply(result.current));
    expect(sendUpdate).toHaveBeenCalledTimes(1);
    return sendUpdate.mock.calls[0][0] as string;
  }

  it('the source itself is schema-valid and intact', () => {
    expectTokensIntact(SOURCE);
  });

  it('(a) parse -> serialize round-trips tokens and the history', () => {
    const doc = parseMemoryMap(SOURCE);
    const out = YamlService.dump(serializeMemoryMap(doc.map, doc.rootStyle));
    expectTokensIntact(out);
    const history = (text: string) =>
      (YamlService.parse(text) as Array<Record<string, unknown>>)[0].versionHistory;
    expect(history(out)).toEqual(history(SOURCE));
    expect(history(out)).toBeDefined();
  });

  it('(b) a bits edit of a neighbouring field keeps the tokens (path edit)', () => {
    const out = runHandler((handler) => handler(['fields', 2, 'bits'], '[3:0]'));
    expect(registersOf(out)[1].fields?.[2].bits).toBe('[3:0]');
    expectTokensIntact(out);
    expectHistoryUntouched(out);
  });

  it('(b) a bits edit written as the whole fields array keeps the tokens', () => {
    const fields = parseAndNormalize(SOURCE).addressBlocks[0].registers[1].fields.map((f) =>
      f.name === 'FLAGS' ? { ...f, bits: '[3:0]', offset: 0, width: 4 } : f
    );
    const out = runHandler((handler) => handler(['fields'], fields));
    expect(registersOf(out)[1].fields?.[2].bits).toBe('[3:0]');
    expectTokensIntact(out);
    expectHistoryUntouched(out);
  });

  it('(c) add register via BlockEditor path (normalized) keeps the tokens', () => {
    const out = uiAddRegister(SOURCE, 0);
    expect(registersOf(out)).toHaveLength(3);
    expectTokensIntact(out);
    expectHistoryUntouched(out);
  });

  it('(c) add register via the outline path (raw) keeps the tokens', () => {
    const out = uiAddRegisterOutline(SOURCE, 0);
    expect(registersOf(out)).toHaveLength(3);
    expectTokensIntact(out);
    expectHistoryUntouched(out);
  });

  it('(c) add block keeps the tokens', () => {
    const out = uiAddBlock(SOURCE);
    expectTokensIntact(out);
    expectHistoryUntouched(out);
  });

  it('(d) a field-move op keeps each token on its field', () => {
    const out = runHandler((handler) => handler(['__op', 'field-move'], { index: 1, delta: -1 }));
    const fields = registersOf(out)[1].fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['MINOR', 'MAJOR', 'FLAGS']);
    expect(fields.map((f) => f.bits)).not.toEqual(['[15:8]', '[23:16]', '[7:0]']);
    expectTokensIntact(out);
    expectHistoryUntouched(out);
  });
});
