import React from 'react';
import { render, screen } from '@testing-library/react';
import AddressMapVisualizer, {
  VisualizerAddressBlock,
} from '../../../webview/components/AddressMapVisualizer';

// Blocks matching the address-map reference design.
const blocks: VisualizerAddressBlock[] = [
  { name: 'CSR', baseAddress: 0x0, range: 0x28 },
  { name: 'DMA_REGS', baseAddress: 0x200, range: 0x40 },
  { name: 'BUF_RAM', baseAddress: 0x1000, range: 0x4 },
  { name: 'RSVD', baseAddress: 0x2000, range: 0x400, usage: 'reserved' },
];

describe('AddressMapVisualizer — vertical to-scale ruler', () => {
  it('renders an empty state when there are no blocks', () => {
    render(<AddressMapVisualizer blocks={[]} layout="vertical" />);
    expect(screen.getByText('No address blocks defined.')).toBeInTheDocument();
  });

  it('renders each block name', () => {
    render(<AddressMapVisualizer blocks={blocks} layout="vertical" />);
    expect(screen.getByText('CSR')).toBeInTheDocument();
    expect(screen.getByText('DMA_REGS')).toBeInTheDocument();
    expect(screen.getByText('BUF_RAM')).toBeInTheDocument();
    expect(screen.getByText('RSVD')).toBeInTheDocument();
  });

  it('renders zero-padded 8-digit address ranges', () => {
    render(<AddressMapVisualizer blocks={blocks} layout="vertical" />);
    expect(screen.getByText('0x00000000 – 0x00000027')).toBeInTheDocument();
    expect(screen.getByText('0x00000200 – 0x0000023F')).toBeInTheDocument();
    expect(screen.getByText('0x00001000 – 0x00001003')).toBeInTheDocument();
    expect(screen.getByText('0x00002000 – 0x000023FF')).toBeInTheDocument();
  });

  it('renders human-readable block sizes', () => {
    render(<AddressMapVisualizer blocks={blocks} layout="vertical" />);
    expect(screen.getByText('(40B)')).toBeInTheDocument();
    expect(screen.getByText('(64B)')).toBeInTheDocument();
    expect(screen.getByText('(4B)')).toBeInTheDocument();
    expect(screen.getByText('(1KB)')).toBeInTheDocument();
  });

  it('renders axis tick labels at the top and bottom of the span', () => {
    render(<AddressMapVisualizer blocks={blocks} layout="vertical" />);
    // Top of axis (first block start) and bottom (last inclusive address).
    expect(screen.getByText('0x0')).toBeInTheDocument();
    expect(screen.getByText('0x23FF')).toBeInTheDocument();
  });

  it('warns when address blocks overlap', () => {
    const overlapping: VisualizerAddressBlock[] = [
      { name: 'A', baseAddress: 0x0, range: 0x100 },
      { name: 'B', baseAddress: 0x80, range: 0x100 },
    ];
    render(<AddressMapVisualizer blocks={overlapping} layout="vertical" />);
    expect(screen.getByText('Address space overlap detected')).toBeInTheDocument();
  });
});
