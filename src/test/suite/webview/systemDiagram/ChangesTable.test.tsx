import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  options: {
    filter?: string;
    selection?: Selection | null;
    graph?: SystemGraph;
    canSwap?: boolean;
  } = {}
) {
  const onSelectInstance = jest.fn();
  const onSelectPort = jest.fn();
  const onSwapCompare = jest.fn();
  const compare = compareOf(diff, 'HEAD', { canSwap: options.canSwap });
  render(
    <ChangesTable
      graph={options.graph ?? zynqGraph('current')}
      compare={compare}
      rows={changeRows(diff, { ignoreVersionOnly: false })}
      filter={options.filter ? compileSearch(options.filter, DEFAULT_SEARCH_OPTIONS) : null}
      selection={options.selection ?? null}
      onSelectInstance={onSelectInstance}
      onSelectPort={onSelectPort}
      onSwapCompare={onSwapCompare}
    />
  );
  return { onSelectInstance, onSelectPort, onSwapCompare };
}

const dataRows = () =>
  screen.queryAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
/** The address row of the segment `segment` of the space sys_ps7/Data. */
const addressRow = (segment: string) =>
  dataRows().find(
    (row) => within(row).getAllByRole('cell')[2].textContent === `sys_ps7/Data → ${segment}`
  )!;
/** The row about `what` (its What column), the first one or the one whose Change contains `change`. */
const rowOf = (what: string, change = '') =>
  dataRows().find((row) => {
    const cells = within(row).getAllByRole('cell');
    return cells[2].textContent === what && cells[3].textContent.includes(change);
  })!;

