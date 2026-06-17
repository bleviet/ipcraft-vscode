import React, { useState } from 'react';
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
  onCellClick: (key: RegEditKey) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  isDragSource?: boolean;
  isDragTarget?: boolean;
  onDragHandlePointerDown?: (e: React.PointerEvent<HTMLTableCellElement>) => void;
  onPointerEnterRow?: () => void;
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
  onCellClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  isDragSource = false,
  isDragTarget = false,
  onDragHandlePointerDown,
  onPointerEnterRow,
  siblingNames,
  baseAddress = 0,
}: RegisterTableRowProps) {
  const [nameError, setNameError] = useState<string | null>(null);
  const offset = reg.offset ?? reg.address_offset ?? 0;
  const absStart = baseAddress + Number(offset);
  const absEnd =
    reg.__kind === 'array' && reg.count && reg.stride
      ? absStart + Number(reg.count) * Number(reg.stride) - 1
      : absStart +
        Math.max(1, Math.floor(Number((reg as Record<string, unknown>).size ?? 32) / 8)) -
        1;

  const isCellActive = (key: RegEditKey) =>
    regActiveCell.rowId === rowId && regActiveCell.key === key;

  return (
    <tr
      data-row-id={rowId}
      data-reg-idx={idx}
      className={`group vscode-row-solid transition-colors border-l-4 border-transparent border-b vscode-border h-12 ${
        isDragSource
          ? 'opacity-40'
          : isDragTarget
            ? 'vscode-focus-border'
            : isSelected
              ? 'vscode-focus-border vscode-row-selected'
              : isHovered
                ? 'vscode-focus-border vscode-row-hover'
                : ''
      }`}
      style={isDragTarget ? { boxShadow: '0 0 0 2px var(--vscode-focusBorder) inset' } : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
      onPointerEnter={onPointerEnterRow}
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
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: FIELD_COLORS[color] || color }}
            />
            <CellInput
              editKey="name"
              className="flex-1"
              value={reg.name ?? ''}
              onFocus={captureEditSnapshot}
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

      {/* OFFSET */}
      <EditableCell
        columnKey="offset"
        isActive={isCellActive('offset')}
        onCellClick={() => onCellClick('offset')}
        className="px-4 py-2 font-mono vscode-muted"
      >
        <CellInput
          editKey="offset"
          className="w-full font-mono"
          value={toHex(offset as number)}
          onFocus={captureEditSnapshot}
          onInput={(value) => {
            const val = Number(value);
            if (!Number.isNaN(val)) {
              onUpdate(['registers', idx, 'offset'], val);
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
        <CellInput
          editKey="description"
          variant="textarea"
          className="w-full"
          style={{ minHeight: '40px', resize: 'none' }}
          value={reg.description ?? ''}
          onFocus={captureEditSnapshot}
          onInput={(value) => onUpdate(['registers', idx, 'description'], value)}
        />
      </EditableCell>
    </tr>
  );
}
