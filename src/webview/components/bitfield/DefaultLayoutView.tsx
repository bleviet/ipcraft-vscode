import React from 'react';
import type { FieldModel } from '../BitFieldVisualizer';

interface DefaultLayoutViewProps {
  bits: (number | null)[];
  fields: FieldModel[];
  bitValues: (0 | 1)[];
  hoveredFieldIndex: number | null;
  setHoveredFieldIndex: (idx: number | null) => void;
  onUpdateFieldReset?: (fieldIndex: number, resetValue: number | null) => void;
  getFieldRange: (field: FieldModel) => { lo: number; hi: number } | null;
  handleShiftPointerDown: (bit: number, e: React.PointerEvent) => void;
  handleShiftPointerMove: (bit: number) => void;
  dragActive: boolean;
  dragSetTo: 0 | 1;
  dragLast: string | null;
  setDragActive: (active: boolean) => void;
  setDragSetTo: (value: 0 | 1) => void;
  setDragLast: (key: string | null) => void;
  applyBit: (fieldIndex: number, localBit: number, desired: 0 | 1) => void;
  valueBar: React.ReactNode;
}

const DefaultLayoutView = ({
  bits,
  fields,
  bitValues,
  hoveredFieldIndex,
  setHoveredFieldIndex,
  onUpdateFieldReset,
  getFieldRange,
  handleShiftPointerDown,
  handleShiftPointerMove,
  dragActive,
  dragSetTo,
  dragLast,
  setDragActive,
  setDragSetTo,
  setDragLast,
  applyBit,
  valueBar,
}: DefaultLayoutViewProps) => {
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
              className={`w-10 h-20 flex flex-col items-center justify-end cursor-pointer group ${fieldIdx !== null ? 'bg-blue-500' : 'vscode-surface-alt'} ${isHovered ? 'z-10' : ''} ${cornerClass}`}
              style={{
                boxShadow: isHovered ? 'inset 0 0 0 2px var(--vscode-focusBorder)' : undefined,
              }}
              onMouseEnter={() => fieldIdx !== null && setHoveredFieldIndex(fieldIdx)}
              onMouseLeave={() => setHoveredFieldIndex(null)}
              onPointerDown={(e) => {
                if (e.shiftKey) {
                  handleShiftPointerDown(bit, e);
                  return;
                }
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
                const curBit = Math.floor(current / Math.pow(2, localBit)) % 2 === 1 ? 1 : 0;
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
                if (dragActive) {
                  if (!onUpdateFieldReset || fieldIdx === null) {
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
                  return;
                }
                handleShiftPointerMove(bit);
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

      <div className="w-full">{valueBar}</div>
    </div>
  );
};

export default DefaultLayoutView;
