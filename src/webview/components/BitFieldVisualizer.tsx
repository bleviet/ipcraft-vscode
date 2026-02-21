import React, { useEffect, useMemo, useState } from 'react';
import { type ProSegment } from './bitfield/types';
import { useShiftDrag } from './bitfield/useShiftDrag';
import { useCtrlDrag } from './bitfield/useCtrlDrag';
import { useValueEditing } from './bitfield/useValueEditing';
import ValueBar from './bitfield/ValueBar';
import DefaultLayoutView from './bitfield/DefaultLayoutView';
import ProLayoutView from './bitfield/ProLayoutView';
import {
  bitAt,
  buildBitOwnerArray,
  buildProLayoutSegments,
  extractBits,
  findGapBoundaries,
  findResizeBoundary,
  getFieldRange,
  getResizableEdges,
  maxForBits,
  parseRegisterValue,
  repackSegments,
  setBit,
  toFieldRangeUpdates,
} from './bitfield/utils';

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
