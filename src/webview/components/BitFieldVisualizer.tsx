import React, { useEffect, useMemo, useState } from 'react';
import { type ProSegment } from './bitfield/types';
import { useShiftDrag } from './bitfield/useShiftDrag';
import { useCtrlDrag } from './bitfield/useCtrlDrag';
import { useValueEditing } from './bitfield/useValueEditing';
import ValueBar from './bitfield/ValueBar';
import DefaultLayoutView from './bitfield/DefaultLayoutView';
import ProLayoutView from './bitfield/ProLayoutView';
import VerticalLayoutView from './bitfield/VerticalLayoutView';
import { getKeyboardReorderUpdates, getKeyboardResizeRange } from './bitfield/keyboardOperations';
import { computeCtrlDragPreview } from './bitfield/reorderAlgorithm';
import {
  applyRegisterValueToFields,
  bitAt,
  buildBitIndexArray,
  buildBitValues,
  buildBitOwnerArray,
  buildProLayoutSegments,
  findGapBoundaries,
  findResizeBoundary,
  getFieldRange,
  getResizableEdges,
  maxForBits,
  parseRegisterValue,
  setBit,
} from './bitfield/utils';

export interface FieldModel {
  name?: string;
  bits?: string;
  bit?: number;
  bit_range?: [number, number];
  bit_offset?: number | string;
  bit_width?: number | string;
  access?: string;
  reset_value?: number | null;
  description?: string;
}

interface BitFieldVisualizerProps {
  fields: FieldModel[];
  hoveredFieldIndex?: number | null;
  setHoveredFieldIndex?: (idx: number | null) => void;
  registerSize?: number;
  layout?: 'default' | 'pro' | 'vertical';
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
      setCtrlDrag({
        active: true,
        draggedFieldIndex: fieldAtBit,
        previewSegments: buildProLayoutSegments(fields, registerSize),
      });
    }
  };

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
      const fieldRange = getFieldRange(fields[fieldAtBit]);
      if (!fieldRange) {
        return;
      }

      const minBit = findResizeBoundary(fieldAtBit, 'lsb', fields, registerSize);
      const maxBit = findResizeBoundary(fieldAtBit, 'msb', fields, registerSize);
      const fieldMid = (fieldRange.lo + fieldRange.hi) / 2;
      const grabbingMsbEdge = bit >= fieldMid;
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

  const handleShiftPointerMove = (bit: number) => {
    if (!shiftDrag.active) {
      return;
    }
    const clampedBit = Math.max(shiftDrag.minBit, Math.min(bit, shiftDrag.maxBit));
    if (clampedBit !== shiftDrag.currentBit) {
      setShiftDrag((prev) => ({ ...prev, currentBit: clampedBit }));
    }
  };

  const handleCtrlPointerMove = (bit: number) => {
    if (!ctrlDrag.active || ctrlDrag.draggedFieldIndex === null) {
      return;
    }

    const preview = computeCtrlDragPreview(bit, ctrlDrag.draggedFieldIndex, fields, registerSize);
    if (!preview) {
      return;
    }

    setCtrlDrag((prev) => ({ ...prev, previewSegments: preview.segments }));
    onDragPreview?.(preview.updates);
  };

  const applyKeyboardReorder = (fieldIndex: number, direction: 'msb' | 'lsb') => {
    const updates = getKeyboardReorderUpdates(fields, registerSize, fieldIndex, direction);
    if (!updates) {
      return;
    }
    commitRangeUpdates(updates);
  };

  const applyKeyboardResize = (fieldIndex: number, edge: 'msb' | 'lsb') => {
    if (!onUpdateFieldRange) {
      return;
    }
    const nextRange = getKeyboardResizeRange(fields, registerSize, fieldIndex, edge);
    if (!nextRange) {
      return;
    }
    onUpdateFieldRange(fieldIndex, nextRange);
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

  const bits = useMemo(() => buildBitIndexArray(fields, registerSize), [fields, registerSize]);
  const bitValues = useMemo(() => buildBitValues(fields, registerSize), [fields, registerSize]);

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
    applyRegisterValueToFields(fields, v, (fieldIndex, value) =>
      onUpdateFieldReset(fieldIndex, value)
    );
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

  const valueBar = (
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
  );

  if (layout === 'pro' || layout === 'vertical') {
    const segments =
      ctrlDrag.active && ctrlDrag.previewSegments
        ? ctrlDrag.previewSegments
        : buildProLayoutSegments(fields, registerSize);
    const sharedProps = {
      fields,
      segments,
      hoverState: { keyboardHelpId, hoveredFieldIndex, setHoveredFieldIndex },
      dragState: {
        shiftDrag,
        shiftHeld,
        ctrlDragActive: ctrlDrag.active,
        ctrlHeld,
        isCtrlDragActive: () => ctrlDragRef.current.active,
        dragActive,
        dragSetTo,
        dragLast,
        setDragActive,
        setDragSetTo,
        setDragLast,
      },
      interactions: {
        onUpdateFieldReset,
        handleShiftPointerDown,
        handleCtrlPointerDown,
        handleShiftPointerMove,
        handleCtrlPointerMove,
        applyKeyboardReorder,
        applyKeyboardResize,
        applyBit,
        bitAt,
      },
    };

    if (layout === 'vertical') {
      return <VerticalLayoutView {...sharedProps} layoutConfig={{ valueView, valueBar }} />;
    }

    return (
      <ProLayoutView
        {...sharedProps}
        interactions={{ ...sharedProps.interactions, getResizableEdges }}
        layoutConfig={{ bitOwners, registerSize, valueView, valueBar }}
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
      valueBar={valueBar}
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
