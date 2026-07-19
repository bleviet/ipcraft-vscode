import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { DataInspectorApp, LaneRibbon } from '../../../webview/dataInspector/DataInspectorApp';

beforeAll(() => {
  HTMLElement.prototype.scrollTo = jest.fn();
});

describe('DataInspectorApp', () => {
  it('opens the main workbench with a zero-valued 32-bit input', () => {
    render(<DataInspectorApp />);

    expect(screen.queryByRole('heading', { name: 'Value composer' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Literal')).toHaveValue('0');
    expect(screen.getByLabelText('Width')).toHaveValue(32);
    expect(screen.getByLabelText('Displayed value status')).toHaveTextContent('32 bits');
    expect(screen.getAllByText('0x00000000')).not.toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Presets' })).not.toBeInTheDocument();
  });

  it('keeps the current value while the source width field is temporarily empty', () => {
    render(<DataInspectorApp />);
    const width = screen.getByLabelText('Width');

    fireEvent.change(width, { target: { value: '' } });

    expect((width as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Displayed value status')).toHaveTextContent('32 bits');
    expect(screen.getAllByText('0x00000000')).not.toHaveLength(0);

    fireEvent.blur(width);
    expect(width).toHaveValue(32);
  });

  it('applies the displayed default zero when a source is added or resized', () => {
    render(<DataInspectorApp />);

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '16' } });
    expect(screen.getByLabelText('Literal')).toHaveValue('0');
    expect(screen.getByLabelText('Displayed value status')).toHaveTextContent('16 bits');
    expect(screen.getAllByText('0x0000')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(screen.getByLabelText('INPUT_2 value')).toHaveValue('0');
    expect(screen.queryByText('No sample')).not.toBeInTheDocument();
  });

  it('accepts a short width-qualified Verilog literal in the transient value field', () => {
    render(<DataInspectorApp />);

    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "32'h12" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));

    expect(screen.getByLabelText('Literal')).toHaveValue('0x00000012');
    expect(screen.getAllByText('0x00000012')).not.toHaveLength(0);
    expect(screen.queryByText(/Hexadecimal literal has/)).not.toBeInTheDocument();
  });

  it('uses paste-any-value as the primary flow and exposes X/Z exactly', () => {
    render(<DataInspectorApp />);

    fireEvent.change(screen.getByLabelText('Literal'), {
      target: { value: "16'b0000_XXXX_0011_ZZZZ" },
    });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));

    expect(screen.getByLabelText('Literal')).toHaveValue('0x0X3Z');
    expect(screen.getAllByText('16 bits')).not.toHaveLength(0);
    expect(screen.getByText('contains X/Z states')).toBeInTheDocument();
    expect(screen.getByLabelText(/Bits 15 through 0: 0000XXXX0011ZZZZ/)).toBeInTheDocument();
    expect(screen.getByText('Session only · samples are never saved')).toBeInTheDocument();
  });

  it('switches every displayed value between neutral representations', () => {
    render(<DataInspectorApp />);

    expect(screen.getAllByText('0x00000000')).not.toHaveLength(0);
    const hex = screen.getByRole('button', { name: 'Hex' });
    const binary = screen.getByRole('button', { name: 'Binary' });
    expect(hex).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(binary);
    expect(binary).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Literal')).toHaveValue('0b00000000000000000000000000000000');
    expect(screen.getAllByText('0b00000000000000000000000000000000')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Decimal' }));
    expect(screen.getByLabelText('Literal')).toHaveValue('0');
    expect(screen.getAllByText('0')).not.toHaveLength(0);
  });

  it('shows copy actions beside the selected input values in Properties', () => {
    const writeText = jest.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<DataInspectorApp />);

    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "32'h0001_2000" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy original value' }));
    expect(writeText).toHaveBeenNthCalledWith(1, '0x00012000');
    expect(writeText).toHaveBeenNthCalledWith(2, "32'h0001_2000");
    expect(screen.getByLabelText('Displayed value status')).not.toContainElement(
      screen.getByRole('button', { name: 'Copy value' })
    );
  });

  it('creates a manual field and links the decoded row with the ribbon segment', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "8'hA5" } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

    const row = screen.getByRole('row', { name: /FIELD_1/ });
    expect(row).toHaveClass('is-selected');
    expect(screen.getByTitle('FIELD_1 [7:7]')).toHaveClass('is-selected');
  });

  it('deletes a focused field with the Delete key', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "8'hA5" } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

    const row = screen.getByRole('row', { name: /FIELD_1/ });
    fireEvent.keyDown(row, { key: 'Delete' });

    expect(screen.queryByRole('row', { name: /FIELD_1/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Interpretation')).not.toBeInTheDocument();
  });

  it('deletes a field when its drag ends outside the fields panel', () => {
    const { container } = render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "8'hA5" } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

    const panel = container.querySelector<HTMLElement>('.di-fields')!;
    jest.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const row = screen.getByRole('row', { name: /FIELD_1/ });
    const dataTransfer = { dropEffect: 'none', effectAllowed: 'move' };
    fireEvent.dragStart(row, { clientX: 100, clientY: 100, dataTransfer });
    const dragEnd = createEvent.dragEnd(row, { dataTransfer });
    Object.defineProperties(dragEnd, {
      clientX: { value: 340 },
      clientY: { value: 100 },
    });
    fireEvent(row, dragEnd);

    expect(screen.queryByRole('row', { name: /FIELD_1/ })).not.toBeInTheDocument();
  });

  it('uses the canvas as the only transform workbench view', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), {
      target: { value: "32'h0001_2000" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));
    expect(screen.getByRole('heading', { name: 'Transform recipe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-layout' })).toBeInTheDocument();
  });

  it('changes a selected field interpretation while retaining its raw bits', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "8'h80" } });
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Interpretation'), { target: { value: 'signed' } });

    const row = screen.getByRole('row', { name: /FIELD_1/ });
    expect(row.querySelectorAll('span')[2]).toHaveTextContent('1');
    expect(row).toHaveTextContent('-1');
  });

  it('shows a known non-nibble-aligned field as hex while retaining its raw bits', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "32'h12345678" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('LSB'), { target: { value: '2' } });

    const cells = screen.getByRole('row', { name: /FIELD_1/ }).querySelectorAll('span');
    expect(cells[2]).toHaveTextContent('000100100011010001010110011110');
    expect(cells[3]).toHaveTextContent('0x048D159E');
  });
});

