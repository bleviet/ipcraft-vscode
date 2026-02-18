# IPCraft VSCode Extension — Code Quality Improvement Plan

## Overview

The codebase has grown organically and shows several architectural concerns: a monolithic `DetailsPanel.tsx` (~3300+ lines), scattered algorithm logic, inconsistent patterns between the extension host and webview, and opportunities to improve DRY, separation of concerns, naming clarity, and modularity. This plan describes incremental refactoring steps to improve maintainability without breaking existing functionality.

---

## Requirements

- **R1**: No regression in existing functionality — all existing tests must continue to pass.
- **R2**: Each refactoring step must be independently compilable and testable.
- **R3**: Reduce `DetailsPanel.tsx` to focused, single-responsibility sub-components (~200 lines each).
- **R4**: Consolidate duplicated logic (bit field parsing, YAML key mapping, validation) into shared utilities.
- **R5**: Enforce consistent naming conventions across the codebase.
- **R6**: All new modules must have corresponding unit tests.
- **R7**: Improve type safety — eliminate remaining `any` types in public APIs.
- **R8**: Document all public functions and exported types with JSDoc.

---

## Implementation Steps

### Phase 1 — Decompose `DetailsPanel.tsx`

**Problem**: `DetailsPanel.tsx` is ~3300+ lines and handles bit fields, registers, address blocks, register arrays, spatial insertion, keyboard navigation, validation, and rendering. This is a clear violation of Single Responsibility.

#### Step 1.1 — Extract `useFieldEditor` hook

Extract all bit field editing state and handlers (drafts, validation, active cell, insert logic) into a dedicated hook.

```typescript
// filepath: src/webview/hooks/useFieldEditor.ts
/**
 * Manages editing state and operations for bit fields within a register.
 * Handles draft values, validation errors, active cell tracking,
 * and spatial insertion logic.
 */
export function useFieldEditor(
  fields: BitFieldDef[],
  registerSize: number,
  onUpdate: (path: YamlPath, value: unknown) => void,
) {
  // nameDrafts, bitsDrafts, resetDrafts, errors, activeCell
  // handleInsertAfter, handleInsertBefore, handleDeleteField
  // handleMoveField
}
```

#### Step 1.2 — Extract `FieldsTable` component

Move the `<table>` rendering for bit fields into its own component.

```typescript
// filepath: src/webview/components/register/FieldsTable.tsx
/**
 * Renders the editable bit fields table for a register.
 * Delegates insertion/deletion/editing to useFieldEditor.
 */
export function FieldsTable({ fields, registerSize, onUpdate }: FieldsTableProps) {}
```

#### Step 1.3 — Extract `RegisterEditor` component

Move register-level property editing (name, offset, access, description) into its own component.

```typescript
// filepath: src/webview/components/register/RegisterEditor.tsx
/**
 * Renders and manages editing of a single register's properties.
 */
export function RegisterEditor({ register, onUpdate }: RegisterEditorProps) {}
```

#### Step 1.4 — Extract `BlockEditor` component

Move address block editing, the blocks summary table, and spatial block insertion into its own component.

```typescript
// filepath: src/webview/components/memorymap/BlockEditor.tsx
/**
 * Renders and manages editing of a single address block's properties,
 * including spatial insertion of new blocks.
 */
export function BlockEditor({ block, onUpdate }: BlockEditorProps) {}
```

#### Step 1.5 — Extract `RegisterArrayEditor` component

Move register array editing (name, count, stride, base offset) into its own component.

```typescript
// filepath: src/webview/components/memorymap/RegisterArrayEditor.tsx
/**
 * Renders and manages editing of a register array definition.
 */
export function RegisterArrayEditor({ array, onUpdate }: RegisterArrayEditorProps) {}
```

#### Step 1.6 — Reduce `DetailsPanel` to a router/coordinator

After extraction, `DetailsPanel` should only:
- Receive `selection` + `onUpdate`
- Delegate rendering to the correct sub-component based on selection type

