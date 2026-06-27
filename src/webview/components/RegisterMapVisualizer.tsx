import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { RegisterActionsMenu } from '../shared/components';

export interface VisualizerRegister {
  name?: string;
  offset?: number | string;
  address_offset?: number | string;
  __kind?: string;
  count?: number;
  stride?: number;
  size?: number;
  [key: string]: unknown;
}

interface RegisterMapVisualizerProps {
  registers: VisualizerRegister[];
  hoveredRegIndex?: number | null;
  setHoveredRegIndex?: (idx: number | null) => void;
  baseAddress?: number;
  onReorderRegisters?: (newRegisters: VisualizerRegister[]) => void;
  onRegisterClick?: (regIndex: number) => void;
  onInsertAtGap?: (gapIndex: number, kind: 'register' | 'flat-array' | 'array') => void;
  onDeleteReg?: (regIndex: number) => void;
  layout?: 'horizontal' | 'vertical';
}

function getRegColor(idx: number) {
  return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
}

// Ctrl-drag state for reordering registers
interface CtrlDragState {
  active: boolean;
  draggedRegIndex: number | null;
  targetIndex: number | null;
}

const CTRL_DRAG_INITIAL: CtrlDragState = {
  active: false,
  draggedRegIndex: null,
  targetIndex: null,
};

