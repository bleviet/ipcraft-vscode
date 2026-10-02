import React from 'react';
import { render, screen } from '@testing-library/react';
import { PortWidthOverridesSection } from '../../../webview/ipcore/components/canvas/inspector/buses/ConduitFields';
import { BUS_VLNV } from '../../../shared/busVlnv';
import type { BusInterface } from '../../../webview/types/ipCore';

function renderSection(bus: BusInterface) {
  render(<PortWidthOverridesSection bus={bus} busIndex={0} paramNames={[]} onUpdate={jest.fn()} />);
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
