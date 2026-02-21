import React from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextField,
  VSCodeTextArea,
} from '@vscode/webview-ui-toolkit/react';
import { EditableTable } from '../../shared/components';
import { ACCESS_OPTIONS } from '../../shared/constants';
import { FIELD_COLORS, getFieldColor } from '../../shared/colors';
import { formatBitsRange as formatBits, fieldToBitsString } from '../../utils/BitFieldUtils';
import { validateVhdlIdentifier } from '../../shared/utils/validation';
import type { FieldEditorState } from '../../hooks/useFieldEditor';

export interface FieldDef {
  name?: string | null;
  bits?: string | null;
  bit_offset?: number | null;
  bit_width?: number | null;
  bit_range?: [number, number] | null;
  access?: string | null;
  reset_value?: number | null;
  description?: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_TABLE_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'bits', header: 'Bit(s)' },
  { key: 'access', header: 'Access' },
  { key: 'reset', header: 'Reset' },
  { key: 'description', header: 'Description' },
];

// ---------------------------------------------------------------------------
// Validation helpers (register-editor utilities)
// ---------------------------------------------------------------------------

/** Returns the width represented by "[N:M]" or "[N]" strings. */
function parseBitsWidth(bits: string): number | null {
  const match = bits.trim().match(/^\[(\d+)(?::(\d+))?\]$/);
  if (!match) {
    return null;
  }
  const n = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : n;
  return Math.abs(n - m) + 1;
}

/** Returns an error message for an invalid bits string, or null if valid. */
function validateBitsString(bits: string): string | null {
  const trimmed = bits.trim();
  if (!/^\[\d+(?::\d+)?\]$/.test(trimmed)) {
    return 'Format must be [N:M] or [N]';
  }
  const match = trimmed.match(/\[(\d+)(?::(\d+))?\]/);
  if (!match) {
    return 'Invalid format';
  }
  const n = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : n;
  if (n < 0 || m < 0) {
    return 'Bit indices must be >= 0';
  }
  if (n < m) {
    return 'MSB must be >= LSB';
  }
  return null;
}

/** Parses a bit string like "[7:4]" or "[3]" into {bit_offset, bit_width, bit_range}. */
function parseBitsInput(text: string) {
  const trimmed = text.trim().replace(/[\[\]]/g, '');
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(':').map((p) => Number(p.trim()));
  if (parts.some((p) => Number.isNaN(p))) {
    return null;
  }
  let msb: number;
  let lsb: number;
  if (parts.length === 1) {
    msb = parts[0];
    lsb = parts[0];
  } else {
    [msb, lsb] = parts as [number, number];
  }
  if (!Number.isFinite(msb) || !Number.isFinite(lsb)) {
    return null;
  }
  if (msb < lsb) {
    const tmp = msb;
    msb = lsb;
    lsb = tmp;
  }
  return {
    bit_offset: lsb,
    bit_width: msb - lsb + 1,
    bit_range: [msb, lsb] as [number, number],
  };
}

