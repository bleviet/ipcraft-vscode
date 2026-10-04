import React from 'react';
import { render, screen } from '@testing-library/react';
import { PortWidthOverridesSection } from '../../../webview/ipcore/components/canvas/inspector/buses/ConduitFields';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import { lookupBusDef } from '../../../webview/ipcore/utils/busLibrary';
import { BUS_VLNV } from '../../../shared/busVlnv';
import type { BusInterface, IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';

function renderSection(bus: BusInterface) {
  render(
    <PortWidthOverridesSection
      bus={bus}
      busIndex={0}
      paramNames={[]}
      libraryPortDefs={lookupBusDef(bus.type, builtinBusLibrary()) ?? undefined}
      onUpdate={jest.fn()}
    />
  );
}

describe('PortWidthOverridesSection', () => {
  it('shows the enabled AXI-Stream TUSER row despite its 1-bit default (issue #208)', () => {
    renderSection({
      name: 'M_AXIS',
      type: BUS_VLNV.AXI_STREAM,
      mode: 'master',
      useOptionalPorts: ['TUSER'],
    } as BusInterface);

    expect(screen.getByText('TDATA')).toBeTruthy();
    expect(screen.getByText('TUSER')).toBeTruthy();
  });

  it('hides TUSER when the optional port is not enabled', () => {
    renderSection({
      name: 'M_AXIS',
      type: BUS_VLNV.AXI_STREAM,
      mode: 'master',
    } as BusInterface);

    expect(screen.queryByText('TUSER')).toBeNull();
  });

  it('keeps spec-fixed 1-bit signals such as AXI4 AWLOCK hidden', () => {
    renderSection({
      name: 'S_AXI',
      type: BUS_VLNV.AXI4_FULL,
      mode: 'slave',
      useOptionalPorts: ['AWLOCK'],
    } as BusInterface);

    expect(screen.queryByText('AWLOCK')).toBeNull();
  });
});

describe('Bus inspector contract widths', () => {
  it('lets the AXI-Stream TUSER width be configured (issue #208)', () => {
    const ipCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'stream', version: '1.0' },
      busInterfaces: [
        { name: 'M_AXIS', type: BUS_VLNV.AXI_STREAM, mode: 'master', useOptionalPorts: ['TUSER'] },
      ],
    } as unknown as IpCore;
    render(
      <CanvasInspector
        selected={{ kind: 'busInterface', index: 0, id: 'bus:0' }}
        ipCore={ipCore}
        imports={{ busLibrary: builtinBusLibrary() }}
        onUpdate={jest.fn()}
        batchUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    const tuserField = screen.getByText('TUSER').closest('.ci-field');
    expect(tuserField?.querySelector('input')).toBeTruthy();
  });
});
