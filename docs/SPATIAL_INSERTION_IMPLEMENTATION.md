# Spatial Insertion Implementation

How the Memory Map editor inserts new entities (bit fields, registers, address blocks)
at spatially meaningful positions while maintaining valid, non-overlapping layouts.

Primary implementation:

- `src/webview/services/SpatialInsertionService.ts` -- pure insertion pipeline
- `src/webview/algorithms/BitFieldRepacker.ts` -- bit field forward/backward repacking
- `src/webview/algorithms/RegisterRepacker.ts` -- register offset repacking
- `src/webview/algorithms/AddressBlockRepacker.ts` -- address block base repacking

Integration points:

- `src/webview/hooks/useFieldEditor.ts` -- keyboard-driven field insertion (`o` / `O`)
- `src/webview/components/register/RegisterEditor.tsx` -- register field management
- `src/webview/components/memorymap/BlockEditor.tsx` -- register / block management

---

## Design Principles

1. **Pure functions, no side effects.** All service methods are static, take immutable inputs,
   and return a new `InsertionResult<T>`. Callers handle state updates and UI rendering.

2. **Uniform pipeline.** Every insertion follows the same five-stage pattern regardless of
   entity type (field, register, block).

3. **Fail with error, never corrupt.** On boundary violations or insufficient space, the
   service returns the original array unchanged with an `error` message. The caller can
   display the error without data loss.

---

## Result Type

```ts
interface InsertionResult<T> {
  items: T[];       // Updated array (unchanged on error)
  newIndex: number; // Index of new item in items (-1 on error)
  error?: string;   // Human-readable error (present only on failure)
}
```

---

## The Five-Stage Pipeline

Every insertion method follows this sequence:

```
1. LOCATE    Find the selected item and compute the insertion position
2. CREATE    Build a new default entity at the computed position
3. SPLICE    Insert the new entity into the array at the correct index
4. REPACK    Shift neighboring entities (forward or backward) to resolve collisions
5. VALIDATE  Check bounds, sort into canonical order, return result or error
```

Below, each stage is explained for all three entity types.

---

## Bit Field Insertion

Methods: `insertFieldAfter(fields, selectedIndex, registerSize)` and `insertFieldBefore(...)`.

### Stage 1: LOCATE

```
insertFieldAfter:   target position = selectedField.MSB + 1
insertFieldBefore:  target position = selectedField.LSB - 1
```

If `selectedIndex` is -1, the last field is used. The selected field's position is resolved
by parsing its bits string via `parseBitsRange(fieldToBitsString(field))`.

### Stage 2: CREATE

A new 1-bit field is created at the target position:

```ts
{
  name: nextSequentialName(fields, 'field'),  // e.g. 'field3'
  bits: formatBits(targetBit, targetBit),     // e.g. '[8:8]'
  bit_offset: targetBit,
  bit_width: 1,
  bit_range: [targetBit, targetBit],
  access: 'read-write',
  reset_value: 0,
  description: '',
}
```

`nextSequentialName` scans existing names matching `field(\d+)` and returns `field{max+1}`.

### Stage 3: SPLICE

**After:** insert new field at array position `selIdx + 1`.
**Before:** insert at array position `selIdx`.

### Stage 4: REPACK

Before splicing, the service checks for collisions at the target bit. If the bit is already
occupied by another field, an error is returned immediately (no implicit shift).

After splicing:
- **After insertion:** `repackFieldsForward(fields, selIdx + 2, registerSize)` shifts all
  fields from index `selIdx + 2` onward toward higher bits.
- **Before insertion:** `repackFieldsBackward(fields, selIdx - 1, registerSize)` shifts all
  fields from index `selIdx - 1` downward toward lower bits.

### Stage 5: VALIDATE

1. Sort fields by LSB ascending (`sortFieldsByLsb`).
2. Check bounds:
   - After insertion: verify no field has `LSB < 0`.
   - Before insertion: verify no field has `MSB >= registerSize`.