/** Parses a hex or decimal string to a number, or returns null. */
function parseReset(text: string): number | null {
  const s = text.trim();
  if (!s) {
    return null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function getFieldBitWidth(f: FieldDef): number {
  const w = Number(f?.bit_width);
  if (Number.isFinite(w) && w > 0) {
    return w;
  }
  const br = f?.bit_range;
  if (Array.isArray(br) && br.length === 2) {
    const msb = Number(br[0]);
    const lsb = Number(br[1]);
    if (Number.isFinite(msb) && Number.isFinite(lsb)) {
      return Math.abs(msb - lsb) + 1;
    }
  }
  return 1;
}

function validateResetForField(f: FieldDef, value: number | null): string | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return 'Invalid number';
  }
  if (value < 0) {
    return 'Reset must be >= 0';
  }
  const width = getFieldBitWidth(f);
  const max = width >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, width) - 1;
  if (value > max) {
    return `Reset too large for ${width} bit(s)`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldsTableProps {
  /** Normalised bit fields for the current register. */
  fields: FieldDef[];
  /** Register width in bits (used for overflow validation). */
  registerSize: number;
  /** Callback to commit a YAML path + value change. */
  onUpdate: YamlUpdateHandler;
  /** All editing state from the useFieldEditor hook. */
  fieldEditor: FieldEditorState;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the editable bit fields table for a register, including the
 * move-up/move-down toolbar.
 * Delegates insertion/deletion/editing to the useFieldEditor hook state.
 */
export function FieldsTable({ fields, registerSize, onUpdate, fieldEditor }: FieldsTableProps) {
  const {
    selectedFieldIndex,
    setSelectedFieldIndex,
    hoveredFieldIndex,
    setHoveredFieldIndex,
    setSelectedEditKey,
    activeCell,
    setActiveCell,
    nameDrafts,
    setNameDrafts,
    nameErrors,
    setNameErrors,
    bitsDrafts,
    setBitsDrafts,
    bitsErrors,
    setBitsErrors,
    dragPreviewRanges,
    resetDrafts,
    setResetDrafts,
    resetErrors,
    setResetErrors,
    insertError,
    focusRef,
    errorRef,
    ensureDraftsInitialized,
    moveSelectedField,
  } = fieldEditor;

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <div className="flex-1 vscode-surface border-r vscode-border min-h-0 flex flex-col">
        {/* Toolbar: move up / move down */}
        <div className="shrink-0 px-4 py-2 border-b vscode-border vscode-surface flex items-center justify-end gap-1">
          <button
            className="p-2 rounded-md transition-colors disabled:opacity-40 vscode-icon-button"
            onClick={() => moveSelectedField(-1)}
            disabled={selectedFieldIndex <= 0}
            title="Move field up"
            type="button"
          >
            <span className="codicon codicon-chevron-up"></span>
          </button>
          <button
            className="p-2 rounded-md transition-colors disabled:opacity-40 vscode-icon-button"
            onClick={() => moveSelectedField(1)}
            disabled={selectedFieldIndex < 0 || selectedFieldIndex >= fields.length - 1}
            title="Move field down"
            type="button"
          >
            <span className="codicon codicon-chevron-down"></span>
          </button>
        </div>

        {/* Scrollable table */}
        <div
          ref={focusRef}
          tabIndex={0}
          data-fields-table="true"
          className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
          style={{ overflowY: 'auto', overflowX: 'auto' }}
        >
          {insertError ? (
            <div ref={errorRef} className="vscode-error px-4 py-2 text-xs">
              {insertError}
            </div>
          ) : null}

          <EditableTable
            rows={fields}
            columns={FIELD_TABLE_COLUMNS}
            showHeaderSection={false}
            showTableBorder={false}
            containerClassName=""
            tableWrapperClassName=""
            tableClassName="w-full text-left border-collapse table-fixed"
            renderTableContent={() => (
              <>
                <colgroup>
                  <col className="w-[18%] min-w-[120px]" />
                  <col className="w-[14%] min-w-[100px]" />
                  <col className="w-[14%] min-w-[120px]" />
                  <col className="w-[14%] min-w-[110px]" />
                  <col className="w-[40%] min-w-[240px]" />
                </colgroup>
                <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                  <tr className="h-12">
                    <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Bit(s)</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Access</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Reset</th>
                    <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y vscode-border text-sm">
                  {fields.map((field, index) => {
                    const bits = fieldToBitsString(field);
                    const color = getFieldColor(field.name ?? `field${index}`);
                    const resetDisplay =
                      field.reset_value !== null && field.reset_value !== undefined
                        ? `0x${Number(field.reset_value).toString(16).toUpperCase()}`
                        : '';

                    const fieldKey = field?.name ? `${String(field.name)}` : `index-${index}`;
                    const nameValue = nameDrafts[fieldKey] ?? String(field.name ?? '');
                    const nameErr = nameErrors[fieldKey] ?? null;

                    const previewRange = dragPreviewRanges[index];
                    const bitsValue = previewRange
                      ? `[${previewRange[0]}:${previewRange[1]}]`
                      : (bitsDrafts[index] ?? bits);
                    const bitsErr = bitsErrors[index] ?? null;
                    const resetValue = resetDrafts[index] ?? (resetDisplay || '0x0');
                    const resetErr = resetErrors[index] ?? null;

                    return (
                      <tr
                        key={`${String(field.name ?? `field-${index}`)}-${String(field.bit_offset ?? bits ?? index)}`}
                        data-row-idx={index}
                        data-field-index={index}
                        className={`group vscode-row-solid transition-colors border-l-4 border-transparent h-12 ${
                          index === selectedFieldIndex
                            ? 'vscode-focus-border vscode-row-selected'
                            : index === hoveredFieldIndex
                              ? 'vscode-focus-border vscode-row-hover'
                              : ''
                        }`}
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setHoveredFieldIndex(index)}
                        onMouseLeave={() => setHoveredFieldIndex(null)}
                        onClick={() => {
                          setSelectedFieldIndex(index);
                          setHoveredFieldIndex(index);
                          setActiveCell((prev) => ({ rowIndex: index, key: prev.key }));
                          ensureDraftsInitialized(index);
                        }}
                        id={`row-${String(field.name ?? '')
                          .toLowerCase()
                          .replace(/[^a-z0-9_]/g, '-')}`}
                      >
                        <>
                          {/* NAME */}
                          <td
                            data-col-key="name"
                            className={`px-6 py-2 font-medium align-middle ${
                              activeCell.rowIndex === index && activeCell.key === 'name'
                                ? 'vscode-cell-active'
                                : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              ensureDraftsInitialized(index);
                              setSelectedFieldIndex(index);
                              setHoveredFieldIndex(index);
                              setSelectedEditKey('name');
                              setActiveCell({ rowIndex: index, key: 'name' });
                            }}
                          >
                            <div className="flex flex-col justify-center">
                              <div className="flex items-center gap-2 h-10">
                                <div
                                  className="w-2.5 h-2.5 rounded-sm"
                                  style={{
                                    backgroundColor:
                                      color === 'gray' ? '#e5e7eb' : FIELD_COLORS?.[color] || color,
                                  }}
                                />
                                <VSCodeTextField
                                  data-edit-key="name"
                                  className="flex-1"
                                  value={nameValue}
                                  onFocus={() => {
                                    ensureDraftsInitialized(index);
                                    setSelectedFieldIndex(index);
                                    setHoveredFieldIndex(index);
                                    setSelectedEditKey('name');
                                    setActiveCell({ rowIndex: index, key: 'name' });
                                  }}
                                  onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                                    const next = String((e.target as HTMLInputElement).value ?? '');
                                    setNameDrafts((prev) => ({
                                      ...prev,
                                      [fieldKey]: next,
                                    }));
                                    const err = validateVhdlIdentifier(next);
                                    setNameErrors((prev) => ({
                                      ...prev,
                                      [fieldKey]: err,
                                    }));
                                  }}
                                  onBlur={(e: Event | React.FocusEvent<HTMLElement>) => {
                                    const next = String((e.target as HTMLInputElement).value ?? '');
                                    const err = validateVhdlIdentifier(next);
                                    if (!err) {
                                      onUpdate(['fields', index, 'name'], next.trim());
                                    }
                                  }}
                                />
                              </div>
                              {nameErr ? (
                                <div className="text-xs vscode-error mt-1">{nameErr}</div>
                              ) : null}
                            </div>
                          </td>

                          {/* BITS */}
                          <td
                            data-col-key="bits"
                            className={`px-4 py-2 font-mono vscode-muted align-middle ${
                              activeCell.rowIndex === index && activeCell.key === 'bits'
                                ? 'vscode-cell-active'
                                : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              ensureDraftsInitialized(index);
                              setSelectedFieldIndex(index);
                              setHoveredFieldIndex(index);
                              setSelectedEditKey('bits');
                              setActiveCell({ rowIndex: index, key: 'bits' });
                            }}
                          >
                            <div className="flex items-center h-10">
                              <div className="flex flex-col w-full">
                                <VSCodeTextField
                                  data-edit-key="bits"
                                  className="w-full font-mono"
                                  value={bitsValue}
                                  onFocus={() => {
                                    ensureDraftsInitialized(index);
                                    setSelectedFieldIndex(index);
                                    setHoveredFieldIndex(index);
                                    setSelectedEditKey('bits');
                                    setActiveCell({ rowIndex: index, key: 'bits' });
                                  }}
                                  onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                                    const next = String((e.target as HTMLInputElement).value ?? '');
                                    setBitsDrafts((prev) => ({
                                      ...prev,
                                      [index]: next,
                                    }));
                                    let err = validateBitsString(next);
                                    if (!err) {
                                      const thisWidth = parseBitsWidth(next);
                                      if (thisWidth !== null) {
                                        let total = 0;
                                        for (let i = 0; i < fields.length; ++i) {
                                          if (i === index) {
                                            total += thisWidth;
                                          } else {
                                            const b = bitsDrafts[i] ?? fieldToBitsString(fields[i]);
                                            const w = parseBitsWidth(b);
                                            if (w) {
                                              total += w;
                                            }
                                          }
                                        }
                                        if (total > registerSize) {
                                          err = `Bit fields overflow register (${total} > ${registerSize})`;
                                        }
                                      }
                                    }
                                    setBitsErrors((prev) => ({
                                      ...prev,
                                      [index]: err,
                                    }));
                                    if (!err) {
                                      const updatedFields = fields.map((f, i) => {
                                        if (i !== index) {
                                          return { ...f };
                                        }
                                        const parsed = parseBitsInput(next);
                                        if (parsed) {
                                          return {
                                            ...f,
                                            bits: next,
                                            bit_offset: parsed.bit_offset,
                                            bit_width: parsed.bit_width,
                                            bit_range: parsed.bit_range,
                                          };
                                        } else {
                                          return { ...f, bits: next };
                                        }
                                      });
                                      const curr = updatedFields[index];
                                      const currMSB = curr.bit_range
                                        ? curr.bit_range[0]
                                        : Number(curr.bit_offset) + Number(curr.bit_width) - 1;
                                      let prevMSB = currMSB;
                                      for (let i = index + 1; i < updatedFields.length; ++i) {
                                        const f = updatedFields[i];
                                        const width = Number(f.bit_width) || 1;
                                        const lsb = Number(prevMSB) + 1;
                                        const msb = Number(lsb) + width - 1;
                                        updatedFields[i] = {
                                          ...f,
                                          bit_offset: lsb,
                                          bit_width: width,
                                          bit_range: [msb, lsb],
                                          bits: formatBits(msb, lsb),
                                        };
                                        prevMSB = msb;
                                      }
                                      onUpdate(['fields'], updatedFields);
                                    }
                                  }}
                                />
                                {bitsErr ? (
                                  <div className="text-xs vscode-error mt-1">{bitsErr}</div>
                                ) : null}
                              </div>
                            </div>
                          </td>

                          {/* ACCESS */}
                          <td
                            data-col-key="access"
                            className={`px-4 py-2 align-middle ${
                              activeCell.rowIndex === index && activeCell.key === 'access'
                                ? 'vscode-cell-active'
                                : ''
                            }`}
                            style={{ overflow: 'visible', position: 'relative' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              ensureDraftsInitialized(index);
                              setSelectedFieldIndex(index);
                              setHoveredFieldIndex(index);
                              setSelectedEditKey('access');
                              setActiveCell({ rowIndex: index, key: 'access' });
                            }}
                          >
                            <div className="flex items-center h-10">
                              <VSCodeDropdown
                                data-edit-key="access"
                                value={field.access ?? 'read-write'}
                                className="w-full"
                                position="below"
                                onFocus={() => {
                                  setSelectedFieldIndex(index);
                                  setHoveredFieldIndex(index);
                                  setSelectedEditKey('access');
                                  setActiveCell({ rowIndex: index, key: 'access' });
                                }}
                                onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                                  onUpdate(
                                    ['fields', index, 'access'],
                                    (e.target as HTMLInputElement).value
                                  )
                                }
                              >
                                {ACCESS_OPTIONS.map((opt) => (
                                  <VSCodeOption key={opt} value={opt}>
                                    {opt}
                                  </VSCodeOption>
                                ))}
                              </VSCodeDropdown>
                            </div>
                          </td>

                          {/* RESET */}
                          <td
                            data-col-key="reset"
                            className={`px-4 py-2 font-mono vscode-muted align-middle ${
                              activeCell.rowIndex === index && activeCell.key === 'reset'
                                ? 'vscode-cell-active'
                                : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              ensureDraftsInitialized(index);
                              setSelectedFieldIndex(index);
                              setHoveredFieldIndex(index);
                              setSelectedEditKey('reset');
                              setActiveCell({ rowIndex: index, key: 'reset' });
                            }}
                          >
                            <div className="flex flex-col justify-center h-10">
                              <VSCodeTextField
                                data-edit-key="reset"
                                className="w-full font-mono"
                                value={resetValue}
                                onFocus={() => {
                                  ensureDraftsInitialized(index);
                                  setSelectedFieldIndex(index);
                                  setHoveredFieldIndex(index);
                                  setSelectedEditKey('reset');
                                  setActiveCell({ rowIndex: index, key: 'reset' });
                                }}
                                onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                                  const raw = String((e.target as HTMLInputElement).value ?? '');
                                  setResetDrafts((prev) => ({
                                    ...prev,
                                    [index]: raw,
                                  }));
                                  const trimmed = raw.trim();
                                  if (!trimmed) {
                                    setResetErrors((prev) => ({
                                      ...prev,
                                      [index]: null,
                                    }));
                                    onUpdate(['fields', index, 'reset_value'], null);
                                    return;
                                  }
                                  const parsed = parseReset(raw);
                                  const err = validateResetForField(field, parsed);
                                  setResetErrors((prev) => ({
                                    ...prev,
                                    [index]: err,
                                  }));
                                  if (!err && parsed !== null) {
                                    onUpdate(['fields', index, 'reset_value'], parsed);
                                  }
                                }}
                              />
                              {resetErr ? (
                                <div className="text-xs vscode-error mt-1">{resetErr}</div>
                              ) : null}
                            </div>
                          </td>

                          {/* DESCRIPTION */}
                          <td
                            data-col-key="description"
                            className={`px-6 py-2 vscode-muted align-middle ${
                              activeCell.rowIndex === index && activeCell.key === 'description'
                                ? 'vscode-cell-active'
                                : ''
                            }`}
                            style={{ width: '40%', minWidth: '240px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              ensureDraftsInitialized(index);
                              setSelectedFieldIndex(index);
                              setHoveredFieldIndex(index);
                              setSelectedEditKey('description');
                              setActiveCell({ rowIndex: index, key: 'description' });
                            }}
                          >
                            <div className="flex items-center h-10">
                              <VSCodeTextArea
                                data-edit-key="description"
                                className="w-full"
                                style={{
                                  height: '40px',
                                  minHeight: '40px',
                                  resize: 'none',
                                }}
                                rows={1}
                                value={field.description ?? ''}
                                onFocus={() => {
                                  setSelectedFieldIndex(index);
                                  setHoveredFieldIndex(index);
                                  setSelectedEditKey('description');
                                  setActiveCell({
                                    rowIndex: index,
                                    key: 'description',
                                  });
                                }}
                                onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                                  onUpdate(
                                    ['fields', index, 'description'],
                                    (e.target as HTMLInputElement).value
                                  )
                                }
                              />
                            </div>
                          </td>
                        </>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
          />
        </div>
      </div>
    </div>
  );
}
