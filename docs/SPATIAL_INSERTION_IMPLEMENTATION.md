# Spatial Insertion Implementation

This document describes the current spatial insertion system used by the Memory Map editor.

Primary implementation:

- `src/webview/services/SpatialInsertionService.ts`

Integration points:

- `src/webview/hooks/useFieldEditor.ts`
- `src/webview/components/register/RegisterEditor.tsx`
- `src/webview/components/memorymap/BlockEditor.tsx`

---

## Overview

Spatial insertion supports inserting new entities relative to current selection while preserving logical ordering.

Entity types:

1. Bit fields in a register
2. Registers in an address block
3. Address blocks in a memory map

All insertion methods return a pure `InsertionResult<T>` object.

---

## Service API

`SpatialInsertionService` exposes paired methods for each entity type:

- `insertFieldAfter(...)`
- `insertFieldBefore(...)`
- `insertRegisterAfter(...)`
- `insertRegisterBefore(...)`
- `insertBlockAfter(...)`
- `insertBlockBefore(...)`

Return shape:

```ts
interface InsertionResult<T> {
  items: T[];
  newIndex: number;
  error?: string;
}
```

---

## Pipeline

Each insertion flow follows the same pattern:

1. Determine selected index + insertion target location.
2. Create new default entity.
3. Resolve collisions/repacking using appropriate repacker algorithm.
4. Sort into canonical order.
5. Validate bounds and return either updated array or error.

Supporting repackers:

- fields: `BitFieldRepacker`
- registers: `RegisterRepacker`
- blocks: `AddressBlockRepacker`

---

## Current Behavior Notes

### Bit fields

- default inserted width: **1 bit**
- generated names: `fieldN` sequence
- canonical sort: by **LSB ascending**
- hard bounds: `0 <= lo`, `hi < registerSize`

### Registers

- default spacing logic respects register offset conventions
- canonical sort: by address offset ascending
- validates lower-bound constraints before returning success

### Address blocks

- canonical sort: by base address ascending
- validates boundaries/overlap outcomes from repack operations

---

## UI Integration

### Register field table keyboard insertion

In `useFieldEditor`:

- `o` → insert after selected field
- `O` (shift+o) → insert before selected field

Hook invokes `SpatialInsertionService.insertField*`, commits `onUpdate(['fields'], result.items)`, and updates active row to `result.newIndex`.

### Error propagation

Service errors are surfaced to local UI state (`insertError`) and shown inline in field/block editors.

---

## Testing

Core service behavior is covered in:

- `src/test/suite/services/SpatialInsertionService.test.ts`

Field-table integration behavior is covered in:

- `src/test/suite/hooks/useFieldEditor.test.ts`

When changing insertion behavior, update both service tests and affected hook/component tests.
