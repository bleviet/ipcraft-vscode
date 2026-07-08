import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MapConduitToBusDialog,
  type MapConduitToBusResult,
} from '../../../webview/ipcore/components/canvas/MapConduitToBusDialog';
import type { BusPortDef } from '../../../webview/ipcore/data/busDefinitions';
import type { ConduitPort } from '../../../webview/types/ipCore';

const FIFO_WRITE_PORTS: BusPortDef[] = [
  { name: 'WR_DATA', direction: 'out', presence: 'required' },
  { name: 'WR_EN', width: 1, direction: 'out', presence: 'required' },
  { name: 'FULL', width: 1, direction: 'in', presence: 'optional' },
];

const CONDUIT_PORTS: ConduitPort[] = [
  { name: 'fifo_wr_en', direction: 'out', width: 1 },
  { name: 'fifo_wr_data', direction: 'out', width: 8 },
  { name: 'fifo_almost_full', direction: 'in', width: 1 },
];

function renderDialog(overrides?: {
  conduitPorts?: ConduitPort[];
  libraryPortDefs?: BusPortDef[];
  onConfirm?: (r: MapConduitToBusResult) => void;
  onCancel?: () => void;
}) {
  const onConfirm = overrides?.onConfirm ?? jest.fn();
  const onCancel = overrides?.onCancel ?? jest.fn();
  render(
    <MapConduitToBusDialog
      busLabel="fifo_write"
      conduitPorts={overrides?.conduitPorts ?? CONDUIT_PORTS}
      libraryPortDefs={overrides?.libraryPortDefs ?? FIFO_WRITE_PORTS}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  return { onConfirm, onCancel };
}

describe('MapConduitToBusDialog', () => {
  it('renders a row for every non-role logical port', () => {
    renderDialog();
    expect(screen.getByText('WR_DATA')).toBeInTheDocument();
    expect(screen.getByText('WR_EN')).toBeInTheDocument();
    expect(screen.getByText('FULL')).toBeInTheDocument();
  });

  it('skips clock/reset-role logical ports', () => {
    renderDialog({
      libraryPortDefs: [...FIFO_WRITE_PORTS, { name: 'ACLK', presence: 'required', role: 'clock' }],
    });
    expect(screen.queryByText('ACLK')).not.toBeInTheDocument();
  });

  it('disables Confirm while a required port is unassigned', () => {
    renderDialog();
    expect(screen.getByText('Confirm')).toBeDisabled();
  });

  // CONDUIT_PORTS' directions (fifo_wr_en/fifo_wr_data: out, fifo_almost_full: in)
  // match FIFO_WRITE_PORTS' own onMaster directions exactly, so these "confirm flow"
  // tests switch to master mode first to keep direction filtering out of their way
  // (direction filtering itself is covered separately below, in slave — the default).

  it('enables Confirm once all required ports are assigned and calls onConfirm with the mapping', () => {
    const { onConfirm } = renderDialog();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'master' } });
    // selects[0] is Mode; the rest follow row order (WR_DATA, WR_EN, FULL).
    fireEvent.change(selects[1], { target: { value: 'fifo_wr_data' } });
    fireEvent.change(selects[2], { target: { value: 'fifo_wr_en' } });

    expect(screen.getByText('Confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'master',
      portNameOverrides: { WR_DATA: 'fifo_wr_data', WR_EN: 'fifo_wr_en' },
      portWidthOverrides: { WR_DATA: 8, WR_EN: 1 },
      useOptionalPorts: [],
    });
  });

  it('adds an assigned optional port to useOptionalPorts', () => {
    const { onConfirm } = renderDialog();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'master' } });
    fireEvent.change(selects[1], { target: { value: 'fifo_wr_data' } });
    fireEvent.change(selects[2], { target: { value: 'fifo_wr_en' } });
    fireEvent.change(selects[3], { target: { value: 'fifo_almost_full' } });

    fireEvent.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'master',
      portNameOverrides: {
        WR_DATA: 'fifo_wr_data',
        WR_EN: 'fifo_wr_en',
        FULL: 'fifo_almost_full',
      },
      portWidthOverrides: { WR_DATA: 8, WR_EN: 1, FULL: 1 },
      useOptionalPorts: ['FULL'],
    });
  });

  it('confirms with no overrides when only optional ports exist and none are assigned', () => {
    const { onConfirm } = renderDialog({
      libraryPortDefs: [{ name: 'FULL', width: 1, direction: 'in', presence: 'optional' }],
    });
    expect(screen.getByText('Confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'slave',
      portNameOverrides: {},
      useOptionalPorts: [],
    });
  });

  it('auto-seeds an exact case-insensitive name match', () => {
    const { onConfirm } = renderDialog({
      conduitPorts: [
        { name: 'wr_data', direction: 'out', width: 8 },
        { name: 'wr_en', direction: 'out', width: 1 },
      ],
    });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'master' } });
    // Both required ports are pre-matched by exact (lowercased) name, so Confirm
    // should already be enabled without any manual selection.
    expect(screen.getByText('Confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'master',
      portNameOverrides: { WR_DATA: 'wr_data', WR_EN: 'wr_en' },
      portWidthOverrides: { WR_DATA: 8, WR_EN: 1 },
      useOptionalPorts: [],
    });
  });

  it('only offers direction-compatible candidates for a given logical port and mode', () => {
    renderDialog();
    const selects = screen.getAllByRole('combobox');
    // WR_DATA is an out-on-master logical port; in slave mode (default) the expected
    // physical direction is "in". fifo_wr_en/fifo_wr_data are "out", fifo_almost_full
    // is "in" — only the "in" port should be offered.
    const wrDataSelect = selects[1];
    const optionValues = Array.from(wrDataSelect.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toContain('fifo_almost_full');
    expect(optionValues).not.toContain('fifo_wr_en');
    expect(optionValues).not.toContain('fifo_wr_data');
  });

  it('excludes a port already assigned to a different logical signal from other dropdowns', () => {
    renderDialog();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'master' } });
    fireEvent.change(selects[1], { target: { value: 'fifo_wr_data' } });

    // WR_EN is also a master-mode "out" port, so fifo_wr_en/fifo_wr_data are both
    // direction-compatible — but fifo_wr_data must be excluded once WR_DATA claims it.
    const wrEnOptions = Array.from(selects[2].querySelectorAll('option')).map((o) => o.value);
    expect(wrEnOptions).toContain('fifo_wr_en');
    expect(wrEnOptions).not.toContain('fifo_wr_data');
  });

  it('switching mode updates which candidates are direction-compatible', () => {
    renderDialog();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'master' } });

    // In master mode, WR_DATA's expected physical direction matches its own ("out").
    const wrDataOptions = Array.from(selects[1].querySelectorAll('option')).map((o) => o.value);
    expect(wrDataOptions).toContain('fifo_wr_data');
    expect(wrDataOptions).toContain('fifo_wr_en');
    expect(wrDataOptions).not.toContain('fifo_almost_full');
  });

  it('calls onCancel when Cancel is clicked', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a message and an always-enabled Confirm when there are no assignable ports', () => {
    const { onConfirm } = renderDialog({ libraryPortDefs: [] });
    expect(screen.getByText(/no signal-level ports to map/i)).toBeInTheDocument();
    expect(screen.getByText('Confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'slave',
      portNameOverrides: {},
      useOptionalPorts: [],
    });
  });
});