describe('ChangesTable', () => {
  it('summarizes the diff and lists a row per change with its columns', () => {
    renderTable();
    expect(screen.getByText('4 blocks, 1 port and 3 address segments differ.')).toBeVisible();
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
      within(addressRow('gpio_block/axi_gpio_1/S_AXI/Reg')).getAllByRole('cell')[1]
    ).toHaveTextContent('Address map');
    expect(within(rowOf('axi_gpio_1')).getAllByRole('cell')[0]).toHaveTextContent('v Version');
  });

  it('says which side is which, with the file names short and the full labels as titles', () => {
    renderTable();
    const direction = screen.getByRole('group', { name: 'Direction of the comparison' });
    expect(direction).toHaveTextContent('Base HEAD → Current current.bd');
    expect(within(direction).getByText('HEAD')).toHaveAttribute('title', 'HEAD');
    expect(within(direction).getByText('current.bd')).toHaveAttribute('title', 'sys/current.bd');
    expect(screen.getByRole('columnheader', { name: 'Base' })).toHaveAttribute('title', 'HEAD');
    expect(screen.getByRole('columnheader', { name: 'Current' })).toHaveAttribute(
      'title',
      'sys/current.bd'
    );
  });

  it('keeps the direction, the summary and the chips in one bar, the chips saying what they mean', () => {
    renderTable(zynqDiff(), { canSwap: true });
    const bar = screen.getByRole('group', { name: 'Direction of the comparison' }).parentElement!;
    expect(bar).toHaveClass('sd-ubar');
    expect(within(bar).getByRole('button', { name: 'Swap' })).toBeVisible();
    expect(within(bar).getByText('4 blocks, 1 port and 3 address segments differ.')).toBeVisible();
    const chips = within(bar)
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'));
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute('title')])).toEqual([
      ['+ Added', 'Only in current'],
      ['− Removed', 'Only in base'],
      ['~ Changed', 'In both, but different'],
      ['v Version only', 'Only the IP version differs'],
    ]);
    expect(screen.queryByText(/only in current ·/)).not.toBeInTheDocument();
  });

  it('cuts a long label in the middle and keeps the full one as the title', () => {
    const long = `${'a'.repeat(40)}.1.bd`;
    const diff = zynqDiff();
    render(
      <ChangesTable
        graph={zynqGraph('current')}
        compare={{ ...compareOf(diff, 'HEAD'), currentLabel: `sys/${long}` }}
        rows={changeRows(diff, { ignoreVersionOnly: false })}
        filter={null}
        selection={null}
        onSelectInstance={jest.fn()}
        onSelectPort={jest.fn()}
        onSwapCompare={jest.fn()}
      />
    );
    const label = screen
      .getByRole('group', { name: 'Direction of the comparison' })
      .querySelector<HTMLElement>(`[title="sys/${long}"]`)!;
    expect(label).toHaveTextContent(/^a{15}….*\.1\.bd$/);
    expect([...label.textContent]).toHaveLength(32);
  });

  it('notes that the two sides are in different formats, also without changes', () => {
    renderTable();
    expect(screen.queryByText(/Different formats/)).not.toBeInTheDocument();
    cleanup();
    renderTable({ ...zynqDiff(), formatsDiffer: true });
    expect(
      screen.getByText('Different formats: only what both describe is comparable.')
    ).toBeVisible();
    cleanup();
    renderTable({ ...emptyDiff(), formatsDiffer: true });
    expect(screen.getByText('No changes.')).toBeVisible();
    expect(screen.getByText(/Different formats/)).toBeVisible();
  });

  it('offers Swap only when the base is a file, and posts swapCompare', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: 'Swap' })).not.toBeInTheDocument();
    cleanup();
    const { onSwapCompare } = renderTable(zynqDiff(), { canSwap: true });
    const swap = screen.getByRole('button', { name: 'Swap' });
    expect(swap).toHaveAttribute(
      'title',
      'Open the base as a diagram and compare it with this file'
    );
    fireEvent.click(swap);
    expect(onSwapCompare).toHaveBeenCalledTimes(1);
  });

  it('keeps long values whole', () => {
    renderTable();
    expect(rowOf('axis_data_fifo_0', 'added').textContent).toBeDefined();
    expect(screen.getByText('ghost_ctrl/rst_n, sync_0/rst_n_in, sys_rst_n')).toBeVisible();
  });

  it('says so, with no table, when nothing differs', () => {
    renderTable(emptyDiff());
    expect(screen.getByText('No changes.')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Direction of the comparison' })).toHaveTextContent(
      'Base HEAD → Current current.bd'
    );
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
    for (const row of [rowOf('axi_gpio_0'), rowOf('led_o'), addressRow('axi_gpio_0/S_AXI/Reg')]) {
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
    const segmentRow = () => addressRow('gpio_block/axi_gpio_1/S_AXI/Reg');
    const slave = () =>
      zynqGraph('current').addressSegments.find(
        (s) => s.segment === 'gpio_block/axi_gpio_1/S_AXI/Reg'
      )!.slaveInstance;

    const changeWords = () =>
      dataRows()
        .filter((row) => within(row).getAllByRole('cell')[1].textContent === 'Address map')
        .map((row) => within(row).getAllByRole('cell')[3].textContent)
        .sort();

    it('reads space → segment, with the change in words and the values as before', () => {
      renderTable();
      expect(
        within(segmentRow())
          .getAllByRole('cell')
          .map((cell) => cell.textContent)
      ).toEqual([
        '~ Changed',
        'Address map',
        'sys_ps7/Data → gpio_block/axi_gpio_1/S_AXI/Reg',
        'address changed',
        '0x41210000 · 0x00010000',
        '0x41220000 · 0x00010000',
      ]);
      expect(
        within(segmentRow()).getAllByRole('cell')[2].querySelectorAll('.sd-code')
      ).toHaveLength(2);
      expect(changeWords()).toEqual(['address changed', 'removed', 'removed']);
    });

    it('says added for a segment that only the current revision has', () => {
      renderTable(zynqReverseDiff(), { graph: zynqGraph('base') });
      expect(changeWords()).toEqual(['added', 'added', 'address changed']);
    });

    it('selects the slave block of a segment that exists in the current revision', () => {
      const { onSelectInstance } = renderTable();
      expect(segmentRow()).toHaveAttribute('title', `Selects ${slave()}`);
      fireEvent.click(segmentRow());
      expect(onSelectInstance).toHaveBeenCalledWith(slave());
    });

    it('marks the segment row of the selected slave block', () => {
      renderTable(zynqDiff(), { selection: { kind: 'instance', id: slave() } });
      expect(segmentRow()).toHaveClass('sd-row-selected');
    });

    it('does not select a removed segment, and says it is not in this revision', () => {
      const { onSelectInstance } = renderTable();
      const removed = addressRow('axi_gpio_0/S_AXI/Reg');
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
