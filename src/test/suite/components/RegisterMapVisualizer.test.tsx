import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RegisterMapVisualizer, {
  VisualizerRegister,
} from '../../../webview/components/RegisterMapVisualizer';

// Registers matching the register-block reference design (offsets within the block).
const registers: VisualizerRegister[] = [
  { name: 'ID', offset: 0x0 },
  { name: 'CTRL', offset: 0x4 },
  { name: 'STATUS', offset: 0x8 },
  { name: 'CH_GAIN', offset: 0x18, __kind: 'array', count: 4, stride: 4 },
];

describe('RegisterMapVisualizer — vertical register ruler', () => {
  it('renders each register name', () => {
    render(<RegisterMapVisualizer registers={registers} layout="vertical" />);
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('CTRL')).toBeInTheDocument();
    expect(screen.getByText('STATUS')).toBeInTheDocument();
    expect(screen.getByText('CH_GAIN')).toBeInTheDocument();
  });

  it('renders block-relative offset ranges', () => {
    render(<RegisterMapVisualizer registers={registers} layout="vertical" />);
    // Range text is split across nodes, so match the row container.
    const idRow = screen.getByText('ID').closest('[data-viz-row]') as HTMLElement;
    expect(idRow).toHaveTextContent('0x0');
    expect(idRow).toHaveTextContent('0x3');
    const arrRow = screen.getByText('CH_GAIN').closest('[data-viz-row]') as HTMLElement;
    expect(arrRow).toHaveTextContent('0x18');
    expect(arrRow).toHaveTextContent('0x27');
  });

  it('shows a REG badge for plain registers', () => {
    render(<RegisterMapVisualizer registers={registers} layout="vertical" />);
    expect(screen.getAllByText('REG').length).toBe(3);
  });

  it('shows replication and [N] badges for arrays', () => {
    render(<RegisterMapVisualizer registers={registers} layout="vertical" />);
    expect(screen.getByText('×4')).toBeInTheDocument();
    expect(screen.getByText('[N]')).toBeInTheDocument();
  });

  it('renders the bottom axis tick at the last register end', () => {
    render(<RegisterMapVisualizer registers={registers} layout="vertical" />);
    // 0x27 appears both in the CH_GAIN range and as the bottom tick.
    expect(screen.getAllByText('0x27').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render kebab actions buttons without insert/delete handlers', () => {
    render(<RegisterMapVisualizer registers={registers} layout="vertical" />);
    expect(screen.queryByLabelText('More Actions...')).not.toBeInTheDocument();
  });

  it('renders a kebab actions button per register when handlers are provided', () => {
    render(
      <RegisterMapVisualizer
        registers={registers}
        layout="vertical"
        onInsertAtGap={jest.fn()}
        onDeleteReg={jest.fn()}
      />
    );
    expect(screen.getAllByLabelText('More Actions...')).toHaveLength(registers.length);
  });

  it('calls onSelectRegister with the clicked register index (vertical)', () => {
    const onSelectRegister = jest.fn();
    render(
      <RegisterMapVisualizer
        registers={registers}
        layout="vertical"
        onSelectRegister={onSelectRegister}
      />
    );

    fireEvent.click(screen.getByText('CTRL').closest('[data-viz-row]') as HTMLElement);
    expect(onSelectRegister).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByText('CH_GAIN').closest('[data-viz-row]') as HTMLElement);
    expect(onSelectRegister).toHaveBeenCalledWith(3);
  });

  it('opens the actions menu and routes insert above/below and delete', () => {
    const onInsertAtGap = jest.fn();
    const onDeleteReg = jest.fn();
    render(
      <RegisterMapVisualizer
        registers={registers}
        layout="vertical"
        onInsertAtGap={onInsertAtGap}
        onDeleteReg={onDeleteReg}
      />
    );

    // Open the menu for the second register (CTRL, index 1).
    fireEvent.click(screen.getAllByLabelText('More Actions...')[1]);

    // Insert Above -> Register inserts at the register's own index.
    fireEvent.click(screen.getAllByText('Register')[0]);
    expect(onInsertAtGap).toHaveBeenCalledWith(1, 'register');

    // Re-open and insert a Nested Array below (index + 1).
    fireEvent.click(screen.getAllByLabelText('More Actions...')[1]);
    fireEvent.click(screen.getAllByText('Nested Array')[1]);
    expect(onInsertAtGap).toHaveBeenCalledWith(2, 'array');

    // Re-open and delete.
    fireEvent.click(screen.getAllByLabelText('More Actions...')[1]);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDeleteReg).toHaveBeenCalledWith(1);
  });
});
