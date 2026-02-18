# Shift-Drag Bit Field Interaction: Implementation Details

This document details the mathematical and programmatic implementation of the "Shift-Drag" interaction within the `BitFieldVisualizer` component. This feature allows users to resize existing bit fields and create new ones by dragging across the visual register grid.

## 1. Core Architecture

The visualization is built on a "Pro Segment" model which converts the abstract list of fields into a linear, rendered representation of the register.

### Data Structures

#### The `bits` Lookup Array
A dense array mapping every bit index (0-31) to a field index.
```typescript
const bits: (number | null)[] = Array(registerSize).fill(null);
// If bits[5] === 0, it means bit 5 belongs to fields[0].
// If bits[5] === null, bit 5 is a gap.
```
This array is recalculated on every render and serves as the primary collision map for hit-testing.

#### The Segment Model (`buildProLayoutSegments`)
Instead of rendering fields directly, the Pro Layout renders a list of **Segments**. A segment works like a "span" in the UI.

1.  **Input**: List of `Field` objects (arbitrary order).
2.  **Process**:
    *   Sort fields by MSB (descending).
    *   Iterate from `registerSize - 1` down to `0`.
    *   If the cursor is at a bit occupied by a field, push a `FieldSegment`.
    *   If the cursor is at an empty bit, identify the contiguous empty region and push a `GapSegment`.
3.  **Output**: An ordered list of segments covering the full 32-bit range.

```typescript
type ProSegment =
  | { type: 'field'; idx: number; start: number; end: number; ... }
  | { type: 'gap'; start: number; end: number };
```

**Why this matters**: This approach reifies "empty space" into DOM elements (`GapSegment`), making them interactive target that can listen for `pointerdown` events.

---

## 2. Interaction State Machine

The interaction is managed by the `shiftDrag` state object:

```typescript
interface ShiftDragState {
  active: boolean;              // Is a drag defined?
  mode: 'resize' | 'create';    // Operation type
  targetFieldIndex: number;     // (Resize only) Which field is being modified
  anchorBit: number;            // Where the user pressed pointer down
  currentBit: number;           // Where the user's pointer currently is (clamped)
  minBit: number;               // Hard lower limit (collision boundary)
  maxBit: number;               // Hard upper limit (collision boundary)
}
```

### State Transitions

1.  **Idle**: `active: false`.
2.  **Pointer Down (Shift Key Held)**:
    *   **Hit Test**: Check `bits[clickedBit]`.
    *   If **Hit Field** -> **Resize Mode**:
        *   Target: Field at index.
        *   Boundaries: Calculated via `findResizeBoundary`.
    *   If **Hit Gap** -> **Create Mode**:
        *   Boundaries: Calculated via `findGapBoundaries`.
3.  **Pointer Move**:
    *   Update `currentBit`.
    *   **Constraint**: `currentBit = clamp(rawBit, minBit, maxBit)`.
    *   This ensures the user cannot drag "through" an existing field into another one.
4.  **Pointer Up**:
    *   Commit changes via callbacks (`onUpdateFieldRange` or `onCreateField`).
    *   Reset state.

---

## 3. Boundary Algorithms

### Create Mode: `findGapBoundaries`
Expands outwards from the clicked bit to find the maximum contiguous empty region.

*   **Logic**:
    *   Walk `maxBit` up until `bits[maxBit + 1]` is not null or `registerSize` is reached.
    *   Walk `minBit` down until `bits[minBit - 1]` is not null or `0` is reached.

### Resize Mode: `findResizeBoundary`
Determines the hard limits for resizing a specific field.

*   **The "Range Redefine" Model**:
    *   When resizing, the user is NOT just moving one edge. They are defining a *new range* for the field using the drag selection.
    *   Therefore, the valid "sandbox" for the field is: `[Current Gap Below] + [Field Itself] + [Current Gap Above]`.
    *   **Lower Limit (`minBit`)**: The nearest collision with another field towards the LSB (or 0).
    *   **Upper Limit (`maxBit`)**: The nearest collision with another field towards the MSB (or 31).