3. Find the new field by name in the sorted array to report `newIndex`.
4. If bounds are violated, return original array + error message.

### Empty register (edge case)

When `fields.length === 0`, a single 1-bit field at `[0:0]` is returned with no repacking.

---

## Repacking Algorithms (Bit Fields)

Located in `src/webview/algorithms/BitFieldRepacker.ts`. All functions operate on
`BitFieldRecord[]` and return a new array (no mutation).

### repackFieldsForward(fields, fromIndex, regWidth)

Shifts fields toward higher bit positions starting from `fromIndex`.

```
Input:  fields sorted by LSB ascending, fromIndex = first field to repack

For each field from fromIndex to end:
  1. Compute nextLsb:
     - If fromIndex > 0: previousField.MSB + 1
     - Otherwise: 0
  2. Preserve field width: width = originalMSB - originalLSB + 1
  3. New LSB = nextLsb
  4. New MSB = min(regWidth - 1, nextLsb + width - 1)  // clamp to register
  5. Update nextLsb = newMSB + 1 for next iteration
```

Visual example (32-bit register, inserting after field B):

```
Before: |  A[3:0]  |  B[7:4]  |  C[11:8]  |  ...gap...  |
Insert:                        ^-- new field at [8:8]
Splice: |  A[3:0]  |  B[7:4]  |  new[8:8]  |  C[11:8]  |
Repack: |  A[3:0]  |  B[7:4]  |  new[8:8]  |  C[12:9]  |
                                              ^-- C shifted forward by 1
```

### repackFieldsBackward(fields, fromIndex, regWidth)

Shifts fields toward lower bit positions starting from `fromIndex` going to index 0.

```
For each field from fromIndex down to 0:
  1. Compute nextMsb:
     - If fromIndex < length - 1: nextField.LSB - 1
     - Otherwise: regWidth - 1
  2. Preserve field width
  3. New MSB = nextMsb
  4. New LSB = max(0, nextMsb - width + 1)  // clamp to bit 0
  5. Update nextMsb = newLSB - 1 for next iteration
```

### repackFieldsFrom(fields, regWidth, startIdx)

