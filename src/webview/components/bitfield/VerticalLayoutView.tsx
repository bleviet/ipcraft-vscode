import React from 'react';
import type { FieldModel } from '../BitFieldVisualizer';
import type { ProSegment, ShiftDragState } from './types';

interface HoverState {
  keyboardHelpId: string;
  hoveredFieldIndex: number | null;
  setHoveredFieldIndex: (idx: number | null) => void;
}

interface DragState {
  shiftDrag: ShiftDragState;
  shiftHeld: boolean;
  ctrlDragActive: boolean;
  ctrlHeld: boolean;
  isCtrlDragActive: () => boolean;
  dragActive: boolean;
  dragSetTo: 0 | 1;
  dragLast: string | null;
  setDragActive: (active: boolean) => void;
  setDragSetTo: (value: 0 | 1) => void;
  setDragLast: (value: string | null) => void;
}

interface InteractionHandlers {
  onUpdateFieldReset?: (fieldIndex: number, resetValue: number | null) => void;
  handleShiftPointerDown: (bit: number, e: React.PointerEvent) => void;
  handleCtrlPointerDown: (bit: number, e: React.PointerEvent) => void;
  handleShiftPointerMove: (bit: number) => void;
  handleCtrlPointerMove: (bit: number) => void;
  applyKeyboardReorder: (fieldIndex: number, direction: 'msb' | 'lsb') => void;
  applyKeyboardResize: (fieldIndex: number, edge: 'msb' | 'lsb') => void;
  applyBit: (fieldIndex: number, localBit: number, desired: 0 | 1) => void;
  bitAt: (value: number, bitIndex: number) => 0 | 1;
}

interface LayoutConfig {
  valueView: 'hex' | 'dec';
  valueBar: React.ReactNode;
}

interface VerticalLayoutViewProps {
  fields: FieldModel[];
  segments: ProSegment[];
  hoverState: HoverState;
  dragState: DragState;
  interactions: InteractionHandlers;
  layoutConfig: LayoutConfig;
}

