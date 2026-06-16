import React from 'react';
import { FIELD_COLORS } from '../../shared/colors';
import { ACCESS_OPTIONS } from '../../shared/constants';
import { toHex } from '../../utils/formatUtils';
import type { YamlUpdateHandler } from '../../types/editor';
import type { RegisterModel } from '../../types/registerModel';
import { EditableCell, CellInput } from '../../shared/components';

// ---------------------------------------------------------------------------
// Types — exported so parent editors can import instead of re-declaring
// ---------------------------------------------------------------------------

export type RegEditKey = 'name' | 'offset' | 'access' | 'description';
export interface RegActiveCell {
  rowId: string | null;
  rowIndex: number;
  key: RegEditKey;
}
export const REG_COLUMN_ORDER: RegEditKey[] = ['name', 'offset', 'access', 'description'];

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
}: RegisterTableRowProps) {
  const offset = reg.offset ?? reg.address_offset ?? 0;

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
        <div className="flex items-center gap-2">
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
            onInput={(value) => onUpdate(['registers', idx, 'name'], value)}
            onBlur={(value) => onUpdate(['registers', idx, 'name'], value)}
          />
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

      {/* ACCESS */}
      <EditableCell
        columnKey="access"
        isActive={isCellActive('access')}
        onCellClick={() => onCellClick('access')}
        className="px-4 py-2"
        style={{ overflow: 'visible', position: 'relative' }}
      >
        <CellInput
          editKey="access"
          variant="dropdown"
          className="w-full"
          value={reg.access ?? 'read-write'}
          options={ACCESS_OPTIONS}
          onFocus={captureEditSnapshot}
          onInput={(value) => onUpdate(['registers', idx, 'access'], value)}
        />
      </EditableCell>

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
