import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { IpBlockCanvas } from '../../../webview/ipcore/components/canvas/IpBlockCanvas';
import type { IpCore } from '../../../webview/types/ipCore';
import type { PacketFormatRefInfo } from '../../../shared/packetFormat';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const REF = 'packets/a.pkt.yml#a';

const info: PacketFormatRefInfo = {
  ref: REF,
  format: {
    name: 'a',
    description: 'Format A',
    dataWidth: 32,
    busTypes: [],
    extends: ['base'],
    beats: [
      {
        name: 'one',
        description: '',
        count: 1,
        signals: {
          data: [
            { name: 'hi', path: 'hi', lsb: 16, width: 16, type: 'uint', description: '' },
            { name: 'lo', path: 'lo', lsb: 0, width: 16, type: 'uint', description: '' },
          ],
        },
      },
    ],
  },
};

const ipCore = {
  vlnv: { vendor: 'v', library: 'l', name: 'n', version: '1.0' },
  busInterfaces: [
    { name: 'm_axis', type: 'ipcraft:busif:axi_stream:1.0', mode: 'master', packetFormatRef: REF },
    { name: 's_axis', type: 'ipcraft:busif:axi_stream:1.0', mode: 'slave' },
  ],
} as unknown as IpCore;

function renderCanvas(selectedId: string | null, onOpen = jest.fn()) {
  const view = render(
    <IpBlockCanvas
      ipCore={ipCore}
      selectedId={selectedId}
      onSelect={jest.fn()}
      busLibrary={builtinBusLibrary()}
      packetFormatInfos={{ [REF]: info }}
      onOpenPacketFormat={onOpen}
    />
  );
  const bundle = (id: string) =>
    view.container.querySelector(`[data-port-id="${id}"]`)!.parentElement!;
  return { ...view, bundle, onOpen };
}

describe('canvas details row with the packet format', () => {
  it('does not open on hover, only when the bus is clicked (selected)', () => {
    const { bundle, container, rerender } = renderCanvas(null);
    fireEvent.mouseEnter(bundle('bus:0'));
    expect(screen.queryByTestId('canvas-details')).not.toBeInTheDocument();

    rerender(
      <IpBlockCanvas
        ipCore={ipCore}
        selectedId="bus:0"
        onSelect={jest.fn()}
        busLibrary={builtinBusLibrary()}
        packetFormatInfos={{ [REF]: info }}
      />
    );
    const card = screen.getByRole('region', { name: 'Packet format of m_axis' });
    const row = screen.getByTestId('canvas-details');
    expect(row).toHaveTextContent('Protocol');
    expect(row).toHaveTextContent('m_axis');
    expect(screen.getByTestId('lane-one-data').children).toHaveLength(2);
    expect(card).toHaveTextContent('extends base');
    // The info box moved into the row; the floating tooltip of the hovered bus is not shown twice.
    expect(container.querySelectorAll('.ip-canvas-tooltip')).toHaveLength(1);
  });

  it('closes when the bus is deselected', () => {
    const { rerender } = renderCanvas('bus:0');
    expect(screen.getByTestId('canvas-details')).toBeInTheDocument();
    rerender(
      <IpBlockCanvas
        ipCore={ipCore}
        selectedId={null}
        onSelect={jest.fn()}
        busLibrary={builtinBusLibrary()}
        packetFormatInfos={{ [REF]: info }}
      />
    );
    expect(screen.queryByTestId('canvas-details')).not.toBeInTheDocument();
  });

  it('wraps the signal into 32-bit rows', () => {
    const wide: PacketFormatRefInfo = {
      ref: REF,
      format: {
        ...info.format!,
        dataWidth: 64,
        beats: [
          {
            ...info.format!.beats[0],
            signals: {
              data: [{ name: 'x', path: 'x', lsb: 16, width: 32, type: 'uint', description: '' }],
            },
          },
        ],
      },
    };
    const view = render(
      <IpBlockCanvas
        ipCore={ipCore}
        selectedId="bus:0"
        onSelect={jest.fn()}
        busLibrary={builtinBusLibrary()}
        packetFormatInfos={{ [REF]: wide }}
      />
    );
    expect(view.getByTestId('lane-one-data')).toBeInTheDocument();
    expect(view.getByTestId('lane-one-data-32')).toBeInTheDocument();
    expect(view.getByTestId('lane-one-data-32')).toHaveTextContent('x');
  });

  it('stays open while another bus is hovered and opens the format file', () => {
    const { bundle, onOpen } = renderCanvas('bus:0');
    expect(screen.getByRole('region', { name: 'Packet format of m_axis' })).toBeInTheDocument();
    fireEvent.mouseEnter(bundle('bus:1'));
    expect(screen.getByRole('region', { name: 'Packet format of m_axis' })).toBeInTheDocument();
    fireEvent.mouseLeave(bundle('bus:1'));
    fireEvent.click(screen.getByText(/Open format/));
    expect(onOpen).toHaveBeenCalledWith('packets/a.pkt.yml');
  });

  it('shows nothing for a bus without a packet format', () => {
    const { bundle } = renderCanvas('bus:1');
    fireEvent.mouseEnter(bundle('bus:1'));
    expect(screen.queryByTestId('canvas-details')).not.toBeInTheDocument();
  });
});
