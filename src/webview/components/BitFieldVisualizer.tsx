import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { FIELD_COLORS, getFieldColor } from '../shared/colors';

export interface FieldModel {
  name?: string;
  bit?: number;
  bit_range?: [number, number];
  bit_offset?: number | string;
  bit_width?: number | string;
  description?: string;
  [key: string]: unknown;
}

interface BitFieldVisualizerProps {
  fields: FieldModel[];
  hoveredFieldIndex?: number | null;
  setHoveredFieldIndex?: (idx: number | null) => void;
  registerSize?: number;
  layout?: 'default' | 'pro';
  onUpdateFieldReset?: (fieldIndex: number, resetValue: number | null) => void;
  onUpdateFieldRange?: (fieldIndex: number, newRange: [number, number]) => void;
  onBatchUpdateFields?: (updates: { idx: number; range: [number, number] }[]) => void;
  onCreateField?: (field: { bit_range: [number, number]; name: string }) => void;
  /** Called during Ctrl+drag to report preview ranges. Pass null to clear preview. */
  onDragPreview?: (preview: { idx: number; range: [number, number] }[] | null) => void;
}

function getFieldRange(field: FieldModel): { lo: number; hi: number } | null {
  if (field?.bit_range && Array.isArray(field.bit_range) && field.bit_range.length === 2) {
    const hi = Number(field.bit_range[0]);
    const lo = Number(field.bit_range[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      return null;
    }
    return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
  }
  if (field?.bit !== undefined) {
    const b = Number(field.bit);
    if (!Number.isFinite(b)) {
      return null;
    }
    return { lo: b, hi: b };
  }
  return null;
}

function bitAt(value: number, bitIndex: number): 0 | 1 {
  if (!Number.isFinite(value) || bitIndex < 0) {
    return 0;
  }
  // Avoid 32-bit-only bitwise ops; support up to ~53 bits safely.
  const div = Math.floor(value / Math.pow(2, bitIndex));
  return div % 2 === 1 ? 1 : 0;
}

function setBit(value: number, bitIndex: number, desired: 0 | 1): number {
  const base = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (bitIndex < 0) {
    return base;
  }
  const current = bitAt(base, bitIndex);
  if (current === desired) {
    return base;
  }
  const delta = Math.pow(2, bitIndex);
  return desired === 1 ? base + delta : Math.max(0, base - delta);
}

function parseRegisterValue(text: string): number | null {
  const s = text.trim();
  if (!s) {
    return null;
  }
  // Accept decimal or 0x-prefixed hex.
  const v = Number.parseInt(s, 0);
  if (!Number.isFinite(v)) {
    return null;
  }
  return v;
}

function maxForBits(bitCount: number): number {
  if (bitCount <= 0) {
    return 0;
  }
  // JS Numbers are safe up to 53 bits of integer precision.
  if (bitCount >= 53) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.pow(2, bitCount) - 1;
}

function extractBits(value: number, lo: number, width: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (width <= 0) {
    return 0;
  }
  const shifted = Math.floor(value / Math.pow(2, lo));
  const mask = width >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, width) - 1;
  return shifted % (mask + 1);
}

// Group fields by contiguous bit ranges for pro layout
function groupFields(fields: FieldModel[]) {
  const groups: {
    idx: number;
    start: number;
    end: number;
    name: string;
    color: string;
  }[] = [];
  fields.forEach((field, idx) => {
    let start = Number(field.bit ?? 0);
    let end = Number(field.bit ?? 0);
    if (field.bit_range) {
      [end, start] = field.bit_range; // [hi, lo]
    }
    if (start > end) {
      [start, end] = [end, start];
    }
    groups.push({
      idx,
      start,
      end,
      name: field.name ?? '',
      color: getFieldColor(field.name ?? `field${idx}`, start),
    });
  });
  // Sort by start bit descending (MSB on left)
  groups.sort((a, b) => b.start - a.start);
  return groups;
}

type ProSegment =
  | {
      type: 'field';
      idx: number;
      start: number;
      end: number;
      name: string;
      color: string;
    }
  | { type: 'gap'; start: number; end: number };

/**
 * Build layout segments including fields and gaps, ordered MSB to LSB.
 */
function buildProLayoutSegments(fields: FieldModel[], registerSize: number): ProSegment[] {
  const groups = groupFields(fields);
  const segments: ProSegment[] = [];

  // Sort groups by end (MSB) descending for left-to-right rendering
  const sorted = [...groups].sort((a, b) => b.end - a.end);

  let cursor = registerSize - 1; // Start from MSB

  for (const group of sorted) {
    // If there's a gap before this field
    if (cursor > group.end) {
      segments.push({ type: 'gap', start: group.end + 1, end: cursor });
    }
    // Add the field
    segments.push({ type: 'field', ...group });
    cursor = group.start - 1;
  }

  // If there's a gap at the end (toward LSB)
  if (cursor >= 0) {
    segments.push({ type: 'gap', start: 0, end: cursor });
  }

  return segments;
}

/**
 * Build an array mapping each bit index to its owning field index, or null if gap.
 */