Legacy function that repacks from `startIdx` downward (MSB to LSB direction). Used for
table-driven bit range edits. Starts from `regWidth - 1` (or the previous field's LSB - 1)
and assigns contiguous ranges going downward.

---

## Register Insertion

Methods: `insertRegisterAfter(registers, selectedIndex)` and `insertRegisterBefore(...)`.

### LOCATE

```
insertRegisterAfter:  newOffset = selectedOffset + selectedSize
insertRegisterBefore: newOffset = selectedOffset - 4
```

`selectedSize` accounts for register arrays: `count * stride` for arrays, 4 bytes for
regular registers. This matches the `registerFootprint()` helper in `RegisterRepacker`.

### CREATE

```ts
{
  name: nextSequentialName(registers, 'reg'),  // e.g. 'reg2'
  address_offset: newOffset,
  offset: newOffset,
  access: 'read-write',
  description: '',
}
```

### REPACK

- **After:** `repackRegistersForward(registers, selIdx + 2)` shifts subsequent registers
  so each starts immediately after the previous one's footprint.
- **Before:** `repackRegistersBackward(registers, selIdx - 1)` shifts preceding registers
  downward.

### VALIDATE

1. Sort by offset ascending.
2. For before-insertion: verify no register has `offset < 0`.
3. Return `newIndex` by name lookup.

### Register Repacker details

`registerFootprint(reg)` computes bytes occupied:
- Regular register: `max(1, floor(size_bits / 8))` where `size_bits` defaults to 32 -> 4 bytes.
- Register array: `stride * count`.

`repackRegistersForward(regs, fromIndex)`:
```
nextOffset = prevReg.offset + registerFootprint(prevReg)
for i = fromIndex to end:
  regs[i].offset = nextOffset
  nextOffset += registerFootprint(regs[i])
```

`repackRegistersBackward(regs, fromIndex)`:
```
nextOffset = nextReg.offset - registerFootprint(regs[fromIndex])
for i = fromIndex down to 0:
  regs[i].offset = max(0, nextOffset)
  nextOffset -= registerFootprint(regs[max(0, i-1)])
```

---

## Address Block Insertion

Methods: `insertBlockAfter(blocks, selectedIndex)` and `insertBlockBefore(...)`.

### LOCATE

```
insertBlockAfter:  newBase = selectedBase + selectedSize
insertBlockBefore: newBase = max(0, selectedBase - newSize)
```

`selectedSize` is computed by `calculateBlockSize(block)`:
- If the block has registers: `sum(4 bytes per reg, or count * stride per array reg)`
- Otherwise: block's `size` property (default 4).

### CREATE

```ts
{
  name: nextSequentialName(blocks, 'block'),  // e.g. 'block2'
  base_address: newBase,
  size: 4,
  usage: 'register',
  description: '',
  registers: [{
    name: 'reg0',
    address_offset: 0,
    offset: 0,
    access: 'read-write',
    description: '',
  }],
}
```

New blocks come with one default register.

### REPACK

- **After:** `repackBlocksForward(blocks, selIdx + 2)` shifts subsequent blocks.
- **Before:** first checks if the previous block overlaps the new one and shrinks it
  if possible, then calls `repackBlocksBackward(blocks, selIdx - 1)`.

### VALIDATE

1. Sort by base address ascending.
2. For before-insertion: verify previous block does not shrink to zero or negative size.
3. Return `newIndex` by name lookup.

### Address Block Repacker details

`repackBlocksForward(blocks, fromIndex)`:
```
nextBase = prevBlock.base_address + calculateBlockSize(prevBlock)
for i = fromIndex to end:
  blocks[i].base_address = nextBase
  nextBase += calculateBlockSize(blocks[i])
```

`repackBlocksBackward(blocks, fromIndex)`:
```
nextEnd = nextBlock.base_address - 1
for i = fromIndex down to 0:
  size = calculateBlockSize(blocks[i])
  base = nextEnd - size + 1
  blocks[i].base_address = max(0, base)
  nextEnd = base - 1
```

---

## UI Integration

### Keyboard (field table)

In `useFieldEditor`, `o` and `O` trigger `tryInsertField(after: boolean)`:

1. Call `SpatialInsertionService.insertFieldAfter` or `insertFieldBefore`.
2. If `result.error`: store in `insertError` state, scroll error into view, return.
3. Otherwise: commit `onUpdate(['fields'], result.items)`.
4. Update selection to `result.newIndex`, clear all draft caches.
5. Scroll the new row into view after a short delay.

### Error display

Service errors are stored in local UI state (`insertError`) and rendered as an inline
error banner above the fields table. The banner auto-scrolls into view on error.

### Integration with BlockEditor

`BlockEditor` uses `insertRegisterAfter/Before` and `insertBlockAfter/Before` following
the same pattern: call service, check error, commit items, update selection.

---

## Naming Convention

`nextSequentialName(items, prefix)` scans all items for names matching `<prefix>(\d+)` and
returns `<prefix>{max + 1}`. If no items match the pattern, returns `<prefix>1`.

Examples:
- Fields: `field1`, `field2`, `field3`, ...
- Registers: `reg1`, `reg2`, `reg3`, ...
- Blocks: `block1`, `block2`, `block3`, ...

---

## Testing

| Test file | Covers |
|-----------|--------|
| `src/test/suite/services/SpatialInsertionService.test.ts` | Full pipeline for all entity types: empty arrays, after/before, boundary errors, collision detection |
| `src/test/suite/algorithms/BitFieldRepacker.test.ts` | Forward/backward repacking, width preservation, clamping |
| `src/test/suite/hooks/useFieldEditor.test.ts` | Keyboard insertion triggers, error propagation, draft clearing |

When changing insertion or repacking behavior, update all three test suites.
