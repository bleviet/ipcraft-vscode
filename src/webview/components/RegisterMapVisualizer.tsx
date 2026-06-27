import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { RegisterActionsMenu, CellInput } from '../shared/components';
import { validateUniqueName } from '../shared/utils/validation';
import type { YamlUpdateHandler } from '../types/editor';

export interface VisualizerRegister {
  name?: string;
  offset?: number | string;
  address_offset?: number | string;
  __kind?: string;
  count?: number;
  stride?: number;
  size?: number;
  description?: string;
  [key: string]: unknown;
}

interface RegisterCardGroup {
  idx: number;
  name: string;
  offset: number;
  absoluteAddress: number;
  size: number;
  isArray: boolean;
  count?: number;
  stride?: number;
  color: string;
}

type CardEditKey = 'name' | 'offset' | 'description';

interface RegisterMapVisualizerProps {
  registers: VisualizerRegister[];
  hoveredRegIndex?: number | null;
  setHoveredRegIndex?: (idx: number | null) => void;
  /** Index of the register currently selected in the table (highlighted persistently). */
  selectedRegIndex?: number | null;
  /** Selects a register, keeping the table editor in sync (single click). */
  onSelectRegister?: (regIndex: number) => void;
  baseAddress?: number;
  onReorderRegisters?: (newRegisters: VisualizerRegister[]) => void;
  onRegisterClick?: (regIndex: number) => void;
  onInsertAtGap?: (gapIndex: number, kind: 'register' | 'flat-array' | 'array') => void;
  onDeleteReg?: (regIndex: number) => void;
  layout?: 'horizontal' | 'vertical';
  /** Tooltip shown on each card when double-click navigates somewhere (e.g. "Double-click to open"). */
  cardDoubleClickHint?: string;
  /**
   * Block-scoped update handler enabling inline editing of register name,
   * offset, and description directly on the vertical-layout cards. When
   * provided (vertical layout only), each card becomes editable.
   */
  onUpdateRegister?: YamlUpdateHandler;
  /** Cancel-edit ref shared with the table editor (ESC reverts the edit). */
  cancelEditRef?: React.MutableRefObject<boolean>;
  /** Snapshot the model before an edit so it can be reverted on cancel. */
  captureEditSnapshot?: () => void;
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

interface RegisterCardProps {
  group: RegisterCardGroup;
  reg: VisualizerRegister;
  isHovered: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  minHeight: number;
  /** Narrow-panel mode: drops the decorative swatch/handle so the name keeps room. */
  compact: boolean;
  axisColor: string;
  cardDoubleClickHint?: string;
  ctrlDragActive: boolean;
  /** Whether the Ctrl/Cmd key is currently held (shows a grab cursor on reorderable cards). */
  ctrlPressed: boolean;
  /** Whether drag-to-reorder is available (onReorderRegisters provided). */
  canReorder: boolean;
  interactive: boolean;
  showKebab: boolean;
  editable: boolean;
  siblingNames: string[];
  onUpdateRegister?: YamlUpdateHandler;
  cancelEditRef?: React.MutableRefObject<boolean>;
  captureEditSnapshot?: () => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onSelect: () => void;
  onNavigate?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKebab: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  /** Initiates a drag-to-reorder from the card's drag handle (no Ctrl required). */
  onDragHandlePointerDown?: (e: React.PointerEvent) => void;
  onPointerMove: () => void;
  onPointerEnter: () => void;
}

/**
 * One register card in the vertical (rail) layout. Holds local edit state so a
 * card's name/offset/description can be edited inline without remounting siblings.
 */
const RegisterCard: React.FC<RegisterCardProps> = ({
  group,
  reg,
  isHovered,
  isSelected,
  isDragging,
  isDropTarget,
  minHeight,
  compact,
  axisColor,
  cardDoubleClickHint,
  ctrlDragActive,
  ctrlPressed,
  canReorder,
  interactive,
  showKebab,
  editable,
  siblingNames,
  onUpdateRegister,
  cancelEditRef,
  captureEditSnapshot,
  onHoverEnter,
  onHoverLeave,
  onSelect,
  onNavigate,
  onContextMenu,
  onKebab,
  onPointerDown,
  onDragHandlePointerDown,
  onPointerMove,
  onPointerEnter,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [editingKey, setEditingKey] = useState<CardEditKey | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Reset edit state when the card is deselected.
  useEffect(() => {
    if (!isSelected) {
      setEditingKey(null);
    }
  }, [isSelected]);

  // Focus the editor once it mounts (double-click / keyboard entered edit mode).
  useEffect(() => {
    if (!editingKey) {
      return;
    }
    const el = cardRef.current?.querySelector(
      `[data-edit-key="${editingKey}"]`
    ) as HTMLElement | null;
    el?.focus?.();
  }, [editingKey]);

  const color = FIELD_COLORS[group.color];
  const accent = isHovered || isSelected;

  const startEdit = (key: CardEditKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingKey(key);
  };

  const commitName = (value: string) => {
    const err = validateUniqueName(value, siblingNames, reg.name ?? '');
    setNameError(err);
    if (!err) {
      onUpdateRegister?.(['registers', group.idx, 'name'], value);
    }
  };

  return (
    <div
      ref={cardRef}
      data-viz-row={group.idx}
      data-tooltip={cardDoubleClickHint}
      className={`flex items-stretch group ${isDragging ? 'opacity-50' : ''}`}
      style={{
        minHeight,
        cursor: ctrlDragActive
          ? 'grabbing'
          : ctrlPressed && canReorder
            ? 'grab'
            : interactive
              ? 'pointer'
              : 'default',
      }}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onClick={onSelect}
      onDoubleClick={(e) => {
        if (!ctrlDragActive && onNavigate) {
          e.stopPropagation();
          onNavigate();
        }
      }}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
      onBlur={(e) => {
        if (!cardRef.current?.contains(e.relatedTarget as Node)) {
          setEditingKey(null);
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
        className={`relative flex-1 min-w-0 flex flex-col my-1 ml-3 rounded-xl border ${
          compact ? 'px-2' : 'px-3'
        } py-2 transition-colors overflow-hidden`}
        style={{
          borderColor: 'var(--vscode-panel-border)',
          background: accent
            ? `color-mix(in srgb, ${color} 9%, var(--vscode-editor-background))`
            : 'var(--vscode-editor-background)',
          boxShadow: isDropTarget
            ? '0 0 0 2px var(--vscode-focusBorder) inset'
            : isSelected
              ? '0 0 0 2px var(--vscode-focusBorder) inset'
              : isHovered
                ? `0 0 0 2px ${color} inset`
                : undefined,
        }}
      >
        {accent && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
            style={{ background: isSelected ? 'var(--vscode-focusBorder)' : color }}
          />
        )}

        <div className={`flex items-stretch min-w-0 ${compact ? 'gap-2' : 'gap-3'}`}>
          {/* Drag handle — drag to reorder (Ctrl + drag also works on the card body).
              Hidden in compact mode to reserve width for the name; Ctrl+drag on the
              card body still reorders. */}
          {canReorder && !compact && (
            <div
              className="flex items-center justify-center w-4 shrink-0 opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity"
              style={{ cursor: ctrlDragActive ? 'grabbing' : 'grab' }}
              title="Drag to reorder"
              aria-label="Drag to reorder"
              onPointerDown={onDragHandlePointerDown}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <span className="codicon codicon-gripper text-sm vscode-muted" />
            </div>
          )}
          {/* Color swatch (stacked sheets for arrays). Dropped in compact mode so
              the name keeps room; array identity is still shown by the [N] badge. */}
          {!compact && (
            <div
              className={`relative w-12 shrink-0 self-stretch rounded-lg ${group.isArray ? 'border-2 border-dashed' : ''}`}
              style={{
                backgroundColor: color,
                borderColor: group.isArray ? 'var(--ipcraft-pattern-border)' : undefined,
                filter: accent ? 'saturate(1.15) brightness(1.05)' : undefined,
                minHeight: 40,
              }}
            >
              {group.isArray && (
                <>
                  <div className="absolute left-1 right-1 bottom-1.5 h-[3px] rounded-sm bg-black/25" />
                  <div className="absolute left-1 right-1 bottom-3 h-[3px] rounded-sm bg-black/15" />
                </>
              )}
            </div>
          )}

          {/* Name + offset range */}
          <div className="flex-1 min-w-0 flex flex-col justify-center leading-tight overflow-hidden">
            {editable && editingKey === 'name' ? (
              <CellInput
                editKey="name"
                className="flex-1 min-w-0 font-mono"
                isEditing
                value={reg.name ?? ''}
                onFocus={() => captureEditSnapshot?.()}
                cancelEditRef={cancelEditRef}
                onInput={commitName}
                onBlur={(value) => {
                  commitName(value);
                  setNameError(null);
                }}
              />
            ) : (
              <span
                className={`font-mono font-bold text-sm line-clamp-2 break-words min-w-0 w-full ${
                  editable ? 'cursor-text' : ''
                }`}
                data-tooltip={editable ? 'Double-click to edit' : undefined}
                onDoubleClick={editable ? startEdit('name') : undefined}
              >
                {group.name}
              </span>
            )}
            <span className="text-[12px] vscode-muted font-mono flex items-center gap-1">
              {editable && editingKey === 'offset' ? (
                <CellInput
                  editKey="offset"
                  className="w-20 font-mono"
                  isEditing
                  value={toHex(group.offset)}
                  onFocus={() => captureEditSnapshot?.()}
                  cancelEditRef={cancelEditRef}
                  onInput={(value) => {
                    const val = Number(value);
                    if (!Number.isNaN(val)) {
                      onUpdateRegister?.(['registers', group.idx, 'offset'], val);
                    }
                  }}
                />
              ) : (
                <span
                  className={editable ? 'cursor-text' : undefined}
                  data-tooltip={editable ? 'Double-click to edit' : undefined}
                  onDoubleClick={editable ? startEdit('offset') : undefined}
                >
                  {toHex(group.offset)}
                </span>
              )}
              <span className="opacity-60">&rarr;</span>
              {toHex(group.offset + group.size - 1)}
            </span>
            {nameError ? (
              <span className="text-[11px] vscode-error mt-0.5">{nameError}</span>
            ) : null}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5 self-center shrink-0 ml-2">
            {group.isArray ? (
              // Single compact pill so the two array markers never overflow the
              // card; the count and [N] stay as separate text nodes.
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold whitespace-nowrap"
                style={{ color, borderColor: color }}
              >
                <span>&times;{String(group.count ?? 1)}</span>
                <span className="opacity-70">[N]</span>
              </span>
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
          {showKebab && (
            <button
              className="self-center shrink-0 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center transition-opacity"
              style={{ opacity: accent ? 1 : 0.35 }}
              onClick={(e) => {
                e.stopPropagation();
                onKebab(e);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title="More Actions..."
              aria-label="More Actions..."
            >
              <span className="codicon codicon-kebab-vertical text-sm" />
            </button>
          )}
        </div>

        {/* Description — editable, revealed when the card is selected */}
        {editable && isSelected && (
          <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--vscode-panel-border)' }}>
            {editingKey === 'description' ? (
              <CellInput
                editKey="description"
                variant="textarea"
                className="w-full text-xs"
                isEditing
                style={{ minHeight: '36px', resize: 'none' }}
                value={reg.description ?? ''}
                onFocus={() => captureEditSnapshot?.()}
                cancelEditRef={cancelEditRef}
                onInput={(value) =>
                  onUpdateRegister?.(['registers', group.idx, 'description'], value)
                }
              />
            ) : (
              <p
                className="text-xs vscode-muted whitespace-pre-wrap cursor-text min-h-[1rem]"
                data-tooltip="Double-click to edit"
                onDoubleClick={startEdit('description')}
              >
                {reg.description?.length ? (
                  reg.description
                ) : (
                  <span className="italic opacity-60">No description</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const RegisterMapVisualizerInner: React.FC<RegisterMapVisualizerProps> = ({
  registers,
  hoveredRegIndex = null,
  setHoveredRegIndex = () => undefined,
  selectedRegIndex = null,
  onSelectRegister,
  baseAddress = 0,
  onReorderRegisters,
  onRegisterClick,
  onInsertAtGap,
  onDeleteReg,
  layout = 'horizontal',
  cardDoubleClickHint,
  onUpdateRegister,
  cancelEditRef,
  captureEditSnapshot,
}) => {
  const [ctrlDrag, setCtrlDrag] = useState<CtrlDragState>(CTRL_DRAG_INITIAL);
  // Synchronous mirror of ctrlDrag.active so the contextmenu handler (fired by
  // macOS Ctrl+click right-click emulation) can tell a drag is in progress
  // before React has flushed the state update.
  const ctrlDragRef = useRef(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  // Compact mode for narrow panels: measured from the container so cards can drop
  // their decorative swatch/handle before the name column collapses to nothing.
  const [compact, setCompact] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regIndex: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Switch cards to compact layout when the panel is too narrow for the full
  // swatch + name + badges row. ResizeObserver is unavailable in jsdom, so tests
  // exercise the default (full) layout.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setCompact(width > 0 && width < 280);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track whether Ctrl/Cmd is held so reorderable cards can show a grab cursor
  // before the drag actually starts (and a grabbing cursor while dragging).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setCtrlPressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        setCtrlPressed(false);
      }
    };
    const reset = () => setCtrlPressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // Scroll the selected register card into view (table-driven selection sync).
  useEffect(() => {
    if (selectedRegIndex === null || selectedRegIndex < 0) {
      return;
    }
    const el = containerRef.current?.querySelector(`[data-viz-row="${selectedRegIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedRegIndex]);

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
      ctrlDragRef.current = false;
      setCtrlDrag(CTRL_DRAG_INITIAL);
    };
    const cancelCtrlDrag = () => {
      ctrlDragRef.current = false;
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

    ctrlDragRef.current = true;
    setCtrlDrag({
      active: true,
      draggedRegIndex: regIdx,
      targetIndex: regIdx,
    });
  };

  // Plain drag from the gripper handle — no Ctrl required. Stops propagation so
  // the card-body Ctrl+drag handler does not also fire.
  const handleDragHandlePointerDown = (regIdx: number, e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    if (!onReorderRegisters) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    ctrlDragRef.current = true;
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
          const isSelected = selectedRegIndex === group.idx;
          const isDragging = ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
          const isDropTarget =
            ctrlDrag.active &&
            ctrlDrag.targetIndex === displayIdx &&
            ctrlDrag.draggedRegIndex !== displayIdx;

          return (
            <RegisterCard
              key={group.idx}
              group={group}
              reg={registers[group.idx] ?? {}}
              isHovered={isHovered}
              isSelected={isSelected}
              isDragging={isDragging}
              isDropTarget={isDropTarget}
              minHeight={heightFor(group)}
              compact={compact}
              axisColor={axisColor}
              cardDoubleClickHint={cardDoubleClickHint}
              ctrlDragActive={ctrlDrag.active}
              ctrlPressed={ctrlPressed}
              canReorder={!!onReorderRegisters}
              interactive={!!(onRegisterClick ?? onReorderRegisters ?? onSelectRegister)}
              showKebab={!!(onInsertAtGap ?? onDeleteReg)}
              editable={!!onUpdateRegister}
              siblingNames={registers
                .filter((_, i) => i !== group.idx)
                .map((r) => String(r.name ?? ''))}
              onUpdateRegister={onUpdateRegister}
              cancelEditRef={cancelEditRef}
              captureEditSnapshot={captureEditSnapshot}
              onHoverEnter={() => setHoveredRegIndex(group.idx)}
              onHoverLeave={() => setHoveredRegIndex(null)}
              onSelect={() => {
                if (!ctrlDrag.active && onSelectRegister) {
                  onSelectRegister(group.idx);
                }
              }}
              onNavigate={onRegisterClick ? () => onRegisterClick(group.idx) : undefined}
              onContextMenu={(e) => {
                // On macOS, Ctrl+click fires a contextmenu event; suppress it
                // while a Ctrl/handle drag is in progress so the actions menu
                // does not pop up instead of the reorder.
                if (ctrlDragRef.current) {
                  e.preventDefault();
                  return;
                }
                if (!onInsertAtGap && !onDeleteReg) {
                  return;
                }
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, regIndex: group.idx });
              }}
              onKebab={(e) => setContextMenu({ x: e.clientX, y: e.clientY, regIndex: group.idx })}
              onPointerDown={(e) => handleCtrlPointerDown(group.idx, e)}
              onDragHandlePointerDown={(e) => handleDragHandlePointerDown(group.idx, e)}
              onPointerMove={() => handlePointerMove(displayIdx)}
              onPointerEnter={() => {
                if (ctrlDrag.active) {
                  handlePointerMove(displayIdx);
                }
              }}
            />
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
    <div ref={containerRef} className="w-full">
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        {/* Register grid background */}
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {displayGroups.map((group, displayIdx) => {
            const isHovered = hoveredRegIndex === group.idx;
            const isSelected = selectedRegIndex === group.idx;
            const accent = isHovered || isSelected;
            const isDragging = ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
            const isDropTarget =
              ctrlDrag.active &&
              ctrlDrag.targetIndex === displayIdx &&
              ctrlDrag.draggedRegIndex !== displayIdx;
            const separatorShadow = 'inset 0 0 0 1px var(--vscode-panel-border)';

            return (
              <div
                key={group.idx}
                data-viz-row={group.idx}
                data-tooltip={cardDoubleClickHint}
                className={`relative flex-1 flex flex-col items-center justify-end select-none min-w-[120px] ${accent ? 'z-10' : ''} ${isDragging ? 'opacity-50' : ''}`}
                style={{
                  cursor: ctrlDrag.active
                    ? 'grabbing'
                    : ctrlPressed && onReorderRegisters
                      ? 'grab'
                      : onRegisterClick || onReorderRegisters || onSelectRegister
                        ? 'pointer'
                        : 'default',
                }}
                onMouseEnter={() => setHoveredRegIndex(group.idx)}
                onMouseLeave={() => setHoveredRegIndex(null)}
                onClick={(e) => {
                  if (!ctrlDrag.active && onSelectRegister) {
                    e.stopPropagation();
                    onSelectRegister(group.idx);
                  }
                }}
                onDoubleClick={(e) => {
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
                    transform: accent ? 'translateY(-2px)' : undefined,
                    filter: accent ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isDropTarget
                      ? `${separatorShadow}, 0 0 0 3px var(--vscode-focusBorder), 0 0 12px var(--vscode-focusBorder)`
                      : isSelected
                        ? `${separatorShadow}, 0 0 0 3px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
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
    prev.selectedRegIndex === next.selectedRegIndex &&
    prev.onSelectRegister === next.onSelectRegister &&
    prev.baseAddress === next.baseAddress &&
    prev.onReorderRegisters === next.onReorderRegisters &&
    prev.onRegisterClick === next.onRegisterClick &&
    prev.onInsertAtGap === next.onInsertAtGap &&
    prev.onDeleteReg === next.onDeleteReg &&
    prev.layout === next.layout &&
    prev.cardDoubleClickHint === next.cardDoubleClickHint &&
    prev.onUpdateRegister === next.onUpdateRegister &&
    prev.cancelEditRef === next.cancelEditRef &&
    prev.captureEditSnapshot === next.captureEditSnapshot
);

export default RegisterMapVisualizer;
