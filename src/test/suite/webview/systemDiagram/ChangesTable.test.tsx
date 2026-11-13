import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import { ChangesTable } from '../../../../webview/systemDiagram/ChangesTable';
import type { SystemGraph } from '../../../../domain/systemGraph';
import type { Selection } from '../../../../webview/systemDiagram/model';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';
import { compareOf, emptyDiff, zynqDiff, zynqGraph, zynqReverseDiff } from './compareFixtures';

function renderTable(
  diff = zynqDiff(),
  options: { filter?: string; selection?: Selection | null; graph?: SystemGraph } = {}
) {
  const onSelectInstance = jest.fn();
  const onSelectPort = jest.fn();
  const compare = compareOf(diff);
  render(
    <ChangesTable
      graph={options.graph ?? zynqGraph('current')}
      compare={compare}
      rows={changeRows(diff, { ignoreVersionOnly: false })}
      filter={options.filter ? compileSearch(options.filter, DEFAULT_SEARCH_OPTIONS) : null}
      selection={options.selection ?? null}
      onSelectInstance={onSelectInstance}
      onSelectPort={onSelectPort}
    />
  );
  return { onSelectInstance, onSelectPort };
}

const dataRows = () =>
  screen.queryAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
/** The row about `what` (its What column), the first one or the one whose Change contains `change`. */
const rowOf = (what: string, change = '') =>
  dataRows().find((row) => {
    const cells = within(row).getAllByRole('cell');
    return cells[2].textContent === what && cells[3].textContent.includes(change);
  })!;

