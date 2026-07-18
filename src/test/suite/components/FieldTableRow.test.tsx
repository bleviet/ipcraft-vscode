import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FieldTableRow from '../../../webview/components/register/FieldTableRow';
import type { FieldDef } from '../../../webview/components/register/FieldsTable';
import { ACCESS_OPTIONS, ACCESS_ABBREVIATIONS } from '../../../webview/shared/constants';
import type { CellInputProps } from '../../../webview/shared/components';

// Mock VectorBoundingInput and (most of) CellInput to simplify testing and
// directly call onInput/onBlur. The 'dropdown' variant is left to delegate
// to the real CellInput (which renders VSCodeDropdown/VSCodeOption, globally
// mocked in test/setup.ts as <select>/<option>) so the access-column tests
// below can assert on real option text/value/data-option-detail rendering.
jest.mock('../../../webview/shared/components', () => {
  const original = jest.requireActual<{ CellInput: React.ComponentType<CellInputProps> }>(
    '../../../webview/shared/components'
  );
  const RealCellInput = original.CellInput;
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
    CellInput: (props: CellInputProps) => {
      if (props.variant === 'dropdown') {
        return <RealCellInput {...props} />;
      }
      const { onInput, onBlur, value, editKey } = props;
      return (
        <input
          data-testid={`cell-input-${editKey}`}
          defaultValue={value}
          onInput={(e) => onInput((e.target as HTMLInputElement).value)}
          onBlur={(e) => onBlur?.((e.target as HTMLInputElement).value)}
        />
      );
    },
  };
});

