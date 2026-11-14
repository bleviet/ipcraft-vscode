import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import type { SystemGraph } from '../../../../domain/systemGraph';
import type { Finding } from '../../../../domain/systemGraphDiff';
import { findingRows } from '../../../../services/systemDiagram/diff/findingRows';
import type { DiagramCompare } from '../../../../shared/messages/systemDiagram';
import { compareOf, emptyDiff } from './compareFixtures';
import { FindingsTable } from '../../../../webview/systemDiagram/FindingsTable';
import type { Selection } from '../../../../webview/systemDiagram/model';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../webview/systemDiagram/searchMatcher';

/** The blocks `/a` and `/b` and the external port `led_o` exist; `/gone` does not. */
const graph = {
  instances: { '/a': {}, '/b': {} },
  levels: { '/': { boundaryPins: [{ name: 'led_o' }] } },
} as unknown as SystemGraph;

const undrivenA: Finding = {
  kind: 'undriven',
  level: '/',
  instance: '/a',
  pin: 'clk',
  label: 'a/clk',
};
const unusedPort: Finding = {
  kind: 'unused',
  level: '/',
  instance: null,
  pin: 'led_o',
  label: 'led_o',
};
const crossing: Finding = {
  kind: 'dataCrossing',
  level: '/',
  from: 'a/M',
  to: 'b/S',
  fromInstance: '/a',
  toInstance: '/b',
  fromClock: 'clkA',
  toClock: 'clkB',
  reason: 'no synchronizer is known',
};
const goneBlock: Finding = {
  kind: 'undriven',
  level: '/',
  instance: '/gone',
  pin: 'rst',
  label: 'gone/rst',
};

function compare(options: {
  baseDefinitions?: DiagramCompare['baseDefinitions'];
  baseLabel?: string;
  missingBase?: boolean;
}): DiagramCompare {
  const base = compareOf(emptyDiff(), options.baseLabel ?? 'v1.0', {
    baseDefinitions: options.baseDefinitions,
  });
  if (options.missingBase) {
    base.diff.base.missing = true;
  }
  return base;
}

function renderTable(
  options: {
    findings?: { new: Finding[]; resolved: Finding[] };
    filter?: string;
    selection?: Selection | null;
    baseDefinitions?: DiagramCompare['baseDefinitions'];
    baseLabel?: string;
    missingBase?: boolean;
  } = {}
) {
  const onSelectInstance = jest.fn();
  const onSelectPort = jest.fn();
  render(
    <FindingsTable
      graph={graph}
      compare={compare(options)}
      rows={findingRows(options.findings ?? { new: [undrivenA, crossing], resolved: [goneBlock] })}
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
const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

afterEach(cleanup);

describe('FindingsTable', () => {
  it('lists the new findings, then the resolved ones, with the word of each sign', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'New or resolved',
      'Finding',
      'Where',
      'Detail',
    ]);
    expect(dataRows().map(cellsOf)).toEqual([
      ['New', 'undriven pin', 'a/clk', ''],
      ['New', 'data crossing', 'a/M → b/S', 'clkA → clkB · no synchronizer is known'],
      ['Resolved', 'undriven pin', 'gone/rst', ''],
    ]);
  });

  describe('the note about the definitions', () => {
    it('says that a file base and the current side use the definitions of this workspace', () => {
      renderTable();
      expect(
        screen.getByText('Both sides are checked with the definitions of this workspace.')
      ).toBeVisible();
    });

    it('says that the base is checked with the definitions at its revision', () => {
      renderTable({ baseDefinitions: 'revision' });
      expect(
        screen.getByText(
          'The base is checked with the definitions at v1.0; the current side with those of this workspace.'
        )
      ).toBeVisible();
    });

    it('names a commit by its short hash and keeps other labels', () => {
      renderTable({ baseDefinitions: 'revision', baseLabel: 'ccccccc Add the DMA block' });
      expect(screen.getByText(/definitions at ccccccc;/)).toBeVisible();
      cleanup();
      renderTable({ baseDefinitions: 'revision', baseLabel: 'main (merge base bbbbbbb)' });
      expect(screen.getByText(/definitions at main \(merge base bbbbbbb\);/)).toBeVisible();
    });

    it('says that the base did not exist, whatever the definitions', () => {
      renderTable({ baseDefinitions: 'revision', missingBase: true });
      expect(
        screen.getByText('The base did not exist: every finding of the file is new.')
      ).toBeVisible();
    });

    it('says that definitions are not read when neither side has them', () => {
      renderTable({ baseDefinitions: 'none' });
      expect(
        screen.getByText('Definitions are not read, so neither side is checked with them.')
      ).toBeVisible();
    });
  });

  it('says so when no finding differs, still with the note', () => {
    renderTable({ findings: { new: [], resolved: [] } });
    expect(screen.getByText('No finding differs from the base.')).toBeVisible();
    expect(screen.getByText(/^Both sides are checked/)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('filters the rows by their texts and says so when none match', () => {
    renderTable({ filter: 'crossing' });
    expect(dataRows()).toHaveLength(1);
    cleanup();
    renderTable({ filter: 'nothing like this' });
    expect(screen.getByText('No rows match the filter.')).toBeVisible();
  });

  it('hides the new or the resolved rows with the chips', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(dataRows().map((row) => cellsOf(row)[0])).toEqual(['Resolved']);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(dataRows().map((row) => cellsOf(row)[0])).toEqual(['New', 'New']);
  });

  it('selects the block of a row when it is clicked or entered', () => {
    const { onSelectInstance, onSelectPort } = renderTable();
    fireEvent.click(dataRows()[0]);
    expect(onSelectInstance).toHaveBeenLastCalledWith('/a');
    // A crossing selects its sink block.
    fireEvent.keyDown(dataRows()[1], { key: 'Enter' });
    expect(onSelectInstance).toHaveBeenLastCalledWith('/b');
    expect(onSelectPort).not.toHaveBeenCalled();
  });

  it('selects an external port', () => {
    const { onSelectInstance, onSelectPort } = renderTable({
      findings: { new: [unusedPort], resolved: [] },
    });
    fireEvent.click(dataRows()[0]);
    expect(onSelectPort).toHaveBeenCalledWith('led_o');
    expect(onSelectInstance).not.toHaveBeenCalled();
  });

  it('does not make a row of a block that is gone clickable', () => {
    const { onSelectInstance } = renderTable();
    const row = dataRows()[2];
    expect(row).toHaveAttribute('title', 'Not in this revision');
    expect(row).not.toHaveAttribute('tabindex');
    fireEvent.click(row);
    expect(onSelectInstance).not.toHaveBeenCalled();
    expect(dataRows()[0]).not.toHaveAttribute('title');
  });

  it('marks the row of the selected block', () => {
    renderTable({ selection: { kind: 'instance', id: '/b' } });
    expect(dataRows().map((row) => row.classList.contains('sd-row-selected'))).toEqual([
      false,
      true,
      false,
    ]);
  });
});
