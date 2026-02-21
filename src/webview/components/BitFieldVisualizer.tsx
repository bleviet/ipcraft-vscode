import React, { useEffect, useMemo, useState } from 'react';
import { getFieldColor } from '../shared/colors';
import { type ProSegment } from './bitfield/types';
import { useShiftDrag } from './bitfield/useShiftDrag';
import { useCtrlDrag } from './bitfield/useCtrlDrag';
import { useValueEditing } from './bitfield/useValueEditing';
import ValueBar from './bitfield/ValueBar';
import DefaultLayoutView from './bitfield/DefaultLayoutView';
import ProLayoutView from './bitfield/ProLayoutView';

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
  const v = Number(s);
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
      color: getFieldColor(field.name ?? `field${idx}`),
    });
  });
  // Sort by start bit descending (MSB on left)
  groups.sort((a, b) => b.start - a.start);
  return groups;
}

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

function repackSegments(segments: ProSegment[]): ProSegment[] {
  let currentBit = 0;
  return segments
    .slice()
    .reverse()
    .map((seg) => {
      const width = seg.end - seg.start + 1;
      const lo = currentBit;
      const hi = currentBit + width - 1;
      currentBit += width;
      return { ...seg, start: lo, end: hi };
    })
    .reverse();
}

function toFieldRangeUpdates(segments: ProSegment[]): { idx: number; range: [number, number] }[] {
  return segments
    .filter((seg): seg is Extract<ProSegment, { type: 'field' }> => seg.type === 'field')
    .map((seg) => ({ idx: seg.idx, range: [seg.end, seg.start] }));
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

const BitFieldVisualizerInner: React.FC<BitFieldVisualizerProps> = ({
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
  const [dragActive, setDragActive] = useState(false);
  const [dragSetTo, setDragSetTo] = useState<0 | 1>(0);
  const [dragLast, setDragLast] = useState<string | null>(null);

  const keyboardHelpId = 'bitfield-keyboard-help';

  const commitRangeUpdates = (updates: { idx: number; range: [number, number] }[]) => {
    if (updates.length === 0) {
      return;
    }
    if (onBatchUpdateFields) {
      onBatchUpdateFields(updates);
      return;
    }
    if (onUpdateFieldRange) {
      updates.forEach((update) => onUpdateFieldRange(update.idx, update.range));
    }
  };

  const { ctrlDrag, setCtrlDrag, ctrlDragRef, ctrlHeld } = useCtrlDrag({
    onCommitPreview: (previewSegments) => {
      const updates = previewSegments
        .filter((seg): seg is Extract<ProSegment, { type: 'field' }> => seg.type === 'field')
        .map((seg) => ({ idx: seg.idx, range: [seg.end, seg.start] as [number, number] }));
      commitRangeUpdates(updates);
    },
    onCancelPreview: () => {
      onDragPreview?.(null);
    },
  });

  const { shiftDrag, setShiftDrag, shiftHeld } = useShiftDrag({
    onResizeCommit: (fieldIndex, newRange) => {
      onUpdateFieldRange?.(fieldIndex, newRange);
    },
    onCreateCommit: (newRange) => {
      onCreateField?.({ bit_range: newRange, name: 'new_field' });
    },
  });

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
    const finalSegments = repackSegments(newSegments);

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

  const applyKeyboardReorder = (fieldIndex: number, direction: 'msb' | 'lsb') => {
    const segments = buildProLayoutSegments(fields, registerSize);
    const sourceIndex = segments.findIndex((seg) => seg.type === 'field' && seg.idx === fieldIndex);
    if (sourceIndex === -1) {
      return;
    }

    const targetIndex = direction === 'msb' ? sourceIndex - 1 : sourceIndex + 1;
    if (targetIndex < 0 || targetIndex >= segments.length) {
      return;
    }

    const reordered = [...segments];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const repacked = repackSegments(reordered);
    commitRangeUpdates(toFieldRangeUpdates(repacked));
  };

  const applyKeyboardResize = (fieldIndex: number, edge: 'msb' | 'lsb') => {
    const range = getFieldRange(fields[fieldIndex]);
    if (!range || !onUpdateFieldRange) {
      return;
    }

    let newLo = range.lo;
    let newHi = range.hi;

    if (edge === 'msb') {
      const maxMsb = findResizeBoundary(fieldIndex, 'msb', fields, registerSize);
      if (range.hi < maxMsb) {
        newHi = range.hi + 1;
      } else if (range.hi > range.lo) {
        newHi = range.hi - 1;
      }
    } else {
      const minLsb = findResizeBoundary(fieldIndex, 'lsb', fields, registerSize);
      if (range.lo > minLsb) {
        newLo = range.lo - 1;
      } else if (range.hi > range.lo) {
        newLo = range.lo + 1;
      }
    }

    if (newHi === range.hi && newLo === range.lo) {
      return;
    }

    onUpdateFieldRange(fieldIndex, [newHi, newLo]);
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

  const {
    valueView,
    setValueView,
    valueDraft,
    setValueDraft,
    setValueEditing,
    valueError,
    setValueError,
    validateRegisterValue,
    commitRegisterValueDraft,
  } = useValueEditing({
    registerSize,
    registerValue,
    parseRegisterValue,
    maxForBits,
    applyRegisterValue,
  });

  if (layout === 'pro') {
    const segments =
      ctrlDrag.active && ctrlDrag.previewSegments
        ? ctrlDrag.previewSegments
        : buildProLayoutSegments(fields, registerSize);
    return (
      <ProLayoutView
        fields={fields}
        segments={segments}
        keyboardHelpId={keyboardHelpId}
        hoveredFieldIndex={hoveredFieldIndex}
        setHoveredFieldIndex={setHoveredFieldIndex}
        shiftDrag={shiftDrag}
        shiftHeld={shiftHeld}
        ctrlDragActive={ctrlDrag.active}
        ctrlHeld={ctrlHeld}
        isCtrlDragActive={() => ctrlDragRef.current.active}
        bitOwners={bitOwners}
        registerSize={registerSize}
        valueView={valueView}
        dragActive={dragActive}
        dragSetTo={dragSetTo}
        dragLast={dragLast}
        setDragActive={setDragActive}
        setDragSetTo={setDragSetTo}
        setDragLast={setDragLast}
        onUpdateFieldReset={onUpdateFieldReset}
        handleShiftPointerDown={handleShiftPointerDown}
        handleCtrlPointerDown={handleCtrlPointerDown}
        handleShiftPointerMove={handleShiftPointerMove}
        handleCtrlPointerMove={handleCtrlPointerMove}
        applyKeyboardReorder={applyKeyboardReorder}
        applyKeyboardResize={applyKeyboardResize}
        applyBit={applyBit}
        bitAt={bitAt}
        getResizableEdges={getResizableEdges}
        valueBar={
          <ValueBar
            valueDraft={valueDraft}
            valueError={valueError}
            valueView={valueView}
            setValueDraft={setValueDraft}
            setValueEditing={setValueEditing}
            setValueError={setValueError}
            setValueView={setValueView}
            parseRegisterValue={parseRegisterValue}
            validateRegisterValue={validateRegisterValue}
            commitRegisterValueDraft={commitRegisterValueDraft}
          />
        }
      />
    );
  }

  return (
    <DefaultLayoutView
      bits={bits}
      fields={fields}
      bitValues={bitValues}
      hoveredFieldIndex={hoveredFieldIndex}
      setHoveredFieldIndex={setHoveredFieldIndex}
      onUpdateFieldReset={onUpdateFieldReset}
      getFieldRange={getFieldRange}
      handleShiftPointerDown={handleShiftPointerDown}
      handleShiftPointerMove={handleShiftPointerMove}
      dragActive={dragActive}
      dragSetTo={dragSetTo}
      dragLast={dragLast}
      setDragActive={setDragActive}
      setDragSetTo={setDragSetTo}
      setDragLast={setDragLast}
      applyBit={applyBit}
      valueBar={
        <ValueBar
          valueDraft={valueDraft}
          valueError={valueError}
          valueView={valueView}
          setValueDraft={setValueDraft}
          setValueEditing={setValueEditing}
          setValueError={setValueError}
          setValueView={setValueView}
          parseRegisterValue={parseRegisterValue}
          validateRegisterValue={validateRegisterValue}
          commitRegisterValueDraft={commitRegisterValueDraft}
        />
      }
    />
  );
};

const BitFieldVisualizer = React.memo(
  BitFieldVisualizerInner,
  (prev, next) =>
    prev.fields === next.fields &&
    prev.hoveredFieldIndex === next.hoveredFieldIndex &&
    prev.setHoveredFieldIndex === next.setHoveredFieldIndex &&
    prev.registerSize === next.registerSize &&
    prev.layout === next.layout &&
    prev.onUpdateFieldReset === next.onUpdateFieldReset &&
    prev.onUpdateFieldRange === next.onUpdateFieldRange &&
    prev.onBatchUpdateFields === next.onBatchUpdateFields &&
    prev.onCreateField === next.onCreateField &&
    prev.onDragPreview === next.onDragPreview
);

export default BitFieldVisualizer;
