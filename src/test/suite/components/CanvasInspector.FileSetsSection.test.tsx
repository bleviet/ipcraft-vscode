import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

const BODY_SELECTION: CanvasElement = { kind: 'body', index: 0, id: 'body' };

function ipCoreWithFiles(files: Array<Record<string, unknown>>): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    clocks: [{ name: 'clk' }],
    resets: [{ name: 'rst_n' }],
    fileSets: [{ name: 'RTL_Sources', files }],
  } as unknown as IpCore;
}

describe('CanvasInspector FileSetsSection — VHDL version', () => {
  it('shows a version dropdown for a vhdl file, defaulting to the unset option', () => {
    const ipCore = ipCoreWithFiles([{ path: 'rtl/core.vhd', type: 'vhdl' }]);
    render(
      <CanvasInspector
        selected={BODY_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    const select = screen.getByTitle('VHDL standard used by Vivado packaging');
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('does not show a version dropdown for a non-vhdl file', () => {
    const ipCore = ipCoreWithFiles([{ path: 'tb/test.py', type: 'python' }]);
    render(
      <CanvasInspector
        selected={BODY_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTitle('VHDL standard used by Vivado packaging')).not.toBeInTheDocument();
  });

  it('writes version onto the file when a non-default option is chosen', () => {
    const onUpdate = jest.fn();
    const ipCore = ipCoreWithFiles([{ path: 'rtl/core.vhd', type: 'vhdl' }]);
    render(
      <CanvasInspector
        selected={BODY_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );
    const select = screen.getByTitle('VHDL standard used by Vivado packaging');
    fireEvent.change(select, { target: { value: '93' } });
    expect(onUpdate).toHaveBeenCalledWith(
      ['fileSets', 0, 'files'],
      [{ path: 'rtl/core.vhd', type: 'vhdl', version: '93' }]
    );
  });

  it('removes version when the default option is re-selected', () => {
    const onUpdate = jest.fn();
    const ipCore = ipCoreWithFiles([{ path: 'rtl/core.vhd', type: 'vhdl', version: '93' }]);
    render(
      <CanvasInspector
        selected={BODY_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );
    const select = screen.getByTitle('VHDL standard used by Vivado packaging');
    fireEvent.change(select, { target: { value: '' } });
    expect(onUpdate).toHaveBeenCalledWith(
      ['fileSets', 0, 'files'],
      [{ path: 'rtl/core.vhd', type: 'vhdl' }]
    );
  });
});
