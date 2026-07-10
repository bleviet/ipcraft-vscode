import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

const MATRIX_SELECTION: CanvasElement = {
  kind: 'busInterfaceMatrix',
  index: 0,
  id: 'busInterfaceMatrix',
};

function baseIpCore(overrides: Partial<IpCore> = {}): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    clocks: [{ name: 'clk_sys' }, { name: 'clk_hs' }],
    resets: [{ name: 'rst_n' }, { name: 'rst_hs_n' }],
    busInterfaces: [],
    ...overrides,
  } as unknown as IpCore;
}

describe('CanvasInspector BusInterfaceMatrixPanel', () => {
  it('shows an empty state when there are no bus interfaces and no resets', () => {
    const ipCore = baseIpCore({ resets: [] } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );
    expect(screen.getByText('No bus interfaces or resets defined')).toBeInTheDocument();
  });

  it('renders one row per bus interface (names visible)', () => {
    const ipCore = baseIpCore({
      busInterfaces: [
        { name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave' },
        { name: 'm_axi_full', type: 'AXI4', mode: 'master' },
      ],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );
    expect(screen.getByText('s_axi_lite')).toBeInTheDocument();
    expect(screen.getByText('m_axi_full')).toBeInTheDocument();
  });

  it("changing a row's Clock select calls onUpdate with the new associatedClock", () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      busInterfaces: [{ name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave' }],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    const row = screen.getByText('s_axi_lite').closest('.ci-busmatrix-row');
    expect(row).not.toBeNull();
    const clockCell = (row as HTMLElement).querySelector('.ci-busmatrix-row__clock');
    expect(clockCell).not.toBeNull();
    const clockSelect = within(clockCell as HTMLElement).getByRole('combobox');
    fireEvent.change(clockSelect, { target: { value: 'clk_hs' } });

    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'associatedClock'], 'clk_hs');
  });

  it("changing a row's Reset select calls onUpdate with the new associatedReset", () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      busInterfaces: [{ name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave' }],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    const row = screen.getByText('s_axi_lite').closest('.ci-busmatrix-row');
    const resetCell = (row as HTMLElement).querySelector('.ci-busmatrix-row__reset');
    expect(resetCell).not.toBeNull();
    const resetSelect = within(resetCell as HTMLElement).getByRole('combobox');
    fireEvent.change(resetSelect, { target: { value: 'rst_hs_n' } });

    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'associatedReset'], 'rst_hs_n');
  });

  it('clearing a Clock select back to "None" calls onUpdate with null', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      busInterfaces: [
        { name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave', associatedClock: 'clk_sys' },
      ],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    const row = screen.getByText('s_axi_lite').closest('.ci-busmatrix-row');
    const clockCell = (row as HTMLElement).querySelector('.ci-busmatrix-row__clock');
    const clockSelect = within(clockCell as HTMLElement).getByRole('combobox');
    fireEvent.change(clockSelect, { target: { value: '' } });

    expect(onUpdate).toHaveBeenCalledWith(['busInterfaces', 0, 'associatedClock'], null);
  });

  it("clicking a row's delete button removes that bus interface", () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore({
      busInterfaces: [
        { name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave' },
        { name: 'm_axi_full', type: 'AXI4', mode: 'master' },
      ],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    const row = screen.getByText('s_axi_lite').closest('.ci-busmatrix-row');
    expect(row).not.toBeNull();
    const deleteBtn = (row as HTMLElement).querySelector('.ci-busmatrix-row__delete');
    expect(deleteBtn).not.toBeNull();
    fireEvent.click(deleteBtn as HTMLElement);

    expect(onUpdate).toHaveBeenCalledWith(
      ['busInterfaces'],
      [{ name: 'm_axi_full', type: 'AXI4', mode: 'master' }]
    );
  });

  it('clicking a bus interface name calls onSelectElement with the bus interface id', () => {
    const onSelectElement = jest.fn();
    const ipCore = baseIpCore({
      busInterfaces: [{ name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave' }],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onSelectElement={onSelectElement}
      />
    );

    fireEvent.click(screen.getByText('s_axi_lite'));
    expect(onSelectElement).toHaveBeenCalledWith('bus:0');
  });

  it('shows the Ports badge and no delete/ungroup footer', () => {
    const ipCore = baseIpCore({
      busInterfaces: [{ name: 's_axi_lite', type: 'AXI4LITE', mode: 'slave' }],
    } as unknown as Partial<IpCore>);
    render(
      <CanvasInspector
        selected={MATRIX_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    expect(screen.getByText('Ports')).toBeInTheDocument();
    expect(screen.getByText('Bus Interfaces')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  describe('Resets section', () => {
    it('renders one row per reset, showing its own associated clock', () => {
      const ipCore = baseIpCore({
        resets: [{ name: 'rst_n', associatedClock: 'clk_sys' }, { name: 'rst_hs_n' }],
      } as unknown as Partial<IpCore>);
      render(
        <CanvasInspector
          selected={MATRIX_SELECTION}
          ipCore={ipCore}
          onUpdate={jest.fn()}
          onClose={jest.fn()}
          onSelectElement={jest.fn()}
        />
      );

      expect(screen.getByText('Resets')).toBeInTheDocument();
      expect(screen.getByText('rst_n')).toBeInTheDocument();
      expect(screen.getByText('rst_hs_n')).toBeInTheDocument();

      const row = screen.getByText('rst_n').closest('.ci-busmatrix-row');
      expect(row).not.toBeNull();
      const clockSelect = within(row as HTMLElement).getByRole('combobox');
      expect(clockSelect).toHaveValue('clk_sys');
    });

    it("changing a reset's Clock select calls onUpdate with resets[index].associatedClock", () => {
      const onUpdate = jest.fn();
      const ipCore = baseIpCore({
        resets: [{ name: 'rst_n' }],
      } as unknown as Partial<IpCore>);
      render(
        <CanvasInspector
          selected={MATRIX_SELECTION}
          ipCore={ipCore}
          onUpdate={onUpdate}
          onClose={jest.fn()}
          onSelectElement={jest.fn()}
        />
      );

      const row = screen.getByText('rst_n').closest('.ci-busmatrix-row');
      const clockSelect = within(row as HTMLElement).getByRole('combobox');
      fireEvent.change(clockSelect, { target: { value: 'clk_hs' } });

      expect(onUpdate).toHaveBeenCalledWith(['resets', 0, 'associatedClock'], 'clk_hs');
    });

    it('clicking a reset name calls onSelectElement with the reset id', () => {
      const onSelectElement = jest.fn();
      const ipCore = baseIpCore({
        resets: [{ name: 'rst_n' }],
      } as unknown as Partial<IpCore>);
      render(
        <CanvasInspector
          selected={MATRIX_SELECTION}
          ipCore={ipCore}
          onUpdate={jest.fn()}
          onClose={jest.fn()}
          onSelectElement={onSelectElement}
        />
      );

      fireEvent.click(screen.getByText('rst_n'));
      expect(onSelectElement).toHaveBeenCalledWith('reset:0');
    });

    it('shows only the Resets section when there are resets but no bus interfaces', () => {
      const ipCore = baseIpCore({
        busInterfaces: [],
        resets: [{ name: 'rst_n' }],
      } as unknown as Partial<IpCore>);
      render(
        <CanvasInspector
          selected={MATRIX_SELECTION}
          ipCore={ipCore}
          onUpdate={jest.fn()}
          onClose={jest.fn()}
          onSelectElement={jest.fn()}
        />
      );

      expect(screen.getByText('Resets')).toBeInTheDocument();
      expect(screen.queryByText('Bus Interfaces')).not.toBeInTheDocument();
    });
  });
});
