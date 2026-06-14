/* eslint-disable @typescript-eslint/no-unsafe-return */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FieldTableRow from '../../../webview/components/register/FieldTableRow';
import type { FieldDef } from '../../../webview/components/register/FieldsTable';

// Mock VectorBoundingInput to simplify testing and directly call onInput/onBlur
jest.mock('../../../webview/shared/components', () => {
  const original = jest.requireActual('../../../webview/shared/components');
  return {
    ...original,
    VectorBoundingInput: ({
      onInput,
      onBlur,
      value,
    }: {
      onInput: (v: string) => void;
      onBlur?: (v: string) => void;
      value: string;
    }) => (
      <input
        data-testid="vector-bounding-input"
        defaultValue={value}
        onChange={(e) => onInput(e.target.value)}
        onBlur={(e) => onBlur?.(e.target.value)}
      />
    ),
    CellInput: ({
      onInput,
      onBlur,
      value,
      editKey,
    }: {
      onInput: (v: string) => void;
      onBlur?: (v: string) => void;
      value: string;
      editKey: string;
    }) => (
      <input
        data-testid={`cell-input-${editKey}`}
        defaultValue={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onBlur={(e) => onBlur?.((e.target as HTMLInputElement).value)}
      />
    ),
  };
});

describe('FieldTableRow bitfields cascading', () => {
  const defaultFieldEditor: any = {
    selectedFieldIndex: 0,
    hoveredFieldIndex: null,
    setHoveredFieldIndex: jest.fn(),
    activeCell: { rowId: 'row-0', key: 'bits' },
    nameDrafts: {},
    setNameDrafts: jest.fn(),
    nameErrors: {},
    setNameErrors: jest.fn(),
    bitsDrafts: {},
    setBitsDrafts: jest.fn(),
    bitsErrors: {},
    setBitsErrors: jest.fn(),
    dragPreviewRanges: {},
    resetDrafts: {},
    setResetDrafts: jest.fn(),
    resetErrors: {},
    setResetErrors: jest.fn(),
    wrappedFields: [
      { rowId: 'row-0', model: {} },
      { rowId: 'row-1', model: {} },
      { rowId: 'row-2', model: {} },
      { rowId: 'row-3', model: {} },
    ],
  };

  it('cascades bit ranges correctly by shifting only overlapping fields and preserving gaps', () => {
    const fields: FieldDef[] = [
      { name: 'RUN', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
      { name: 'STOP_ON_ERR', bits: '[1:1]', offset: 1, width: 1, bitRange: [1, 1] },
      { name: 'LOG_LEVEL', bits: '[7:4]', offset: 4, width: 4, bitRange: [7, 4] },
      { name: 'CLEAR_STATS', bits: '[31:31]', offset: 31, width: 1, bitRange: [31, 31] },
    ];

    const onUpdate = jest.fn();
    const onCellClick = jest.fn(() => jest.fn());
    const onCellFocus = jest.fn(() => jest.fn());

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={onUpdate}
            fieldEditor={defaultFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={onCellClick}
            onCellFocus={onCellFocus}
          />
        </tbody>
      </table>
    );

    // Trigger update of RUN from [0:0] to [1:0]
    const input = screen.getByTestId('vector-bounding-input');
    fireEvent.change(input, { target: { value: '[1:0]' } });

    // Live cascade: change alone commits at least once
    expect(onUpdate).toHaveBeenCalled();
    const [path, updatedFields] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(path).toEqual(['fields']);

    // RUN should be [1:0]
    expect(updatedFields[0].bits).toBe('[1:0]');
    // STOP_ON_ERR should be shifted to [2:2] (overlaps with RUN [1:0])
    expect(updatedFields[1].bits).toBe('[2:2]');
    // LOG_LEVEL should remain [7:4] (no overlap with [2:2])
    expect(updatedFields[2].bits).toBe('[7:4]');
    // CLEAR_STATS should remain [31:31] (no overlap with [7:4])
    expect(updatedFields[3].bits).toBe('[31:31]');

    // bitsDrafts for cascaded fields must be updated immediately so their
    // VectorBoundingInput displays the new position without waiting for the
    // document round-trip (prevents the "RUN[9:0] / STOP_ON_ERR[13:7]"
    // visual overlap scenario).
    const setBitsDraftsCalls = (defaultFieldEditor.setBitsDrafts as jest.Mock).mock.calls as [
      unknown,
    ][][];
    type DraftsUpdater = (p: Record<string, string>) => Record<string, string>;
    const cascadeCall = setBitsDraftsCalls
      .map((c) => c[0] as DraftsUpdater | unknown)
      .find((updater): updater is DraftsUpdater => {
        if (typeof updater !== 'function') {
          return false;
        }
        const result = (updater as DraftsUpdater)({});
        return 'row-1' in result;
      });
    expect(cascadeCall).toBeDefined();
    const cascadeState = cascadeCall ? cascadeCall({}) : {};
    expect(cascadeState['row-1']).toBe('[2:2]');
  });

  it('prevents saving and raises validation error when cascade shifts fields beyond register size limit', () => {
    const fields: FieldDef[] = [
      { name: 'LOG_LEVEL', bits: '[30:28]', offset: 28, width: 3, bitRange: [30, 28] },
      { name: 'CLEAR_STATS', bits: '[31:31]', offset: 31, width: 1, bitRange: [31, 31] },
    ];

    const onUpdate = jest.fn();
    const onCellClick = jest.fn(() => jest.fn());
    const onCellFocus = jest.fn(() => jest.fn());

    const setBitsErrors = jest.fn();
    const mockFieldEditor = {
      ...defaultFieldEditor,
      setBitsErrors,
      wrappedFields: [
        { rowId: 'row-0', model: {} },
        { rowId: 'row-1', model: {} },
      ],
    };

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={onUpdate}
            fieldEditor={mockFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={onCellClick}
            onCellFocus={onCellFocus}
          />
        </tbody>
      </table>
    );

    const input = screen.getByTestId('vector-bounding-input');
    fireEvent.change(input, { target: { value: '[31:29]' } });
    fireEvent.blur(input);

    expect(onUpdate).not.toHaveBeenCalled();

    expect(setBitsErrors).toHaveBeenCalled();
    const latestErrorUpdate = setBitsErrors.mock.calls[
      setBitsErrors.mock.calls.length - 1
    ]?.[0] as (prev: Record<string, string>) => Record<string, string>;
    const errorState = latestErrorUpdate({});
    expect(errorState['row-0']).toContain('overflow register boundary');
  });

  it('commits complex expression via CellInput fallback without strict validation', () => {
    const fields: FieldDef[] = [
      { name: 'DATA', bits: '[AxiDataWidth_g-1:0]', offset: null, width: null, bitRange: null },
    ];

    const onUpdate = jest.fn();
    const onCellClick = jest.fn(() => jest.fn());
    const onCellFocus = jest.fn(() => jest.fn());

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={onUpdate}
            fieldEditor={defaultFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={onCellClick}
            onCellFocus={onCellFocus}
          />
        </tbody>
      </table>
    );

    const input = screen.getByTestId('cell-input-bits');
    fireEvent.input(input, { target: { value: '[AxiDataWidth_g-1:8]' } });
    fireEvent.blur(input, { target: { value: '[AxiDataWidth_g-1:8]' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0]).toEqual(['fields', 0, 'bits']);
    expect(onUpdate.mock.calls[0][1]).toBe('[AxiDataWidth_g-1:8]');
  });

  it('does not show validation errors for partial placeholder drafts like [?:?]', () => {
    const fields: FieldDef[] = [
      { name: 'RUN', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
    ];

    const setBitsErrors = jest.fn();
    const mockFieldEditor = {
      ...defaultFieldEditor,
      setBitsErrors,
      wrappedFields: [{ rowId: 'row-0', model: {} }],
    };

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={jest.fn()}
            fieldEditor={mockFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    const input = screen.getByTestId('vector-bounding-input');
    fireEvent.change(input, { target: { value: '[?:8]' } });

    const lastErrorCall = setBitsErrors.mock.calls[setBitsErrors.mock.calls.length - 1]?.[0] as
      | ((prev: Record<string, string>) => Record<string, string>)
      | undefined;
    const errorState = lastErrorCall ? lastErrorCall({}) : {};
    expect(errorState['row-0']).toBeNull();
  });

  it('cascades bit ranges live during typing without waiting for blur (CONTROL register scenario)', () => {
    // Reproduces the CONTROL register scenario from
    // ipcraft-spec/examples/comprehensive_avalon/comprehensive_avalon.mm.yml:
    // RUN [0:0] -> [1:0] should push STOP_ON_ERR [1:1] -> [2:2] immediately.
    const fields: FieldDef[] = [
      { name: 'RUN', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
      { name: 'STOP_ON_ERR', bits: '[1:1]', offset: 1, width: 1, bitRange: [1, 1] },
      { name: 'LOG_LEVEL', bits: '[7:4]', offset: 4, width: 4, bitRange: [7, 4] },
      { name: 'CLEAR_STATS', bits: '[31:31]', offset: 31, width: 1, bitRange: [31, 31] },
    ];

    const onUpdate = jest.fn();
    const onCellClick = jest.fn(() => jest.fn());
    const onCellFocus = jest.fn(() => jest.fn());

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={onUpdate}
            fieldEditor={defaultFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={onCellClick}
            onCellFocus={onCellFocus}
          />
        </tbody>
      </table>
    );

    const input = screen.getByTestId('vector-bounding-input');

    // Simulate typing '1' into MSB (changes RUN from [0:0] to [1:0]).
    // Live cascade means the commit fires during typing, not on blur.
    onUpdate.mockClear();
    fireEvent.change(input, { target: { value: '[1:0]' } });

    // Cascade should have fired on the change event alone, without waiting for blur.
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    const [path, updatedFields] = lastCall;
    expect(path).toEqual(['fields']);

    // RUN becomes [1:0]
    expect(updatedFields[0].bits).toBe('[1:0]');
    // STOP_ON_ERR is pushed to [2:2] (the ascending field was pushed further)
    expect(updatedFields[1].bits).toBe('[2:2]');
    // LOG_LEVEL and CLEAR_STATS are preserved (no overlap)
    expect(updatedFields[2].bits).toBe('[7:4]');
    expect(updatedFields[3].bits).toBe('[31:31]');
  });

  it('rejects change that would overlap a lower-index field (cascade only shifts forward)', () => {
    // RUN [0:0], STOP_ON_ERR [1:1]. Changing STOP_ON_ERR to [1:0] would overlap
    // RUN at bit 0. The cascade only shifts higher-index fields, so this must
    // be rejected outright.
    const fields: FieldDef[] = [
      { name: 'RUN', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
      { name: 'STOP_ON_ERR', bits: '[1:1]', offset: 1, width: 1, bitRange: [1, 1] },
    ];

    const onUpdate = jest.fn();
    const setBitsErrors = jest.fn();
    const onCellClick = jest.fn(() => jest.fn());
    const onCellFocus = jest.fn(() => jest.fn());
    const mockFieldEditor = {
      ...defaultFieldEditor,
      setBitsErrors,
      wrappedFields: [
        { rowId: 'row-0', model: {} },
        { rowId: 'row-1', model: {} },
      ],
    };

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[1]}
            rowId="row-1"
            index={1}
            fields={fields}
            registerSize={32}
            onUpdate={onUpdate}
            fieldEditor={mockFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={onCellClick}
            onCellFocus={onCellFocus}
          />
        </tbody>
      </table>
    );

    const input = screen.getByTestId('vector-bounding-input');
    fireEvent.change(input, { target: { value: '[1:0]' } });

    // The change must be rejected — onUpdate must not have been called.
    expect(onUpdate).not.toHaveBeenCalled();

    // An overlap error must have been set.
    const lastErrorCall = setBitsErrors.mock.calls[setBitsErrors.mock.calls.length - 1]?.[0] as
      | ((prev: Record<string, string>) => Record<string, string>)
      | undefined;
    expect(lastErrorCall).toBeDefined();
    const errorState = lastErrorCall ? lastErrorCall({}) : {};
    expect(errorState['row-1']).toMatch(/overlap with RUN/);
  });
});
