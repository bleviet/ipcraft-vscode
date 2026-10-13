import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RegisterEditor } from '../../../webview/components/register/RegisterEditor';
import { toArrayElementSelectionObject } from '../../../webview/utils/arrayElementSelection';
import type { BitFieldRecord } from '../../../webview/types/editor';
import { VersionContextProvider } from '../../../webview/hooks/useVersionContext';
import { VersionRefIssuesProvider } from '../../../webview/hooks/useVersionRefIssuesContext';
import type { VersionContext } from '../../../shared/versioning/versionContext';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';
import { normalizeMemoryMap } from '../../../domain/parse';

let mockDebugMode = false;
jest.mock('../../../webview/hooks/useDebugMode', () => ({
  useDebugMode: () => ({ debugMode: mockDebugMode, toggleDebugMode: jest.fn() }),
}));

const bitFieldVisualizerMock = jest.fn((props: unknown) => {
  void props;
  return <div data-testid="mock-bitfield-visualizer">BitField</div>;
});

jest.mock('../../../webview/components/BitFieldVisualizer', () => ({
  __esModule: true,
  default: (props: unknown) => bitFieldVisualizerMock(props),
}));

jest.mock('../../../webview/components/register/FieldsTable', () => ({
  FieldsTable: ({
    valueBar,
    fieldIssues,
  }: {
    valueBar?: React.ReactNode;
    fieldIssues?: Map<number, { message: string }[]>;
  }) => (
    <div data-testid="mock-fields-table">
      FieldsTable
      {valueBar}
      {[...(fieldIssues?.values() ?? [])].flat().map((issue) => (
        <div key={issue.message} data-testid="mock-field-issue">
          {issue.message}
        </div>
      ))}
    </div>
  ),
}));

