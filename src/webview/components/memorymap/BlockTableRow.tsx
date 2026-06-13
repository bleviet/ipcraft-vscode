import React from 'react';
import { FIELD_COLORS } from '../../shared/colors';
import { calculateBlockSize } from '../../utils/blockSize';
import { toHex } from '../../utils/formatUtils';
import type { YamlUpdateHandler } from '../../types/editor';
import type { MemoryMapBlockDef } from './MemoryMapEditor';
import { EditableCell, CellInput } from '../../shared/components';

// ---------------------------------------------------------------------------
// Types -- exported so parent editors can import instead of re-declaring
// ---------------------------------------------------------------------------

export type BlockEditKey = 'name' | 'base' | 'size' | 'usage' | 'description';
export interface BlockActiveCell {
  rowId: string | null;
  rowIndex: number;
  key: BlockEditKey;
}
export const BLOCK_COLUMN_ORDER: BlockEditKey[] = ['name', 'base', 'size', 'usage', 'description'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlockTableRowProps {
  block: MemoryMapBlockDef;
  rowId: string;
  idx: number;
  isSelected: boolean;
  isHovered: boolean;
  blockActiveCell: BlockActiveCell;
  color: string;
  cancelEditRef: React.MutableRefObject<boolean>;
  captureEditSnapshot: () => void;
  onUpdate: YamlUpdateHandler;
  onRowClick: () => void;
  onCellClick: (key: BlockEditKey) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared block row used by MemoryMapEditor.
 */
export function BlockTableRow({
  block,
  rowId,
  idx,
  isSelected,
  isHovered,
  blockActiveCell,
  color,
  cancelEditRef,
  captureEditSnapshot,
  onUpdate,
  onRowClick,
  onCellClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
}: BlockTableRowProps) {
  const base = block.baseAddress ?? 0;
  const size = calculateBlockSize(block);

  const isCellActive = (key: BlockEditKey) =>
    blockActiveCell.rowId === rowId && blockActiveCell.key === key;

  return (
    <tr
      data-row-id={rowId}
      data-block-idx={idx}
      className={`group transition-colors border-l-4 border-transparent border-b vscode-border h-12 ${
        isSelected
          ? 'vscode-focus-border vscode-row-selected'
          : isHovered
            ? 'vscode-focus-border vscode-row-hover'
            : ''
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
    >
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
            value={block.name || ''}
            onFocus={captureEditSnapshot}
            cancelEditRef={cancelEditRef}
            onInput={(value) => onUpdate(['addressBlocks', idx, 'name'], value)}
            onBlur={(value) => onUpdate(['addressBlocks', idx, 'name'], value)}
          />
        </div>
      </EditableCell>

      {/* BASE ADDRESS */}
      <EditableCell
        columnKey="base"
        isActive={isCellActive('base')}
        onCellClick={() => onCellClick('base')}
        className="px-4 py-2 font-mono vscode-muted"
      >
        <CellInput
          editKey="base"
          className="w-full font-mono"
          value={toHex(base)}
          onFocus={captureEditSnapshot}
          onInput={(value) => {
            const val = Number(value);
            if (!Number.isNaN(val)) {
              onUpdate(['addressBlocks', idx, 'baseAddress'], val);
            }
          }}
        />
      </EditableCell>

      {/* SIZE */}
      <EditableCell
        columnKey="size"
        isActive={isCellActive('size')}
        onCellClick={() => onCellClick('size')}
        className="px-4 py-2 font-mono vscode-muted"
      >
        {size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`}
      </EditableCell>

      {/* USAGE */}
      <EditableCell
        columnKey="usage"
        isActive={isCellActive('usage')}
        onCellClick={() => onCellClick('usage')}
        className="px-4 py-2"
      >
        <span className="px-2 py-0.5 rounded text-xs font-medium vscode-badge whitespace-nowrap">
          {block.usage ?? 'register'}
        </span>
      </EditableCell>

      {/* DESCRIPTION */}
      <EditableCell
        columnKey="description"
        isActive={isCellActive('description')}
        onCellClick={() => onCellClick('description')}
        className="px-6 py-2 vscode-muted"
      >
        <CellInput
          editKey="description"
          variant="textarea"
          className="w-full"
          value={block.description ?? ''}
          onFocus={captureEditSnapshot}
          onInput={(value) => onUpdate(['addressBlocks', idx, 'description'], value)}
        />
      </EditableCell>
    </tr>
  );
}