```typescript
// filepath: src/webview/components/DetailsPanel.tsx
/**
 * Routes the current selection to the appropriate detail editor component.
 * Does not contain any editing logic itself.
 */
export const DetailsPanel = React.forwardRef<DetailsPanelHandle, DetailsPanelProps>(
  ({ selection, onUpdate, ... }, ref) => {
    switch (selection.type) {
      case 'register': return <RegisterEditor .../>;
      case 'block':    return <BlockEditor .../>;
      case 'array':    return <RegisterArrayEditor .../>;
      default:         return <EmptyState />;
    }
  }
);
```

---

### Phase 2 — Consolidate Spatial Insertion Logic

**Problem**: Spatial insertion logic (`handleInsertAfter`, `handleInsertBefore` for fields, blocks, and registers) is duplicated inline in `DetailsPanel.tsx` with similar structure. The pattern — *compute new item → insert in array → repack → sort → validate → dispatch* — is repeated three times.

#### Step 2.1 — Create a `SpatialInsertionService`

```typescript
// filepath: src/webview/services/SpatialInsertionService.ts

/**
 * Generic result of a spatial insertion operation.
 */
export interface InsertionResult<T> {
  items: T[];
  newIndex: number;
  error?: string;
}

/**
 * Provides spatial insertion operations for bit fields, registers,
 * and address blocks. Encapsulates the insert → repack → sort → validate pipeline.
 */
export class SpatialInsertionService {
  static insertFieldAfter(
    fields: BitFieldDef[],
    selectedIndex: number,
    registerSize: number,
  ): InsertionResult<BitFieldDef>;

  static insertFieldBefore(
    fields: BitFieldDef[],
    selectedIndex: number,
    registerSize: number,
  ): InsertionResult<BitFieldDef>;

  static insertBlockAfter(
    blocks: AddressBlock[],
    selectedIndex: number,
  ): InsertionResult<AddressBlock>;

  static insertRegisterAfter(
    registers: RegisterDef[],
    selectedIndex: number,
  ): InsertionResult<RegisterDef>;
}
```

---

### Phase 3 — Consolidate Duplicated Utilities

**Problem**: There is overlapping logic between `src/webview/services/YamlService.ts`, `src/webview/shared/utils/yamlKeyMapper.ts`, `src/webview/shared/utils/validation.ts`, and inline validation in `DetailsPanel.tsx`.

#### Step 3.1 — Centralise bit field utility functions

The `toBits`, `parseBitsRange`, `formatBits` functions appear in multiple places. Consolidate them.

```typescript
// filepath: src/webview/utils/BitFieldUtils.ts
/**
 * Parses a bits string '[hi:lo]' or '[n]' into [hi, lo].
 * Returns null if the format is unrecognised.
 */
export function parseBitsRange(bits: string): [number, number] | null;

/**
 * Formats a bit range as '[hi:lo]' or '[n:n]' for single bits.
 */
export function formatBitsRange(hi: number, lo: number): string;

/**
 * Converts a field definition to its canonical bits string.
 * Prefers explicit `bits` field, falls back to `bit_offset`/`bit_width`.
 */
export function fieldToBitsString(field: BitFieldDef): string;
```

#### Step 3.2 — Remove redundant `any` types from `YamlService` public API

Replace `any` with `unknown` in `YamlService.parse`, `YamlService.dump`, and `YamlService.cleanForYaml` signatures. Use internal type guards.

#### Step 3.3 — Unify validation helpers

`validateVhdlIdentifier`, `validateUniqueName`, `validateFrequency`, etc. exist in `src/webview/shared/utils/validation.ts` but are also applied inline. Ensure all validation goes through this module and is not re-implemented elsewhere.

---

### Phase 4 — Improve Naming Clarity

**Problem**: Several names are ambiguous or inconsistent.

| Current | Proposed | Reason |
|---|---|---|
| `mapPrefix` (in `index.tsx`) | `selectionRootPath` | Describes purpose |
| `sel` | `selection` | Avoid abbreviations |
| `arr` (RegisterArray in DetailsPanel) | `registerArray` | Avoid abbreviations |
| `f` (field loop var) | `field` | Avoid single-letter variables |
| `toBits(f)` | `fieldToBitsString(field)` | Descriptive function name |
| `op` (in handleFieldOperations) | `operationType` | Avoid abbreviations |
| `idx` | `index` | Avoid abbreviations |

Apply renames systematically, starting from the most-used identifiers.

---