jest.mock('../../../webview/shared/components', () => ({
  KeyboardShortcutsButton: () => <div data-testid="mock-shortcuts-button">Shortcuts</div>,
  EditorHeader: ({
    title,
    layout,
    onToggleLayout,
    children,
  }: {
    title: string;
    layout: string;
    onToggleLayout: () => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="mock-editor-header">
      {title}
      <button
        aria-label="Toggle register layout"
        title={layout === 'stacked' ? 'Switch to side-by-side layout' : 'Switch to stacked layout'}
        onClick={onToggleLayout}
      />
      {children}
    </div>
  ),
  TwoPanelEditorLayout: ({
    header,
    visualizer,
    table,
    footer,
    layout,
  }: {
    header: React.ReactNode;
    visualizer: React.ReactNode;
    table: React.ReactNode;
    footer?: React.ReactNode;
    layout: string;
  }) => (
    <div data-testid="mock-two-panel-layout">
      {header}
      {layout === 'side-by-side' ? (
        <div className="register-visualizer-pane">{visualizer}</div>
      ) : (
        visualizer
      )}
      {table}
      {footer}
    </div>
  ),
}));

const setDragPreviewRanges = jest.fn();

jest.mock('../../../webview/hooks/useFieldEditor', () => ({
  useFieldEditor: () => ({
    wrappedFields: [
      { rowId: 'row-RUN', model: { name: 'RUN' } },
      { rowId: 'row-STOP', model: { name: 'STOP_ON_ERR' } },
    ],
    hoveredFieldIndex: null,
    setHoveredFieldIndex: jest.fn(),
    setDragPreviewRanges,
    setBitsDrafts: jest.fn(),
    focusRef: { current: null },
  }),
}));

const register = {
  name: 'CTRL',
  description: 'Control register',
  size: 32,
  fields: [{ name: 'enable', bitRange: [0, 0], resetValue: 1 }],
} as unknown as Parameters<typeof RegisterEditor>[0]['register'];

const fields: BitFieldRecord[] = [{ name: 'enable', bitRange: [0, 0], resetValue: 1 }];

const noop = jest.fn();

describe('RegisterEditor layouts', () => {
  beforeEach(() => {
    bitFieldVisualizerMock.mockClear();
    noop.mockClear();
    mockDebugMode = false;
  });

  it('renders side-by-side mode with vertical visualizer layout', () => {
    const toggle = jest.fn();
    const { container } = render(
      <RegisterEditor
        register={register}
        fields={fields}
        registerLayout="side-by-side"
        toggleRegisterLayout={toggle}
        onUpdate={noop}
      />
    );

    expect(screen.getByTestId('mock-fields-table')).toBeInTheDocument();
    expect(container.querySelector('.register-visualizer-pane')).toBeTruthy();

    expect(bitFieldVisualizerMock).toHaveBeenCalled();
    const latestCall = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as { layout?: string };
    expect(latestCall.layout).toBe('vertical');
    expect(screen.getByTitle('Switch to stacked layout')).toBeInTheDocument();
  });

  it('renders a title override and header children (flat register array reuse)', () => {
    render(
      <RegisterEditor
        register={register}
        fields={fields}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={noop}
        title="CH_GAIN"
        headerChildren={<div data-testid="array-dimensions">count/stride</div>}
        footerContext="array"
      />
    );

    const header = screen.getByTestId('mock-editor-header');
    expect(header).toHaveTextContent('CH_GAIN');
    expect(header).not.toHaveTextContent('CTRL');
    expect(screen.getByTestId('array-dimensions')).toBeInTheDocument();
    // The bit-field editor itself is still rendered for the array template.
    expect(screen.getByTestId('mock-fields-table')).toBeInTheDocument();
    expect(bitFieldVisualizerMock).toHaveBeenCalled();
  });

  it('renders stacked mode with pro visualizer layout', () => {
    const toggle = jest.fn();
    render(
      <RegisterEditor
        register={register}
        fields={fields}
        registerLayout="stacked"
        toggleRegisterLayout={toggle}
        onUpdate={noop}
      />
    );

    expect(bitFieldVisualizerMock).toHaveBeenCalled();
    const latestCall = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as { layout?: string };
    expect(latestCall.layout).toBe('pro');
    expect(screen.getByTitle('Switch to side-by-side layout')).toBeInTheDocument();
  });

  it('calls toggleRegisterLayout when toggle button is clicked', () => {
    const toggle = jest.fn();
    render(
      <RegisterEditor
        register={register}
        fields={fields}
        registerLayout="side-by-side"
        toggleRegisterLayout={toggle}
        onUpdate={noop}
      />
    );

    fireEvent.click(screen.getByLabelText('Toggle register layout'));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('keeps bitRange in sync with bits/offset/width when committing a ctrl-drag reorder', () => {
    // After a ctrl-drag commit the field objects must carry a bitRange that
    // matches the new offset/width. The FieldTableRow cascade/overlap logic
    // treats bitRange as authoritative when present, so a stale bitRange
    // (pointing at the old position) silently corrupts later offset edits.
    bitFieldVisualizerMock.mockClear();
    const onUpdate = jest.fn();
    const dragFields: BitFieldRecord[] = [
      { name: 'A', bits: '[2:0]', offset: 0, width: 3, bitRange: [2, 0] },
      { name: 'B', bits: '[7:4]', offset: 4, width: 4, bitRange: [7, 4] },
    ];

    render(
      <RegisterEditor
        register={register}
        fields={dragFields}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={onUpdate}
      />
    );

    const props = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as {
      onBatchUpdateFields?: (updates: { idx: number; range: [number, number] }[]) => void;
      onUpdateFieldRange?: (idx: number, range: [number, number]) => void;
    };

    // Simulate moving A from [2:0] to [6:4] and B from [7:4] to [3:0].
    props.onBatchUpdateFields!([
      { idx: 0, range: [6, 4] },
      { idx: 1, range: [3, 0] },
    ]);

    const [, committed] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1] as [
      unknown,
      BitFieldRecord[],
    ];
    for (const f of committed) {
      const offset = Number(f.offset);
      const width = Number(f.width);
      expect(f.bitRange).toEqual([offset + width - 1, offset]);
      expect(f.bits).toBe(`[${offset + width - 1}:${offset}]`);
    }

    // The single-field range commit path must also stay in sync.
    onUpdate.mockClear();
    props.onUpdateFieldRange!(0, [9, 8]);
    const [, single] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1] as [
      unknown,
      BitFieldRecord[],
    ];
    const moved = single.find((f) => f.name === 'A')!;
    expect(moved.bitRange).toEqual([9, 8]);
    expect(moved.offset).toBe(8);
    expect(moved.width).toBe(2);
    expect(moved.bits).toBe('[9:8]');
  });

  it.each([
    [8, 0],
    [0xd, 5],
  ])('masks resetValue %i to %i when a field is shrunk to [2:0]', (reset, expected) => {
    bitFieldVisualizerMock.mockClear();
    const onUpdate = jest.fn();
    const shrinkFields: BitFieldRecord[] = [
      { name: 'f', bits: '[3:0]', offset: 0, width: 4, bitRange: [3, 0], resetValue: reset },
    ];

    render(
      <RegisterEditor
        register={register}
        fields={shrinkFields}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={onUpdate}
      />
    );

    const props = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as {
      onBatchUpdateFields?: (updates: { idx: number; range: [number, number] }[]) => void;
      onUpdateFieldRange?: (idx: number, range: [number, number]) => void;
    };

    props.onUpdateFieldRange!(0, [2, 0]);
    let committed = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1] as BitFieldRecord[];
    expect(committed[0].resetValue).toBe(expected);

    onUpdate.mockClear();
    props.onBatchUpdateFields!([{ idx: 0, range: [2, 0] }]);
    committed = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1] as BitFieldRecord[];
    expect(committed[0].resetValue).toBe(expected);
  });

  it('re-sorts fields by bit position after a single-field range commit', () => {
    // A single-field drag/resize commit must keep the fields array sorted by
    // bit position. FieldTableRow's cascade treats array index as bit order;
    // an unsorted array makes it cascade the wrong fields and overflow the
    // register (the "CLEAR_STATS [10:5] -> MSB 32 >= 32" bug).
    bitFieldVisualizerMock.mockClear();
    const onUpdate = jest.fn();
    const dragFields: BitFieldRecord[] = [
      { name: 'LOW', bits: '[2:0]', offset: 0, width: 3, bitRange: [2, 0] },
      { name: 'HIGH', bits: '[7:4]', offset: 4, width: 4, bitRange: [7, 4] },
    ];

    render(
      <RegisterEditor
        register={register}
        fields={dragFields}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={onUpdate}
      />
    );

    const props = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as {
      onUpdateFieldRange?: (idx: number, range: [number, number]) => void;
    };

    // Move LOW (index 0) above HIGH: [2:0] -> [11:9]. The array must come back
    // ordered by offset, so HIGH (offset 4) precedes LOW (offset 9).
    props.onUpdateFieldRange!(0, [11, 9]);

    const [, committed] = onUpdate.mock.calls[onUpdate.mock.calls.length - 1] as [
      unknown,
      BitFieldRecord[],
    ];
    expect(committed.map((f) => f.name)).toEqual(['HIGH', 'LOW']);
    expect(committed.map((f) => f.offset)).toEqual([4, 9]);
  });

  it('maps onDragPreview idx entries to rowId keys so the field table can show the preview', () => {
    // The preview produced by computeCtrlDragPreview is keyed by field array
    // index (idx). The table looks up dragPreviewRanges by rowId, so the
    // onDragPreview handler in RegisterEditor must translate idx -> rowId;
    // otherwise the preview is invisible and stale bitsDrafts leak through.
    bitFieldVisualizerMock.mockClear();
    setDragPreviewRanges.mockClear();
    render(
      <RegisterEditor
        register={register}
        fields={fields}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={noop}
      />
    );

    const latestProps = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as {
      onDragPreview?: (preview: { idx: number; range: [number, number] }[] | null) => void;
    };
    expect(typeof latestProps.onDragPreview).toBe('function');

    latestProps.onDragPreview!(null);
    expect(setDragPreviewRanges).toHaveBeenLastCalledWith({});

    latestProps.onDragPreview!([
      { idx: 0, range: [1, 1] },
      { idx: 1, range: [0, 0] },
    ]);
    expect(setDragPreviewRanges).toHaveBeenLastCalledWith({
      'row-RUN': [1, 1],
      'row-STOP': [0, 0],
    });
  });

  it('keeps a >53-bit debug-mode value on an offset/width field instead of reverting it', () => {
    // Regression test: `normalisedFields` used to apply the bigint debug
    // override only in the fallback branch, but offset/width fields (the
    // common case) return early with the un-overridden resetValue, so the
    // committed value silently reverted on the very next render.
    mockDebugMode = true;
    bitFieldVisualizerMock.mockClear();
    const offsetWidthFields: BitFieldRecord[] = [
      { name: 'WIDE', offset: 0, width: 64, resetValue: 0 },
    ];

    render(
      <RegisterEditor
        register={{ ...register, size: 64 }}
        fields={offsetWidthFields}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={noop}
      />
    );

    const props = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as {
      onUpdateFieldReset?: (fieldIndex: number, value: number | bigint | null) => void;
    };

    const bigValue = BigInt('0xFEDCBA9876543210');
    act(() => props.onUpdateFieldReset!(0, bigValue));

    const latestFields = bitFieldVisualizerMock.mock.calls[
      bitFieldVisualizerMock.mock.calls.length - 1
    ]?.[0] as { fields: BitFieldRecord[] };
    expect(latestFields.fields[0].resetValue).toBe(bigValue);
  });
});

