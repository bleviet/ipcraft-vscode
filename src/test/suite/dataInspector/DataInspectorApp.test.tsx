import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { DataInspectorApp, LaneRibbon } from '../../../webview/dataInspector/DataInspectorApp';

beforeAll(() => {
  HTMLElement.prototype.scrollTo = jest.fn();
});

describe('DataInspectorApp', () => {
  it('offers one-click examples for common HDL value formats', () => {
    render(<DataInspectorApp />);

    expect(screen.getByRole('button', { name: /Known hex/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unknown states/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /VHDL hex/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: /Unknown states/ }));

    expect(screen.getByLabelText('Literal')).toHaveValue("16'b0000_XXXX_0011_ZZZZ");
    expect(screen.getByLabelText('Width')).toHaveValue(16);
    expect(screen.getByText('contains X/Z states')).toBeInTheDocument();
  });

  it('uses paste-any-value as the primary flow and exposes X/Z exactly', () => {
    render(<DataInspectorApp />);

    fireEvent.change(screen.getByLabelText('Literal'), {
      target: { value: "16'b0000_XXXX_0011_ZZZZ" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));

    expect(screen.getAllByText('16 bits')).not.toHaveLength(0);
    expect(screen.getByText('contains X/Z states')).toBeInTheDocument();
    expect(screen.getByLabelText(/Bits 15 through 0: 0000XXXX0011ZZZZ/)).toBeInTheDocument();
    expect(screen.getByText('Session only · samples are never saved')).toBeInTheDocument();
  });

  it('rejects decimal input without an explicit width', () => {
    render(<DataInspectorApp />);

    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));

    expect(screen.getByText('Decimal input requires an explicit width')).toBeInTheDocument();
  });

  it('creates a manual field and links the decoded row with the ribbon segment', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "8'hA5" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

    const row = screen.getByRole('row', { name: /FIELD_1/ });
    expect(row).toHaveClass('is-selected');
    expect(screen.getByTitle('FIELD_1 [7:7]')).toHaveClass('is-selected');
  });

  it('combines named sources with explicit concat order and a live width equation', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), {
      target: { value: "32'h0001_2000" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.change(screen.getByLabelText('INPUT_2 value'), {
      target: { value: "32'h0000_3F00" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Decode INPUT_2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));

    expect(screen.getByText('32 + 32 = 64 bits')).toBeInTheDocument();
    expect(screen.getByText("64'h0001200000003F00")).toBeInTheDocument();
    expect(screen.getByText(/input2 \[31:0\]/)).toBeInTheDocument();
  });

  it('offers composition presets and multiple named outputs', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "16'h1234" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Byte swap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add output' }));

    expect(screen.getByText("16'h3412")).toBeInTheDocument();
    expect(screen.getByLabelText('Output 2 name')).toHaveValue('OUTPUT_2');
  });

  it('changes a selected field interpretation while retaining its raw bits', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "8'h80" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(screen.getByLabelText('Interpretation'), { target: { value: 'signed' } });

    const row = screen.getByRole('row', { name: /FIELD_1/ });
    expect(row.querySelectorAll('span')[2]).toHaveTextContent('1');
    expect(row).toHaveTextContent('-1');
  });

  it('shows a known non-nibble-aligned field as hex while retaining its raw bits', () => {
    render(<DataInspectorApp />);
    fireEvent.change(screen.getByLabelText('Literal'), { target: { value: "32'h12345678" } });
    fireEvent.click(screen.getByRole('button', { name: 'Decode' }));
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
});
