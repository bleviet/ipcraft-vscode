import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import {
  dataCrossingsHeadline,
  resetCrossingsHeadline,
} from '../../../../webview/systemDiagram/clocks/crossingRows';
import { CrossingsTable } from '../../../../webview/systemDiagram/CrossingsTable';
import type { FocusedPin } from '../../../../webview/systemDiagram/unconnectedPins';
import { loadClockFixtureGraph } from './fixtureGraph';

const graph = loadClockFixtureGraph();
const analysis = analyzeClocks(graph);
const pinCrossings = analysis.crossings.filter(
  (crossing): crossing is PinCrossing => crossing.kind !== 'block'
);

function renderTable(
  crossings: readonly PinCrossing[],
  props: {
    focusedPin?: FocusedPin;
    selection?: { kind: 'net'; id: string };
    headline?: (flagged: number) => string;
    showKind?: boolean;
  } = {}
) {
  const onSelectNet = jest.fn();
  const onReveal = jest.fn();
  render(
    <CrossingsTable
      graph={graph}
      crossings={crossings}
      headline={props.headline ?? dataCrossingsHeadline}
      showKind={props.showKind ?? true}
      filter={null}
      selection={props.selection ?? null}
      focusedPin={props.focusedPin ?? null}
      onSelectNet={onSelectNet}
      onReveal={onReveal}
    />
  );
  return { onSelectNet, onReveal };
}

const dataRows = () => screen.queryAllByRole('row').slice(1);
const withStatus = (...statuses: string[]) =>
  pinCrossings.filter((crossing) => statuses.includes(crossing.status));

