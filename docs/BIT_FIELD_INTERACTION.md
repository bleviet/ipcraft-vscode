# Bit Field Interaction: Current Implementation

This document explains how bit-field editing works in the current Memory Map register editor.

Primary implementation files:

- `src/webview/components/BitFieldVisualizer.tsx`
- `src/webview/components/register/RegisterEditor.tsx`
- `src/webview/components/register/FieldsTable.tsx`
- `src/webview/hooks/useFieldEditor.ts`

---

## 1) Core Model

The visualizer derives field ownership from normalized ranges:

- canonical range: `bit_range: [hi, lo]`
- fallback from `bit_offset` + `bit_width` when needed

It builds a per-bit ownership map (`number | null` per bit) used for:

- hit testing
- collision detection
- resize/translate limits
- rendering segment groups

---

## 2) Shift-Drag (Resize / Create)

### Resize mode

When Shift + pointer-down hits an existing field:

- visualizer enters resize mode
- anchor is fixed at one edge
- current pointer bit is clamped to valid boundaries
- on pointer-up, emits `onUpdateFieldRange(fieldIndex, [newHi, newLo])`

### Create mode

When Shift + pointer-down hits a gap:

- visualizer enters create mode
- drag selects `[hi, lo]` range inside allowed gap
- on pointer-up, emits `onCreateField({ bit_range: [hi, lo], name: 'new_field' })`

`RegisterEditor` converts these callbacks into full field updates and commits a single `onUpdate(['fields'], newFields)`.

---

## 3) Ctrl-Drag (Translate)

Ctrl-drag moves field ranges while preserving width.

Behavior:

- translation by delta (`currentBit - startBit`)
- clamp to register bounds
- reject overlapping range placements
- emit live preview during drag

Callbacks:

- `onBatchUpdateFields(updates)` for atomic multi-field updates
- `onDragPreview(preview | null)` for live table preview and cleanup

Atomic batch commit avoids stale-state race conditions from sequential per-field updates.

---

## 4) Table Synchronization

`FieldsTable` displays bit ranges using either:

- live drag preview ranges, or
- local draft values, or
- current field values

### Reorder consistency fix

`useFieldEditor` now clears index-keyed draft caches when field order/signature changes so stale draft values do not attach to different rows after reorder.

Cleared maps on order change:

- `bitsDrafts`
- `bitsErrors`
- `dragPreviewRanges`
- `resetDrafts`
- `resetErrors`

This keeps table bits aligned with visualizer ranges after swap/move operations.

---

## 5) Keyboard Interaction (Fields Table)

From `useFieldEditor`:

- navigation: arrows or `h/j/k/l`
- edit current cell: `F2` or `e`
- insert after: `o`
- insert before: `O` (shift+o)
- delete row: `d` or `Delete`
- move row: `Alt+Up` / `Alt+Down`
- blur editor back to table: `Escape`

---

## 6) Data Commit Path

1. Visual interaction updates local visual state.
2. Callback from visualizer to `RegisterEditor`.
3. `RegisterEditor` computes full updated field list (including derived offsets/widths).
4. `onUpdate(['fields'], updatedFields)` commits through `DetailsPanel` to YAML sync path.

---

## 7) Testing Coverage

Relevant tests:

- `src/test/suite/hooks/useFieldEditor.test.ts`
- `src/test/suite/algorithms/BitFieldRepacker.test.ts`
- `src/test/suite/services/SpatialInsertionService.test.ts`

The hook suite includes regression coverage for reorder synchronization behavior.
