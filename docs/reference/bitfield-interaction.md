# Bit Field Interaction

Detailed reference for how bit-field editing works in the Memory Map register editor.

## Core Data Model

Every bit field carries three position properties:

```text
bit_range:  [hi, lo]       -- canonical [MSB, LSB] tuple
bit_offset: lo              -- LSB index
bit_width:  hi - lo + 1     -- field width in bits
```

### Bit-ownership array

`BitFieldVisualizer` builds a per-bit ownership array of length `registerSize` (default 32):

```text
owners[bit] = fieldIndex | null
```

This array drives hit testing, collision detection, resize boundary calculation, and gap detection.

### Segment model

`buildProLayoutSegments(fields, registerSize)` converts fields and gaps into an ordered list of segments:

```typescript
{ type: 'field', idx, start: lo, end: hi, name, color }
{ type: 'gap', start: lo, end: hi }
```

Used for rendering and the Ctrl-drag reorder algorithm.

## Shift-Drag: Resize and Create

### Resize (Shift + pointer-down on a field)

1. Determine which edge the user grabbed (MSB or LSB) by comparing to field midpoint
2. Anchor the opposite edge
3. Compute drag boundaries using `findResizeBoundary`
4. On pointer-move, clamp to boundaries
5. On pointer-up, commit new range via `onUpdateFieldRange`

### Create (Shift + pointer-down on a gap)

1. Find contiguous gap boundaries via `findGapBoundaries`
2. Set anchor at clicked bit
3. On pointer-move, expand selection within gap
4. On pointer-up, emit `onCreateField` with the selected range

## Ctrl-Drag: Reorder

Moves a field to a different bit position, pushing other fields aside.

1. Build segment list from current fields
2. Remove the dragged segment
3. Repack remaining segments (dense, no gaps)
4. Find insertion target at pointer position
5. Insert dragged segment (before/after field, or split gap)
6. Final repack assigns valid positions
7. Live preview via `ctrlDrag.previewSegments`
8. Commit on pointer-up with `onBatchUpdateFields` (atomic update)

!!! important
    Batch commit is essential. Sequential per-field updates would cause intermediate overlapping states.

## Table Draft Layers

`FieldsTable` display priority for bit ranges:

1. `dragPreviewRanges[index]` -- live Ctrl-drag preview (highest)
2. `bitsDrafts[index]` -- user's uncommitted text edit
3. `fieldToBitsString(field)` -- committed data model value

Draft maps are keyed by row index. On reorder, `useFieldEditor` detects order changes via an order signature and clears all draft maps.

## Inline Bits Editing with Repack

When the user edits a bit range in the table:

1. Parse new bits string
2. Validate format and total bit usage
3. Update edited field positions
4. Repack all subsequent fields (preserve widths, shift positions)
5. Commit full updated field array

## Data Commit Path

```text
User interaction
  -> BitFieldVisualizer callback
  -> RegisterEditor handler (compute derived fields, sort by LSB)
  -> onUpdate(['fields'], newFields)
  -> DetailsPanel -> useYamlSync -> YamlPathResolver -> DocumentManager
  -> VS Code document update
```

## Reset Value Editing

Pro layout renders per-bit value cells:

- Click a bit cell to toggle 0/1
- Drag across bits to set multiple bits
- Hex value bar shows composite value with direct hex input

Uses `Math.pow(2, n)` arithmetic (safe up to 53 bits, avoiding 32-bit bitwise limits).

## Implementation Files

| File | Purpose |
|------|---------|
| `BitFieldVisualizer.tsx` | Visual diagram + pointer interaction |
| `bitfield/useShiftDrag.ts` | Resize/create drag state machine |
| `bitfield/useCtrlDrag.ts` | Reorder drag state machine |
| `register/RegisterEditor.tsx` | Wires callbacks to data model |
| `register/FieldsTable.tsx` | Inline-editable table with drafts |
| `hooks/useFieldEditor.ts` | Selection, drafts, keyboard, insertion |

## Testing

| Test File | Covers |
|-----------|--------|
| `hooks/useFieldEditor.test.ts` | Draft management, selection, insertion, reorder sync |
| `algorithms/BitFieldRepacker.test.ts` | Forward/backward repacking, edge clamping |
| `services/SpatialInsertionService.test.ts` | Field/register/block insertion pipeline |
