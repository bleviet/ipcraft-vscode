/**
 * Outline panel — register/array color swatches and the array count/stride
 * inline-edit badge (relocated from RegisterArrayEditor's removed dimensions
 * header, see the array-header follow-up on issue #99).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Outline from '../../../webview/components/OutlinePanel';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';

function makeMemoryMap(): NormalizedMemoryMap {
  return {
    name: 'CSR_MAP',
    addressBlocks: [
      {
        name: 'GLOBAL_REGS',
        baseAddress: 0,
        usage: 'register',
        registers: [
          { name: 'GLOBAL_CTRL', offset: 0, fields: [] },
          {
            __kind: 'array',
            name: 'CHANNEL',
            offset: 0x400,
            count: 4,
            stride: 16,
            registers: [{ name: 'CTRL', offset: 0, fields: [] }],
          },
        ],
      },
    ],
  } as unknown as NormalizedMemoryMap;
}

const noop = jest.fn();

describe('Outline — register/array color swatches', () => {
  it('renders a color swatch for a top-level register row', () => {
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={noop} />
    );
    const row = screen.getByText('GLOBAL_CTRL').closest('[data-outline-id]') as HTMLElement;
    const swatch = row.querySelector('span[style*="background-color"]');
    expect(swatch).not.toBeNull();
  });

  it('renders a color swatch for an array row', () => {
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={noop} />
    );
    const row = screen.getByText('CHANNEL').closest('[data-outline-id]') as HTMLElement;
    const swatch = row.querySelector('span[style*="background-color"]');
    expect(swatch).not.toBeNull();
  });

  it('gives a register and an array with the same name the same swatch color (name-hash based)', () => {
    const mm = makeMemoryMap();
    // Rename the array to match the register's name for this test only.
    mm.addressBlocks[0].registers[1].name = 'GLOBAL_CTRL';
    render(<Outline memoryMap={mm} selectedId={null} onSelect={noop} onRename={noop} />);
    const rows = screen.getAllByText('GLOBAL_CTRL');
    const swatchColors = rows.map((el) => {
      const swatch = el
        .closest('[data-outline-id]')
        ?.querySelector<HTMLElement>('span[style*="background-color"]');
      return swatch?.style.backgroundColor;
    });
    expect(swatchColors[0]).toBeTruthy();
    expect(swatchColors[0]).toBe(swatchColors[1]);
  });
});

describe('Outline — array count/stride inline edit', () => {
  it('shows the count and stride as read-only text by default', () => {
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={noop} />
    );
    expect(screen.getByText('×')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('16B')).toBeInTheDocument();
  });

  it('double-clicking the count commits a new value via onRename', () => {
    const onRename = jest.fn();
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={onRename} />
    );
    fireEvent.doubleClick(screen.getByText('4'));
    const input = document.querySelector('input.outline-inline-edit') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith(['addressBlocks', 0, 'registers', 1, 'count'], 8);
  });

  it('double-clicking the stride commits a new value via onRename', () => {
    const onRename = jest.fn();
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={onRename} />
    );
    fireEvent.doubleClick(screen.getByText('16B'));
    const input = document.querySelector('input.outline-inline-edit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '32' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(['addressBlocks', 0, 'registers', 1, 'stride'], 32);
  });

  it('Escape cancels without committing', () => {
    const onRename = jest.fn();
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={onRename} />
    );
    fireEvent.doubleClick(screen.getByText('4'));
    const input = document.querySelector('input.outline-inline-edit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('does not commit a non-numeric or zero value', () => {
    const onRename = jest.fn();
    render(
      <Outline memoryMap={makeMemoryMap()} selectedId={null} onSelect={noop} onRename={onRename} />
    );
    fireEvent.doubleClick(screen.getByText('4'));
    const input = document.querySelector('input.outline-inline-edit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });
});
