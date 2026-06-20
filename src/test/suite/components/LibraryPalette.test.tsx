import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryPalette } from '../../../webview/ipcore/components/canvas/LibraryPalette';

const WORKSPACE_BUS_LIBRARY = {
  CUSTOM_FIFO: {
    busType: { vendor: 'xilinx.com', library: 'busif', name: 'custom_fifo', version: '1.0' },
    source: 'workspace',
    ports: [{ name: 'WR_EN', direction: 'out' }],
  },
};

describe('LibraryPalette', () => {
  it('renders the built-in bus protocols with an IPCraft vendor badge', () => {
    render(<LibraryPalette />);
    expect(screen.getByText('AXI4-Lite')).toBeInTheDocument();
    expect(screen.getAllByText('IPCraft').length).toBeGreaterThan(0);
  });

  it('shows the real vendor badge for a workspace-discovered interface', () => {
    render(<LibraryPalette busLibrary={WORKSPACE_BUS_LIBRARY} />);
    expect(screen.getByText('Custom-Fifo')).toBeInTheDocument();
    expect(screen.getByText('xilinx.com')).toBeInTheDocument();
  });

  it('fuzzy-filters items by label as the user types', () => {
    render(<LibraryPalette busLibrary={WORKSPACE_BUS_LIBRARY} />);
    // "lite" is an ordered subsequence of "AXI4-Lite" but, unlike "axlt", isn't
    // accidentally satisfiable by the other built-ins' combined label+vendor text.
    fireEvent.change(screen.getByPlaceholderText('Search interfaces...'), {
      target: { value: 'lite' },
    });
    expect(screen.getByText('AXI4-Lite')).toBeInTheDocument();
    expect(screen.queryByText('AXI4-Full')).not.toBeInTheDocument();
    expect(screen.queryByText('Avalon-MM')).not.toBeInTheDocument();
  });

  it('fuzzy-filters by vendor, not just label', () => {
    render(<LibraryPalette busLibrary={WORKSPACE_BUS_LIBRARY} />);
    fireEvent.change(screen.getByPlaceholderText('Search interfaces...'), {
      target: { value: 'xilinx' },
    });
    expect(screen.getByText('Custom-Fifo')).toBeInTheDocument();
    expect(screen.queryByText('AXI4-Lite')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches and clears back to the full list', () => {
    render(<LibraryPalette busLibrary={WORKSPACE_BUS_LIBRARY} />);
    const input = screen.getByPlaceholderText('Search interfaces...');
    fireEvent.change(input, { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/No interfaces match/)).toBeInTheDocument();
    expect(screen.queryByText('AXI4-Lite')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText('AXI4-Lite')).toBeInTheDocument();
    expect(screen.getByText('Custom-Fifo')).toBeInTheDocument();
  });

  it('disambiguates same-named interfaces that differ only by VLNV version, instead of looking like duplicates', () => {
    const jtagVersions = {
      XILINX_COM_INTERFACE_JTAG_1_0: {
        busType: { vendor: 'xilinx.com', library: 'interface', name: 'jtag', version: '1.0' },
        source: 'vivado',
        ports: [{ name: 'TCK', direction: 'out' }],
      },
      XILINX_COM_INTERFACE_JTAG_2_0: {
        busType: { vendor: 'xilinx.com', library: 'interface', name: 'jtag', version: '2.0' },
        source: 'vivado',
        ports: [{ name: 'TCK', direction: 'out' }],
      },
    };
    render(<LibraryPalette busLibrary={jtagVersions} />);
    expect(screen.queryByText('Jtag')).not.toBeInTheDocument();
    expect(screen.getByText('Jtag (v1.0)')).toBeInTheDocument();
    expect(screen.getByText('Jtag (v2.0)')).toBeInTheDocument();
  });

  it('drops a true duplicate — the same VLNV discovered twice under different dict keys', () => {
    const sameVlnvTwice = {
      WORKSPACE_KEY: {
        busType: { vendor: 'xilinx.com', library: 'interface', name: 'jtag', version: '1.0' },
        source: 'workspace',
        ports: [{ name: 'TCK', direction: 'out' }],
      },
      VIVADO_KEY: {
        busType: { vendor: 'xilinx.com', library: 'interface', name: 'jtag', version: '1.0' },
        source: 'vivado',
        ports: [{ name: 'TCK', direction: 'out' }],
      },
    };
    render(<LibraryPalette busLibrary={sameVlnvTwice} />);
    expect(screen.getAllByText('Jtag')).toHaveLength(1);
  });

  it('shows the full VLNV in a tooltip on the interface label', () => {
    render(<LibraryPalette busLibrary={WORKSPACE_BUS_LIBRARY} />);
    expect(screen.getByText('Custom-Fifo')).toHaveAttribute(
      'title',
      'VLNV: xilinx.com:busif:custom_fifo:1.0'
    );
  });
});
