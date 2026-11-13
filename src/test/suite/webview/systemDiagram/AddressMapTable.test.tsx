import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { AddressMapTable } from '../../../../webview/systemDiagram/AddressMapTable';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';
import { zynqDiff, zynqGraph, zynqReverseDiff } from './compareFixtures';
import { loadFixtureGraph } from './fixtureGraph';

const props = { filter: null, onSelectInstance: jest.fn(), onReveal: jest.fn() };

describe('AddressMapTable without a comparison', () => {
  it('has the six columns of the design and no sign column', () => {
    const graph = loadFixtureGraph();
    render(<AddressMapTable graph={graph} {...props} />);
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Address space', 'Segment', 'Base', 'Range', 'High', 'Source']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(graph.addressSegments.length);
    for (const row of rows) {
      expect(within(row).getAllByRole('cell')).toHaveLength(6);
      expect(row).toHaveClass('sd-clickable', 'cursor-pointer');
      expect(row.querySelector('.sd-sign')).toBeNull();
      expect(row).not.toHaveAttribute('title');
      expect(row).not.toHaveAttribute('tabindex');
      for (const cell of within(row).getAllByRole('cell')) {
        expect(cell).not.toHaveAttribute('data-changed');
        expect(cell).not.toHaveAttribute('title');
      }
    }
  });
});

describe('AddressMapTable while comparing', () => {
  const base = zynqGraph('base');
  const current = zynqGraph('current');
  const diff = zynqDiff();
  const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

  it('lists signs, marks the changed values with the base, and dims the removed segments', () => {
    props.onSelectInstance.mockClear();
    render(<AddressMapTable graph={current} diff={diff} {...props} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Kind of change',
      'Address space',
      'Segment',
      'Base',
      'Range',
      'High',
      'Source',
    ]);
    const changed = within(rowOf('gpio_block/axi_gpio_1/S_AXI/Reg')).getAllByRole('cell');
    expect(changed[0]).toHaveTextContent('~');
    expect(changed[0].querySelector('.sd-sign')).toHaveAttribute('data-sign', '~');
    expect(changed[3]).toHaveAttribute('data-changed', 'true');
    expect(changed[3]).toHaveAttribute('title', 'Base: 0x4121_0000');
    expect(changed[4]).not.toHaveAttribute('data-changed');
    expect(changed[5]).toHaveAttribute('data-changed', 'true');
    expect(changed[5]).toHaveAttribute('title', 'Base: 0x4121_FFFF');

    const removed = rowOf('axi_gpio_0/S_AXI/Reg');
    expect(within(removed).getAllByRole('cell')[0]).toHaveTextContent('−');
    expect(removed).toHaveClass('opacity-70');
    expect(removed).not.toHaveClass('sd-clickable');
    expect(removed).toHaveAttribute('title', 'Not in this revision');
    expect(within(removed).getAllByRole('cell')[6]).toHaveTextContent('-');
    expect(within(removed).queryByRole('button')).toBeNull();
    fireEvent.click(removed);
    expect(props.onSelectInstance).not.toHaveBeenCalled();
  });

  it('signs an added segment', () => {
    render(<AddressMapTable graph={base} diff={zynqReverseDiff()} {...props} />);
    const added = within(rowOf('axi_gpio_0/S_AXI/Reg')).getAllByRole('cell');
    expect(added[0]).toHaveTextContent('+');
    expect(added[0].querySelector('.sd-sign')).toHaveAttribute('data-sign', '+');
    expect(within(rowOf('axi_gpio_0/S_AXI/Reg')).getByRole('button')).toBeVisible();
  });

  it('selects the slave block of a current row on click', () => {
    props.onSelectInstance.mockClear();
    render(<AddressMapTable graph={current} diff={diff} {...props} />);
    fireEvent.click(rowOf('gpio_block/axi_gpio_1/S_AXI/Reg'));
    expect(props.onSelectInstance).toHaveBeenCalledWith('/gpio_block/axi_gpio_1');
  });

  it('filters the removed rows too', () => {
    const filter = compileSearch('0x41200000', DEFAULT_SEARCH_OPTIONS);
    render(<AddressMapTable graph={current} diff={diff} {...props} filter={filter} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('axi_gpio_0/S_AXI/Reg');
  });

  it('shows the removed segments of a design that has none left', () => {
    render(<AddressMapTable graph={{ ...current, addressSegments: [] }} diff={diff} {...props} />);
    expect(screen.getAllByRole('row')).toHaveLength(
      1 + diff.segments.filter((s) => s.status === 'removed').length
    );
  });
});