---

## 4. Visual Feedback Logic

Visual feedback is computed dynamically during the render loop of the segments.

### The Selection Range
Defined mathematically as:
```typescript
const selectionLo = Math.min(shiftDrag.anchorBit, shiftDrag.currentBit);
const selectionHi = Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
```

### Gap Segment Rendering
When `mode === 'create'` OR `mode === 'resize'` (dragging field into gap):
*   **Active Bits**: Any bit `b` where `selectionLo <= b <= selectionHi`.
*   **Style**: Rendered with High Contrast Blue background and `+` symbol.

### Field Segment Rendering
When `mode === 'resize'`:
*   **Active Bits (`isInNewRange`)**: Bits inside the selection.
    *   **Style**: Solid opacity, Border highlight.
*   **Inactive Bits (`isOutOfNewRange`)**: Bits outside the selection (but inside the original field).
    *   **Concept**: These bits will be *discarded* if the user releases the mouse.
    *   **Style**: Low opacity (0.3), background color removed (grayed out).

---

## 5. Commit Logic

When the user releases the mouse:

**Mathematical Resolution**:
1.  Calculate final range `[H, L]` from `anchorBit` and `currentBit`.
2.  **If Resize**:
    *   Call `onUpdateFieldRange(targetIndex, [H, L])`.
    *   This atomic update overwrites the old range `[oldH, oldL]` with `[H, L]`.
    *   Any bits in `[oldH, oldL]` that are NOT in `[H, L]` become implicit gaps.
3.  **If Create**:
    *   Call `onCreateField({ bit_range: [H, L] })`.

This implementation ensures that "shrinking" a field is strictly equivalent to "selecting a sub-range" of that field, providing a predictable mental model for the user.

---

## 6. Visual Resize Handles

When the user holds the **Shift** key while hovering over a field, arrow indicators appear on resizable edges.

### Edge Detection (`getResizableEdges`)

For each field, we compute resize capabilities per edge:

```typescript
function getResizableEdges(fieldStart, fieldEnd, bitOwners, registerSize) {
  const msbBit = Math.max(fieldStart, fieldEnd);
  const lsbBit = Math.min(fieldStart, fieldEnd);
  const fieldWidth = msbBit - lsbBit + 1;

  const canShrink = fieldWidth > 1;
  const hasGapLeft = lsbBit > 0 && bitOwners[lsbBit - 1] === null;
  const hasGapRight = msbBit < registerSize - 1 && bitOwners[msbBit + 1] === null;

  return {
    left: { canShrink, canExpand: hasGapLeft },
    right: { canShrink, canExpand: hasGapRight },
  };
}
```

### Visual-to-Logical Mapping

Due to MSB-first rendering (higher bits on the left):
- **Visual left** = MSB edge (`edges.right`)
- **Visual right** = LSB edge (`edges.left`)

### Arrow Types

| Condition | Arrow | Meaning |
|-----------|-------|---------|
| `canShrink && canExpand` | ↔ (bidirectional) | Can shrink inward OR expand into gap |
| `canExpand` only | ← or → (outward) | Single-bit field, can only expand |
| `canShrink` only | → or ← (inward) | Multi-bit field at register boundary, can only shrink |

### Anchor Determination

When the user clicks to start a resize, the **opposite edge** becomes the anchor (fixed point):

```typescript
const fieldMid = (fieldRange.lo + fieldRange.hi) / 2;
const grabbingMsbEdge = bit >= fieldMid;
const anchorBit = grabbingMsbEdge ? fieldRange.lo : fieldRange.hi;
```

This ensures intuitive drag behavior: dragging from bit 31 toward 16 on field [31:1] yields [16:1], not [31:16].

---

# Ctrl-Drag Bit Field Interaction: Translation Implementation

The "Ctrl-Drag" feature allows users to move fields by dragging them to a new position. The field translates by the cursor delta while preserving its width.

## 1. The Translation Model