describe('RegisterEditor register value storage', () => {
  const fieldlessRegister = {
    name: 'NO_FIELDS',
    size: 32,
  } as unknown as Parameters<typeof RegisterEditor>[0]['register'];

  beforeEach(() => {
    mockDebugMode = false;
  });

  function renderFieldless(onUpdate: jest.Mock, overrides?: Partial<{ resetValue: number }>) {
    render(
      <RegisterEditor
        register={{ ...fieldlessRegister, ...overrides }}
        fields={[]}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={onUpdate}
      />
    );
    return screen.getByLabelText<HTMLInputElement>('Register value (hex)');
  }

  it('shows the register resetValue when there are no bit fields to compose it from', () => {
    const input = renderFieldless(jest.fn(), { resetValue: 0xa5a5 });
    expect(input.value).toBe('0000A5A5');
  });

  it('commits a value to the register resetValue when there are no bit fields', () => {
    const onUpdate = jest.fn();
    const input = renderFieldless(onUpdate);

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '0000A5A5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onUpdate).toHaveBeenCalledWith(['resetValue'], 0xa5a5);
  });

  it('keeps a fieldless register value out of the document in Debug Mode', () => {
    // Debug Mode explores values without ever writing the .mm.yml (issue #39).
    mockDebugMode = true;
    const onUpdate = jest.fn();
    const input = renderFieldless(onUpdate);

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '0000A5A5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>('Register value (hex)').value).toBe('0000A5A5');
  });

  it('rejects a value whose set bits no field covers instead of writing part of it', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterEditor
        register={register}
        fields={[{ name: 'LOW', bits: '[3:0]', offset: 0, width: 4, bitRange: [3, 0] }]}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={onUpdate}
      />
    );
    const input = screen.getByLabelText<HTMLInputElement>('Register value (hex)');

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '0000A5A5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/Bits 31:4 are not covered by a bit field/)).toBeTruthy();
  });

  it('commits a value that fits the covered bits', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterEditor
        register={register}
        fields={[{ name: 'LOW', bits: '[3:0]', offset: 0, width: 4, bitRange: [3, 0] }]}
        registerLayout="stacked"
        toggleRegisterLayout={jest.fn()}
        onUpdate={onUpdate}
      />
    );
    const input = screen.getByLabelText<HTMLInputElement>('Register value (hex)');

    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '00000005' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onUpdate).toHaveBeenCalledWith(['fields', 0, 'resetValue'], 5);
  });
});