function buildBitOwnerArray(fields: FieldModel[], registerSize: number): (number | null)[] {
  const owners: (number | null)[] = Array.from({ length: registerSize }, () => null);
  fields.forEach((field, idx) => {
    const range = getFieldRange(field);
    if (range) {
      for (let bit = range.lo; bit <= range.hi; bit++) {
        if (bit >= 0 && bit < registerSize) {
          owners[bit] = idx;
        }
      }
    }
  });
  return owners;
}

/**
 * Determine resize capabilities for each edge of a field.
 * Returns whether each edge can shrink (field width > 1) and/or expand (gap adjacent).
 */
function getResizableEdges(
  fieldStart: number,
  fieldEnd: number,
  bitOwners: (number | null)[],
  registerSize: number
): {
  left: { canShrink: boolean; canExpand: boolean };
  right: { canShrink: boolean; canExpand: boolean };
} {
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

// ============================================================================
// Shift-Drag Types and Helpers
// ============================================================================

interface ShiftDragState {
  active: boolean;
  mode: 'resize' | 'create';
  targetFieldIndex: number | null;
  resizeEdge: 'msb' | 'lsb' | null;
  originalRange: { lo: number; hi: number } | null;
  anchorBit: number;
  currentBit: number;
  minBit: number;
  maxBit: number;
}

const SHIFT_DRAG_INITIAL: ShiftDragState = {
  active: false,
  mode: 'resize',
  targetFieldIndex: null,
  resizeEdge: null,
  originalRange: null,
  anchorBit: 0,
  currentBit: 0,
  minBit: 0,
  maxBit: 31,
};

interface CtrlDragState {
  active: boolean;
  draggedFieldIndex: number | null;
  previewSegments: ProSegment[] | null;
}

const CTRL_DRAG_INITIAL: CtrlDragState = {
  active: false,
  draggedFieldIndex: null,
  previewSegments: null,
};

/**
 * Find the boundaries of the gap containing startBit.
 * Returns { minBit, maxBit } for the contiguous empty region.
 */
function findGapBoundaries(
  startBit: number,
  bits: (number | null)[],
  registerSize: number
): { minBit: number; maxBit: number } {
  let minBit = startBit;
  let maxBit = startBit;

  // Expand toward MSB (higher bits)
  while (maxBit < registerSize - 1 && bits[maxBit + 1] === null) {
    maxBit++;
  }

  // Expand toward LSB (lower bits)
  while (minBit > 0 && bits[minBit - 1] === null) {
    minBit--;
  }

  return { minBit, maxBit };
}

/**
 * Find the collision boundary when resizing a field toward 'edge'.
 * Returns the maximum (for msb) or minimum (for lsb) bit the field can extend to.
 */
function findResizeBoundary(
  fieldIndex: number,
  edge: 'msb' | 'lsb',
  fields: FieldModel[],
  registerSize: number
): number {
  const thisRange = getFieldRange(fields[fieldIndex]);
  if (!thisRange) {
    return edge === 'msb' ? registerSize - 1 : 0;
  }

  if (edge === 'msb') {
    // Find nearest field above our MSB
    let limit = registerSize - 1;
    for (let i = 0; i < fields.length; i++) {
      if (i === fieldIndex) {
        continue;
      }
      const r = getFieldRange(fields[i]);
      if (r && r.lo > thisRange.hi) {
        limit = Math.min(limit, r.lo - 1);
      }
    }
    return limit;
  } else {
    // Find nearest field below our LSB
    let limit = 0;
    for (let i = 0; i < fields.length; i++) {
      if (i === fieldIndex) {
        continue;
      }
      const r = getFieldRange(fields[i]);
      if (r && r.hi < thisRange.lo) {
        limit = Math.max(limit, r.hi + 1);
      }
    }
    return limit;
  }
}

const BitFieldVisualizer: React.FC<BitFieldVisualizerProps> = ({
  fields,
  hoveredFieldIndex = null,
  setHoveredFieldIndex = () => undefined,
  registerSize = 32,
  layout = 'default',
  onUpdateFieldReset,
  onUpdateFieldRange,
  onBatchUpdateFields,
  onCreateField,
  onDragPreview,
}) => {
  const [valueView, setValueView] = useState<'hex' | 'dec'>('hex');
  const [valueDraft, setValueDraft] = useState<string>('');
  const [valueEditing, setValueEditing] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragSetTo, setDragSetTo] = useState<0 | 1>(0);
  const [dragLast, setDragLast] = useState<string | null>(null);

  // Shift-drag state for resizing/creating fields
  const [shiftDrag, setShiftDrag] = useState<ShiftDragState>(SHIFT_DRAG_INITIAL);

  // Ctrl-drag state for reordering fields
  const [ctrlDrag, setCtrlDrag] = useState<CtrlDragState>(CTRL_DRAG_INITIAL);

  // Ref to track ctrlDrag state synchronously (avoids stale closures in event handlers)
  const ctrlDragRef = useRef<CtrlDragState>(ctrlDrag);
  useEffect(() => {
    ctrlDragRef.current = ctrlDrag;
  }, [ctrlDrag]);

  // Track Shift key held (for showing resize handles)
  const [shiftHeld, setShiftHeld] = useState(false);

  // Track Ctrl/Meta key held (for grab cursor)
  const [ctrlHeld, setCtrlHeld] = useState(false);

  // Listen for Shift key press/release globally
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !shiftDrag.active) {
        setShiftHeld(true);
      }
      if ((e.key === 'Control' || e.key === 'Meta') && !ctrlDrag.active) {
        setCtrlHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftHeld(false);
      }
      if (e.key === 'Control' || e.key === 'Meta') {
        setCtrlHeld(false);
      }
    };
    const handleBlur = () => {
      setShiftHeld(false);
      setCtrlHeld(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [shiftDrag.active, ctrlDrag.active]);

  useEffect(() => {
    if (!dragActive) {
      return;
    }
    const stop = () => {
      setDragActive(false);
      setDragLast(null);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [dragActive]);

  // Shift-drag: cleanup on pointer up
  useEffect(() => {
    if (!shiftDrag.active) {
      return;
    }
    const commitShiftDrag = () => {
      if (shiftDrag.mode === 'resize' && shiftDrag.targetFieldIndex !== null) {
        // Redefine field range to the dragged selection
        const newLo = Math.min(shiftDrag.anchorBit, shiftDrag.currentBit);
        const newHi = Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
        if (onUpdateFieldRange && newLo <= newHi) {
          onUpdateFieldRange(shiftDrag.targetFieldIndex, [newHi, newLo]);
        }
      } else if (shiftDrag.mode === 'create') {
        const lo = Math.min(shiftDrag.anchorBit, shiftDrag.currentBit);
        const hi = Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
        if (onCreateField && lo <= hi) {
          onCreateField({ bit_range: [hi, lo], name: 'new_field' });
        }
      }
      setShiftDrag(SHIFT_DRAG_INITIAL);
    };
    window.addEventListener('pointerup', commitShiftDrag);
    window.addEventListener('pointercancel', () => setShiftDrag(SHIFT_DRAG_INITIAL));
    window.addEventListener('blur', () => setShiftDrag(SHIFT_DRAG_INITIAL));
    return () => {
      window.removeEventListener('pointerup', commitShiftDrag);
      window.removeEventListener('pointercancel', () => setShiftDrag(SHIFT_DRAG_INITIAL));
      window.removeEventListener('blur', () => setShiftDrag(SHIFT_DRAG_INITIAL));
    };
  }, [shiftDrag, onUpdateFieldRange, onCreateField]);

  // Ctrl-drag: cleanup on pointer up
  useEffect(() => {
    if (!ctrlDrag.active) {
      return;
    }
    const commitCtrlDrag = () => {
      if (ctrlDrag.previewSegments) {
        // Commit the new layout
        // Group by field index and update ranges
        const updates: { idx: number; range: [number, number] }[] = [];

        ctrlDrag.previewSegments.forEach((seg) => {
          if (seg.type === 'field') {
            updates.push({ idx: seg.idx, range: [seg.end, seg.start] });
          }
        });

        // Apply updates
        if (onBatchUpdateFields && updates.length > 0) {
          onBatchUpdateFields(updates);
        } else if (onUpdateFieldRange) {
          // Fallback (might cause race conditions)
          updates.forEach((update) => {
            onUpdateFieldRange(update.idx, update.range);
          });
        }
      }
      // Clear preview in parent
      onDragPreview?.(null);
      // Delay clearing preview to next frame to avoid flash back to original position
      requestAnimationFrame(() => {
        setCtrlDrag(CTRL_DRAG_INITIAL);
      });
    };
    const cancelCtrlDrag = () => {
      onDragPreview?.(null);
      setCtrlDrag(CTRL_DRAG_INITIAL);
    };
    window.addEventListener('pointerup', commitCtrlDrag);
    window.addEventListener('pointercancel', cancelCtrlDrag);
    window.addEventListener('blur', cancelCtrlDrag);
    return () => {
      window.removeEventListener('pointerup', commitCtrlDrag);
      window.removeEventListener('pointercancel', cancelCtrlDrag);
      window.removeEventListener('blur', cancelCtrlDrag);
    };
  }, [ctrlDrag, onUpdateFieldRange, onBatchUpdateFields, onDragPreview]);

  /**
   * Handle Ctrl+PointerDown to start reorder mode.
   */
  const handleCtrlPointerDown = (bit: number, e: React.PointerEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    if (e.button !== 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const fieldAtBit = bits[bit];
    if (fieldAtBit !== null) {
      // Start reorder drag
      setCtrlDrag({
        active: true,
        draggedFieldIndex: fieldAtBit,
        previewSegments: buildProLayoutSegments(fields, registerSize),
      });
    }
  };

  /**
   * Handle Shift+PointerDown to start resize or create mode.
   */
  const handleShiftPointerDown = (bit: number, e: React.PointerEvent) => {
    if (!e.shiftKey) {
      return;
    }
    if (e.button !== 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const fieldAtBit = bits[bit];

    if (fieldAtBit !== null) {
      // RESIZE mode - redefine field range via drag selection
      const fieldRange = getFieldRange(fields[fieldAtBit]);
      if (!fieldRange) {
        return;
      }

      // Allow dragging anywhere from collision boundary on LSB side to collision boundary on MSB side
      const minBit = findResizeBoundary(fieldAtBit, 'lsb', fields, registerSize);
      const maxBit = findResizeBoundary(fieldAtBit, 'msb', fields, registerSize);

      // Determine which edge the user is grabbing (closer to MSB or LSB)
      const fieldMid = (fieldRange.lo + fieldRange.hi) / 2;
      const grabbingMsbEdge = bit >= fieldMid;

      // Anchor is the OPPOSITE edge (the one that stays fixed)
      // If grabbing MSB edge, anchor is LSB; if grabbing LSB edge, anchor is MSB
      const anchorBit = grabbingMsbEdge ? fieldRange.lo : fieldRange.hi;

      setShiftDrag({
        active: true,
        mode: 'resize',
        targetFieldIndex: fieldAtBit,
        resizeEdge: null, // Not used in new model
        originalRange: fieldRange,
        anchorBit,
        currentBit: bit,
        minBit,
        maxBit,
      });
    } else {
      // CREATE mode
      const gap = findGapBoundaries(bit, bits, registerSize);

      setShiftDrag({
        active: true,
        mode: 'create',
        targetFieldIndex: null,
        resizeEdge: null,
        originalRange: null,
        anchorBit: bit,
        currentBit: bit,
        minBit: gap.minBit,
        maxBit: gap.maxBit,
      });
    }
  };

  /**
   * Handle pointer move during shift-drag.
   */
  const handleShiftPointerMove = (bit: number) => {
    if (!shiftDrag.active) {
      return;
    }
    const clampedBit = Math.max(shiftDrag.minBit, Math.min(bit, shiftDrag.maxBit));
    if (clampedBit !== shiftDrag.currentBit) {
      setShiftDrag((prev) => ({ ...prev, currentBit: clampedBit }));
    }
  };

  /**
   * Handle pointer move during ctrl-drag (reordering).
   * Uses a repacking algorithm that allows field swapping.
   */
  const handleCtrlPointerMove = (bit: number) => {
    if (!ctrlDrag.active || ctrlDrag.draggedFieldIndex === null) {
      return;
    }

    // 1. Get original segments (MSB -> LSB)
    const originalSegments = buildProLayoutSegments(fields, registerSize);

    // 2. Find and remove dragged segment
    const draggedSegIndex = originalSegments.findIndex(
      (s) => s.type === 'field' && s.idx === ctrlDrag.draggedFieldIndex
    );
    if (draggedSegIndex === -1) {
      return;
    }

    const draggedSeg = originalSegments[draggedSegIndex];
    if (draggedSeg.type !== 'field') {
      return;
    } // Should not happen

    // Remove it from the list for calculations
    const cleanSegments = [...originalSegments];
    cleanSegments.splice(draggedSegIndex, 1);

    // 3. Repack clean list to build coordinate space
    let currentBit = 0;
    const repackedClean = cleanSegments
      .slice()
      .reverse()
      .map((seg) => {
        const width = seg.end - seg.start + 1;
        const newLo = currentBit;
        const newHi = currentBit + width - 1;
        currentBit += width;
        return { ...seg, start: newLo, end: newHi, width };
      })
      .reverse(); // Restore MSB->LSB order

    // 4. Find insertion target in repacked list
    const effectiveCursor = Math.min(bit, currentBit);

    // Find target segment covering effectiveCursor
    const targetIdx = repackedClean.findIndex(
      (s) => effectiveCursor >= s.start && effectiveCursor <= s.end
    );

    const newSegments: ProSegment[] = [];

    // Helper to insert dragged segment
    const insertDragged = () => {
      newSegments.push(draggedSeg);
    };

    if (targetIdx === -1) {
      // Cursor is above all content (implicit top gap)
      // Just append at MSB side (start of list since MSB->LSB)
      insertDragged(); // Insert as MSB
      newSegments.push(...cleanSegments);
    } else {
      // We hit a segment.
      const target = repackedClean[targetIdx];
      const originalTarget = cleanSegments[targetIdx]; // Corresponding logic segment

      const offsetInTarget = effectiveCursor - target.start;

      if (target.type === 'field') {
        // Insert Before or After based on center?
        // Since list is MSB->LSB:
        // "Before" in array = Higher Bits (MSB side).
        // "After" in array = Lower Bits (LSB side).
        const targetWidth = target.end - target.start + 1;
        const msbSide = offsetInTarget > targetWidth / 2;

        // Split list at target
        const before = cleanSegments.slice(0, targetIdx);
        const after = cleanSegments.slice(targetIdx + 1);

        newSegments.push(...before);
        if (msbSide) {
          insertDragged();
          newSegments.push(originalTarget);
        } else {
          newSegments.push(originalTarget);
          insertDragged();
        }
        newSegments.push(...after);
      } else {
        // Target is GAP. Split it.
        const botWidth = offsetInTarget;
        const targetWidth = target.end - target.start + 1;
        const topWidth = targetWidth - offsetInTarget;

        const before = cleanSegments.slice(0, targetIdx);
        const after = cleanSegments.slice(targetIdx + 1);

        newSegments.push(...before);

        if (topWidth > 0) {
          newSegments.push({
            type: 'gap',
            start: 0,
            end: topWidth - 1, // Set end so width calculation works: end - start + 1 = topWidth
          } as ProSegment);
        }

        insertDragged();

        if (botWidth > 0) {
          newSegments.push({
            type: 'gap',
            start: 0,
            end: botWidth - 1, // Set end so width calculation works: end - start + 1 = botWidth
          } as ProSegment);
        }

        newSegments.push(...after);
      }
    }

    // 5. Final Repack for Preview
    currentBit = 0;
    const finalSegments = newSegments
      .slice()
      .reverse()
      .map((seg) => {
        const width = seg.end - seg.start + 1;
        const lo = currentBit;
        const hi = currentBit + Number(width) - 1;
        currentBit += Number(width);
        return { ...seg, start: lo, end: hi };
      })
      .reverse();

    setCtrlDrag((prev) => ({ ...prev, previewSegments: finalSegments }));

    // Report preview to parent for live table updates
    if (onDragPreview) {
      const previewUpdates = finalSegments
        .filter((seg): seg is typeof seg & { type: 'field' } => seg.type === 'field')
        .map((seg) => ({
          idx: seg.idx,
          range: [seg.end, seg.start] as [number, number],
        }));
      onDragPreview(previewUpdates);
    }
  };

  const applyBit = (fieldIndex: number, localBit: number, desired: 0 | 1) => {
    if (!onUpdateFieldReset) {
      return;
    }
    const raw = fields?.[fieldIndex]?.reset_value;
    const current = raw === null || raw === undefined ? 0 : Number(raw);
    const next = setBit(current, localBit, desired);
    onUpdateFieldReset(fieldIndex, next);
  };

  // Build a per-bit array with field index or null
  const bits: (number | null)[] = Array.from({ length: registerSize }, () => null);
  fields.forEach((field, idx) => {
    if (field.bit_range) {
      const [hi, lo] = field.bit_range;
      for (let i = lo; i <= hi; ++i) {
        bits[i] = idx;
      }
    } else if (field.bit !== undefined) {
      bits[field.bit] = idx;
    }
  });

  const bitValues = useMemo(() => {
    const values: (0 | 1)[] = Array.from({ length: registerSize }, () => 0);
    fields.forEach((field) => {
      const r = getFieldRange(field);
      if (!r) {
        return;
      }
      const raw = field?.reset_value;
      const fieldValue = raw === null || raw === undefined ? 0 : Number(raw);
      for (let bit = r.lo; bit <= r.hi; bit++) {
        const localBit = bit - r.lo;
        values[bit] = bitAt(fieldValue, localBit);
      }
    });
    return values;
  }, [fields, registerSize]);

  // Memoize bit-to-field owner mapping for resize handle edge detection
  const bitOwners = useMemo(() => buildBitOwnerArray(fields, registerSize), [fields, registerSize]);

  const registerValue = useMemo(() => {
    let v = 0;
    for (let bit = 0; bit < registerSize; bit++) {
      if (bitValues[bit] === 1) {
        v += Math.pow(2, bit);
      }
    }
    return v;
  }, [bitValues, registerSize]);

  const registerValueText = useMemo(() => {
    if (valueView === 'dec') {
      return registerValue.toString(10);
    }
    return `0x${registerValue.toString(16).toUpperCase()}`;
  }, [registerValue, valueView]);

  useEffect(() => {
    if (valueEditing) {
      return;
    }
    setValueDraft(registerValueText);
    setValueError(null);
  }, [registerValueText, valueEditing]);

  const validateRegisterValue = (v: number | null): string | null => {
    if (v === null) {
      return 'Value is required';
    }
    if (!Number.isFinite(v)) {
      return 'Invalid number';
    }
    if (v < 0) {
      return 'Value must be >= 0';
    }
    const max = maxForBits(registerSize);
    if (v > max) {
      return `Value too large for ${registerSize} bit(s)`;
    }
    return null;
  };

  const applyRegisterValue = (v: number) => {
    if (!onUpdateFieldReset) {
      return;
    }
    fields.forEach((field, fieldIndex) => {
      const r = getFieldRange(field);
      if (!r) {
        return;
      }
      const width = r.hi - r.lo + 1;
      const sub = extractBits(v, r.lo, width);
      onUpdateFieldReset(fieldIndex, sub);
    });
  };

  const commitRegisterValueDraft = () => {
    const parsed = parseRegisterValue(valueDraft);
    const err = validateRegisterValue(parsed);
    setValueError(err);
    if (err || parsed === null) {
      return;
    }
    applyRegisterValue(parsed);
  };

  const renderValueBar = () => (
    <div
      className="mt-3 flex items-center justify-start gap-3 p-3 rounded"
      style={{ background: 'var(--vscode-editor-background)' }}
    >
      <div className="text-sm vscode-muted font-mono font-semibold">Value:</div>
      <div className="min-w-[320px] text-base">
        <VSCodeTextField
          className="w-full"
          value={valueDraft}
          onFocus={() => setValueEditing(true)}
          onBlur={() => {
            setValueEditing(false);
            commitRegisterValueDraft();
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onInput={(e: any) => {
            const event = e as unknown as React.ChangeEvent<HTMLInputElement>;
            const next = String(event.target.value ?? '');
            setValueDraft(next);
            const parsed = parseRegisterValue(next);
            setValueError(validateRegisterValue(parsed));
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onKeyDown={(e: any) => {
            const event = e as unknown as React.KeyboardEvent<HTMLInputElement>;
            if (event.key !== 'Enter') {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            commitRegisterValueDraft();
            setValueEditing(false);
            // Return focus to the visualizer root.
            event.currentTarget?.blur?.();
          }}
        />
        {valueError ? <div className="text-xs vscode-error mt-1">{valueError}</div> : null}
      </div>
      <button
        type="button"
        className="px-3 py-2 text-sm font-semibold border rounded"
        style={{
          borderColor: 'var(--vscode-button-border, var(--vscode-panel-border))',
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            'var(--vscode-button-hoverBackground)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            'var(--vscode-button-background)';
        }}
        onClick={() => setValueView((v) => (v === 'hex' ? 'dec' : 'hex'))}
        title="Toggle hex/dec"
      >
        {valueView.toUpperCase()}
      </button>
    </div>
  );

  if (layout === 'pro') {
    // Grouped, modern layout with floating labels and grid - includes gaps
    const segments =
      ctrlDrag.active && ctrlDrag.previewSegments
        ? ctrlDrag.previewSegments
        : buildProLayoutSegments(fields, registerSize);
    return (
      <div className="w-full">
        <div className="relative w-full flex items-start overflow-x-auto pb-2">
          {/* Bit grid background */}
          <div className="relative flex flex-row items-end gap-0.5 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full min-w-max">
            {/* Render each segment (field or gap) */}
            {segments.map((segment, segIdx) => {
              const width = segment.end - segment.start + 1;

              if (segment.type === 'gap') {
                // Render gap segment
                return (
                  <div
                    key={`gap-${segIdx}`}
                    className="relative flex flex-col items-center justify-end select-none"
                    style={{ width: `calc(${width} * 2rem)` }}
                  >
                    <div className="h-20 w-full rounded-t-md overflow-hidden flex">
                      {Array.from({ length: width }).map((_, i) => {
                        const bit = segment.end - i;
                        // Check if this bit is in the active drag range (for both create and resize extending into gap)
                        const isInDragRange =
                          shiftDrag.active &&
                          (shiftDrag.mode === 'create' || shiftDrag.mode === 'resize') &&
                          bit >= Math.min(shiftDrag.anchorBit, shiftDrag.currentBit) &&
                          bit <= Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
                        return (
                          <div
                            key={i}
                            className="w-10 h-20 flex items-center justify-center touch-none"
                            style={{
                              background: isInDragRange
                                ? 'var(--vscode-editor-selectionBackground, #264f78)'
                                : 'var(--vscode-editor-background)',
                              opacity: isInDragRange ? 0.9 : 0.5,
                              border: isInDragRange
                                ? '2px solid var(--vscode-focusBorder)'
                                : undefined,
                              cursor: ctrlDrag.active ? 'grabbing' : ctrlHeld ? 'grab' : 'pointer',
                            }}
                            onPointerDown={(e) => {
                              if (e.shiftKey) {
                                handleShiftPointerDown(bit, e);
                                return;
                              }
                              if (e.ctrlKey || e.metaKey) {
                                handleCtrlPointerDown(bit, e);
                                return;
                              }
                            }}
                            onPointerMove={() => {
                              handleShiftPointerMove(bit);
                              handleCtrlPointerMove(bit);
                            }}
                            onPointerEnter={() => {
                              if (shiftDrag.active) {
                                handleShiftPointerMove(bit);
                              }
                              if (ctrlDragRef.current.active) {
                                handleCtrlPointerMove(bit);
                              }
                            }}
                          >
                            <span className="text-sm font-mono vscode-muted select-none">
                              {isInDragRange ? '+' : '-'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Per-bit numbers below */}
                    <div className="flex flex-row w-full">
                      {Array.from({ length: width }).map((_, i) => {
                        const bit = segment.end - i;
                        return (
                          <div
                            key={bit}
                            className="w-10 text-center text-[11px] vscode-muted font-mono mt-1"
                          >
                            {bit}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // Render field segment
              const group = segment;
              const isHovered = hoveredFieldIndex === group.idx;
              const field = fields[group.idx];
              const fieldReset =
                field?.reset_value === null || field?.reset_value === undefined
                  ? 0
                  : Number(field.reset_value);
              const isSingleBit = width === 1;

              return (
                <div
                  key={group.idx}
                  className={`relative flex flex-col items-center justify-end select-none ${isHovered ? 'z-10' : ''}`}
                  style={{ width: `calc(${width} * 2rem)` }}
                  onMouseEnter={() => setHoveredFieldIndex(group.idx)}
                  onMouseLeave={() => setHoveredFieldIndex(null)}
                >
                  <div
                    className="h-20 w-full rounded-t-md overflow-hidden flex relative"
                    style={{
                      opacity: 1,
                      transform: isHovered ? 'translateY(-2px)' : undefined,
                      filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                      boxShadow: isHovered
                        ? '0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)'
                        : undefined,
                    }}
                  >
                    {/* Resize handles - show when Shift is held and hovering this field */}
                    {shiftHeld &&
                      isHovered &&
                      !shiftDrag.active &&
                      (() => {
                        const edges = getResizableEdges(
                          group.start,
                          group.end,
                          bitOwners,
                          registerSize
                        );
                        // Visual left = MSB edge (edges.right), Visual right = LSB edge (edges.left)
                        const showVisualLeft = edges.right.canShrink || edges.right.canExpand;
                        const showVisualRight = edges.left.canShrink || edges.left.canExpand;
                        const visualLeftBidirectional =
                          edges.right.canShrink && edges.right.canExpand;
                        const visualRightBidirectional =
                          edges.left.canShrink && edges.left.canExpand;

                        return (
                          <>
                            {/* Left handle (MSB side - visual left) */}
                            {showVisualLeft && (
                              <div
                                className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center z-20 pointer-events-none"
                                style={{
                                  background:
                                    'linear-gradient(90deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
                                }}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  className="drop-shadow-lg"
                                >
                                  {visualLeftBidirectional ? (
                                    /* Bidirectional arrow ↔ - cleaner, wider design */
                                    <>
                                      <path
                                        d="M2 8H14"
                                        stroke="white"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                      />
                                      <path
                                        d="M5 5L2 8L5 11"
                                        stroke="white"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M11 5L14 8L11 11"
                                        stroke="white"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </>
                                  ) : edges.right.canExpand ? (
                                    /* Outward arrow ← (expand) */
                                    <path
                                      d="M10 4L6 8L10 12"
                                      stroke="white"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  ) : (
                                    /* Inward arrow → (shrink) */
                                    <path
                                      d="M6 4L10 8L6 12"
                                      stroke="white"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  )}
                                </svg>
                              </div>
                            )}
                            {/* Right handle (LSB side - visual right) */}
                            {showVisualRight && (
                              <div
                                className="absolute right-0 top-0 bottom-0 w-6 flex items-center justify-center z-20 pointer-events-none"
                                style={{
                                  background:
                                    'linear-gradient(270deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
                                }}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  className="drop-shadow-lg"
                                >
                                  {visualRightBidirectional ? (
                                    /* Bidirectional arrow ↔ - cleaner, wider design */
                                    <>
                                      <path
                                        d="M2 8H14"
                                        stroke="white"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                      />
                                      <path
                                        d="M5 5L2 8L5 11"
                                        stroke="white"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M11 5L14 8L11 11"
                                        stroke="white"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </>
                                  ) : edges.left.canExpand ? (
                                    /* Outward arrow → (expand) */
                                    <path
                                      d="M6 4L10 8L6 12"
                                      stroke="white"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  ) : (
                                    /* Inward arrow ← (shrink) */
                                    <path
                                      d="M10 4L6 8L10 12"
                                      stroke="white"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  )}
                                </svg>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    {Array.from({ length: width }).map((_, i) => {
                      const bit = group.end - i;
                      const localBit = bit - group.start;
                      const v = bitAt(fieldReset, localBit);
                      const dragKey = `${group.idx}:${localBit}`;

                      // Check if we're resizing this field
                      const isResizingThisField =
                        shiftDrag.active &&
                        shiftDrag.mode === 'resize' &&
                        shiftDrag.targetFieldIndex === group.idx;

                      // Check if this bit is within the new drag selection range
                      const isInNewRange =
                        isResizingThisField &&
                        bit >= Math.min(shiftDrag.anchorBit, shiftDrag.currentBit) &&
                        bit <= Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);

                      // Check if this bit will be removed (outside new range)
                      const isOutOfNewRange = isResizingThisField && !isInNewRange;

                      return (
                        <div
                          key={i}
                          className={`w-10 h-20 flex items-center justify-center touch-none ${
                            v === 1 && !isOutOfNewRange ? 'ring-1 ring-white/70 ring-inset' : ''
                          } ${
                            isSingleBit
                              ? 'rounded-md'
                              : i === 0
                                ? 'rounded-l-md'
                                : i === width - 1
                                  ? 'rounded-r-md'
                                  : ''
                          }`}
                          style={{
                            background: isOutOfNewRange
                              ? 'var(--vscode-editor-background)'
                              : FIELD_COLORS[group.color],
                            opacity: isOutOfNewRange ? 0.3 : 1,
                            border: isInNewRange
                              ? '2px solid var(--vscode-focusBorder)'
                              : undefined,
                            cursor: ctrlDrag.active ? 'grabbing' : ctrlHeld ? 'grab' : 'pointer',
                          }}
                          onPointerDown={(e) => {
                            // Shift-drag for resize
                            if (e.shiftKey) {
                              handleShiftPointerDown(bit, e);
                              return;
                            }
                            // Ctrl-drag for reorder
                            if (e.ctrlKey || e.metaKey) {
                              handleCtrlPointerDown(bit, e);
                              return;
                            }
                            // Normal bit toggle
                            if (!onUpdateFieldReset) {
                              return;
                            }
                            if (e.button !== 0) {
                              return;
                            }
                            e.preventDefault();
                            e.stopPropagation();

                            const desired: 0 | 1 = v === 1 ? 0 : 1;
                            setDragActive(true);
                            setDragSetTo(desired);
                            setDragLast(dragKey);
                            applyBit(group.idx, localBit, desired);
                          }}
                          onPointerMove={() => {
                            handleShiftPointerMove(bit);
                            handleCtrlPointerMove(bit);
                          }}
                          onPointerEnter={(e) => {
                            // Handle shift-drag move
                            if (shiftDrag.active) {
                              handleShiftPointerMove(bit);
                              return;
                            }
                            if (ctrlDragRef.current.active) {
                              handleCtrlPointerMove(bit);
                              return;
                            }
                            // Normal bit drag
                            if (!dragActive) {
                              return;
                            }
                            if (!onUpdateFieldReset) {
                              return;
                            }
                            if (dragLast === dragKey) {
                              return;
                            }
                            e.preventDefault();
                            e.stopPropagation();
                            setDragLast(dragKey);
                            applyBit(group.idx, localBit, dragSetTo);
                          }}
                        >
                          <span
                            className={`text-sm font-mono text-white/90 select-none ${v === 1 ? 'font-bold' : 'font-normal'}`}
                          >
                            {v}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div
                    className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${
                      segIdx === 0 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                    }`}
                    style={{
                      background: 'var(--vscode-editorWidget-background)',
                      color: 'var(--vscode-foreground)',
                      borderColor: 'var(--vscode-panel-border)',
                    }}
                  >
                    <div className="font-bold">
                      {group.name}
                      <span className="ml-2 vscode-muted font-mono text-[11px]">
                        [{Math.max(group.start, group.end)}:{Math.min(group.start, group.end)}]
                      </span>
                    </div>
                    <div className="text-[11px] vscode-muted font-mono">
                      {valueView === 'dec'
                        ? Math.trunc(fieldReset).toString(10)
                        : `0x${Math.trunc(fieldReset).toString(16).toUpperCase()}`}
                    </div>
                  </div>
                  {/* Per-bit numbers below, LSB (right) to MSB (left) */}
                  <div className="flex flex-row w-full">
                    {Array.from({ length: width }).map((_, i) => {
                      const bit = group.end - i;
                      return (
                        <div
                          key={bit}
                          className="w-10 text-center text-[11px] vscode-muted font-mono mt-1"
                        >
                          {bit}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {renderValueBar()}
      </div>
    );
  }

  // Default: simple per-bit grid
  return (
    <div className="w-full flex flex-col items-center">
      <div className="flex flex-row-reverse gap-0.5 select-none">
        {bits.map((fieldIdx, bit) => {
          const isHovered = fieldIdx !== null && fieldIdx === hoveredFieldIndex;
          const range = fieldIdx !== null ? getFieldRange(fields[fieldIdx]) : null;
          const isSingleBit = range ? range.hi === range.lo : false;
          const cornerClass = range
            ? isSingleBit
              ? 'rounded-md'
              : bit === range.hi
                ? 'rounded-l-md'
                : bit === range.lo
                  ? 'rounded-r-md'
                  : ''
            : '';
          return (
            <div
              key={bit}
              className={`w-10 h-20 flex flex-col items-center justify-end cursor-pointer group ${
                fieldIdx !== null ? 'bg-blue-500' : 'vscode-surface-alt'
              } ${isHovered ? 'z-10' : ''} ${cornerClass}`}
              style={{
                boxShadow: isHovered ? 'inset 0 0 0 2px var(--vscode-focusBorder)' : undefined,
              }}
              onMouseEnter={() => fieldIdx !== null && setHoveredFieldIndex(fieldIdx)}
              onMouseLeave={() => setHoveredFieldIndex(null)}
              onPointerDown={(e) => {
                // Shift-drag for resize/create
                if (e.shiftKey) {
                  handleShiftPointerDown(bit, e);
                  return;
                }
                // Normal bit toggle
                if (!onUpdateFieldReset) {
                  return;
                }
                if (fieldIdx === null) {
                  return;
                }
                if (e.button !== 0) {
                  return;
                }
                const r = getFieldRange(fields[fieldIdx]);
                if (!r) {
                  return;
                }
                const localBit = bit - r.lo;
                if (localBit < 0 || localBit > r.hi - r.lo) {
                  return;
                }
                const raw = fields[fieldIdx]?.reset_value;
                const current = raw === null || raw === undefined ? 0 : Number(raw);
                const curBit = bitAt(current, localBit);
                const desired: 0 | 1 = curBit === 1 ? 0 : 1;
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
                setDragSetTo(desired);
                setDragLast(`${fieldIdx}:${localBit}`);
                applyBit(fieldIdx, localBit, desired);
              }}
              onPointerMove={() => handleShiftPointerMove(bit)}
              onPointerEnter={(e) => {
                // Handle shift-drag move
                if (shiftDrag.active) {
                  handleShiftPointerMove(bit);
                  return;
                }
                // Normal bit drag
                if (!dragActive) {
                  return;
                }
                if (!onUpdateFieldReset) {
                  return;
                }
                if (fieldIdx === null) {
                  return;
                }
                const r = getFieldRange(fields[fieldIdx]);
                if (!r) {
                  return;
                }
                const localBit = bit - r.lo;
                if (localBit < 0 || localBit > r.hi - r.lo) {
                  return;
                }
                const key = `${fieldIdx}:${localBit}`;
                if (dragLast === key) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                setDragLast(key);
                applyBit(fieldIdx, localBit, dragSetTo);
              }}
            >
              <span className="text-[10px] vscode-muted font-mono">{bit}</span>
              <span className="text-[11px] font-mono mb-1">{bitValues[bit]}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-row-reverse gap-0.5 mt-1">
        {bits.map((fieldIdx, bit) => (
          <div key={bit} className="w-7 text-center text-[10px] vscode-muted font-mono">
            {fieldIdx !== null ? fields[fieldIdx].name : ''}
          </div>
        ))}
      </div>

      <div className="w-full">{renderValueBar()}</div>
    </div>
  );
};

export default BitFieldVisualizer;
