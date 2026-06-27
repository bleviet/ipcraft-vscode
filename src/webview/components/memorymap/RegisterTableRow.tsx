import React, { useEffect, useState } from 'react';
import { FIELD_COLORS } from '../../shared/colors';
import { toHex } from '../../utils/formatUtils';
import type { YamlUpdateHandler } from '../../types/editor';
import type { RegisterModel } from '../../types/registerModel';
import { EditableCell, CellInput } from '../../shared/components';
import { validateUniqueName } from '../../shared/utils/validation';

// ---------------------------------------------------------------------------
// Types — exported so parent editors can import instead of re-declaring
// ---------------------------------------------------------------------------

export type RegEditKey = 'name' | 'offset' | 'description';
export interface RegActiveCell {
  rowId: string | null;
  rowIndex: number;
  key: RegEditKey;
}
export const REG_COLUMN_ORDER: RegEditKey[] = ['name', 'offset', 'description'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RegisterTableRowProps {
  reg: RegisterModel;
  rowId: string;
  idx: number;
  isSelected: boolean;
  isHovered: boolean;
  regActiveCell: RegActiveCell;
  color: string;
  cancelEditRef: React.MutableRefObject<boolean>;
  captureEditSnapshot: () => void;
  onUpdate: YamlUpdateHandler;
  onRowClick: () => void;
  /** Navigates into the register (e.g. opens its field editor), triggered by double-click. */
  onRowDoubleClick?: () => void;
  onCellClick: (key: RegEditKey) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Opens the kebab actions menu (insert/delete) anchored at the click position. */
  onActionsMenu?: (e: React.MouseEvent) => void;
  isDragSource?: boolean;
  isDragTarget?: boolean;
  dragTargetPosition?: 'top' | 'bottom' | 'center' | null;
  onDragHandlePointerDown?: (e: React.PointerEvent<HTMLTableCellElement>) => void;
  onPointerEnterRow?: () => void;
  onDragMove?: (rowId: string, e: React.PointerEvent) => void;
  siblingNames?: string[];
  baseAddress?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared register row used by both BlockEditor and RegisterArrayEditor.
 */
export function RegisterTableRow({
  reg,
  rowId,
  idx,
  isSelected,
  isHovered,
  regActiveCell,
  color,
  cancelEditRef,
  captureEditSnapshot,
  onUpdate,
  onRowClick,
  onRowDoubleClick,
  onCellClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  onActionsMenu,
  isDragSource = false,
  isDragTarget = false,
  dragTargetPosition = null,
  onDragHandlePointerDown,
  onPointerEnterRow,
  onDragMove,
  siblingNames,
  baseAddress = 0,
}: RegisterTableRowProps) {
  const [nameError, setNameError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<RegEditKey | null>(null);

  useEffect(() => {
    if (!isSelected) {
      setEditingKey(null);
    }
  }, [isSelected]);

  // Visual type: nested array (__kind), flat array (count/stride), or plain register.
  const isNestedArray = reg.__kind === 'array';
  const isFlatArray =
    !isNestedArray && typeof reg.count === 'number' && typeof reg.stride === 'number';
  const isArrayLike = isNestedArray || isFlatArray;
  const swatchColor = FIELD_COLORS[color] || color;

  const offset = reg.offset ?? reg.address_offset ?? 0;
  const absStart = baseAddress + Number(offset);
  const absEnd =
    isArrayLike && reg.count && reg.stride
      ? absStart + Number(reg.count) * Number(reg.stride) - 1
      : absStart +
        Math.max(1, Math.floor(Number((reg as Record<string, unknown>).size ?? 32) / 8)) -
        1;

  const isCellActive = (key: RegEditKey) =>
    regActiveCell.rowId === rowId && regActiveCell.key === key;

  const typeBadge = isNestedArray
    ? { icon: 'codicon-symbol-struct', label: `×${reg.count ?? 1}`, title: 'Nested register array' }
    : isFlatArray
      ? { icon: 'codicon-symbol-array', label: `×${reg.count ?? 1}`, title: 'Flat register array' }
      : { icon: 'codicon-symbol-field', label: 'REG', title: 'Register' };

  return (
    <tr
      data-row-id={rowId}
      data-reg-idx={idx}
      className={`group vscode-row-solid transition-colors border-l-4 border-transparent border-b vscode-border h-12 ${
        isDragSource
          ? 'opacity-40'
          : isDragTarget && dragTargetPosition === 'center'
            ? 'vscode-focus-border'
            : isSelected
              ? 'vscode-focus-border vscode-row-selected'
              : isHovered
                ? 'vscode-focus-border vscode-row-hover'
                : ''
      }`}
      style={
        isDragTarget
          ? dragTargetPosition === 'top'
            ? {
                backgroundImage: 'linear-gradient(to right, #f97316, #f43f5e)',
                backgroundSize: '100% 2px',
                backgroundPosition: 'top',
                backgroundRepeat: 'no-repeat',
              }
            : dragTargetPosition === 'bottom'
              ? {
                  backgroundImage: 'linear-gradient(to right, #f97316, #f43f5e)',
                  backgroundSize: '100% 2px',
                  backgroundPosition: 'bottom',
                  backgroundRepeat: 'no-repeat',
                }
              : {
                  backgroundImage:
                    'linear-gradient(to right, #f97316, #f43f5e), linear-gradient(to right, #f97316, #f43f5e), linear-gradient(to bottom, #f97316, #f97316), linear-gradient(to bottom, #f43f5e, #f43f5e)',
                  backgroundSize: '100% 2px, 100% 2px, 2px 100%, 2px 100%',
                  backgroundPosition: 'top, bottom, left, right',
                  backgroundRepeat: 'no-repeat',
                }
          : undefined
      }
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onRowClick}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setEditingKey(null);
        }
      }}
      onDoubleClick={(e) => {
        if (!onRowDoubleClick) {
          return;
        }
        // Let double-click select text inside editable fields rather than navigate.
        const target = e.target as HTMLElement | null;
        const isEditable = !!target?.closest(
          'input, textarea, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown'
        );
        if (isEditable) {
          return;
        }
        e.stopPropagation();
        onRowDoubleClick();
      }}
      onContextMenu={onContextMenu}
      onPointerEnter={onPointerEnterRow}
      onPointerMove={(e) => {
        if (onDragMove) {
          onDragMove(rowId, e);
        }
      }}
    >
      {/* DRAG HANDLE */}
      <td
        className="w-8 px-1 text-center select-none opacity-0 group-hover:opacity-40 hover:!opacity-80"
        title="Drag to reorder"
        style={{ cursor: onDragHandlePointerDown ? 'grab' : 'default' }}
        onPointerDown={onDragHandlePointerDown}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="codicon codicon-gripper text-sm" />
      </td>
      {/* NAME */}
      <EditableCell
        columnKey="name"
        isActive={isCellActive('name')}
        onCellClick={() => onCellClick('name')}
        className="px-6 py-2 font-medium"
      >
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2 h-10">
            <div
              className={`w-2.5 h-2.5 rounded-sm shrink-0 ${isArrayLike ? 'border border-dashed' : ''}`}
              style={{
                backgroundColor: swatchColor,
                borderColor: isArrayLike ? 'var(--ipcraft-pattern-border)' : undefined,
              }}
            />
            <span
              className="inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold leading-none"
              style={{ color: swatchColor, borderColor: swatchColor }}
              title={typeBadge.title}
            >
              <span className={`codicon ${typeBadge.icon} text-[11px]`} />
              {typeBadge.label}
            </span>
            <CellInput
              editKey="name"
              className="flex-1 min-w-0"
              isEditing={editingKey === 'name'}
              value={reg.name ?? ''}
              onFocus={() => {
                captureEditSnapshot();
                setEditingKey('name');
              }}
              cancelEditRef={cancelEditRef}
              onInput={(value) => {
                const err = validateUniqueName(value, siblingNames ?? [], reg.name ?? '');
                setNameError(err);
                if (!err) {
                  onUpdate(['registers', idx, 'name'], value);
                }
              }}
              onBlur={(value) => {
                const err = validateUniqueName(value, siblingNames ?? [], reg.name ?? '');
                if (!err) {
                  onUpdate(['registers', idx, 'name'], value);
                }
                // Either committed or discarded — the input reverts to the
                // canonical value either way, so no error should linger.
                setNameError(null);
              }}
            />
          </div>
          {nameError ? <div className="text-xs vscode-error mt-1">{nameError}</div> : null}
        </div>
      </EditableCell>

      {/* OFFSET / BASE ADDRESS */}
      <EditableCell
        columnKey="offset"
        isActive={isCellActive('offset')}
        onCellClick={() => onCellClick('offset')}
        className="px-4 py-2 font-mono vscode-muted"
      >
        <CellInput
          editKey="offset"
          className="w-full font-mono"
          isEditing={editingKey === 'offset'}
          value={toHex(absStart)}
          onFocus={() => {
            captureEditSnapshot();
            setEditingKey('offset');
          }}
          onInput={(value) => {
            const val = Number(value);
            if (!Number.isNaN(val)) {
              onUpdate(['registers', idx, 'offset'], val - baseAddress);
            }
          }}
        />
      </EditableCell>

      {/* ADDRESS RANGE (read-only) */}
      <td className="px-4 py-2 font-mono text-sm vscode-muted">
        {toHex(absStart)}
        <span className="mx-1 opacity-50">→</span>
        {toHex(absEnd)}
      </td>

      {/* DESCRIPTION */}
      <EditableCell
        columnKey="description"
        isActive={isCellActive('description')}
        onCellClick={() => onCellClick('description')}
        className="px-6 py-2 vscode-muted"
        style={{ width: '35%' }}
      >
        <div className="flex items-start gap-1">
          <CellInput
            editKey="description"
            variant="textarea"
            className="flex-1 min-w-0"
            isEditing={editingKey === 'description'}
            style={{ minHeight: '40px', resize: 'none' }}
            value={reg.description ?? ''}
            onFocus={() => {
              captureEditSnapshot();
              setEditingKey('description');
            }}
            onInput={(value) => onUpdate(['registers', idx, 'description'], value)}
          />
          {onActionsMenu && (
            <button
              className={`${
                isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              } self-center shrink-0 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center transition-opacity`}
              onClick={(e) => {
                e.stopPropagation();
                onActionsMenu(e);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title="More Actions..."
              aria-label="More Actions..."
            >
              <span className="codicon codicon-kebab-vertical text-sm" />
            </button>
          )}
        </div>
      </EditableCell>
    </tr>
  );
}
