import React from 'react';
import { render } from '@testing-library/react';
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
