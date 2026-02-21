# Bit Field Interaction

How bit-field editing works in the Memory Map register editor.

Primary implementation files:

- `src/webview/components/BitFieldVisualizer.tsx` -- visual register diagram + pointer interaction
- `src/webview/components/bitfield/useShiftDrag.ts` -- resize / create drag state machine
- `src/webview/components/bitfield/useCtrlDrag.ts` -- reorder drag state machine
- `src/webview/components/register/RegisterEditor.tsx` -- wires visualizer callbacks to data model
- `src/webview/components/register/FieldsTable.tsx` -- inline-editable table with draft/preview layers
- `src/webview/hooks/useFieldEditor.ts` -- selection, drafts, keyboard navigation, spatial insertion

---

## 1) Core Data Model

Every bit field carries three redundant but consistent position properties:

```
bit_range:  [hi, lo]      -- canonical [MSB, LSB] tuple
bit_offset: lo             -- LSB index
bit_width:  hi - lo + 1    -- field width in bits
```

`fieldToBitsString(field)` converts any field to the display string `[hi:lo]`.
`parseBitsRange(str)` parses `[hi:lo]` or `[n]` back into `[hi, lo]`.

### Bit-ownership array

`BitFieldVisualizer` builds a per-bit ownership array of length `registerSize` (default 32):

```
owners[bit] = fieldIndex | null
```

For each field, every bit from `lo` to `hi` is marked with that field's index.
Unowned bits are `null` (gaps). This array drives:

- **Hit testing** -- which field (if any) does a pointer click land on?
- **Collision detection** -- can a new/resized field occupy a given range?
- **Resize boundary calculation** -- how far can a field edge extend before hitting a neighbor?
- **Gap boundary calculation** -- what is the contiguous empty region around a bit?

### Segment model (pro layout)

`buildProLayoutSegments(fields, registerSize)` converts fields + gaps into an ordered list of
`ProSegment` objects (MSB to LSB). Each segment is either:

```ts
{ type: 'field', idx, start: lo, end: hi, name, color }
{ type: 'gap', start: lo, end: hi }
```

This list represents the full register as a left-to-right sequence and is used for
rendering and for the Ctrl-drag reorder algorithm.

---

## 2) Shift-Drag: Resize and Create

Shift-drag handles two modes, depending on whether the pointer lands on a field or a gap.
State is managed by `useShiftDrag` via `ShiftDragState`.

### 2a) Resize mode (Shift + pointer-down on a field)

```
Trigger:   Shift + PointerDown on bit owned by field F
Purpose:   Change F's bit range by dragging one edge
```

Algorithm:

1. Compute which edge the user grabbed by comparing the clicked bit to the field midpoint.
   If `bit >= (lo + hi) / 2`, the user is grabbing the MSB edge; otherwise the LSB edge.

2. Set the **anchor** to the opposite edge (the one that stays fixed).
   - Grabbing MSB edge --> anchor = `lo`
   - Grabbing LSB edge --> anchor = `hi`

3. Compute drag boundaries using `findResizeBoundary`:
   - `minBit` = nearest neighbor's `hi + 1` below the field (or 0)
   - `maxBit` = nearest neighbor's `lo - 1` above the field (or `registerSize - 1`)

4. On pointer-move, clamp `currentBit` to `[minBit, maxBit]` and update state.

5. On pointer-up, commit the new range as `[max(anchor, current), min(anchor, current)]`.

The result is emitted as `onUpdateFieldRange(fieldIndex, [newHi, newLo])`.

### 2b) Create mode (Shift + pointer-down on a gap)

```
Trigger:   Shift + PointerDown on an unowned bit
Purpose:   Create a new field by selecting a bit range within the gap
```

Algorithm:

1. Find the contiguous gap boundaries around the clicked bit using `findGapBoundaries`:
   expand outward in both directions while `owners[bit] === null`.

2. Set anchor = the clicked bit. Set `minBit`/`maxBit` to gap boundaries.

3. On pointer-move, clamp `currentBit` within boundaries. The user can drag in either
   direction from the anchor to select a range.

4. On pointer-up, emit `onCreateField({ bit_range: [hi, lo], name: 'new_field' })`.

`RegisterEditor.onCreateField` assigns the next sequential name (`field1`, `field2`, ...),
fills default properties, appends to the field list, sorts by LSB, and commits.

---

## 3) Ctrl-Drag: Reorder (Translate)

Ctrl-drag reorders fields by position while preserving each field's width.
State is managed by `useCtrlDrag` via `CtrlDragState`.

```
Trigger:   Ctrl/Cmd + PointerDown on a field
Purpose:   Move a field to a different bit position, pushing other fields aside
```

### Algorithm step by step

Given: fields array, `registerSize`, dragged field index `D`, current pointer bit `B`.

1. **Build segment list** from the current fields: `buildProLayoutSegments(fields, registerSize)`.
   Result is ordered MSB to LSB.

2. **Remove the dragged segment** from the list. This leaves a list of remaining fields + gaps.

3. **Repack the remaining segments** (LSB to MSB) to create a dense coordinate space with no
   gaps between field segments. This assigns each remaining segment a temporary `[start, end]`.

4. **Find the insertion target**: locate which repacked segment the pointer bit `B` falls inside.

5. **Insert the dragged segment**:
   - If `B` lands on a **field segment**: compare the offset within that segment to its center.
     If cursor is on the MSB half, insert the dragged field before (higher bits); otherwise after.
   - If `B` lands on a **gap segment**: split the gap at the cursor position. Place the dragged
     field between the two halves.
   - If `B` is above all content: insert at the MSB end.

6. **Final repack**: `repackSegments` assigns final `[start, end]` coordinates to every segment
   in the new order by walking LSB to MSB, producing a valid non-overlapping layout.