describe('LaneRibbon', () => {
  it('keeps the rendered DOM bounded for a 4096-bit vector', () => {
    const vector = parseLiteral(`${4096}'h${'A5'.repeat(512)}`).vector;
    render(
      <LaneRibbon
        vector={vector}
        fields={[]}
        laneWidth={8}
        selectedFieldId={null}
        onSelectField={() => undefined}
      />
    );

    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '512');
    expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(10);
  });

  it('provides roving lane focus and keyboard navigation', () => {
    render(
      <LaneRibbon
        vector={parseLiteral("64'h0123456789ABCDEF").vector}
        fields={[]}
        laneWidth={16}
        selectedFieldId={null}
        onSelectField={() => undefined}
      />
    );
    const first = screen.getByLabelText(/Bits 63 through 48/);
    const second = screen.getByLabelText(/Bits 47 through 32/);

    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveAttribute('tabindex', '0');
  });

  it('distinguishes active, inactive, and unknown bit states without striking masked bits', () => {
    const { container } = render(
      <LaneRibbon
        vector={parseLiteral("4'b10XZ").vector}
        fields={[]}
        laneWidth={8}
        selectedFieldId={null}
        onSelectField={() => undefined}
        maskedBits={new Set([2])}
        zoom="bit"
      />
    );

    expect(container.querySelector('[data-bit="3"]')).toHaveClass('is-one');
    expect(container.querySelector('[data-bit="2"]')).toHaveClass('is-zero', 'is-masked');
    expect(container.querySelector('[data-bit="1"]')).toHaveClass('is-unknown');
    expect(container.querySelector('[data-bit="0"]')).toHaveClass('is-unknown');
  });

  it('accounts for transform-inserted bits outside projected source fields', () => {
    const { container } = render(
      <LaneRibbon
        vector={parseLiteral("4'b0101").vector}
        fields={[{ id: 'source-field', name: 'SOURCE', msb: 2, lsb: 0, groupId: 'default' }]}
        laneWidth={8}
        selectedFieldId={null}
        onSelectField={() => undefined}
        provenance={[
          { sourceId: 'input', sourceBit: 1 },
          { sourceId: 'input', sourceBit: 2 },
          { sourceId: 'input', sourceBit: 3 },
          null,
        ]}
        zoom="bit"
      />
    );

    const inserted = container.querySelector('.di-inserted-segment');
    expect(inserted).toHaveAttribute('title', 'Transform-inserted 0 [3:3]');
    expect(inserted).toHaveStyle({ left: '0%', width: '25%' });
    expect(container.querySelector('.di-source-band .is-inserted')).toHaveTextContent('+0');
  });
});