Unlike the previous "reorder" model which repacked segments, Ctrl-Drag now uses simple **delta-based translation**.

### Key Concepts
*   **Delta Translation**: Field moves by `delta = currentBit - startBit`.
*   **Width Preservation**: The field's bit-width is preserved during movement.
*   **Collision Detection**: Movement is blocked if it would overlap another field.
*   **Boundary Clamping**: Field is kept within register bounds.

---

## 2. Translation Algorithm (`handleCtrlPointerMove`)

### State Tracking

```typescript
interface CtrlDragState {
  active: boolean;
  draggedFieldIndex: number | null;
  startBit: number;           // Where the user started dragging
  originalRange: { lo, hi };  // Original field range
  previewSegments: ProSegment[] | null;
}
```

### Algorithm Steps

1. **Calculate Delta**: `delta = currentBit - startBit`
2. **Compute New Range**:
   ```typescript
   newLo = originalRange.lo + delta;
   newHi = originalRange.hi + delta;
   ```
3. **Clamp to Bounds**: Ensure `newLo >= 0` and `newHi < registerSize`
4. **Collision Check**: For each other field, reject if ranges overlap:
   ```typescript
   if (newLo <= otherRange.hi && newHi >= otherRange.lo) return; // Collision
   ```
5. **Generate Preview**: Build preview segments with the translated field.

### Visual Feedback: Grab Cursor

- **Ctrl held**: `cursor: grab` (open hand)
- **Ctrl+Drag active**: `cursor: grabbing` (closed hand)

---

## 3. Atomic Commit Mechanism

Since a reorder operation can change the bit ranges of *multiple* fields simultaneously (e.g., swapping two fields changes valid bits for both), updates must be atomic.

### The Problem: Race Conditions
If `onUpdateFieldRange` is called sequentially for multiple fields:
1.  Update Field A -> Triggers Parent State Update.
2.  Update Field B -> Triggers Parent State Update (using stale state from before Step 1).
3.  Result: Step 1 is lost.

### The Solution: `onBatchUpdateFields`
We introduced a specific callback props for batch operations.

```typescript
onBatchUpdateFields: (updates: { idx: number; range: [number, number] }[]) => void
```

**Implementation in `DetailsPanel`**:
1.  Clone `fields` array.
2.  Apply all updates locally to the clone.
3.  **Sort**: Re-sort the array by LSB to ensure logical table order.
4.  **Single Commit**: Call `onUpdate(['fields'], newFields)` once.

---

## 4. Live Table Preview (`onDragPreview`)

During Ctrl-Drag, the BIT(s) column in the details panel updates in real-time to show the preview bit ranges.

### Callback Interface

```typescript
onDragPreview?: (
  preview: { idx: number; range: [number, number] }[] | null,
) => void;
```

### Flow

1. **During Drag**: `handleCtrlPointerMove` extracts field ranges from `previewSegments` and calls `onDragPreview(updates)`.
2. **On Commit/Cancel**: `onDragPreview(null)` is called to clear the preview state.

### Implementation in `DetailsPanel`

```typescript
const [dragPreviewRanges, setDragPreviewRanges] = useState<
  Record<number, [number, number]>
>({});

// In bits column display:
const previewRange = dragPreviewRanges[idx];
const bitsValue = previewRange
  ? `[${previewRange[0]}:${previewRange[1]}]`
  : (bitsDrafts[idx] ?? bits);
```

---

## 5. Gap Segment Width Preservation

When splitting gaps during drag (e.g., dropping a field into a gap), the split gap segments must preserve their correct widths.

### The Bug (Fixed)

Previously, split gaps were created with `{ start: 0, end: 0 }`, causing width to default to 1 bit regardless of actual gap size. This caused segments beyond the split to disappear from the visualizer.

### The Fix

Split gaps now set `end = width - 1` to preserve correct dimensions:

```typescript
if (topWidth > 0) {
  newSegments.push({
    type: "gap",
    start: 0,
    end: topWidth - 1, // Correct width calculation
  });
}
```