### Phase 5 — Improve Type Safety

#### Step 5.1 — Replace `any` in algorithm functions

```typescript
// Before
function repackFieldsForward(fields: any[], fromIndex: number, regSize: number): any[]

// After
function repackFieldsForward(
  fields: BitFieldDef[],
  fromIndex: number,
  registerSizeBits: number,
): BitFieldDef[]
```

#### Step 5.2 — Type the `onUpdate` callback consistently

The `onUpdate(path, value)` pattern appears throughout the webview. Define a shared type:

```typescript
// filepath: src/webview/types/editor.d.ts
export type YamlUpdateHandler = (path: YamlPath, value: unknown) => void;
```

#### Step 5.3 — Type discriminated unions for selection

```typescript
// filepath: src/webview/types/selection.d.ts
export type EditorSelection =
  | { type: 'register'; path: YamlPath; data: RegisterDef }
  | { type: 'block'; path: YamlPath; data: AddressBlock }
  | { type: 'array'; path: YamlPath; data: RegisterArrayNode }
  | { type: 'none' };
```

---

### Phase 6 — Improve IPCore Editor Consistency

**Problem**: The IPCore editor (`src/webview/ipcore/`) has a parallel component structure (`ClocksTable`, `ResetsTable`) that may diverge from the memory map editor patterns.

#### Step 6.1 — Extract shared `EditableTable` primitive

```typescript
// filepath: src/webview/shared/components/EditableTable.tsx
/**
 * Generic editable table with inline add/edit/delete row support.
 * Used by ClocksTable, ResetsTable, and FieldsTable.
 */
export function EditableTable<T>({
  rows,
  columns,
  onAdd,
  onEdit,
  onDelete,
}: EditableTableProps<T>) {}
```

#### Step 6.2 — Extract shared `FormField` component

Verify `FormField` (already used in `ClocksTable.tsx`) is reused everywhere and not re-implemented inline.

---

### Phase 7 — Documentation & JSDoc Completion

- Add JSDoc to all exported functions in `src/webview/algorithms/`
- Add JSDoc to all exported functions in `src/webview/services/`
- Update `docs/ARCHITECTURE.md` to reflect new component tree after Phase 1
- Add inline comments for non-obvious algorithm steps (e.g., clamping logic, collision detection)

---

## Testing

### Unit Tests — New Modules

| Module | Test File | Key Cases |
|---|---|---|
| `SpatialInsertionService` | `src/test/suite/services/SpatialInsertionService.test.ts` | Insert into empty array, insert after last item, insert before first item, collision → error, gap → error, overflow → error |
| `useFieldEditor` | `src/test/suite/hooks/useFieldEditor.test.ts` | Draft initialisation, validation triggers, insert field updates state, delete clears active cell |
| `BitFieldUtils.parseBitsRange` | `src/test/suite/utils/BitFieldUtils.test.ts` | `[7:4]`, `[0:0]`, `[31]`, invalid strings → null |
| `BitFieldUtils.fieldToBitsString` | same | Fields with `bits`, with `bit_offset`/`bit_width`, with neither |
| `EditableTable` | `src/test/suite/components/EditableTable.test.ts` | Render rows, click add shows inline form, save calls `onAdd`, cancel cancels |

### Regression Tests — Refactored Components

- After each Phase 1 extraction, verify the existing `YamlService.test.ts` and `RegisterRepacker.test.ts` still pass without modification.
- Add a smoke test that renders `DetailsPanel` with a mock selection and verifies the correct sub-component is shown.

### Type Safety Tests

- Enable `strict: true` in `tsconfig.json` if not already, and resolve all resulting errors as a checklist.
- Add ESLint rule `@typescript-eslint/no-explicit-any` as a warning to track progress.

---

## Priority Order

```
Phase 1 (DetailsPanel decomposition) — Highest impact, enables all other phases
Phase 2 (SpatialInsertionService)    — Eliminates most duplication
Phase 3 (Utility consolidation)      — Reduces hidden coupling
Phase 5 (Type safety)                — Prevents future bugs
Phase 4 (Naming clarity)             — Improves readability
Phase 6 (Shared primitives)          — Long-term consistency
Phase 7 (Documentation)              — Ongoing, parallel to all phases
```
