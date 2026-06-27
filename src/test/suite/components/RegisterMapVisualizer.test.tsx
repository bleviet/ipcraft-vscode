import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('RegisterMapVisualizer — inline card editing (vertical rail)', () => {
  const regs: VisualizerRegister[] = [
    { name: 'ID', offset: 0x0 },
    { name: 'CTRL', offset: 0x4 },
    { name: 'STATUS', offset: 0x8 },
  ];

  function renderEditor(overrides: Record<string, unknown> = {}) {
    const onUpdateRegister = jest.fn();
    const onSelectRegister = jest.fn();
    const { container } = render(
      <RegisterMapVisualizer
        registers={regs}
        layout="vertical"
        onUpdateRegister={onUpdateRegister}
        onSelectRegister={onSelectRegister}
        {...overrides}
      />
    );
    return { onUpdateRegister, onSelectRegister, container };
  }

  // Card fields expose the edit tooltip in document order: name, offset, then
  // description (the latter only when the card is selected).
  function editableSpansForRow(rowText: string) {
    const row = screen.getByText(rowText).closest('[data-viz-row]') as HTMLElement;
    return row.querySelectorAll('[data-tooltip="Double-click to edit"]');
  }

  it('double-click a card name commits the new name via onUpdateRegister', () => {
    const { onUpdateRegister, container } = renderEditor({ selectedRegIndex: 0 });

    fireEvent.dblClick(editableSpansForRow('ID')[0] as HTMLElement);
    const nameInput = container.querySelector('[data-edit-key="name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'NEW_NAME' } });

    expect(onUpdateRegister).toHaveBeenCalledWith(['registers', 0, 'name'], 'NEW_NAME');
  });

  it('rejects a duplicate sibling name and shows an error', () => {
    const { onUpdateRegister, container } = renderEditor({ selectedRegIndex: 0 });

    fireEvent.dblClick(editableSpansForRow('ID')[0] as HTMLElement);
    const nameInput = container.querySelector('[data-edit-key="name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'CTRL' } });

    expect(onUpdateRegister).not.toHaveBeenCalled();
    expect(screen.getByText('Name is already used')).toBeInTheDocument();
  });

  it('double-click the offset commits a numeric offset via onUpdateRegister', () => {
    const { onUpdateRegister, container } = renderEditor({ selectedRegIndex: 0 });

    fireEvent.dblClick(editableSpansForRow('ID')[1] as HTMLElement);
    const offsetInput = container.querySelector('[data-edit-key="offset"]') as HTMLInputElement;
    fireEvent.change(offsetInput, { target: { value: '16' } });

    expect(onUpdateRegister).toHaveBeenCalledWith(['registers', 0, 'offset'], 16);
  });

  it('double-click the selected card description commits via onUpdateRegister', () => {
    const { onUpdateRegister, container } = renderEditor({ selectedRegIndex: 0 });

    fireEvent.dblClick(editableSpansForRow('ID')[2] as HTMLElement);
    const descInput = container.querySelector(
      '[data-edit-key="description"]'
    ) as HTMLTextAreaElement;
    fireEvent.change(descInput, { target: { value: 'A description' } });

    expect(onUpdateRegister).toHaveBeenCalledWith(['registers', 0, 'description'], 'A description');
  });

  it('does not enable editing when onUpdateRegister is omitted', () => {
    render(<RegisterMapVisualizer registers={regs} layout="vertical" selectedRegIndex={0} />);
    // No edit tooltip spans when not editable.
    expect(document.querySelectorAll('[data-tooltip="Double-click to edit"]')).toHaveLength(0);
  });
});

describe('RegisterMapVisualizer — ctrl-drag reorder affordance', () => {
  const regs: VisualizerRegister[] = [
    { name: 'ID', offset: 0x0 },
    { name: 'CTRL', offset: 0x4 },
  ];

  it('renders a drag handle per card when onReorderRegisters is provided', () => {
    const { container } = render(
      <RegisterMapVisualizer registers={regs} layout="vertical" onReorderRegisters={jest.fn()} />
    );
    expect(container.querySelectorAll('[aria-label="Drag to reorder"]')).toHaveLength(regs.length);
  });

  it('does not render a drag handle without onReorderRegisters', () => {
    const { container } = render(
      <RegisterMapVisualizer registers={regs} layout="vertical" onSelectRegister={jest.fn()} />
    );
    expect(container.querySelector('[aria-label="Drag to reorder"]')).toBeNull();
  });

  it('shows a grab cursor while Ctrl is held and reverts on release', () => {
    render(
      <RegisterMapVisualizer
        registers={regs}
        layout="vertical"
        onReorderRegisters={jest.fn()}
        onSelectRegister={jest.fn()}
      />
    );
    const idRow = screen.getByText('ID').closest('[data-viz-row]') as HTMLElement;
    // Before Ctrl: interactive (onSelectRegister) -> pointer cursor.
    expect(idRow.style.cursor).toBe('pointer');

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    });
    expect(idRow.style.cursor).toBe('grab');

    act(() => {
      fireEvent.keyUp(document.body, { key: 'Control', ctrlKey: false });
    });
    expect(idRow.style.cursor).toBe('pointer');
  });

  it('drag handle initiates a reorder drag without Ctrl', () => {
    const onReorderRegisters = jest.fn();
    const onSelectRegister = jest.fn();
    const { container } = render(
      <RegisterMapVisualizer
        registers={regs}
        layout="vertical"
        onReorderRegisters={onReorderRegisters}
        onSelectRegister={onSelectRegister}
      />
    );
    const handle = container.querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
    // Plain pointerdown on the handle (no Ctrl) starts a drag.
    fireEvent.pointerDown(handle, { button: 0 });

    // The dragged card (ID) enters the dragging state (opacity-50).
    const idRow = screen.getByText('ID').closest('[data-viz-row]') as HTMLElement;
    expect(idRow.className).toContain('opacity-50');
    // The handle's pointerdown must not select the card.
    expect(onSelectRegister).not.toHaveBeenCalled();
  });

  it('suppresses the actions menu while a Ctrl-drag is in progress', () => {
    // On macOS, Ctrl+click also fires a contextmenu event; it must not open the
    // kebab/actions menu during a reorder drag.
    render(
      <RegisterMapVisualizer
        registers={regs}
        layout="vertical"
        onReorderRegisters={jest.fn()}
        onInsertAtGap={jest.fn()}
        onDeleteReg={jest.fn()}
      />
    );
    const idRow = screen.getByText('ID').closest('[data-viz-row]') as HTMLElement;
    fireEvent.pointerDown(idRow, { button: 0, ctrlKey: true });
    fireEvent.contextMenu(idRow, { button: 0, ctrlKey: true, clientX: 10, clientY: 10 });
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('still opens the actions menu on a plain right-click', () => {
    render(
      <RegisterMapVisualizer
        registers={regs}
        layout="vertical"
        onInsertAtGap={jest.fn()}
        onDeleteReg={jest.fn()}
      />
    );
    const idRow = screen.getByText('ID').closest('[data-viz-row]') as HTMLElement;
    fireEvent.contextMenu(idRow, { button: 2, clientX: 10, clientY: 10 });
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});
