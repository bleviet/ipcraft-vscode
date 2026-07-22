import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';
import type { IpCore } from '../../../webview/types/ipCore';

const PORT_SELECTION: CanvasElement = { kind: 'port', index: 0, id: 'port:0' };

function bigEndianPortIpCore(): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    ports: [{ name: 'data', direction: 'in', width: 32, endianness: 'big' }],
  } as unknown as IpCore;
}

describe('CanvasInspector PortPanel endianness', () => {
  it('resets big endianness atomically when direction changes to inout', () => {
    const batchUpdate = jest.fn();
    render(
      <CanvasInspector
        selected={PORT_SELECTION}
        ipCore={bigEndianPortIpCore()}
        onUpdate={jest.fn()}
        batchUpdate={batchUpdate}
        onClose={jest.fn()}
      />
    );

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'inout' } });

    expect(batchUpdate).toHaveBeenCalledWith([
      [['ports', 0, 'direction'], 'inout'],
      [['ports', 0, 'endianness'], 'little'],
    ]);
  });

  it('keeps an invalid authored big-endian value editable so it can be recovered', () => {
    const ipCore = bigEndianPortIpCore();
    if (ipCore.ports?.[0]) {
      ipCore.ports[0].width = 12;
    }
    render(
      <CanvasInspector
        selected={PORT_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getAllByRole('combobox')[1]).not.toBeDisabled();
  });
});