describe('RegisterEditor $version references', () => {
  const resolved: VersionContext = {
    status: 'resolved',
    versionScheme: 'major.minor.patch',
    version: '1.4.2',
  };
  const reg32 = { name: 'VERSION', size: 32 } as unknown as RegisterProp;

  type RegisterProp = Parameters<typeof RegisterEditor>[0]['register'];

  const majorField: BitFieldRecord = {
    name: 'MAJOR',
    bits: '[23:16]',
    offset: 16,
    width: 8,
    bitRange: [23, 16],
    resetValue: 0,
    versionRef: '$version.major',
  };
  const lowField: BitFieldRecord = {
    name: 'LOW',
    bits: '[7:0]',
    offset: 0,
    width: 8,
    bitRange: [7, 0],
    resetValue: 0,
  };

  function renderEditor(options: {
    register?: RegisterProp;
    fields: BitFieldRecord[];
    context?: VersionContext;
    onUpdate?: jest.Mock;
    memoryMap?: NormalizedMemoryMap;
    issueSource?: object;
  }) {
    const onUpdate = options.onUpdate ?? jest.fn();
    render(
      <VersionContextProvider>
        <VersionRefIssuesProvider memoryMap={options.memoryMap ?? null}>
          <RegisterEditor
            register={options.register ?? reg32}
            issueSource={options.issueSource}
            fields={options.fields}
            registerLayout="stacked"
            toggleRegisterLayout={jest.fn()}
            onUpdate={onUpdate}
          />
        </VersionRefIssuesProvider>
      </VersionContextProvider>
    );
    if (options.context) {
      const context = options.context;
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'versionContext', context } })
        );
      });
    }
    return onUpdate;
  }

  const latestVisualizerProps = () =>
    bitFieldVisualizerMock.mock.calls[bitFieldVisualizerMock.mock.calls.length - 1]?.[0] as {
      fields: BitFieldRecord[];
      onUpdateFieldReset: (fieldIndex: number, value: number | bigint | null) => void;
    };

  function commitValue(text: string) {
    const input = screen.getByLabelText<HTMLInputElement>('Register value (hex)');
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    return input;
  }

  beforeEach(() => {
    bitFieldVisualizerMock.mockClear();
    mockDebugMode = false;
  });

  it('hands the visualizer the resolved value of a token field', () => {
    renderEditor({ fields: [majorField, lowField], context: resolved });
    expect(latestVisualizerProps().fields[0].resetValue).toBe(1);
    expect(screen.getByLabelText<HTMLInputElement>('Register value (hex)').value).toBe('00010000');
  });

  it('reads an unresolved token field as 0', () => {
    renderEditor({ fields: [majorField, lowField] });
    expect(latestVisualizerProps().fields[0].resetValue).toBe(0);
  });

  it('ignores a bit click on a token field', () => {
    const onUpdate = renderEditor({ fields: [majorField, lowField], context: resolved });
    act(() => latestVisualizerProps().onUpdateFieldReset(0, 3));
    expect(onUpdate).not.toHaveBeenCalled();
    act(() => latestVisualizerProps().onUpdateFieldReset(1, 3));
    expect(onUpdate).toHaveBeenCalledWith(['fields', 1, 'resetValue'], 3);
  });

  it('keeps a Debug Mode bit click on a token field local', () => {
    mockDebugMode = true;
    const onUpdate = renderEditor({ fields: [majorField, lowField], context: resolved });
    act(() => latestVisualizerProps().onUpdateFieldReset(0, 3));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(latestVisualizerProps().fields[0].resetValue).toBe(3);
  });

  it('writes only the plain fields when the value bar keeps the token bits', () => {
    const onUpdate = renderEditor({ fields: [majorField, lowField], context: resolved });
    commitValue('000100A5');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['fields', 1, 'resetValue'], 0xa5);
  });

  it('rejects a value that changes the bits of a token field', () => {
    const onUpdate = renderEditor({ fields: [majorField, lowField], context: resolved });
    commitValue('000200A5');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Bits 23:16 hold $version.major (0x01)')).toBeTruthy();
  });

  it('commits $version on a fieldless register in one update', () => {
    const onUpdate = renderEditor({ fields: [] });
    commitValue('$version');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['resetValue'], '$version');
  });

  it('shows the packed version and a hint for a fieldless $version register', () => {
    const onUpdate = renderEditor({
      register: { ...reg32, versionRef: '$version' },
      fields: [],
      context: resolved,
    });
    expect(screen.getByLabelText<HTMLInputElement>('Register value (hex)').value).toBe('00010402');
    expect(screen.getByText('= $version')).toBeTruthy();

    // Re-committing the displayed value must not turn the token into a number.
    commitValue('00010402');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('replaces the token with a number typed later, in one update', () => {
    const onUpdate = renderEditor({
      register: { ...reg32, versionRef: '$version' },
      fields: [],
      context: resolved,
    });
    commitValue('000000FF');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['resetValue'], 0xff);
  });

  it('does not show Invalid number while $version is being typed', () => {
    renderEditor({ fields: [] });
    const input = screen.getByLabelText<HTMLInputElement>('Register value (hex)');
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '$ver' } });
    });
    expect(screen.queryByText('Invalid number')).toBeNull();
    act(() => {
      fireEvent.change(input, { target: { value: '$verx' } });
    });
    expect(screen.getByText('Invalid number')).toBeTruthy();
  });

  it('rejects $version on a register with bit fields', () => {
    const onUpdate = renderEditor({ fields: [lowField] });
    commitValue('$version');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Use $version.* on the bit fields')).toBeTruthy();
  });

  it('refuses $version in Debug Mode', () => {
    mockDebugMode = true;
    const onUpdate = renderEditor({ fields: [] });
    commitValue('$version');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Version references cannot be set in Debug Mode')).toBeTruthy();
  });

  it('lists the diagnostics of the underlying array for a flat-array element copy', () => {
    const map = normalizeMemoryMap({
      name: 'm',
      addressBlocks: [
        {
          name: 'B',
          registers: [
            {
              name: 'CH',
              count: 4,
              stride: 4,
              fields: [{ name: 'F', bits: '[7:0]', resetValue: '$version.major' }],
            },
          ],
        },
      ],
    });
    const array = map.addressBlocks[0].registers[0];
    const element = toArrayElementSelectionObject(array, 1, 0x44);
    const props = {
      fields: array.fields as unknown as BitFieldRecord[],
      memoryMap: map,
    };

    // Without the source the copy matches nothing in the map.
    renderEditor({ ...props, register: element as unknown as RegisterProp });
    expect(screen.queryByTestId('mock-field-issue')).toBeNull();
    cleanup();

    renderEditor({
      ...props,
      register: element as unknown as RegisterProp,
      issueSource: element.__element_source,
    });
    expect(screen.getByTestId('mock-field-issue')).toHaveTextContent(
      'Version references are not supported in register arrays'
    );
  });

  it('lists the register-level diagnostics above the table', () => {
    const map = normalizeMemoryMap({
      name: 'm',
      addressBlocks: [
        {
          name: 'B',
          registers: [
            {
              name: 'VERSION',
              resetValue: '$version',
              fields: [{ name: 'F', bits: '[7:0]' }],
            },
          ],
        },
      ],
    });
    const mapRegister = map.addressBlocks[0].registers[0];
    renderEditor({
      register: mapRegister as unknown as RegisterProp,
      fields: mapRegister.fields as unknown as BitFieldRecord[],
      memoryMap: map,
    });
    const list = screen.getByTestId('version-issues');
    expect(list).toHaveTextContent('Use $version.* on the fields instead of a register-level');
    expect(list.querySelector('[data-severity="error"]')).toBeTruthy();
  });
});
