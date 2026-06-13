import React from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { VSCodeDropdown, VSCodeOption } from '@vscode/webview-ui-toolkit/react';
import { ACCESS_OPTIONS } from '../../shared/constants';
import { FIELD_COLORS, getFieldColor } from '../../shared/colors';
import { fieldToBitsString, formatBitsRange as formatBits } from '../../utils/BitFieldUtils';
import { validateVhdlIdentifier } from '../../shared/utils/validation';
import {
  parseBitsInput,
  parseBitsWidth,
  parseReset,
  validateBitsString,
  validateResetForField,
} from '../../shared/utils/fieldValidation';
import type { EditKey, FieldEditorState } from '../../hooks/useFieldEditor';
import type { FieldDef } from './FieldsTable';
import { EditableCell, CellInput } from '../../shared/components';

interface FieldTableRowProps {
  field: FieldDef;
  rowId: string;
  index: number;
  fields: FieldDef[];
  registerSize: number;
  onUpdate: YamlUpdateHandler;
  fieldEditor: FieldEditorState;
  onRowClick: (index: number) => void;
  onCellClick: (
    index: number,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => (e: React.MouseEvent<HTMLElement>) => void;
  onCellFocus: (
    index: number,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => () => void;
}

const FieldTableRow = ({
  field,
  rowId,
  index,
  fields,
  registerSize,
  onUpdate,
  fieldEditor,
  onRowClick,
  onCellClick,
  onCellFocus,
}: FieldTableRowProps) => {
  const {
    selectedFieldIndex,
    hoveredFieldIndex,
    setHoveredFieldIndex,
    activeCell,
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
  } = fieldEditor;

  const W1C_ACCESS = new Set(['write-1-to-clear', 'read-write-1-to-clear']);
  const isW1C = W1C_ACCESS.has(field.access ?? '');

  const bits = fieldToBitsString(field);
  const color = getFieldColor(field.name ?? `field${index}`);
  const resetDisplay =
    field.resetValue !== null && field.resetValue !== undefined
      ? `0x${Number(field.resetValue).toString(16).toUpperCase()}`
      : '';

  const nameValue = nameDrafts[rowId] ?? String(field.name ?? '');
  const nameErr = nameErrors[rowId] ?? null;

  const previewRange = dragPreviewRanges[rowId];
  const bitsValue = previewRange
    ? `[${previewRange[0]}:${previewRange[1]}]`
    : (bitsDrafts[rowId] ?? bits);
  const bitsErr = bitsErrors[rowId] ?? null;
  const resetValue = resetDrafts[rowId] ?? (resetDisplay || '0x0');
  const resetErr = resetErrors[rowId] ?? null;

  return (
    <tr
      data-row-id={rowId}
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
      onClick={() => onRowClick(index)}
      id={`row-${String(field.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '-')}`}
    >
      <>
        <EditableCell
          columnKey="name"
          isActive={activeCell.rowId === rowId && activeCell.key === 'name'}
          onCellClick={onCellClick(index, 'name')}
          className="px-6 py-2 font-medium"
        >
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2 h-10">
              <div
                className={`w-2.5 h-2.5 ${field.monitorChangeOf ? 'rounded-full' : 'rounded-sm'} shrink-0`}
                style={{
                  backgroundColor: color === 'gray' ? '#e5e7eb' : FIELD_COLORS?.[color] || color,
                  boxShadow: field.monitorChangeOf
                    ? '0 0 0 1.5px var(--vscode-focusBorder)'
                    : undefined,
                }}
                title={
                  field.monitorChangeOf ? `CoS W1C — monitors: ${field.monitorChangeOf}` : undefined
                }
              />
              <CellInput
                editKey="name"
                className="flex-1"
                value={nameValue}
                onFocus={onCellFocus(index, 'name')}
                cancelEditRef={fieldEditor.cancelEditRef}
                onInput={(value) => {
                  const next = value ?? '';
                  setNameDrafts((prev: Record<string, string>) => ({
                    ...prev,
                    [rowId]: next,
                  }));
                  const err = validateVhdlIdentifier(next);
                  setNameErrors((prev: Record<string, string | null>) => ({
                    ...prev,
                    [rowId]: err,
                  }));
                }}
                onBlur={(value) => {
                  const next = value ?? '';
                  const err = validateVhdlIdentifier(next);
                  if (!err) {
                    onUpdate(['fields', index, 'name'], next.trim());
                  }
                }}
              />
            </div>
            {nameErr ? <div className="text-xs vscode-error mt-1">{nameErr}</div> : null}
          </div>
        </EditableCell>

        <EditableCell
          columnKey="bits"
          isActive={activeCell.rowId === rowId && activeCell.key === 'bits'}
          onCellClick={onCellClick(index, 'bits')}
          className="px-4 py-2 font-mono vscode-muted"
        >
          <div className="flex items-center h-10">
            <div className="flex flex-col w-full">
              <CellInput
                editKey="bits"
                className="w-full font-mono"
                value={bitsValue}
                onFocus={onCellFocus(index, 'bits')}
                cancelEditRef={fieldEditor.cancelEditRef}
                onInput={(value) => {
                  const next = value ?? '';
                  setBitsDrafts((prev: Record<string, string>) => ({
                    ...prev,
                    [rowId]: next,
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
                          const otherRowId = fieldEditor.wrappedFields[i]?.rowId;
                          const b = otherRowId
                            ? (bitsDrafts[otherRowId] ?? fieldToBitsString(fields[i]))
                            : fieldToBitsString(fields[i]);
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

                  setBitsErrors((prev: Record<string, string | null>) => ({
                    ...prev,
                    [rowId]: err,
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
                          offset: parsed.offset,
                          width: parsed.width,
                          bitRange: parsed.bitRange,
                        };
                      }
                      return { ...f, bits: next };
                    });

                    const curr = updatedFields[index];
                    const currMSB = curr.bitRange
                      ? curr.bitRange[0]
                      : Number(curr.offset) + Number(curr.width) - 1;
                    let prevMSB = currMSB;
                    for (let i = index + 1; i < updatedFields.length; ++i) {
                      const f = updatedFields[i];
                      const width = Number(f.width) || 1;
                      const lsb = Number(prevMSB) + 1;
                      const msb = Number(lsb) + width - 1;
                      updatedFields[i] = {
                        ...f,
                        offset: lsb,
                        width: width,
                        bitRange: [msb, lsb],
                        bits: formatBits(msb, lsb),
                      };
                      prevMSB = msb;
                    }
                    onUpdate(['fields'], updatedFields);
                  }
                }}
              />
              {bitsErr ? <div className="text-xs vscode-error mt-1">{bitsErr}</div> : null}
            </div>
          </div>
        </EditableCell>

        <EditableCell
          columnKey="access"
          isActive={activeCell.rowId === rowId && activeCell.key === 'access'}
          onCellClick={onCellClick(index, 'access')}
          className="px-4 py-2"
          style={{ overflow: 'visible', position: 'relative' }}
        >
          <div className="flex flex-col gap-1 py-0.5">
            <div className="flex items-center h-10">
              <CellInput
                editKey="access"
                variant="dropdown"
                value={field.access ?? 'read-write'}
                className="w-full"
                options={ACCESS_OPTIONS}
                onFocus={onCellFocus(index, 'access')}
                cancelEditRef={fieldEditor.cancelEditRef}
                onInput={(value) => {
                  const next = value;
                  onUpdate(['fields', index, 'access'], next);
                  if (!W1C_ACCESS.has(next)) {
                    onUpdate(['fields', index, 'monitorChangeOf'], null);
                  }
                }}
              />
            </div>
            {isW1C && (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] vscode-muted whitespace-nowrap shrink-0">
                  Monitors:
                </span>
                <VSCodeDropdown
                  value={String(field.monitorChangeOf ?? '')}
                  className="flex-1"
                  position="below"
                  onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                    const val = (e.target as HTMLInputElement).value;
                    onUpdate(['fields', index, 'monitorChangeOf'], val || null);
                  }}
                >
                  <VSCodeOption value="">— none —</VSCodeOption>
                  {fields
                    .filter((f, i) => i !== index && f.name)
                    .map((f) => (
                      <VSCodeOption key={String(f.name)} value={String(f.name)}>
                        {String(f.name)}
                      </VSCodeOption>
                    ))}
                </VSCodeDropdown>
              </div>
            )}
          </div>
        </EditableCell>

        <EditableCell
          columnKey="reset"
          isActive={activeCell.rowId === rowId && activeCell.key === 'reset'}
          onCellClick={onCellClick(index, 'reset')}
          className="px-4 py-2 font-mono vscode-muted"
        >
          <div className="flex flex-col justify-center h-10">
            <CellInput
              editKey="reset"
              className="w-full font-mono"
              value={resetValue}
              onFocus={onCellFocus(index, 'reset')}
              cancelEditRef={fieldEditor.cancelEditRef}
              onInput={(value) => {
                const raw = value ?? '';
                setResetDrafts((prev: Record<string, string>) => ({
                  ...prev,
                  [rowId]: raw,
                }));

                const trimmed = raw.trim();
                if (!trimmed) {
                  setResetErrors((prev: Record<string, string | null>) => ({
                    ...prev,
                    [rowId]: null,
                  }));
                  onUpdate(['fields', index, 'resetValue'], null);
                  return;
                }

                const parsed = parseReset(raw);
                const err = validateResetForField(field, parsed);
                setResetErrors((prev: Record<string, string | null>) => ({
                  ...prev,
                  [rowId]: err,
                }));
                if (!err && parsed !== null) {
                  onUpdate(['fields', index, 'resetValue'], parsed);
                }
              }}
            />
            {resetErr ? <div className="text-xs vscode-error mt-1">{resetErr}</div> : null}
          </div>
        </EditableCell>

        <EditableCell
          columnKey="description"
          isActive={activeCell.rowId === rowId && activeCell.key === 'description'}
          onCellClick={onCellClick(index, 'description')}
          className="px-6 py-2 vscode-muted"
          style={{ width: '40%', minWidth: '240px' }}
        >
          <div className="flex items-center h-10">
            <CellInput
              editKey="description"
              variant="textarea"
              className="w-full"
              style={{
                height: '40px',
                minHeight: '40px',
                resize: 'none',
              }}
              value={field.description ?? ''}
              onFocus={onCellFocus(index, 'description', { initializeDrafts: false })}
              cancelEditRef={fieldEditor.cancelEditRef}
              onInput={(value) => onUpdate(['fields', index, 'description'], value)}
              onBlur={(value) => onUpdate(['fields', index, 'description'], value)}
            />
          </div>
        </EditableCell>
      </>
    </tr>
  );
};

export default FieldTableRow;