describe('CrossingsTable', () => {
  describe('summary line', () => {
    it('counts the crossings without a synchronizer, in the plural', () => {
      renderTable(pinCrossings);
      expect(screen.getByText('4 crossings without a synchronizer.')).toBeVisible();
    });

    it('uses the singular for one crossing', () => {
      renderTable(withStatus('cross').slice(0, 1));
      expect(screen.getByText('1 crossing without a synchronizer.')).toBeVisible();
      expect(dataRows()).toHaveLength(1);
    });

    it('says none were found, without a table, when nothing is flagged', () => {
      renderTable(withStatus('ok'));
      expect(screen.getByText('No clock domain crossings on this level.')).toBeVisible();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('says none were found for a design without data connections or resets', () => {
      renderTable([]);
      expect(screen.getByText('No clock domain crossings on this level.')).toBeVisible();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('rows', () => {
    it('lists only the crossings by default, never ok, related or block rows', () => {
      renderTable(pinCrossings);
      expect(dataRows()).toHaveLength(4);
      expect(screen.getAllByRole('img', { name: 'Crossing' })).toHaveLength(4);
      expect(screen.queryByRole('img', { name: 'Could not be checked' })).not.toBeInTheDocument();
      expect(screen.queryByText('axis_data_fifo_0 (dsp_pipeline)')).not.toBeInTheDocument();
      expect(screen.queryByText(/Both ends on/)).not.toBeInTheDocument();
    });

    it('reveals the crossings that could not be checked with the checkbox, off at first', () => {
      renderTable(pinCrossings);
      const checkbox = screen.getByRole('checkbox', { name: 'Show 3 that could not be checked' });
      expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox);
      expect(dataRows()).toHaveLength(7);
      expect(screen.getAllByRole('img', { name: 'Could not be checked' })).toHaveLength(3);
      expect(screen.getByText('4 crossings without a synchronizer.')).toBeVisible();
      fireEvent.click(checkbox);
      expect(dataRows()).toHaveLength(4);
    });

    it('offers the checkbox for one crossing that could not be checked, and for none flagged', () => {
      renderTable(withStatus('unchecked').slice(0, 1));
      expect(screen.getByText('No clock domain crossings on this level.')).toBeVisible();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show 1 that could not be checked' }));
      expect(dataRows()).toHaveLength(1);
    });

    it('does not offer the checkbox when every crossing was checked', () => {
      renderTable(withStatus('cross'));
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('gives the reason of a crossing that could not be checked as its problem', () => {
      renderTable(withStatus('unchecked'));
      fireEvent.click(screen.getByRole('checkbox'));
      const row = screen.getAllByText(/has clocks on 2 domains/)[0].closest('tr')!;
      expect(within(row).getAllByRole('cell')[4]).toHaveTextContent(
        'axis_data_fifo_0 has clocks on 2 domains; the clock of M_AXIS is in its definition'
      );
      expect(row.getAttribute('title')).toContain('axis_data_fifo_0/M_AXIS: clock not known');
    });
  });

  describe('row click', () => {
    it('selects the net and names the sink pin to focus', () => {
      const { onSelectNet } = renderTable(pinCrossings);
      const row = screen.getByText('fir_compiler_0/aresetn').closest('tr')!;
      fireEvent.click(row);
      const crossing = pinCrossings.find(
        (candidate) => candidate.to.label === 'fir_compiler_0/aresetn'
      )!;
      expect(onSelectNet).toHaveBeenCalledTimes(1);
      expect(onSelectNet).toHaveBeenCalledWith(crossing.netId, {
        nodeId: crossing.to.nodeId,
        pin: crossing.to.pin,
      });
    });

    it('opens the script from the source link without selecting the net', () => {
      const { onSelectNet, onReveal } = renderTable(pinCrossings);
      const row = screen.getByText('fir_compiler_0/aresetn').closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: /zynq_clock_domains\.tcl:\d+/ }));
      expect(onReveal).toHaveBeenCalledTimes(1);
      expect(onSelectNet).not.toHaveBeenCalled();
    });

    it('marks the row of the focused sink pin as selected', () => {
      const crossing = pinCrossings.find(
        (candidate) => candidate.to.label === 'fir_compiler_0/aresetn'
      )!;
      renderTable(pinCrossings, {
        selection: { kind: 'net', id: crossing.netId },
        focusedPin: { nodeId: crossing.to.nodeId, pin: crossing.to.pin, netId: crossing.netId },
      });
      expect(screen.getByText('fir_compiler_0/aresetn').closest('tr')).toHaveClass(
        'sd-row-selected'
      );
      expect(screen.getByText('ovf_monitor_0/rst_n').closest('tr')).not.toHaveClass(
        'sd-row-selected'
      );
    });
  });

  describe('as the table of the reset crossings', () => {
    const resets = pinCrossings.filter((crossing) => crossing.kind === 'reset');
    const asResets = { headline: resetCrossingsHeadline, showKind: false };

    it('counts the reset crossings without a synchronizer, in the plural', () => {
      renderTable(resets, asResets);
      expect(screen.getByText('2 reset crossings without a synchronizer.')).toBeVisible();
      expect(dataRows()).toHaveLength(2);
    });

    it('uses the singular for one reset', () => {
      renderTable(
        withStatus('cross')
          .filter((crossing) => crossing.kind === 'reset')
          .slice(0, 1),
        asResets
      );
      expect(screen.getByText('1 reset crossing without a synchronizer.')).toBeVisible();
    });

    it('says none were found when no reset crosses', () => {
      renderTable([], asResets);
      expect(screen.getByText('No reset domain crossings on this level.')).toBeVisible();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('drops the Kind column: every row is a reset', () => {
      renderTable(resets, asResets);
      expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
        'Status',
        'From',
        'To',
        'Problem',
        'Source',
      ]);
      const cells = within(dataRows()[0]).getAllByRole('cell');
      expect(cells).toHaveLength(5);
      expect(cells[1]).toHaveTextContent('rst_ps7_0_100M/peripheral_aresetn');
      expect(cells[2]).toHaveTextContent('fir_compiler_0/aresetn');
      expect(cells[3]).toHaveTextContent(
        'released by FCLK_CLK0 · 100 MHz, clocked by FCLK_CLK1 · 200 MHz'
      );
    });

    it('has its own checkbox for the resets that could not be checked', () => {
      renderTable(resets, asResets);
      const checkbox = screen.getByRole('checkbox', { name: 'Show 1 that could not be checked' });
      expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox);
      expect(dataRows()).toHaveLength(3);
      expect(screen.getByText('2 reset crossings without a synchronizer.')).toBeVisible();
    });

    it('selects the net and names the sink pin to focus, as for a data crossing', () => {
      const { onSelectNet } = renderTable(resets, asResets);
      fireEvent.click(screen.getByText('fir_compiler_0/aresetn').closest('tr')!);
      const crossing = resets.find((candidate) => candidate.to.label === 'fir_compiler_0/aresetn')!;
      expect(onSelectNet).toHaveBeenCalledWith(crossing.netId, {
        nodeId: crossing.to.nodeId,
        pin: crossing.to.pin,
      });
    });
  });
});
