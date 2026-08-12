import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const selected: CanvasElement = { kind: 'busInterface', index: 0, id: 'bus:0' };

describe('CanvasInspector BusContractFields', () => {
  it('renders editable roots/properties and read-only derived widths', () => {
    const batchUpdate = jest.fn();
    const ipCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'stream', version: '1.0' },
      busInterfaces: [
        {
          name: 'stream',
          type: 'AVST',
          mode: 'source',
          portWidthOverrides: { data: 32, empty: 2 },
          interfaceProperties: { dataBitsPerSymbol: 8, symbolsPerBeat: 4 },
          useOptionalPorts: ['startofpacket', 'endofpacket', 'empty'],
        },
      ],
    } as unknown as IpCore;

    render(
      <CanvasInspector
        selected={selected}
        ipCore={ipCore}
        imports={{ busLibrary: builtinBusLibrary() }}
        onUpdate={jest.fn()}
        batchUpdate={batchUpdate}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('Interface Properties')).toBeInTheDocument();
    expect(screen.getByText('dataBitsPerSymbol')).toBeInTheDocument();
    expect(screen.getByText('symbolsPerBeat')).toBeInTheDocument();
    expect(screen.getByText('ceil(log2(symbolsPerBeat)) = 2')).toBeInTheDocument();

    const dataField = screen.getByText('data').closest('.ci-field');
    const input = dataField?.querySelector('input');
    expect(input).toBeTruthy();
    fireEvent.focus(input!);
    fireEvent.change(input!, { target: { value: '64' } });
    fireEvent.blur(input!);
    expect(batchUpdate).toHaveBeenCalledWith([
      [['busInterfaces', 0, 'portWidthOverrides', 'data'], 64],
      [['busInterfaces', 0, 'portWidthOverrides', 'empty'], undefined],
    ]);
  });

  it('focuses a field addressed by a new issue focus request', () => {
    const ipCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'stream', version: '1.0' },
      busInterfaces: [{ name: 'stream', type: 'AXIS', mode: 'master' }],
    } as unknown as IpCore;
    render(
      <CanvasInspector
        selected={selected}
        ipCore={ipCore}
        imports={{ busLibrary: builtinBusLibrary() }}
        onUpdate={jest.fn()}
        batchUpdate={jest.fn()}
        issueFocusRequest={{
          path: ['busInterfaces', 0, 'portWidthOverrides', 'TDATA'],
          nonce: 1,
        }}
        onClose={jest.fn()}
      />
    );

    expect(document.activeElement).toBe(document.querySelector('#bus-0-width-TDATA input'));
  });
});
