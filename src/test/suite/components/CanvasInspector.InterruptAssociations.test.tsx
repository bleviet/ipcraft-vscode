import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';

const ipCore = {
  vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
  clocks: [{ name: 'clk_sys' }, { name: 'clk_irq' }],
  busInterfaces: [
    {
      name: 's_axi',
      type: 'ipcraft:busif:axi4_lite:1.0',
      mode: 'slave',
      physicalPrefix: 's_axi_',
    },
    {
      name: 'm_axi',
      type: 'ipcraft:busif:axi4_full:1.0',
      mode: 'master',
      physicalPrefix: 'm_axi_',
    },
    {
      name: 's_avmm',
      type: 'ipcraft:busif:avalon_mm:1.0',
      mode: 'slave',
      physicalPrefix: 's_avmm_',
    },
    {
      name: 's_axis',
      type: 'ipcraft:busif:axi_stream:1.0',
      mode: 'slave',
      physicalPrefix: 's_axis_',
    },
    {
      name: 's_axi_array',
      type: 'ipcraft:busif:axi4_lite:1.0',
      mode: 'slave',
      physicalPrefix: 's_axi_array_',
      array: { count: 2 },
    },
  ],
  interrupts: [
    {
      name: 'irq',
      direction: 'out',
      sensitivity: 'LEVEL_HIGH',
      associatedBusInterface: 's_axi',
      associatedClock: 'clk_irq',
    },
  ],
} as IpCore;

describe('InterruptPanel associations', () => {
  it('shows current values and only eligible bus interfaces', () => {
    render(
      <CanvasInspector
        selected={{ kind: 'interrupt', index: 0, id: 'interrupt:0' }}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    const busSelect = screen.getByLabelText('Associated Bus Interface');
    const clockSelect = screen.getByLabelText('Associated Clock');

    expect(busSelect).toHaveValue('s_axi');
    expect(clockSelect).toHaveValue('clk_irq');
    expect(within(busSelect).getByRole('option', { name: 's_axi' })).toBeInTheDocument();
    expect(within(busSelect).getByRole('option', { name: 's_avmm' })).toBeInTheDocument();
    expect(within(busSelect).queryByRole('option', { name: 'm_axi' })).not.toBeInTheDocument();
    expect(within(busSelect).queryByRole('option', { name: 's_axis' })).not.toBeInTheDocument();
    expect(
      within(busSelect).queryByRole('option', { name: 's_axi_array' })
    ).not.toBeInTheDocument();
  });

  it('saves and clears both associations on the interrupt path', () => {
    const onUpdate = jest.fn();
    render(
      <CanvasInspector
        selected={{ kind: 'interrupt', index: 0, id: 'interrupt:0' }}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const busSelect = screen.getByLabelText('Associated Bus Interface');
    fireEvent.change(busSelect, {
      target: { value: 's_avmm' },
    });
    fireEvent.change(busSelect, {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Associated Clock'), {
      target: { value: 'clk_sys' },
    });
    fireEvent.change(screen.getByLabelText('Associated Clock'), {
      target: { value: '' },
    });

    expect(onUpdate).toHaveBeenCalledWith(['interrupts', 0, 'associatedBusInterface'], 's_avmm');
    expect(onUpdate).toHaveBeenCalledWith(['interrupts', 0, 'associatedBusInterface'], null);
    expect(onUpdate).toHaveBeenCalledWith(['interrupts', 0, 'associatedClock'], 'clk_sys');
    expect(onUpdate).toHaveBeenCalledWith(['interrupts', 0, 'associatedClock'], null);
  });
});
