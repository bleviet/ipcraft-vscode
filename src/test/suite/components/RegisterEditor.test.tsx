import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RegisterEditor } from '../../../webview/components/register/RegisterEditor';
import type { BitFieldRecord } from '../../../webview/types/editor';

const bitFieldVisualizerMock = jest.fn((props: unknown) => {
  void props;
  return <div data-testid="mock-bitfield-visualizer">BitField</div>;
});

jest.mock('../../../webview/components/BitFieldVisualizer', () => ({
  __esModule: true,
  default: (props: unknown) => bitFieldVisualizerMock(props),
}));

jest.mock('../../../webview/components/register/FieldsTable', () => ({
  FieldsTable: () => <div data-testid="mock-fields-table">FieldsTable</div>,
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
  fields: [{ name: 'enable', bit_range: [0, 0], reset_value: 1 }],
} as unknown as Parameters<typeof RegisterEditor>[0]['register'];

const fields: BitFieldRecord[] = [{ name: 'enable', bit_range: [0, 0], reset_value: 1 }];

const noop = jest.fn();

describe('RegisterEditor layouts', () => {
  beforeEach(() => {
    bitFieldVisualizerMock.mockClear();
    noop.mockClear();
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
});