const VerticalLayoutView = ({
  fields,
  segments,
  hoverState,
  dragState,
  interactions,
  layoutConfig,
}: VerticalLayoutViewProps) => {
  const { keyboardHelpId, hoveredFieldIndex, setHoveredFieldIndex } = hoverState;
  const {
    shiftDrag,
    ctrlDragActive,
    ctrlHeld,
    isCtrlDragActive,
    dragActive,
    dragSetTo,
    dragLast,
    setDragActive,
    setDragSetTo,
    setDragLast,
  } = dragState;
  const {
    onUpdateFieldReset,
    handleShiftPointerDown,
    handleCtrlPointerDown,
    handleShiftPointerMove,
    handleCtrlPointerMove,
    applyKeyboardReorder,
    applyKeyboardResize,
    applyBit,
    bitAt,
  } = interactions;
  const { valueView, valueBar } = layoutConfig;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div id={keyboardHelpId} className="sr-only">
        Use Alt plus Up or Down arrow to reorder a field. Use Shift plus Up or Down arrow to resize
        the selected field.
      </div>

      <div className="relative flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 min-h-0">
        <div className="relative flex flex-col gap-1 min-h-max">
          {segments.map((segment, segIdx) => {
            const bitCount = segment.end - segment.start + 1;

            if (segment.type === 'gap') {
              return (
                <div
                  key={`gap-${segIdx}`}
                  style={{ height: `calc(${bitCount} * 2rem)` }}
                  className="relative flex"
                >
                  <div className="w-8 flex flex-col justify-between text-[11px] vscode-muted font-mono py-1">
                    <span>{segment.end}</span>
                    {bitCount > 1 ? <span>{segment.start}</span> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="w-20 h-full rounded-r-md overflow-hidden">
                      {Array.from({ length: bitCount }).map((_, i) => {
                        const bit = segment.end - i;
                        const isInDragRange =
                          shiftDrag.active &&
                          (shiftDrag.mode === 'create' || shiftDrag.mode === 'resize') &&
                          bit >= Math.min(shiftDrag.anchorBit, shiftDrag.currentBit) &&
                          bit <= Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);

                        return (
                          <div
                            key={bit}
                            className="h-8 flex items-center justify-center touch-none"
                            style={{
                              background: isInDragRange
                                ? 'var(--vscode-editor-selectionBackground, #264f78)'
                                : 'var(--vscode-editor-background)',
                              opacity: isInDragRange ? 0.95 : 0.6,
                              borderTop:
                                i === 0 ? undefined : '1px solid var(--vscode-panel-border)',
                              cursor: ctrlDragActive ? 'grabbing' : ctrlHeld ? 'grab' : 'pointer',
                            }}
                            onPointerDown={(e) => {
                              if (e.shiftKey) {
                                handleShiftPointerDown(bit, e);
                                return;
                              }
                              if (e.ctrlKey || e.metaKey) {
                                handleCtrlPointerDown(bit, e);
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
                              if (isCtrlDragActive()) {
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
                  </div>
                </div>
              );
            }

            const group = segment;
            const isHovered = hoveredFieldIndex === group.idx;
            const field = fields[group.idx];
            const fieldReset =
              field?.reset_value === null || field?.reset_value === undefined
                ? 0
                : Number(field.reset_value);

            return (
              <div
                key={group.idx}
                className={`relative flex ${isHovered ? 'z-10' : ''}`}
                style={{ height: `calc(${bitCount} * 2rem)` }}
                role="button"
                tabIndex={0}
                aria-describedby={keyboardHelpId}
                aria-label={`${group.name || 'Field'} bits ${Math.max(group.start, group.end)} to ${Math.min(group.start, group.end)}. Alt plus arrow keys reorder. Shift plus arrow keys resize.`}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Shift+ArrowUp Shift+ArrowDown"
                onMouseEnter={() => setHoveredFieldIndex(group.idx)}
                onMouseLeave={() => setHoveredFieldIndex(null)}
                onFocus={() => setHoveredFieldIndex(group.idx)}
                onBlur={() => setHoveredFieldIndex(null)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyKeyboardReorder(group.idx, e.key === 'ArrowUp' ? 'msb' : 'lsb');
                    return;
                  }
                  if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyKeyboardResize(group.idx, e.key === 'ArrowUp' ? 'msb' : 'lsb');
                  }
                }}
              >
                <div className="w-8 flex flex-col justify-between text-[11px] vscode-muted font-mono py-1">
                  <span>{group.end}</span>
                  {bitCount > 1 ? <span>{group.start}</span> : null}
                </div>
                <div
                  className="w-20 h-full rounded-r-md overflow-hidden"
                  style={{
                    transform: isHovered ? 'translateX(2px)' : undefined,
                    filter: isHovered ? 'saturate(1.1) brightness(1.05)' : undefined,
                    boxShadow: isHovered ? '0 0 0 2px var(--vscode-focusBorder)' : undefined,
                  }}
                >
                  {Array.from({ length: bitCount }).map((_, i) => {
                    const bit = group.end - i;
                    const localBit = bit - group.start;
                    const value = bitAt(fieldReset, localBit);
                    const dragKey = `${group.idx}:${localBit}`;
                    const isResizingThisField =
                      shiftDrag.active &&
                      shiftDrag.mode === 'resize' &&
                      shiftDrag.targetFieldIndex === group.idx;
                    const isInNewRange =
                      isResizingThisField &&
                      bit >= Math.min(shiftDrag.anchorBit, shiftDrag.currentBit) &&
                      bit <= Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
                    const isOutOfNewRange = isResizingThisField && !isInNewRange;

                    return (
                      <div
                        key={bit}
                        className="h-8 flex items-center justify-center text-sm font-mono touch-none"
                        style={{
                          color: 'var(--ipcraft-pattern-label-fg)',
                          textShadow: '0 1px 2px var(--ipcraft-pattern-label-shadow)',
                          background:
                            value === 1
                              ? group.color
                              : `color-mix(in srgb, ${group.color} 45%, var(--vscode-editor-background))`,
                          opacity: isOutOfNewRange ? 0.35 : isInNewRange ? 1 : 0.95,
                          borderTop:
                            i === 0 ? undefined : '1px solid var(--ipcraft-pattern-border)',
                          cursor: ctrlDragActive
                            ? 'grabbing'
                            : ctrlHeld
                              ? 'grab'
                              : onUpdateFieldReset
                                ? dragActive
                                  ? 'crosshair'
                                  : 'pointer'
                                : 'default',
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
                          if (!onUpdateFieldReset || e.button !== 0) {
                            return;
                          }
                          e.preventDefault();
                          e.stopPropagation();

                          const desired: 0 | 1 = value === 1 ? 0 : 1;
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
                          if (shiftDrag.active) {
                            handleShiftPointerMove(bit);
                            return;
                          }
                          if (isCtrlDragActive()) {
                            handleCtrlPointerMove(bit);
                            return;
                          }
                          if (!dragActive || !onUpdateFieldReset || dragLast === dragKey) {
                            return;
                          }

                          e.preventDefault();
                          e.stopPropagation();
                          setDragLast(dragKey);
                          applyBit(group.idx, localBit, dragSetTo);
                        }}
                      >
                        {value}
                      </div>
                    );
                  })}
                </div>
                <div
                  className="absolute left-32 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-0.5 rounded border shadow text-xs pointer-events-none"
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
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t vscode-border">{valueBar}</div>
    </div>
  );
};

export default VerticalLayoutView;
