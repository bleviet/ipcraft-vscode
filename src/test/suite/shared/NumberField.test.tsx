import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberField } from '../../../webview/shared/components/NumberField';

describe('NumberField', () => {
  it('renders label and numeric value', () => {
    render(<NumberField label="Test Number" value={42} onChange={() => {}} />);
    expect(screen.getByText('Test Number')).toBeInTheDocument();
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('calls onChange with a number when input changes', () => {
    const onChange = jest.fn();
    render(<NumberField label="Test Number" value={0} onChange={onChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: '123' } });

    expect(onChange).toHaveBeenCalledWith(123);
  });

  it('calls onChange with 0 when input is empty', () => {
    const onChange = jest.fn();
    render(<NumberField label="Test Number" value={10} onChange={onChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('ignores non-numeric input', () => {
    const onChange = jest.fn();
    render(<NumberField label="Test Number" value={10} onChange={onChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'abc' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('displays error message', () => {
    render(
      <NumberField label="Test Number" value={10} onChange={() => {}} error="Out of range!" />
    );
    expect(screen.getByText('Out of range!')).toBeInTheDocument();
  });

  it('calls onSave on Enter key', () => {
    const onSave = jest.fn();
    render(<NumberField label="Test Number" value={10} onChange={() => {}} onSave={onSave} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onSave).toHaveBeenCalled();
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = jest.fn();
    render(<NumberField label="Test Number" value={10} onChange={() => {}} onCancel={onCancel} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });
});
