import React from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextArea,
  VSCodeTextField,
} from '@vscode/webview-ui-toolkit/react';
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

interface FieldTableRowProps {
  field: FieldDef;
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
      onClick={() => onRowClick(index)}
      id={`row-${String(field.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '-')}`}
    >
      <>
        <td
          data-col-key="name"
          className={`px-6 py-2 font-medium align-middle ${
            activeCell.rowIndex === index && activeCell.key === 'name' ? 'vscode-cell-active' : ''
          }`}
          onClick={onCellClick(index, 'name')}
        >
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2 h-10">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{
                  backgroundColor: color === 'gray' ? '#e5e7eb' : FIELD_COLORS?.[color] || color,
                }}
              />
              <VSCodeTextField
                data-edit-key="name"
                className="flex-1"
                value={nameValue}
                onFocus={onCellFocus(index, 'name')}
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
            {nameErr ? <div className="text-xs vscode-error mt-1">{nameErr}</div> : null}
          </div>
        </td>

        <td
          data-col-key="bits"
          className={`px-4 py-2 font-mono vscode-muted align-middle ${
            activeCell.rowIndex === index && activeCell.key === 'bits' ? 'vscode-cell-active' : ''
          }`}
          onClick={onCellClick(index, 'bits')}
        >
          <div className="flex items-center h-10">
            <div className="flex flex-col w-full">
              <VSCodeTextField
                data-edit-key="bits"
                className="w-full font-mono"
                value={bitsValue}
                onFocus={onCellFocus(index, 'bits')}
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
                      }
                      return { ...f, bits: next };
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
              {bitsErr ? <div className="text-xs vscode-error mt-1">{bitsErr}</div> : null}
            </div>
          </div>
        </td>

        <td
          data-col-key="access"
          className={`px-4 py-2 align-middle ${
            activeCell.rowIndex === index && activeCell.key === 'access' ? 'vscode-cell-active' : ''
          }`}
          style={{ overflow: 'visible', position: 'relative' }}
          onClick={onCellClick(index, 'access')}
        >
          <div className="flex items-center h-10">
            <VSCodeDropdown
              data-edit-key="access"
              value={field.access ?? 'read-write'}
              className="w-full"
              position="below"
              onFocus={onCellFocus(index, 'access')}
              onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                onUpdate(['fields', index, 'access'], (e.target as HTMLInputElement).value)
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

        <td
          data-col-key="reset"
          className={`px-4 py-2 font-mono vscode-muted align-middle ${
            activeCell.rowIndex === index && activeCell.key === 'reset' ? 'vscode-cell-active' : ''
          }`}
          onClick={onCellClick(index, 'reset')}
        >
          <div className="flex flex-col justify-center h-10">
            <VSCodeTextField
              data-edit-key="reset"
              className="w-full font-mono"
              value={resetValue}
              onFocus={onCellFocus(index, 'reset')}
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
            {resetErr ? <div className="text-xs vscode-error mt-1">{resetErr}</div> : null}
          </div>
        </td>

        <td
          data-col-key="description"
          className={`px-6 py-2 vscode-muted align-middle ${
            activeCell.rowIndex === index && activeCell.key === 'description'
              ? 'vscode-cell-active'
              : ''
          }`}
          style={{ width: '40%', minWidth: '240px' }}
          onClick={onCellClick(index, 'description')}
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
              onFocus={onCellFocus(index, 'description', { initializeDrafts: false })}
              onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                onUpdate(['fields', index, 'description'], (e.target as HTMLInputElement).value)
              }
            />
          </div>
        </td>
      </>
    </tr>
  );
};

export default FieldTableRow;
