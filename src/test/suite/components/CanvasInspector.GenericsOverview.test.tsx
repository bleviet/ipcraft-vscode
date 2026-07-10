import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

const GENERICS_SELECTION: CanvasElement = { kind: 'generics', index: 0, id: 'generics' };

function baseIpCore(parameters: Record<string, unknown>[]): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    parameters,
  } as unknown as IpCore;
}

describe('CanvasInspector GenericsOverviewPanel', () => {
  it('shows an empty state when there are no parameters', () => {
    const ipCore = baseIpCore([]);
    render(
      <CanvasInspector
        selected={GENERICS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );
    expect(screen.getByText('No generics defined')).toBeInTheDocument();
  });

  it('renders one row per parameter (names visible)', () => {
    const ipCore = baseIpCore([
      { name: 'DATA_WIDTH', dataType: 'integer', defaultValue: 32 },
      { name: 'ADDR_WIDTH', dataType: 'integer', defaultValue: 16 },
    ]);
    render(
      <CanvasInspector
        selected={GENERICS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );
    expect(screen.getByText('DATA_WIDTH')).toBeInTheDocument();
    expect(screen.getByText('ADDR_WIDTH')).toBeInTheDocument();
  });

  it("changing a row's Page select calls onUpdate with the new uiPage", () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      { name: 'DATA_WIDTH', dataType: 'integer', defaultValue: 32, uiPage: 'Page A' },
      { name: 'ADDR_WIDTH', dataType: 'integer', defaultValue: 16 },
    ]);
    render(
      <CanvasInspector
        selected={GENERICS_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    // ADDR_WIDTH (row 1) has no uiPage, so its row renders exactly one
    // <select> (Page) — the Group cell shows a plain "—" placeholder instead.
    const addrRow = screen.getByText('ADDR_WIDTH').closest('.ci-generics-row');
    expect(addrRow).not.toBeNull();
    const addrPageSelect = within(addrRow as HTMLElement).getByRole('combobox');
    fireEvent.change(addrPageSelect, { target: { value: 'Page A' } });

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiPage'], 'Page A');
  });

  it("clearing a row's Page also clears that row's uiGroup", () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      {
        name: 'DATA_WIDTH',
        dataType: 'integer',
        defaultValue: 32,
        uiPage: 'Page A',
        uiGroup: 'Grp',
      },
    ]);
    render(
      <CanvasInspector
        selected={GENERICS_SELECTION}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );

    const row = screen.getByText('DATA_WIDTH').closest('.ci-generics-row');
    expect(row).not.toBeNull();
    const pageCell = (row as HTMLElement).querySelector('.ci-generics-row__page');
    expect(pageCell).not.toBeNull();
    const pageSelect = within(pageCell as HTMLElement).getByRole('combobox');
    fireEvent.change(pageSelect, { target: { value: '' } });

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiPage'], null);
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], null);
  });

  it('clicking a parameter name calls onSelectElement with the parameter id', () => {
    const onSelectElement = jest.fn();
    const ipCore = baseIpCore([{ name: 'DATA_WIDTH', dataType: 'integer', defaultValue: 32 }]);
    render(
      <CanvasInspector
        selected={GENERICS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onSelectElement={onSelectElement}
      />
    );

    fireEvent.click(screen.getByText('DATA_WIDTH'));
    expect(onSelectElement).toHaveBeenCalledWith('parameter:0');
  });

  it('shows the Generics badge and no delete/ungroup footer', () => {
    const ipCore = baseIpCore([{ name: 'DATA_WIDTH', dataType: 'integer', defaultValue: 32 }]);
    render(
      <CanvasInspector
        selected={GENERICS_SELECTION}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
        onUngroup={jest.fn()}
        onSelectElement={jest.fn()}
      />
    );
    // "Generics" appears both as the header badge and the panel's section title.
    expect(screen.getAllByText('Generics').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.queryByText('Ungroup signals')).not.toBeInTheDocument();
  });
});
