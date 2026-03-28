import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextAreaField } from '../../../webview/shared/components/TextAreaField';

describe('TextAreaField', () => {
  it('renders label and text value', () => {
    render(<TextAreaField label="Test Area" value="Some long text" onChange={() => {}} />);
    expect(screen.getByText('Test Area')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Some long text')).toBeInTheDocument();
  });

  it('calls onChange when input changes', () => {
    const onChange = jest.fn();
    render(<TextAreaField label="Test Area" value="" onChange={onChange} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.input(textarea, { target: { value: 'New text' } });

    expect(onChange).toHaveBeenCalledWith('New text');
  });

  it('displays error message', () => {
    render(<TextAreaField label="Test Area" value="" onChange={() => {}} error="Error Message" />);
    expect(screen.getByText('Error Message')).toBeInTheDocument();
  });

  it('calls onSave on Ctrl+Enter keys', () => {
    const onSave = jest.fn();
    render(<TextAreaField label="Test Area" value="val" onChange={() => {}} onSave={onSave} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onSave).toHaveBeenCalled();
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = jest.fn();
    render(<TextAreaField label="Test Area" value="val" onChange={() => {}} onCancel={onCancel} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });
});
