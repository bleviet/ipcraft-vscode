# Spatial Editing

How the Memory Map editor inserts new entities (bit fields, registers, address blocks) at spatially meaningful positions while maintaining valid, non-overlapping layouts.

## Five-Stage Pipeline

Every insertion -- whether a bit field, register, or address block -- follows the same pipeline:

```mermaid
graph LR
    L["1. LOCATE<br/>Find insertion position"] --> C["2. CREATE<br/>Build default entity"]
    C --> S["3. SPLICE<br/>Insert into array"]
    S --> R["4. REPACK<br/>Shift neighbors"]
    R --> V["5. VALIDATE<br/>Check bounds, sort"]
```

| Stage | Purpose |
|-------|---------|
| **Locate** | Find the selected item and compute insertion position |
| **Create** | Build a new default entity at the computed position |
| **Splice** | Insert the entity into the array at the correct index |
| **Repack** | Shift neighboring entities to resolve collisions |
| **Validate** | Check bounds, sort into canonical order, return result or error |

## Result Type

All insertion methods return the same structure:

```typescript
interface InsertionResult<T> {
  items: T[];       // updated array (unchanged on error)
  newIndex: number; // index of new item (-1 on error)
  error?: string;   // human-readable error (only on failure)
}
```

On failure, the original array is returned unchanged. No data corruption.

## Entity Types

### Bit Fields

- Methods: `insertFieldAfter` / `insertFieldBefore`
- Creates a 1-bit field at the target position
- Repacks with `BitFieldRepacker` (forward or backward)
- Validates against register size (default 32 bits)

### Registers

- Methods: `insertRegisterAfter` / `insertRegisterBefore`
- Creates a register with default 4-byte size
- Handles register arrays (footprint = `count * stride`)
- Repacks with `RegisterRepacker`

### Address Blocks

- Methods: `insertBlockAfter` / `insertBlockBefore`
- Creates a block with one default register
- Repacks with `AddressBlockRepacker`

## Repacking Algorithms

Located in `src/webview/algorithms/`:

| Algorithm | File | Direction |
|-----------|------|-----------|
| `repackFieldsForward` | `BitFieldRepacker.ts` | Shifts fields toward MSB |
| `repackFieldsBackward` | `BitFieldRepacker.ts` | Shifts fields toward LSB |
| `repackRegistersForward` | `RegisterRepacker.ts` | Shifts registers to higher offsets |
| `repackRegistersBackward` | `RegisterRepacker.ts` | Shifts registers to lower offsets |
| `repackBlocksForward` | `AddressBlockRepacker.ts` | Shifts blocks to higher addresses |
| `repackBlocksBackward` | `AddressBlockRepacker.ts` | Shifts blocks to lower addresses |

Each repacker preserves the entity's width/size and shifts only the position. Clamping prevents negative offsets or exceeding bounds.

## UI Integration

### Keyboard triggers (field table)

`useFieldEditor` handles `o` (insert after) and `O` (insert before):

1. Call `SpatialInsertionService.insertFieldAfter` or `insertFieldBefore`
2. On error: show inline error banner
3. On success: commit updated array, select the new item, clear drafts

### Block and register insertion

`BlockEditor` follows the same pattern for registers and blocks.

## Implementation Files

| File | Purpose |
|------|---------|
| `src/webview/services/SpatialInsertionService.ts` | Pure insertion pipeline |
| `src/webview/algorithms/BitFieldRepacker.ts` | Bit field repacking |
| `src/webview/algorithms/RegisterRepacker.ts` | Register repacking |
| `src/webview/algorithms/AddressBlockRepacker.ts` | Block repacking |

## Testing

| Test File | Covers |
|-----------|--------|
| `src/test/suite/services/SpatialInsertionService.test.ts` | Full pipeline for all entity types |
| `src/test/suite/algorithms/BitFieldRepacker.test.ts` | Forward/backward repacking |
| `src/test/suite/hooks/useFieldEditor.test.ts` | Keyboard insertion, error propagation |
