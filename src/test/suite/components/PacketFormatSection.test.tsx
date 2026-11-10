import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PacketFormatSection } from '../../../webview/ipcore/components/canvas/inspector/buses/PacketFormatSection';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import { parseIpCore } from '../../../domain/parse';
import { serializeIpCore } from '../../../domain/serialize';
import type { PacketFormatCandidate, PacketFormatRefInfo } from '../../../shared/packetFormat';

const cand = (name: string, dataWidth: number): PacketFormatCandidate => ({
  ref: `../${name}.pkt.yml#${name}`,
  file: `${name}.pkt.yml`,
  name,
  description: '',
  dataWidth,
  busTypes: [],
});

const info: PacketFormatRefInfo = {
  ref: '../a.pkt.yml#a',
  format: {
    name: 'a',
    description: 'Format A',
    dataWidth: 32,
    busTypes: [],
    extends: [],
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

describe('PacketFormatSection', () => {
  it('lists matching candidates and opens the format without drawing lanes', () => {
    const onOpen = jest.fn();
    const onChange = jest.fn();
    render(
      <PacketFormatSection
        currentRef="../a.pkt.yml#a"
        info={info}
        candidates={[cand('a', 32), cand('wide', 64)]}
        dataWidth={32}
        onRequestCandidates={jest.fn()}
        onChange={onChange}
        onOpen={onOpen}
      />
    );
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.includes('wide'))).toBe(false);
    expect(options.some((o) => o?.includes('a.pkt.yml#a'))).toBe(true);
    fireEvent.click(screen.getByText(/Open format/));
    expect(onOpen).toHaveBeenCalledWith('../a.pkt.yml');
    expect(screen.queryByTestId('packet-lanes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('is shown for a streaming interface in the bus inspector only', () => {
    const make = (type: string): IpCore =>
      ({
        vlnv: { vendor: 'v', library: 'l', name: 'n', version: '1.0' },
        busInterfaces: [{ name: 'm_axis', type, mode: 'master' }],
      }) as unknown as IpCore;
    const packetFormats = {
      infos: {},
      candidates: [],
      handleInfo: jest.fn(),
      handleCandidates: jest.fn(),
      requestCandidates: jest.fn(),
      openFile: jest.fn(),
    };
    const show = (type: string) =>
      render(
        <CanvasInspector
          selected={{ kind: 'busInterface', index: 0, id: 'bus:0' }}
          ipCore={make(type)}
          imports={{ busLibrary: builtinBusLibrary() }}
          packetFormats={packetFormats}
          onUpdate={jest.fn()}
          onClose={jest.fn()}
        />
      );
    const first = show('ipcraft:busif:axi_stream:1.0');
    expect(screen.getByText('Packet format')).toBeInTheDocument();
    first.unmount();
    show('ipcraft:busif:axi4_lite:1.0');
    expect(screen.queryByText('Packet format')).not.toBeInTheDocument();
  });
});

describe('apiVersion 1.3 round trip', () => {
  it('keeps packetFormatRef through parse and serialize', () => {
    const text = [
      "apiVersion: '1.3'",
      'vlnv: { vendor: v, library: l, name: n, version: "1.0" }',
      'busInterfaces:',
      '  - name: s_axis',
      '    type: ipcraft:busif:axi_stream:1.0',
      '    mode: slave',
      '    packetFormatRef: ./event.pkt.yml#event',
      '',
    ].join('\n');
    const parsed = parseIpCore(text);
    expect(parsed.busInterfaces?.[0]?.packetFormatRef).toBe('./event.pkt.yml#event');
    const out = serializeIpCore(parsed) as { busInterfaces: Array<{ packetFormatRef?: string }> };
    expect(out.busInterfaces[0].packetFormatRef).toBe('./event.pkt.yml#event');
  });
});
