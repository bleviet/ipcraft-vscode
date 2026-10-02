import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import { CanvasBusSubPort } from '../../../webview/ipcore/components/canvas/CanvasBusSubPort';

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

  it('renders accessible contract-driven polarity selectors without activating inactive ports', () => {
    const batchUpdate = jest.fn();
    const ipCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'control', version: '1.0' },
      busInterfaces: [
        {
          name: 'control',
          type: 'AVMM',
          mode: 'master',
          useOptionalPorts: ['read'],
          portPolarityOverrides: { write: 'activeLow' },
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

    const readPolarity = screen.getByRole('combobox', { name: 'read polarity' });
    const writePolarity = screen.getByRole('combobox', { name: 'write polarity' });
    expect(readPolarity).toHaveValue('default');
    expect(writePolarity).toHaveValue('activeLow');
    expect(screen.getAllByRole('option', { name: 'Default (Active high)' }).length).toBeGreaterThan(
      0
    );
    expect(screen.queryByRole('combobox', { name: 'address polarity' })).not.toBeInTheDocument();
    expect(writePolarity.closest('.ci-field')?.parentElement).toHaveTextContent(
      'Inactive; this setting is preserved when activated.'
    );

    fireEvent.change(writePolarity, { target: { value: 'default' } });
    expect(batchUpdate).toHaveBeenCalledWith([
      [['busInterfaces', 0, 'portPolarityOverrides'], undefined],
    ]);
    expect(batchUpdate).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([expect.arrayContaining(['useOptionalPorts'])]),
      ])
    );
  });

  it('removes an explicit override equal to the contract default through Default', () => {
    const batchUpdate = jest.fn();
    const ipCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'control', version: '1.0' },
      busInterfaces: [
        {
          name: 'control',
          type: 'AVMM',
          mode: 'master',
          portPolarityOverrides: { read: 'activeHigh' },
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

    const readPolarity = screen.getByRole('combobox', { name: 'read polarity' });
    expect(readPolarity).toHaveValue('activeHigh');
    fireEvent.change(readPolarity, { target: { value: 'default' } });
    expect(batchUpdate).toHaveBeenCalledWith([
      [['busInterfaces', 0, 'portPolarityOverrides'], undefined],
    ]);
  });
});

describe('CanvasBusSubPort polarity badge', () => {
  it('renders an effective text badge and exposes polarity in the accessible name', () => {
    render(
      <svg>
        <CanvasBusSubPort
          subPort={{
            id: 'bus:0:read',
            parentBusId: 'bus:0',
            x: 100,
            y: 100,
            side: 'left',
            name: 'read',
            interfaceRole: 'read_n',
            widthLabel: '',
            direction: 'out',
            presence: 'optional',
            active: true,
            absent: false,
            physicalPrefix: 'avs_',
            physicalSuffix: 'read_n',
            polarity: 'activeLow',
            polarityConfigurable: true,
            clockDomainIdx: -1,
          }}
          onActivate={jest.fn()}
          onDeactivate={jest.fn()}
          onSelect={jest.fn()}
        />
      </svg>
    );

    expect(
      screen.getByRole('button', { name: /read signal, interface role read_n, active low/i })
    ).toBeInTheDocument();
    expect(document.querySelector('.canvas-bus-subport__logical')).toHaveTextContent('read_n');
    expect(document.querySelector('.canvas-bus-subport__polarity-badge')).toHaveTextContent('L');
  });
});
