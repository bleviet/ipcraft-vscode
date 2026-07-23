import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

const BUS_SELECTION: CanvasElement = { kind: 'busInterface', index: 0, id: 'bus:0' };

function baseIpCore(bus: Record<string, unknown>): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    clocks: [{ name: 'clk' }],
    resets: [{ name: 'rst_n' }],
    busInterfaces: [bus],
  } as unknown as IpCore;
}

describe('CanvasInspector ConduitPanel — clock/reset associations', () => {
  it('hides the Associations section for a conduit-mode interface', () => {
    const ipCore = baseIpCore({
      name: 'custom_if',
      type: 'user:busif:custom:1.0',
      mode: 'conduit',
    });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByText('Associations')).not.toBeInTheDocument();
    expect(screen.queryByText('Clock')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
    expect(screen.queryByText('Endianness')).not.toBeInTheDocument();
  });

  it('treats a missing mode as conduit (matches the Mode field default)', () => {
    const ipCore = baseIpCore({ name: 'custom_if', type: 'user:busif:custom:1.0' });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByText('Associations')).not.toBeInTheDocument();
  });

  it('shows the Associations section once a custom interface is switched to master/slave', () => {
    const ipCore = baseIpCore({ name: 'custom_if', type: 'user:busif:custom:1.0', mode: 'master' });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText('Associations')).toBeInTheDocument();
    expect(screen.getByText('Clock')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('clears a stale associatedClock/associatedReset when switching mode to conduit', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      name: 'custom_if',
      type: 'user:busif:custom:1.0',
      mode: 'master',
      associatedClock: 'clk',
      associatedReset: 'rst_n',
    });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const modeSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(modeSelect, { target: { value: 'conduit' } });

    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'mode'], 'conduit');
    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'associatedClock'], null);
    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'associatedReset'], null);
  });

  it('does not touch associatedClock/associatedReset when switching between master and slave', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      name: 'custom_if',
      type: 'user:busif:custom:1.0',
      mode: 'master',
      associatedClock: 'clk',
    });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const modeSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(modeSelect, { target: { value: 'slave' } });

    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'mode'], 'slave');
    expect(onUpdate).not.toHaveBeenCalledWith(['busInterfaces', 0, 'associatedClock'], null);
    expect(onUpdate).not.toHaveBeenCalledWith(['busInterfaces', 0, 'associatedReset'], null);
  });
});

describe('CanvasInspector BusPanel — Avalon-ST configuration', () => {
  it('edits firstSymbolInHighOrderBits for Avalon-ST interfaces', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      name: 'stream_out',
      type: 'ipcraft:busif:avalon_st:1.0',
      mode: 'source',
      firstSymbolInHighOrderBits: true,
    });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const checkbox = screen.getByRole('checkbox', {
      name: 'First Symbol in High-Order Bits',
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onUpdate).toHaveBeenCalledWith(
      ['busInterfaces', 0, 'firstSymbolInHighOrderBits'],
      false
    );
  });

  it('does not show Avalon-ST configuration for other bus protocols', () => {
    const ipCore = baseIpCore({
      name: 'stream_out',
      type: 'ipcraft:busif:axi_stream:1.0',
      mode: 'master',
    });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(
      screen.queryByRole('checkbox', { name: 'First Symbol in High-Order Bits' })
    ).not.toBeInTheDocument();
  });
});
