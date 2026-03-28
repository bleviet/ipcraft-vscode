import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormField } from '../../../webview/shared/components/FormField';

describe('FormField', () => {
  it('renders label and value', () => {
    render(<FormField label="Test Label" value="Test Value" onChange={() => {}} />);
    expect(screen.getByText('Test Label')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Value')).toBeInTheDocument();
  });

  it('calls onChange when input changes', () => {
    const onChange = jest.fn();
    render(<FormField label="Test Label" value="" onChange={onChange} />);

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'New Value' } });

    expect(onChange).toHaveBeenCalledWith('New Value');
  });

  it('shows required asterisk when required is true', () => {
    render(<FormField label="Test Label" value="" onChange={() => {}} required={true} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('displays error message', () => {
    render(<FormField label="Test Label" value="" onChange={() => {}} error="Error Message" />);
    expect(screen.getByText('Error Message')).toBeInTheDocument();
  });

  it('performs local validation on blur', () => {
    const validator = jest.fn((val) => (val === '' ? 'Required' : null));
    render(<FormField label="Test Label" value="" onChange={() => {}} validator={validator} />);

    const input = screen.getByRole('textbox');
    fireEvent.blur(input);

    expect(validator).toHaveBeenCalledWith('');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('calls onSave on Enter key', () => {
    const onSave = jest.fn();
    render(<FormField label="Test Label" value="val" onChange={() => {}} onSave={onSave} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onSave).toHaveBeenCalled();
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = jest.fn();
    render(<FormField label="Test Label" value="val" onChange={() => {}} onCancel={onCancel} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });
});
