import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BitFieldVisualizer from '../../../webview/components/BitFieldVisualizer';

describe('BitFieldVisualizer vertical layout', () => {
  it('renders an aligned index label for every bit in a field', () => {
    const { container } = render(
      <BitFieldVisualizer
        fields={[{ name: 'reg1', bitRange: [31, 0], resetValue: 0 }]}
        registerSize={32}
        layout="vertical"
      />
    );

    const labels = Array.from(container.querySelectorAll<HTMLElement>('.bitfield-bit-index'));

    expect(labels).toHaveLength(32);
    expect(labels.map((label) => label.dataset.bitIndex)).toEqual(
      Array.from({ length: 32 }, (_, bit) => bit.toString())
    );
    expect(labels.map((label) => label.textContent)).toEqual(
      Array.from({ length: 32 }, (_, bit) => bit.toString())
    );
  });

  it('renders every bit index across field and gap segments', () => {
    const { container } = render(
      <BitFieldVisualizer
        fields={[
          { name: 'low', bitRange: [1, 0], resetValue: 0 },
          { name: 'high', bitRange: [7, 6], resetValue: 0 },
        ]}
        registerSize={8}
        layout="vertical"
      />
    );

    const labels = Array.from(container.querySelectorAll<HTMLElement>('.bitfield-bit-index'));

    expect(labels.map((label) => Number(label.dataset.bitIndex))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('BitFieldVisualizer field context menu', () => {
  const fields = [
    { name: 'low', bitRange: [1, 0] as [number, number], resetValue: 0 },
    { name: 'high', bitRange: [7, 6] as [number, number], resetValue: 0 },
  ];

  const openMenu = (name: RegExp) => fireEvent.contextMenu(screen.getByRole('button', { name }));

  it('offers Insert Before/After and reports the field index', () => {
    const onInsertField = jest.fn();
    render(
      <BitFieldVisualizer
        fields={fields}
        registerSize={8}
        layout="pro"
        onDeleteField={jest.fn()}
        onInsertField={onInsertField}
      />
    );

    openMenu(/^high bits/);
    fireEvent.click(screen.getByText('Insert Before'));
    expect(onInsertField).toHaveBeenLastCalledWith(1, false);

    openMenu(/^low bits/);
    fireEvent.click(screen.getByText('Insert After'));
    expect(onInsertField).toHaveBeenLastCalledWith(0, true);
    expect(onInsertField).toHaveBeenCalledTimes(2);
  });

  it('shows only Delete without onInsertField', () => {
    render(
      <BitFieldVisualizer fields={fields} registerSize={8} layout="pro" onDeleteField={jest.fn()} />
    );

    openMenu(/^low bits/);
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Insert Before')).toBeNull();
    expect(screen.queryByText('Insert After')).toBeNull();
  });
});

describe('BitFieldVisualizer out-of-range reset values', () => {
  it.each(['vertical', 'pro'] as const)(
    'shows 0x0 for a [2:0] field with resetValue 8 (%s)',
    (layout) => {
      render(
        <BitFieldVisualizer
          fields={[{ name: 'f', bitRange: [2, 0], resetValue: 8 }]}
          registerSize={8}
          layout={layout}
        />
      );
      expect(screen.getAllByText('0x0').length).toBeGreaterThan(0);
      expect(screen.queryByText('0x8')).toBeNull();
    }
  );
});