describe('ChangesTable', () => {
  it('summarizes the diff and lists a row per change with its columns', () => {
    renderTable();
    expect(
      screen.getByText('4 blocks, 1 port and 3 address segments differ from HEAD.')
    ).toBeVisible();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Kind of change',
      'Where',
      'What',
      'Change',
      'Base',
      'Current',
    ]);
    expect(dataRows()).toHaveLength(12);
    const cells = within(rowOf('sys_ps7')).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '~ Changed',
      '/',
      'sys_ps7',
      'parameter CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ',
      '100',
      '150',
    ]);
    expect(within(rowOf('led_o')).getAllByRole('cell')[1]).toHaveTextContent('External ports');
    expect(
      within(rowOf('sys_ps7/Data', 'gpio_block/axi_gpio_1/S_AXI/Reg')).getAllByRole('cell')[1]
    ).toHaveTextContent('Address map');
    expect(within(rowOf('axi_gpio_1')).getAllByRole('cell')[0]).toHaveTextContent('v Version');
  });

  it('keeps long values whole', () => {
    renderTable();
    expect(rowOf('axis_data_fifo_0', 'added').textContent).toBeDefined();
    expect(screen.getByText('ghost_ctrl/rst_n, sync_0/rst_n_in, sys_rst_n')).toBeVisible();
  });

  it('says so, with no table, when nothing differs', () => {
    renderTable(emptyDiff());
    expect(screen.getByText('No changes compared with HEAD.')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Added' })).not.toBeInTheDocument();
  });

  it('hides the rows of a kind of change with its chip and shows them again', () => {
    renderTable();
    const removed = screen.getByRole('button', { name: 'Removed' });
    expect(removed).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(removed);
    expect(removed).toHaveAttribute('aria-pressed', 'false');
    expect(dataRows()).toHaveLength(6);
    expect(dataRows().every((row) => !row.textContent?.startsWith('− Removed'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Version only' }));
    expect(dataRows()).toHaveLength(5);
    fireEvent.click(removed);
    expect(dataRows()).toHaveLength(11);
  });

  it('shows the no-match text when the chips hide every row', () => {
    renderTable();
    for (const name of ['Added', 'Removed', 'Changed', 'Version only']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(screen.getByText('No rows match the filter.')).toBeVisible();
  });

  it('lists only the rows the panel filter matches', () => {
    renderTable(zynqDiff(), { filter: 'FREQMHZ' });
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0]).toHaveTextContent('sys_ps7');
  });

  it('matches the filter against the kind of change and the level', () => {
    renderTable(zynqDiff(), { filter: 'Version' });
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0]).toHaveTextContent('axi_gpio_1');
  });

  it('says so when the filter matches no row', () => {
    renderTable(zynqDiff(), { filter: 'nothing like this' });
    expect(screen.getByText('No rows match the filter.')).toBeVisible();
  });

  it('selects the block of a row on click and on Enter', () => {
    const { onSelectInstance } = renderTable();
    fireEvent.click(rowOf('sys_ps7'));
    expect(onSelectInstance).toHaveBeenLastCalledWith('/sys_ps7');
    fireEvent.keyDown(rowOf('axi_gpio_1'), { key: 'Enter' });
    expect(onSelectInstance).toHaveBeenLastCalledWith('/gpio_block/axi_gpio_1');
    fireEvent.click(rowOf('axis_data_fifo_0', 'added'));
    expect(onSelectInstance).toHaveBeenLastCalledWith('/axis_data_fifo_0');
  });

  it('selects the external port of a port row', () => {
    const { onSelectPort, onSelectInstance } = renderTable(zynqReverseDiff(), {
      graph: zynqGraph('base'),
    });
    fireEvent.click(rowOf('led_o'));
    expect(onSelectPort).toHaveBeenCalledWith('led_o');
    expect(onSelectInstance).not.toHaveBeenCalled();
  });

  it('does not select anything for what is not in this revision', () => {
    const { onSelectInstance, onSelectPort } = renderTable();
    for (const text of ['axi_gpio_0', 'led_o', 'sys_ps7/Data']) {
      const row = rowOf(text);
      expect(row).toHaveAttribute('title', 'Not in this revision');
      expect(row).not.toHaveAttribute('tabindex');
      fireEvent.click(row);
    }
    expect(onSelectInstance).not.toHaveBeenCalled();
    expect(onSelectPort).not.toHaveBeenCalled();
  });

  it('marks the rows of the selected block', () => {
    renderTable(zynqDiff(), { selection: { kind: 'instance', id: '/sys_ps7' } });
    expect(rowOf('sys_ps7')).toHaveClass('sd-row-selected');
    expect(rowOf('axi_gpio_1')).not.toHaveClass('sd-row-selected');
  });

  it('marks the row of the selected external port', () => {
    renderTable(zynqReverseDiff(), {
      graph: zynqGraph('base'),
      selection: { kind: 'boundary', id: '/::led_o' },
    });
    expect(rowOf('led_o')).toHaveClass('sd-row-selected');
  });

  describe('address segment rows', () => {
    const segmentRow = () => rowOf('sys_ps7/Data', 'gpio_block/axi_gpio_1/S_AXI/Reg');
    const slave = () =>
      zynqGraph('current').addressSegments.find(
        (s) => s.segment === 'gpio_block/axi_gpio_1/S_AXI/Reg'
      )!.slaveInstance;

    it('selects the slave block of a segment that exists in the current revision', () => {
      const { onSelectInstance } = renderTable();
      expect(segmentRow()).not.toHaveAttribute('title');
      fireEvent.click(segmentRow());
      expect(onSelectInstance).toHaveBeenCalledWith(slave());
    });

    it('marks the segment row of the selected slave block', () => {
      renderTable(zynqDiff(), { selection: { kind: 'instance', id: slave() } });
      expect(segmentRow()).toHaveClass('sd-row-selected');
    });

    it('does not select a removed segment, and says it is not in this revision', () => {
      const { onSelectInstance } = renderTable();
      const removed = rowOf('sys_ps7/Data', 'axi_gpio_0/S_AXI/Reg');
      expect(removed).toHaveAttribute('title', 'Not in this revision');
      fireEvent.click(removed);
      expect(onSelectInstance).not.toHaveBeenCalled();
    });

    it('is not clickable, and has no title, when the graph has no slave block for it', () => {
      const graph = zynqGraph('current');
      delete graph.instances[slave()];
      const { onSelectInstance } = renderTable(zynqDiff(), { graph });
      expect(segmentRow()).not.toHaveAttribute('title');
      expect(segmentRow()).not.toHaveAttribute('tabindex');
      fireEvent.click(segmentRow());
      expect(onSelectInstance).not.toHaveBeenCalled();
    });
  });
});
