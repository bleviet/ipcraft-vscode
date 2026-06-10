# Bulletproof Memory Layout Invariants: Audit & Refactoring Plan

## STEP 1: Workspace Introspection & Mutation Audit

### 1. Static vs. Dynamic Offsets

**Finding: Hybrid -- stored as static values, re-derived on normalization.**

The data model stores offsets as explicit static values at every level:

- **Address Blocks**: `base_address: number` -- stored in YAML, persisted in the data model ([AddressBlock](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/types/memoryMap.d.ts#L160-L170)).
- **Registers**: `offset: number` (YAML source) and `address_offset: number` (runtime alias) -- both stored statically ([RegisterDef](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/types/memoryMap.d.ts#L176-L188)).
- **Bit Fields**: `bits: string` (canonical `"[MSB:LSB]"` string stored in YAML), plus runtime-computed `bit_offset`, `bit_width`, `bit_range` derived from `bits` during normalization ([BitFieldDef](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/types/memoryMap.d.ts#L194-L204), [BitFieldRecord](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/types/editor.d.ts#L32-L42)).

The `DataNormalizer.normalizeRegisterList()` ([DataNormalizer.ts:137-195](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/DataNormalizer.ts#L137-L195)) does have an internal `currentOffset` running counter that can fill in missing offsets sequentially, but this only runs during *initial parse*. Once registers are rendered, their `address_offset` values are static numbers in the live state object.

**Root problem**: When an element is moved or deleted, its stored static offset is carried along unchanged. Downstream elements are not automatically re-derived unless the specific mutation code explicitly calls a repacker.

---

### 2. Alignment & Stride Rules

**Finding: Hardcoded to 32-bit/4-byte stride for registers, with register-array support.**

- `RegisterRepacker.registerFootprint()` ([RegisterRepacker.ts:7-17](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/RegisterRepacker.ts#L7-L17)) computes: for arrays, `stride * count`; for scalar registers, `Math.floor(bits / 8)` defaulting to `32 bits -> 4 bytes`.
- `calculateBlockSize()` ([blockSize.ts:18-33](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/utils/blockSize.ts#L18-L33)) sums register footprints identically: arrays use `count * stride`, scalar registers are hardcoded to `4 bytes`.
- The `SpatialInsertionService` hardcodes new registers at `4-byte` offsets ([SpatialInsertionService.ts:548](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/SpatialInsertionService.ts#L548): `newOffset = selectedOffset - 4`).
- The YAML schema supports `defaultRegWidth` per block and `size` per register, but the repacking/insertion code largely ignores these and defaults to `4`.

**Root problem**: `registerFootprint()` correctly reads `reg.size` and converts to bytes, but the insertion code uses a hardcoded `4` for new register sizing. For existing registers with non-32-bit widths, the repacker does respect the actual size. The deeper issue is that `calculateBlockSize()` ignores `reg.size` for scalar registers, always using `4`.

---

### 3. Relocation & Reordering Footprint

**Finding: Register reorder is a flat index swap with naive sequential offset re-stamp. Bitfield reorder correctly uses segment repacking. Block reorder does NOT exist.**

Three distinct relocation paths exist:

#### Bitfield Reorder (keyboard: Alt+Arrow, drag: Ctrl+drag)
Handled by [keyboardOperations.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/bitfield/keyboardOperations.ts) and [reorderAlgorithm.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/bitfield/reorderAlgorithm.ts). These correctly:
1. Build a segment layout from the field array
2. Splice/reinsert the dragged field at the target position
3. Call `repackSegments()` to recompute all bit ranges contiguously
4. Return per-field `{ idx, range }` updates

This is the **only well-implemented relocation path**.

#### Bitfield Move (keyboard: up/down arrows in the table editor)
Handled by [FieldOperationService.moveField()](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/FieldOperationService.ts#L73-L99). This:
1. Swaps array elements at `index` and `index + delta`
2. Walks the entire array from index 0, re-stamping `bits` with `formatBitsLike(offset, width)` using a running `offset` counter

> [!CAUTION]
> **BUG**: This `moveField()` directly mutates the `fields` array in place (it is called on the YAML root object). It also strips all properties except `name`, `bits`, `access`, `reset_value`, `description`, `enumerated_values` -- any extension properties (`[k: string]: unknown`) are silently dropped on every move operation.

#### Register Reorder (Ctrl+drag in RegisterMapVisualizer)
Handled inside [RegisterMapVisualizer.tsx commitCtrlDrag()](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/RegisterMapVisualizer.tsx#L139-L165). This:
1. Splices the dragged register out and re-inserts at the target position
2. Iterates all registers with a `runningOffset` counter, directly mutating `r.offset` and `r.address_offset`

> [!WARNING]
> **BUG**: This directly mutates the register objects in the existing `registers` array. The mutations are applied to the *same objects* that React holds in state, violating immutability. Furthermore, the `onReorderRegisters` callback in [BlockEditor.tsx:444](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/memorymap/BlockEditor.tsx#L444) calls `onUpdate(['registers'], newRegs)`, which replaces only the register array -- it does NOT trigger `repackSubsequentBlocks()` to cascade base_address changes to downstream address blocks.

#### Block Reorder
**Not implemented.** There is no UI gesture or code path for reordering address blocks. The `AddressBlockRepacker` has `repackBlocksForward` / `repackBlocksBackward` used only for insertion, not relocation.

---

### 4. State Architecture

**Finding: YAML text is the single source of truth, processed through a parse -> normalize -> render -> path-edit -> serialize -> sync pipeline.**

The state flow is:

```
YAML text (from VS Code extension)
  --> useYamlSync receives 'update' messages
    --> useMemoryMapState.updateFromYaml(text)
      --> YamlService.parse(text) -> DataNormalizer.normalizeMemoryMap()
        --> React state: memoryMap (MemoryMap object)

User edits:
  --> useYamlUpdateHandler: (path, value) =>
    1. YamlService.safeParse(rawTextRef.current) -> rootObj
    2. YamlPathResolver.setAtPath(root, fullPath, value)  // mutates in place
    3. YamlService.dump(root) -> newText
    4. updateRawText(newText) -> re-parse -> re-normalize -> re-render
    5. sendUpdate(newText) -> VS Code extension -> saves to file
```

**Special case: field operations** (`__op` prefix) are routed through [FieldOperationService.applyFieldOperation()](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/FieldOperationService.ts#L101-L139) which directly mutates the YAML root.

> [!IMPORTANT]
> The architecture is sound in principle -- YAML text as source of truth, path-based updates, re-parse/re-normalize on every edit. The bugs arise because:
> 1. Several mutation paths bypass the repacking pipeline (register reorder, field move)
> 2. Cross-layer cascading is ad-hoc (only `repackSubsequentBlocks` exists, and only for specific call sites)
> 3. Direct object mutation violates React immutability assumptions

---

## STEP 2: Refactoring Plan

### Core Design Principle

**Array position is the sole source of truth for layout.** After any mutation, a single `recomputeLayout()` function sweeps all three layers top-down (blocks -> registers -> fields) and stamps correct offsets/ranges based purely on sequential position and element sizes. This function is called as the final step of every mutation, making it impossible for offsets to desynchronize.

### Architecture

```
LayoutEngine (new file: src/webview/algorithms/LayoutEngine.ts)
  |
  +-- recomputeBlockLayout(blocks[])  -> blocks[] with correct base_address
  +-- recomputeRegisterLayout(registers[], defaultRegWidth)  -> registers[] with correct offset
  +-- recomputeBitfieldLayout(fields[], regWidth)  -> fields[] with correct bits/ranges
  +-- recomputeFullLayout(memoryMap)  -> full sweep, top-down
  +-- validateLayout(memoryMap)  -> LayoutError[] (overlap detection, bound checking)

MutationService (new file: src/webview/algorithms/MutationService.ts)
  |
  +-- insertElement(layer, mode, targetId, memoryMap)  -> memoryMap
  +-- deleteElement(layer, targetId, memoryMap)  -> memoryMap
  +-- relocateElement(layer, sourceId, targetParentId, targetIndex, memoryMap)  -> memoryMap
  |
  (every method ends with recomputeFullLayout + validateLayout)
```

### Proposed Changes

---

### LayoutEngine (algorithms layer)

#### [NEW] [LayoutEngine.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/LayoutEngine.ts)

Pure, stateless layout computation engine. No React, no DOM, no YAML.

Key functions:

- `recomputeBitfieldLayout(fields, regWidth)`: Walk fields in array order, assign `bit_offset` as a running counter of consumed bits, compute `bits` string. Clamp to `regWidth`. Return new array (immutable).
- `recomputeRegisterLayout(registers, defaultRegWidth)`: Walk registers in array order, assign `offset` / `address_offset` as a running counter using each register's footprint (respects `size` field and array `count * stride`). Return new array (immutable).
- `recomputeBlockLayout(blocks)`: Walk blocks in array order, assign `base_address` as a running counter using each block's computed size (sum of register footprints). Return new array (immutable).
- `recomputeFullLayout(memoryMap)`: Applies all three in top-down order: blocks, then registers within each block, then fields within each register. Returns a new `MemoryMap` object.
- `validateLayout(memoryMap)`: Returns `LayoutError[]` checking: bitfield overlaps within a register, bitfield exceeding register width, register overlap within a block, block overlap.

Design decisions:
- All functions return new objects (immutable). No in-place mutation.
- `recomputeFullLayout` is the canonical entry point -- callers never need to remember which sub-layers to update.
- The existing `BitFieldRepacker`, `RegisterRepacker`, and `AddressBlockRepacker` will be **replaced** by this unified engine. Their directional (forward/backward) repacking was a partial solution; the new engine always recomputes from scratch using array order.

---

### MutationService (algorithms layer)

#### [NEW] [MutationService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/MutationService.ts)

Stateless mutation functions operating on normalized `MemoryMap` data. Every function:
1. Performs the structural mutation (splice, insert, remove)
2. Calls `recomputeFullLayout()` on the result
3. Calls `validateLayout()` and returns errors if any

Key functions:

- `insertElement(layer, mode, targetIndex, parentPath?, memoryMap)`: Inserts a default element before/after the target. For bitfields: inserts a 1-bit field. For registers: inserts a 4-byte register. For blocks: inserts a block with one register.
- `deleteElement(layer, targetIndex, parentPath?, memoryMap)`: Removes the element. Layout is recomputed so downstream elements close the gap.
- `relocateElement(layer, sourceIndex, sourceParentPath?, targetParentPath?, targetIndex, memoryMap)`: Removes from source position, inserts at target position (possibly in a different parent). Layout is recomputed for both source and target parents.

Cross-parent relocation:
- **Bitfield to different register**: Field is removed from source register's fields array, inserted into target register's fields array at the specified index. Both registers' fields get `recomputeBitfieldLayout`. Overlap validation runs on the target register.
- **Register to different block**: Register is removed from source block's registers array, inserted into target block's registers array. Both blocks get `recomputeRegisterLayout`. Parent blocks get `recomputeBlockLayout`.
- **Block reorder**: Block is removed and reinserted. `recomputeBlockLayout` runs on the full block array.

---

### Integration changes

#### [MODIFY] [FieldOperationService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/FieldOperationService.ts)

Replace the `moveField()` function to use `MutationService.relocateElement('field', ...)` instead of manual array swap + running offset. Remove the property-stripping bug.

Replace `addField()` and `deleteField()` to delegate to `MutationService.insertElement` / `MutationService.deleteElement`.

#### [MODIFY] [RegisterMapVisualizer.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/components/RegisterMapVisualizer.tsx)

Replace `commitCtrlDrag()` (lines 139-165) to:
1. Build an immutable copy of the register array
2. Splice/reinsert immutably
3. Call `recomputeRegisterLayout()` instead of the manual `runningOffset` loop
4. Call `onReorderRegisters(newRegs)` with the properly offset-stamped copy

#### [MODIFY] [SpatialInsertionService.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/services/SpatialInsertionService.ts)

Refactor insertion methods to delegate to `MutationService.insertElement()` + `LayoutEngine.recomputeFullLayout()`. This eliminates the duplicated offset calculation logic and ensures consistency.

#### [MODIFY] [index.tsx](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/index.tsx)

Replace the ad-hoc `repackSubsequentBlocks()` callback (lines 92-130) and `handleRegisterAction()` (lines 184-224) with calls to the unified `MutationService`, which automatically cascades layout recomputation across all layers.

#### [DELETE or DEPRECATE] Existing repackers

The three repacker files ([BitFieldRepacker.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/BitFieldRepacker.ts), [RegisterRepacker.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/RegisterRepacker.ts), [AddressBlockRepacker.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/webview/algorithms/AddressBlockRepacker.ts)) become redundant once `LayoutEngine` is in place. They will be removed after all references are migrated.

---

## STEP 3: Mutator Function Signatures

```typescript
// LayoutEngine.ts

export interface LayoutError {
  layer: 'block' | 'register' | 'field';
  parentPath: string;        // e.g. "blocks[0].registers[2]"
  message: string;           // e.g. "Bitfield 'status' [7:4] overlaps with 'control' [5:0]"
  severity: 'error' | 'warning';
}

export interface LayoutResult<T> {
  data: T;
  errors: LayoutError[];
}

// MutationService.ts

export type Layer = 'block' | 'register' | 'field';
export type InsertMode = 'before' | 'after';

export interface MutationResult {
  memoryMap: NormalizedMemoryMap;
  errors: LayoutError[];
  /** Index of the newly inserted/relocated element in its parent array. */
  newIndex: number;
}

/** Insert a default element before/after the target. */
export function insertElement(
  memoryMap: NormalizedMemoryMap,
  layer: Layer,
  mode: InsertMode,
  targetIndex: number,
  parentPath?: { blockIndex: number; registerIndex?: number }
): MutationResult;

/** Delete an element at the target index. */
export function deleteElement(
  memoryMap: NormalizedMemoryMap,
  layer: Layer,
  targetIndex: number,
  parentPath?: { blockIndex: number; registerIndex?: number }
): MutationResult;

/** Relocate an element from source to target position. */
export function relocateElement(
  memoryMap: NormalizedMemoryMap,
  layer: Layer,
  sourceIndex: number,
  sourceParentPath: { blockIndex: number; registerIndex?: number },
  targetParentPath: { blockIndex: number; registerIndex?: number },
  targetIndex: number
): MutationResult;
```

---

## Open Questions

> [!IMPORTANT]
> **Register width**: Should `recomputeRegisterLayout` use `defaultRegWidth` from the parent `AddressBlock` when a register has no explicit `size`? Currently, `calculateBlockSize` hardcodes `4 bytes` for scalar registers regardless of block-level defaults. Using `defaultRegWidth` would be more correct but could change existing layout behavior.

> [!IMPORTANT]
> **Explicit vs. sequential offsets**: Some users may intentionally leave gaps between registers (e.g., reserved address space). Should `recomputeRegisterLayout` always pack registers contiguously, or should it only recompute when offsets are absent/null? The current proposal packs contiguously on every mutation. An alternative is to only recompute offsets for elements that were actually moved/inserted, preserving intentional gaps elsewhere.

> [!IMPORTANT]
> **Backward compatibility with existing YAML files**: The three repackers are used by existing test suites ([BitFieldRepacker.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/algorithms/BitFieldRepacker.test.ts), [RegisterRepacker.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/algorithms/RegisterRepacker.test.ts), [AddressBlockRepacker.test.ts](file:///home/balevision/workspace/bleviet/ipcraft-vscode/src/test/suite/algorithms/AddressBlockRepacker.test.ts)). Should the new `LayoutEngine` tests subsume those, or should both be maintained during a transition period?

---

## Verification Plan

### Automated Tests

New test file: `src/test/suite/algorithms/LayoutEngine.test.ts`
- Unit tests for each `recompute*` function in isolation
- Integration tests for `recomputeFullLayout` verifying cross-layer cascading
- Edge cases: empty arrays, single elements, max-width registers, array registers

New test file: `src/test/suite/algorithms/MutationService.test.ts`
- Insert/delete/relocate at each layer
- Cross-parent relocations (field to different register, register to different block)
- Overlap detection after relocation
- Boundary conditions (first element, last element, only element)

```bash
npx jest --testPathPattern='LayoutEngine|MutationService'
```

Existing tests must continue passing:
```bash
npx jest --testPathPattern='BitFieldRepacker|RegisterRepacker|AddressBlockRepacker'
```

### Manual Verification

- Open a memory map YAML file in the extension
- Ctrl+drag registers within a block -- verify offsets update correctly
- Use keyboard arrows to move bitfields -- verify bit ranges update correctly
- Insert/delete registers and verify downstream block base addresses cascade
- Insert/delete bitfields and verify no overlap or out-of-bounds

# Memory Map Structural Fix Walkthrough

I have completed the structural audit and refactored the memory map offset logic to use a stateless, globally consistent layout engine. This solves the bugs where moving, inserting, or deleting registers/fields caused offsets and alignments to get permanently out of sync.

## The Core Problem

Previously, the app used an incremental array mutation strategy where UI components (`BlockEditor`, `RegisterMapVisualizer`, `FieldOperationService`) would locally shift array elements and manually recalculate `address_offset` or `bit_offset` using `forEach` loops. This scattered logic was extremely fragile because it hardcoded offsets (e.g. `i * 4`) instead of respecting custom footprints, resulting in overlap and alignment corruption during dragging and dropping.

## The Solution

I designed a **stateless, top-down layout engine** to serve as the singular source of truth for spatial coordinates.

### 1. `LayoutEngine.ts`
Implemented a pure functional `recomputeFullLayout` that takes a full Memory Map YAML structure and recursively sweeps through blocks, registers, and fields. It assigns correct base addresses, byte offsets, and bit ranges based purely on array sequence and element sizes (footprints).

### 2. `MutationService.ts`
Provides `insertElement`, `deleteElement`, and `relocateElement` logic to correctly shuffle array elements without ever manually calculating offsets. Once elements are moved, it automatically runs `LayoutEngine.recomputeFullLayout()` to recalculate layout constraints globally.

### 3. Removed Ad-hoc UI Mutations
I eliminated all localized offset loops inside UI components:
- **`index.tsx`**: Removed `repackSubsequentBlocks` and `SpatialInsertionService`. We now intercept `handleUpdate` for registers and run `applyGlobalLayout()` which writes globally validated offsets to YAML.
- **`BlockEditor.tsx`**: Removed array offset adjustment loops for drag-and-drop and insertions. Replaced it with simple `splice` swaps.
- **`RegisterMapVisualizer.tsx`**: Removed manual offset recalculations after `commitCtrlDrag()`.
- **`FieldOperationService.ts`**: Removed loops trying to fix `bit_offset` during bitfield moves/insertions. Replaced it with an `applyGlobalLayout` hook in `useYamlUpdateHandler`.

## Testing

> [!TIP]
> The full layout logic ensures that structural hierarchy is strictly preserved and invariant constraints are enforced dynamically on every state update.

All tests are successfully passing, and lint issues have been resolved. The VS Code extension's webview should now be perfectly robust against any sort of array operation on memory map elements!
