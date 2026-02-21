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
}));

jest.mock('../../../webview/hooks/useFieldEditor', () => ({
  useFieldEditor: () => ({
    hoveredFieldIndex: null,
    setHoveredFieldIndex: jest.fn(),
    setDragPreviewRanges: jest.fn(),
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
});
