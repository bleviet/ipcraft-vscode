import React from 'react';
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextArea,
  VSCodeTextField,
} from '@vscode/webview-ui-toolkit/react';
import { FIELD_COLORS } from '../../shared/colors';
import { ACCESS_OPTIONS } from '../../shared/constants';
import { toHex } from '../../utils/formatUtils';
import type { YamlUpdateHandler } from '../../types/editor';
import type { RegisterModel } from '../../types/registerModel';

// ---------------------------------------------------------------------------
// Types — exported so parent editors can import instead of re-declaring
// ---------------------------------------------------------------------------

export type RegEditKey = 'name' | 'offset' | 'access' | 'description';
export type RegActiveCell = { rowIndex: number; key: RegEditKey };
export const REG_COLUMN_ORDER: RegEditKey[] = ['name', 'offset', 'access', 'description'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RegisterTableRowProps {
  reg: RegisterModel;
  idx: number;
  isSelected: boolean;
  isHovered: boolean;
  regActiveCell: RegActiveCell;
  color: string;
  captureEditSnapshot: () => void;
  onUpdate: YamlUpdateHandler;
  onRowClick: () => void;
  onCellClick: (key: RegEditKey) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared register row used by both BlockEditor and RegisterArrayEditor.
 *
 * Behaviour:
 *   - name   : onInput live-commit; onFocus captures snapshot.
 *   - offset : onInput live-commit (hex display); onFocus captures snapshot.
 *   - access : VSCodeDropdown onInput live-commit.
 *   - description : VSCodeTextArea onInput live-commit; onFocus captures snapshot.
 */
export function RegisterTableRow({
  reg,
  idx,
  isSelected,
  isHovered,
  regActiveCell,
  color,
  captureEditSnapshot,
  onUpdate,
  onRowClick,
  onCellClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
}: RegisterTableRowProps) {
  const offset = reg.address_offset ?? reg.offset ?? 0;

  const isCellActive = (key: RegEditKey) =>
    regActiveCell.rowIndex === idx && regActiveCell.key === key;

  return (
    <tr
      data-row-idx={idx}
      data-reg-idx={idx}
      className={`group vscode-row-solid transition-colors border-l-4 border-transparent border-b vscode-border h-12 ${
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
      <td
        data-col-key="name"
        className={`px-6 py-2 font-medium align-middle ${isCellActive('name') ? 'vscode-cell-active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onCellClick('name');
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: FIELD_COLORS[color] || color }}
          />
          <VSCodeTextField
            data-edit-key="name"
            className="flex-1"
            value={reg.name ?? ''}
            onFocus={() => captureEditSnapshot()}
            onInput={(e: Event | React.FormEvent<HTMLElement>) =>
              onUpdate(['registers', idx, 'name'], (e.target as HTMLInputElement).value)
            }
          />
        </div>
      </td>

      {/* OFFSET */}
      <td
        data-col-key="offset"
        className={`px-4 py-2 font-mono vscode-muted align-middle ${isCellActive('offset') ? 'vscode-cell-active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onCellClick('offset');
        }}
      >
        <VSCodeTextField
          data-edit-key="offset"
          className="w-full font-mono"
          value={toHex(offset as number)}
          onFocus={() => captureEditSnapshot()}
          onInput={(e: Event | React.FormEvent<HTMLElement>) => {
            const val = Number((e.target as HTMLInputElement).value);
            if (!Number.isNaN(val)) {
              onUpdate(['registers', idx, 'address_offset'], val);
            }
          }}
        />
      </td>

      {/* ACCESS */}
      <td
        data-col-key="access"
        className={`px-4 py-2 align-middle ${isCellActive('access') ? 'vscode-cell-active' : ''}`}
        style={{ overflow: 'visible', position: 'relative' }}
        onClick={(e) => {
          e.stopPropagation();
          onCellClick('access');
        }}
      >
        <VSCodeDropdown
          data-edit-key="access"
          className="w-full"
          value={reg.access ?? 'read-write'}
          onFocus={() => captureEditSnapshot()}
          onInput={(e: Event | React.FormEvent<HTMLElement>) =>
            onUpdate(['registers', idx, 'access'], (e.target as HTMLInputElement).value)
          }
        >
          {ACCESS_OPTIONS.map((opt) => (
            <VSCodeOption key={opt} value={opt}>
              {opt}
            </VSCodeOption>
          ))}
        </VSCodeDropdown>
      </td>

      {/* DESCRIPTION */}
      <td
        data-col-key="description"
        className={`px-6 py-2 vscode-muted align-middle ${isCellActive('description') ? 'vscode-cell-active' : ''}`}
        style={{ width: '35%' }}
        onClick={(e) => {
          e.stopPropagation();
          onCellClick('description');
        }}
      >
        <VSCodeTextArea
          data-edit-key="description"
          className="w-full"
          style={{ height: '40px', minHeight: '40px', resize: 'none' }}
          rows={1}
          value={reg.description ?? ''}
          onFocus={() => captureEditSnapshot()}
          onInput={(e: Event | React.FormEvent<HTMLElement>) =>
            onUpdate(['registers', idx, 'description'], (e.target as HTMLTextAreaElement).value)
          }
        />
      </td>
    </tr>
  );
}