const RegisterMapVisualizerInner: React.FC<RegisterMapVisualizerProps> = ({
  registers,
  hoveredRegIndex = null,
  setHoveredRegIndex = () => undefined,
  baseAddress = 0,
  onReorderRegisters,
  onRegisterClick,
  onInsertAtGap,
  onDeleteReg,
  layout = 'horizontal',
}) => {
  const [ctrlDrag, setCtrlDrag] = useState<CtrlDragState>(CTRL_DRAG_INITIAL);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regIndex: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Ctrl-drag: cleanup on pointer up
  useEffect(() => {
    if (!ctrlDrag.active) {
      return;
    }
    const commitCtrlDrag = () => {
      if (
        ctrlDrag.draggedRegIndex !== null &&
        ctrlDrag.targetIndex !== null &&
        ctrlDrag.draggedRegIndex !== ctrlDrag.targetIndex &&
        onReorderRegisters
      ) {
        // Reorder registers
        const newRegs = [...registers];
        const [removed] = newRegs.splice(ctrlDrag.draggedRegIndex, 1);
        newRegs.splice(ctrlDrag.targetIndex, 0, removed);

        // Offsets will be automatically recalculated by the global layout engine
        // when the state update propagates.

        onReorderRegisters(newRegs);
      }
      setCtrlDrag(CTRL_DRAG_INITIAL);
    };
    const cancelCtrlDrag = () => setCtrlDrag(CTRL_DRAG_INITIAL);

    window.addEventListener('pointerup', commitCtrlDrag);
    window.addEventListener('pointercancel', cancelCtrlDrag);
    window.addEventListener('blur', cancelCtrlDrag);
    return () => {
      window.removeEventListener('pointerup', commitCtrlDrag);
      window.removeEventListener('pointercancel', cancelCtrlDrag);
      window.removeEventListener('blur', cancelCtrlDrag);
    };
  }, [ctrlDrag, registers, onReorderRegisters]);

  const handleCtrlPointerDown = (regIdx: number, e: React.PointerEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    if (e.button !== 0) {
      return;
    }
    if (!onReorderRegisters) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    setCtrlDrag({
      active: true,
      draggedRegIndex: regIdx,
      targetIndex: regIdx,
    });
  };

  const handlePointerMove = (regIdx: number) => {
    if (!ctrlDrag.active) {
      return;
    }
    if (ctrlDrag.targetIndex !== regIdx) {
      setCtrlDrag((prev) => ({ ...prev, targetIndex: regIdx }));
    }
  };

  const groups = useMemo(() => {
    return registers.map((reg, idx) => {
      const offset = reg.address_offset ?? reg.offset ?? idx * 4;
      // Calculate size - arrays use count * stride, registers use 4 bytes (32-bit default)
      let size = 4; // Default: 4 bytes (32-bit register)
      let isArray = false;
      if (reg.__kind === 'array') {
        size = (reg.count ?? 1) * (reg.stride ?? 4);
        isArray = true;
      } else if (reg.size) {
        // reg.size is in BITS (e.g., 32 = 32-bit), convert to bytes
        size = Math.max(1, Math.floor(reg.size / 8));
      }
      return {
        idx,
        name: reg.name ?? `Reg ${idx}`,
        offset: Number(offset),
        absoluteAddress: Number(baseAddress) + Number(offset),
        size,
        isArray,
        count: reg.count,
        stride: reg.stride,
        color: getRegColor(idx),
      };
    });
  }, [registers, baseAddress]);

  // Compute preview order during drag
  const displayGroups = useMemo(() => {
    if (
      !ctrlDrag.active ||
      ctrlDrag.draggedRegIndex === null ||
      ctrlDrag.targetIndex === null ||
      ctrlDrag.draggedRegIndex === ctrlDrag.targetIndex
    ) {
      return groups;
    }

    // Reorder for preview
    const newGroups = [...groups];
    const [removed] = newGroups.splice(ctrlDrag.draggedRegIndex, 1);
    newGroups.splice(ctrlDrag.targetIndex, 0, removed);
    return newGroups;
  }, [groups, ctrlDrag]);

  if (layout === 'vertical') {
    // To-scale row heights: regular registers share a base height, arrays grow
    // with their byte footprint (capped) to read as a taller stacked block.
    const ROW_H = 64;
    const heightFor = (g: { isArray: boolean; size: number }) =>
      g.isArray ? Math.min(Math.max(ROW_H * (g.size / 4), ROW_H * 1.6), ROW_H * 3) : ROW_H;

    const lastGroup = displayGroups[displayGroups.length - 1];
    const bottomAddr = lastGroup ? lastGroup.offset + lastGroup.size - 1 : 0;
    const axisColor = 'color-mix(in srgb, var(--vscode-foreground) 35%, transparent)';

    return (
      <div ref={containerRef} className="flex flex-col w-full relative select-none pt-3 pb-6">
        {displayGroups.map((group, displayIdx) => {
          const isHovered = hoveredRegIndex === group.idx;
          const isDragging = ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
          const isDropTarget =
            ctrlDrag.active &&
            ctrlDrag.targetIndex === displayIdx &&
            ctrlDrag.draggedRegIndex !== displayIdx;
          const color = FIELD_COLORS[group.color];

          return (
            <div
              key={group.idx}
              data-viz-row={group.idx}
              className={`flex items-stretch ${isDragging ? 'opacity-50' : ''}`}
              style={{
                minHeight: heightFor(group),
                cursor: ctrlDrag.active
                  ? 'grabbing'
                  : onRegisterClick || onReorderRegisters
                    ? 'pointer'
                    : 'default',
              }}
              onMouseEnter={() => setHoveredRegIndex(group.idx)}
              onMouseLeave={() => setHoveredRegIndex(null)}
              onClick={(e) => {
                if (!ctrlDrag.active && onRegisterClick) {
                  e.stopPropagation();
                  onRegisterClick(group.idx);
                }
              }}
              onContextMenu={(e) => {
                if (!onInsertAtGap && !onDeleteReg) {
                  return;
                }
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, regIndex: group.idx });
              }}
              onPointerDown={(e) => handleCtrlPointerDown(group.idx, e)}
              onPointerMove={() => handlePointerMove(displayIdx)}
              onPointerEnter={() => {
                if (ctrlDrag.active) {
                  handlePointerMove(displayIdx);
                }
              }}
            >
              {/* Address axis cell — tick at the register's start offset */}
              <div
                className="relative w-12 shrink-0"
                style={{ borderRight: `1px ${group.isArray ? 'dashed' : 'solid'} ${axisColor}` }}
              >
                <div className="absolute right-0 top-0 -translate-y-1/2 flex items-center gap-1 pr-px">
                  <span className="text-[11px] font-mono vscode-muted whitespace-nowrap leading-none">
                    {toHex(group.offset)}
                  </span>
                  <span
                    className="block h-px w-2"
                    style={{
                      background: 'color-mix(in srgb, var(--vscode-foreground) 55%, transparent)',
                    }}
                  />
                </div>
              </div>

              {/* Register card */}
              <div
                className="relative flex-1 min-w-0 flex items-stretch gap-3 my-1 ml-3 rounded-xl border px-3 py-2 transition-colors"
                style={{
                  borderColor: 'var(--vscode-panel-border)',
                  background: isHovered
                    ? `color-mix(in srgb, ${color} 9%, var(--vscode-editor-background))`
                    : 'var(--vscode-editor-background)',
                  boxShadow: isDropTarget
                    ? '0 0 0 2px var(--vscode-focusBorder) inset'
                    : isHovered
                      ? `0 0 0 2px ${color} inset`
                      : undefined,
                }}
              >
                {isHovered && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                    style={{ background: color }}
                  />
                )}

                {/* Color swatch (stacked sheets for arrays) */}
                <div
                  className={`relative w-12 shrink-0 self-stretch rounded-lg ${group.isArray ? 'border-2 border-dashed' : ''}`}
                  style={{
                    backgroundColor: color,
                    borderColor: group.isArray ? 'var(--ipcraft-pattern-border)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                  }}
                >
                  {group.isArray && (
                    <>
                      <div className="absolute left-1 right-1 bottom-1.5 h-[3px] rounded-sm bg-black/25" />
                      <div className="absolute left-1 right-1 bottom-3 h-[3px] rounded-sm bg-black/15" />
                    </>
                  )}
                </div>

                {/* Name + offset range */}
                <div className="flex-1 min-w-0 flex flex-col justify-center leading-tight">
                  <span className="font-mono font-bold text-sm truncate">{group.name}</span>
                  <span className="text-[12px] vscode-muted font-mono">
                    {toHex(group.offset)}
                    <span className="mx-1 opacity-60">&rarr;</span>
                    {toHex(group.offset + group.size - 1)}
                  </span>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1.5 self-center shrink-0">
                  {group.isArray ? (
                    <>
                      <span
                        className="px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold"
                        style={{ color, borderColor: color }}
                      >
                        &times;{String(group.count ?? 1)}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold"
                        style={{ color, borderColor: color }}
                      >
                        [N]
                      </span>
                    </>
                  ) : (
                    <span
                      className="px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold"
                      style={{ color, borderColor: color }}
                    >
                      REG
                    </span>
                  )}
                </div>

                {/* Kebab actions menu */}
                {(onInsertAtGap ?? onDeleteReg) && (
                  <button
                    className="self-center shrink-0 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center transition-opacity"
                    style={{ opacity: isHovered ? 1 : 0.35 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, regIndex: group.idx });
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="More Actions..."
                    aria-label="More Actions..."
                  >
                    <span className="codicon codicon-kebab-vertical text-sm" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Bottom axis tick — last register's end address */}
        {lastGroup && (
          <div className="flex">
            <div className="relative w-12 shrink-0">
              <div className="absolute right-0 top-0 -translate-y-1/2 flex items-center gap-1 pr-px">
                <span className="text-[11px] font-mono vscode-muted whitespace-nowrap leading-none">
                  {toHex(bottomAddr)}
                </span>
                <span
                  className="block h-px w-2"
                  style={{
                    background: 'color-mix(in srgb, var(--vscode-foreground) 55%, transparent)',
                  }}
                />
              </div>
            </div>
          </div>
        )}
        {contextMenu && (onInsertAtGap ?? onDeleteReg) && (
          <RegisterActionsMenu
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onInsert={(where, kind) => {
              onInsertAtGap?.(
                where === 'above' ? contextMenu.regIndex : contextMenu.regIndex + 1,
                kind
              );
            }}
            onDelete={() => onDeleteReg?.(contextMenu.regIndex)}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        {/* Register grid background */}
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {displayGroups.map((group, displayIdx) => {
            const isHovered = hoveredRegIndex === group.idx;
            const isDragging = ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
            const isDropTarget =
              ctrlDrag.active &&
              ctrlDrag.targetIndex === displayIdx &&
              ctrlDrag.draggedRegIndex !== displayIdx;
            const separatorShadow = 'inset 0 0 0 1px var(--vscode-panel-border)';

            return (
              <div
                key={group.idx}
                className={`relative flex-1 flex flex-col items-center justify-end select-none min-w-[120px] ${isHovered ? 'z-10' : ''} ${isDragging ? 'opacity-50' : ''}`}
                style={{
                  cursor: ctrlDrag.active
                    ? 'grabbing'
                    : onRegisterClick || onReorderRegisters
                      ? 'pointer'
                      : 'default',
                }}
                onMouseEnter={() => setHoveredRegIndex(group.idx)}
                onMouseLeave={() => setHoveredRegIndex(null)}
                onClick={(e) => {
                  if (!ctrlDrag.active && onRegisterClick) {
                    e.stopPropagation();
                    onRegisterClick(group.idx);
                  }
                }}
                onPointerDown={(e) => handleCtrlPointerDown(group.idx, e)}
                onPointerMove={() => handlePointerMove(displayIdx)}
                onPointerEnter={() => {
                  if (ctrlDrag.active) {
                    handlePointerMove(displayIdx);
                  }
                }}
              >
                <div
                  className={`h-20 w-full overflow-hidden flex items-center justify-center px-2 rounded-md ${group.isArray ? 'border-2 border-dashed' : ''}`}
                  style={{
                    backgroundColor: FIELD_COLORS[group.color],
                    opacity: 1,
                    borderColor: group.isArray ? 'var(--ipcraft-pattern-border)' : undefined,
                    transform: isHovered ? 'translateY(-2px)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isDropTarget
                      ? `${separatorShadow}, 0 0 0 3px var(--vscode-focusBorder), 0 0 12px var(--vscode-focusBorder)`
                      : isHovered
                        ? `${separatorShadow}, 0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
                        : separatorShadow,
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="ipcraft-pattern-label text-[10px] font-mono font-semibold select-none text-center leading-tight">
                      {group.isArray ? `[${String(group.count)}]` : 'REG'}
                    </span>
                  </div>
                </div>
                <div
                  className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${
                    displayIdx === 0 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                  style={{
                    background: 'var(--vscode-editorWidget-background)',
                    color: 'var(--vscode-foreground)',
                    borderColor: 'var(--vscode-panel-border)',
                  }}
                >
                  <div className="font-bold">
                    {group.name}
                    <span className="ml-2 vscode-muted font-mono text-[11px]">[{group.size}B]</span>
                  </div>
                  <div className="text-[11px] vscode-muted font-mono">
                    {toHex(group.absoluteAddress)} →{' '}
                    {toHex(Number(group.absoluteAddress) + Number(group.size) - 1)}
                  </div>
                </div>
                <div className="flex w-full justify-center">
                  <div className="text-center text-[11px] vscode-muted font-mono mt-1">
                    {toHex(group.absoluteAddress)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const RegisterMapVisualizer = React.memo(
  RegisterMapVisualizerInner,
  (prev, next) =>
    prev.registers === next.registers &&
    prev.hoveredRegIndex === next.hoveredRegIndex &&
    prev.setHoveredRegIndex === next.setHoveredRegIndex &&
    prev.baseAddress === next.baseAddress &&
    prev.onReorderRegisters === next.onReorderRegisters &&
    prev.onRegisterClick === next.onRegisterClick &&
    prev.onInsertAtGap === next.onInsertAtGap &&
    prev.onDeleteReg === next.onDeleteReg &&
    prev.layout === next.layout
);

export default RegisterMapVisualizer;