7. **Live preview**: the repacked segments are stored in `ctrlDrag.previewSegments` and sent to
   `RegisterEditor` via `onDragPreview`. The table and visualizer render the preview layout.

8. **Commit on pointer-up**: the preview segment positions become the actual field ranges via
   `onBatchUpdateFields(updates)`. This performs an atomic update to all field positions at once.

9. **Cancel on pointer-cancel/blur**: preview is cleared, fields revert to original positions.

### Why batch commit matters

An atomic `onBatchUpdateFields` call updates all field ranges in a single `onUpdate(['fields'], ...)`.
Sequential per-field updates would cause intermediate states where ranges overlap, triggering
validation errors or stale-state bugs.

---

## 4) Keyboard Interaction

### Register fields table (useFieldEditor + useTableNavigation)

| Key               | Action                              |
|-------------------|-------------------------------------|
| Arrow keys        | Navigate cells (row/column)         |
| `h` `j` `k` `l`  | Vim-style cell navigation           |
| `F2` or `e`       | Enter edit mode on current cell     |
| `Escape`          | Exit edit mode, refocus table       |
| `o`               | Insert field after selected row     |
| `O` (Shift+o)     | Insert field before selected row    |
| `d` or `Delete`   | Delete selected field               |
| `Alt+Up`          | Move selected field up (swap)       |
| `Alt+Down`        | Move selected field down (swap)     |

### Visualizer keyboard (pro layout)

| Key                     | Action                                      |
|-------------------------|---------------------------------------------|
| `Shift+Left/Right`     | Resize hovered field (LSB/MSB edge toggle)  |
| `Ctrl+Left/Right`      | Reorder hovered field (swap with neighbor)  |

`applyKeyboardResize` adjusts one edge by 1 bit (expand if gap exists, shrink if at boundary).
`applyKeyboardReorder` swaps the field with its adjacent segment in the segment list and repacks.

---

## 5) Table Display and Draft Layers

`FieldsTable` renders each field's properties in an inline-editable row. The displayed bit range
for a given field follows a priority chain:

```
1. dragPreviewRanges[index]   -- live Ctrl-drag preview (highest priority)
2. bitsDrafts[index]          -- user's uncommitted text edit
3. fieldToBitsString(field)   -- committed value from the data model
```

### Draft state management

`useFieldEditor` maintains per-field draft maps keyed by row index:

- `nameDrafts` / `nameErrors` -- field name editing + VHDL identifier validation
- `bitsDrafts` / `bitsErrors` -- bit range editing + format/overflow validation
- `resetDrafts` / `resetErrors` -- reset value editing + range validation
- `dragPreviewRanges` -- Ctrl-drag intermediate positions

### Reorder consistency

When fields are reordered (move, Ctrl-drag commit, insertion), the array indices change.
Index-keyed draft maps would show stale values on wrong rows.

`useFieldEditor` detects order changes by computing an **order signature**:

```ts
signature = fields.map((f, i) => `${name}|${bits}`).join('||')
```

When the signature changes between renders, all index-keyed maps are cleared:
`bitsDrafts`, `bitsErrors`, `dragPreviewRanges`, `resetDrafts`, `resetErrors`.

This forces the table to re-derive display values from the committed data model.

---

## 6) Inline Bits Editing with Auto-Repack

When the user edits a bit range in the table (e.g., changes `[3:0]` to `[7:0]`), `FieldsTable`
performs immediate forward repacking:

1. Parse the new bits string with `parseBitsInput`.
2. Validate format (`[N:M]` where `N >= M >= 0`).
3. Check total bit usage does not exceed `registerSize`.
4. Update the edited field's `bit_offset`, `bit_width`, `bit_range`.
5. Repack all fields after the edited one: for each subsequent field, set its LSB to
   `previousMSB + 1`, preserving its original width.
6. Commit the full updated field array via `onUpdate(['fields'], updatedFields)`.

This keeps fields contiguous and non-overlapping after a manual range change.

---

## 7) Data Commit Path

```
User interaction
    |
    v
BitFieldVisualizer callback (onUpdateFieldRange / onBatchUpdateFields / onCreateField)
    |
    v
RegisterEditor handler
    - computes derived fields (bit_offset, bit_width from bit_range)
    - sorts fields by LSB ascending
    - calls onUpdate(['fields'], newFields)
    |
    v
DetailsPanel -> useYamlSync -> YamlPathResolver -> DocumentManager
    |
    v
VS Code document update + YAML serialization
```

Single-field property edits (name, access, reset, description) use the path form:
`onUpdate(['fields', index, 'propertyName'], value)`.

Structural changes (insert, delete, reorder, resize, batch update) replace the entire
fields array: `onUpdate(['fields'], newFieldsArray)`.

---

## 8) Reset Value Editing via Visualizer

The pro layout renders per-bit value cells that show the reset value of each field
decomposed into individual bits.

- Click a bit cell to toggle between 0 and 1.
- Pointer-drag across bits to set multiple bits to the same value.
- The register-wide hex value bar shows the composite value and supports direct hex input.

Implementation uses `bitAt(value, bitIndex)` and `setBit(value, bitIndex, desired)` which
operate with `Math.pow(2, n)` arithmetic (safe up to 53 bits, avoiding 32-bit bitwise limits).

---

## 9) Testing Coverage

| Test file | Covers |
|-----------|--------|
| `src/test/suite/hooks/useFieldEditor.test.ts` | Draft management, selection, insertion, reorder sync |
| `src/test/suite/algorithms/BitFieldRepacker.test.ts` | Forward/backward repacking, edge clamping |
| `src/test/suite/services/SpatialInsertionService.test.ts` | Field/register/block insertion pipeline |

When changing interaction behavior, update both the algorithm/service tests and the hook tests.