describe('FieldTableRow bitfields cascading', () => {
  const defaultFieldEditor: any = {
    selectedFieldIndex: 0,
    hoveredFieldIndex: null,
    setHoveredFieldIndex: jest.fn(),
    activeCell: { rowId: 'row-0', key: 'bits' },
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
    expect(errorState['row-0']).toMatch(/overlap|overflow/);
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

  it('detects overlap with fields AFTER edited index (post Ctrl+drag reorder)', () => {
    // After Ctrl+drag, the array may be sorted by offset but the edited field
    // could overlap with a field at a HIGHER index that has a LOWER bit position.
    // This reproduces the EVENTS register scenario:
    //   [UNDERRUN[1:1], OVERRUN[0:0], SRC_ACTIVE[8:8], SRC_TOGGLED[9:9]]
    // Editing SRC_ACTIVE (index 2) to [20:14] must detect overlap with
    // SRC_TOGGLED (index 3, bits [9:9]).
    const fields: FieldDef[] = [
      { name: 'UNDERRUN', bits: '[1:1]', offset: 1, width: 1, bitRange: [1, 1] },
      { name: 'OVERRUN', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
      { name: 'SRC_ACTIVE', bits: '[8:8]', offset: 8, width: 1, bitRange: [8, 8] },
      { name: 'SRC_TOGGLED', bits: '[9:9]', offset: 9, width: 1, bitRange: [9, 9] },
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
        { rowId: 'row-2', model: {} },
        { rowId: 'row-3', model: {} },
      ],
    };

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[2]}
            rowId="row-2"
            index={2}
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
    fireEvent.change(input, { target: { value: '[20:14]' } });

    // The cascade must push SRC_TOGGLED above the edited field's MSB (20),
    // not just above the previous field's MSB.
    expect(onUpdate).toHaveBeenCalled();
    const [, updatedFields] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(updatedFields[2].bits).toBe('[20:14]');
    expect(updatedFields[3].bits).toBe('[21:21]');
  });

  it('cascade tracks max MSB of all positioned fields, not just previous', () => {
    // Fields: A[4:0], B[9:9], C[10:10]. Edit B (index 1) to [12:8].
    // B now overlaps C at [10:10]. The cascade must push C above B's MSB (12).
    const fields: FieldDef[] = [
      { name: 'A', bits: '[4:0]', offset: 0, width: 5, bitRange: [4, 0] },
      { name: 'B', bits: '[9:9]', offset: 9, width: 1, bitRange: [9, 9] },
      { name: 'C', bits: '[10:10]', offset: 10, width: 1, bitRange: [10, 10] },
    ];

    const onUpdate = jest.fn();
    const onCellClick = jest.fn(() => jest.fn());
    const onCellFocus = jest.fn(() => jest.fn());
    const mockFieldEditor = {
      ...defaultFieldEditor,
      wrappedFields: [
        { rowId: 'row-0', model: {} },
        { rowId: 'row-1', model: {} },
        { rowId: 'row-2', model: {} },
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
    fireEvent.change(input, { target: { value: '[12:8]' } });

    // B becomes [12:8], C must be pushed to [13:13] (above maxMSB=12)
    expect(onUpdate).toHaveBeenCalled();
    const [, updatedFields] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(updatedFields[1].bits).toBe('[12:8]');
    expect(updatedFields[2].bits).toBe('[13:13]');
  });

  it('post-cascade check rejects when cascade cannot resolve overlap with lower-bit field at higher index', () => {
    // After Ctrl+drag reorder: [B[8:8], A[0:0], C[9:9]]
    // Edit A (index 1) to [5:3]. B at [8:8] is at index 0 (before A).
    // C at [9:9] is at index 2 (after A), cascade pushes C above maxMSB=5.
    // But B at [8:8] is NOT cascaded (index < 1). No overlap with B.
    // Now test: [B[8:8], C[9:9], A[0:0]]. Edit A (index 2) to [10:5].
    // Pre-cascade check: no fields before index 2 overlap [10:5]? B[8:8] overlaps!
    const fields: FieldDef[] = [
      { name: 'B', bits: '[8:8]', offset: 8, width: 1, bitRange: [8, 8] },
      { name: 'C', bits: '[9:9]', offset: 9, width: 1, bitRange: [9, 9] },
      { name: 'A', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
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
        { rowId: 'row-2', model: {} },
      ],
    };

    render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[2]}
            rowId="row-2"
            index={2}
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
    fireEvent.change(input, { target: { value: '[10:5]' } });

    // Must be rejected: A[10:5] overlaps B[8:8] which is at index < 2
    expect(onUpdate).not.toHaveBeenCalled();
    const lastErrorCall = setBitsErrors.mock.calls[setBitsErrors.mock.calls.length - 1]?.[0] as
      | ((prev: Record<string, string>) => Record<string, string>)
      | undefined;
    expect(lastErrorCall).toBeDefined();
    const errorState = lastErrorCall ? lastErrorCall({}) : {};
    expect(errorState['row-2']).toMatch(/overlap with B/);
  });
});

describe('FieldTableRow access column', () => {
  const defaultFieldEditor: any = {
    selectedFieldIndex: 0,
    hoveredFieldIndex: null,
    setHoveredFieldIndex: jest.fn(),
    activeCell: { rowId: 'row-0', key: 'access' },
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
    ],
  };

  it('renders one option per ACCESS_OPTIONS entry with the token as text and the full enum value/detail', () => {
    const fields: FieldDef[] = [
      {
        name: 'STATUS',
        bits: '[0:0]',
        offset: 0,
        width: 1,
        bitRange: [0, 0],
        access: 'read-write',
      },
    ];
    const onUpdate = jest.fn();

    const { container } = render(
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
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    const select = container.querySelector('select[data-edit-key="access"]') as HTMLSelectElement;
    expect(select).toBeTruthy();

    const optionEls = Array.from(select.querySelectorAll('option'));
    expect(optionEls).toHaveLength(ACCESS_OPTIONS.length);
    for (const opt of ACCESS_OPTIONS) {
      const optionEl = optionEls.find((o) => o.getAttribute('value') === opt);
      expect(optionEl).toBeTruthy();
      expect(optionEl!.textContent).toBe(ACCESS_ABBREVIATIONS[opt]);
      expect(optionEl!.getAttribute('data-option-detail')).toBe(opt);
    }

    fireEvent.change(select, { target: { value: 'write-only' } });
    expect(onUpdate).toHaveBeenCalledWith(['fields', 0, 'access'], 'write-only');
  });

  it('shows the monitor icon button only for W1C access, with no legacy Monitors dropdown', () => {
    const w1cField: FieldDef = {
      name: 'IRQ',
      bits: '[0:0]',
      offset: 0,
      width: 1,
      bitRange: [0, 0],
      access: 'write-1-to-clear',
      monitorChangeOf: 'SRC',
    };
    const srcField: FieldDef = {
      name: 'SRC',
      bits: '[1:1]',
      offset: 1,
      width: 1,
      bitRange: [1, 1],
      access: 'read-write',
    };
    const fields = [w1cField, srcField];

    const { container, rerender } = render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={jest.fn()}
            fieldEditor={defaultFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    // W1C row: monitor button present, and only the access <select> exists
    // (no second Monitors dropdown crammed into the cell).
    expect(container.querySelector('button.codicon-pulse')).toBeTruthy();
    expect(container.querySelectorAll('select')).toHaveLength(1);

    rerender(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[1]}
            rowId="row-1"
            index={1}
            fields={fields}
            registerSize={32}
            onUpdate={jest.fn()}
            fieldEditor={{ ...defaultFieldEditor, activeCell: { rowId: 'row-1', key: 'access' } }}
            onRowClick={jest.fn()}
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    // Non-W1C row: no monitor button.
    expect(container.querySelector('button.codicon-pulse')).toBeFalsy();
    expect(container.querySelectorAll('select')).toHaveLength(1);
  });

  it('opens the monitor picker listing sibling names plus "-- none --", and selecting an item updates monitorChangeOf', () => {
    const fields: FieldDef[] = [
      {
        name: 'IRQ',
        bits: '[0:0]',
        offset: 0,
        width: 1,
        bitRange: [0, 0],
        access: 'write-1-to-clear',
        monitorChangeOf: 'SRC',
      },
      { name: 'SRC', bits: '[1:1]', offset: 1, width: 1, bitRange: [1, 1], access: 'read-write' },
      { name: 'OTHER', bits: '[2:2]', offset: 2, width: 1, bitRange: [2, 2], access: 'read-write' },
    ];
    const onUpdate = jest.fn();

    const { container } = render(
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
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    const button = container.querySelector('button.codicon-pulse') as HTMLButtonElement;
    fireEvent.click(button);

    expect(screen.getByText('-- none --')).toBeInTheDocument();
    expect(screen.getByText('SRC')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();
    // Self is excluded from the sibling list.
    expect(screen.queryByText('IRQ')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('OTHER'));
    expect(onUpdate).toHaveBeenCalledWith(['fields', 0, 'monitorChangeOf'], 'OTHER');

    fireEvent.click(button);
    fireEvent.click(screen.getByText('-- none --'));
    expect(onUpdate).toHaveBeenCalledWith(['fields', 0, 'monitorChangeOf'], null);
  });

  it('clearing access away from W1C also emits a monitorChangeOf: null companion update', () => {
    const fields: FieldDef[] = [
      {
        name: 'IRQ',
        bits: '[0:0]',
        offset: 0,
        width: 1,
        bitRange: [0, 0],
        access: 'write-1-to-clear',
        monitorChangeOf: 'SRC',
      },
    ];
    const onUpdate = jest.fn();

    const { container } = render(
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
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    const select = container.querySelector('select[data-edit-key="access"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'read-write' } });

    expect(onUpdate).toHaveBeenCalledWith(['fields', 0, 'access'], 'read-write');
    expect(onUpdate).toHaveBeenCalledWith(['fields', 0, 'monitorChangeOf'], null);
  });

  it('has no "Double-click to edit" tooltip on the access cell (opens on a single click instead)', () => {
    const fields: FieldDef[] = [
      {
        name: 'STATUS',
        bits: '[0:0]',
        offset: 0,
        width: 1,
        bitRange: [0, 0],
        access: 'read-write',
      },
    ];

    const { container } = render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={jest.fn()}
            fieldEditor={defaultFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={jest.fn(() => jest.fn())}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    const accessTd = container.querySelector('td[data-col-key="access"]') as HTMLTableCellElement;
    expect(accessTd.hasAttribute('data-tooltip')).toBe(false);

    // Other cells are unaffected and keep the default tooltip.
    const nameTd = container.querySelector('td[data-col-key="name"]') as HTMLTableCellElement;
    expect(nameTd.getAttribute('data-tooltip')).toBe('Double-click to edit');
  });

  it('a click on the access dropdown still bubbles to the td and fires the cell-click selection callback', () => {
    const fields: FieldDef[] = [
      {
        name: 'STATUS',
        bits: '[0:0]',
        offset: 0,
        width: 1,
        bitRange: [0, 0],
        access: 'read-write',
      },
    ];
    const accessClickHandler = jest.fn();
    const onCellClick = jest.fn((_index: number, key: string) =>
      key === 'access' ? accessClickHandler : jest.fn()
    );

    const { container } = render(
      <table>
        <tbody>
          <FieldTableRow
            field={fields[0]}
            rowId="row-0"
            index={0}
            fields={fields}
            registerSize={32}
            onUpdate={jest.fn()}
            fieldEditor={defaultFieldEditor}
            onRowClick={jest.fn()}
            onCellClick={onCellClick}
            onCellFocus={jest.fn(() => jest.fn())}
          />
        </tbody>
      </table>
    );

    const select = container.querySelector('select[data-edit-key="access"]') as HTMLSelectElement;
    // Sanity-check the pointer-events fix this cell click depends on.
    expect(select.style.pointerEvents).toBe('auto');

    fireEvent.click(select);

    expect(accessClickHandler).toHaveBeenCalledTimes(1);
  });
});
