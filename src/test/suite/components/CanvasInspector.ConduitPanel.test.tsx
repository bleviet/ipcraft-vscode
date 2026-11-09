import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import { builtinBusLibrary } from '../../helpers/busLibrary';

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
        imports={{ busLibrary: builtinBusLibrary() }}
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
        imports={{ busLibrary: builtinBusLibrary() }}
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
  it('uses endianness as the only Avalon-ST ordering control', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      name: 'stream_out',
      type: 'ipcraft:busif:avalon_st:1.0',
      mode: 'source',
      endianness: 'big',
    });
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={ipCore}
        imports={{ busLibrary: builtinBusLibrary() }}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    expect(
      screen.queryByRole('checkbox', { name: 'First Symbol in High-Order Bits' })
    ).not.toBeInTheDocument();
    const endianness = screen.getByRole('combobox', { name: 'Endianness' });
    expect(endianness).toHaveValue('big');
    fireEvent.change(endianness, { target: { value: 'little' } });
    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'endianness'], 'little');
  });
});

describe('CanvasInspector ConduitPanel - save as custom bus definition', () => {
  const FIELDS = [{ name: 'low', bits: '[3:0]' }];

  function saveAndAck(conduitPorts: unknown[]) {
    const onUpdate = jest.fn<void, [Array<string | number>, unknown]>();
    render(
      <CanvasInspector
        selected={BUS_SELECTION}
        ipCore={baseIpCore({
          name: 'custom_if',
          type: 'user:busif:custom:1.0',
          mode: 'conduit',
          conduitPorts,
        })}
        imports={{ busLibrary: builtinBusLibrary() }}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText(/Save Bus Definition/));
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'customBusDefinitionSaved', customBusLibraryDir: 'custom_bus_definitions' },
        })
      );
    });
    return onUpdate;
  }

  it('writes portFields keyed by conduit port name before clearing conduitPorts', () => {
    const onUpdate = saveAndAck([
      { name: 'dbg_val', direction: 'out', width: 4, fields: FIELDS },
      { name: 'dbg_plain', direction: 'in', width: 1 },
    ]);

    const paths = onUpdate.mock.calls.map(([path]) => path.join('.'));
    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'portFields'], {
      dbg_val: FIELDS,
    });
    expect(paths.indexOf('busInterfaces.0.portFields')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('busInterfaces.0.portFields')).toBeLessThan(
      paths.indexOf('busInterfaces.0.conduitPorts')
    );
    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'conduitPorts'], null);
  });

  it('writes no portFields when no conduit port has fields', () => {
    const onUpdate = saveAndAck([{ name: 'dbg_val', direction: 'out', width: 4 }]);

    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'conduitPorts'], null);
    expect(onUpdate.mock.calls.map(([path]) => path.join('.'))).not.toContain(
      'busInterfaces.0.portFields'
    );
  });
});
