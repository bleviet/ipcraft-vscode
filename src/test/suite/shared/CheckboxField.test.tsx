import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckboxField } from '../../../webview/shared/components/CheckboxField';

describe('CheckboxField', () => {
  it('renders label and reflects checked state (checked)', () => {
    render(<CheckboxField label="Test Checkbox" checked={true} onChange={() => {}} />);
    expect(screen.getByText('Test Checkbox')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.checked).toBe(true);
  });

  it('reflects checked state (unchecked)', () => {
    render(<CheckboxField label="Test Checkbox" checked={false} onChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.checked).toBe(false);
  });

  it('calls onChange when clicked', () => {
    const onChange = jest.fn();
    render(<CheckboxField label="Test Checkbox" checked={false} onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('handles disabled state', () => {
    render(
      <CheckboxField label="Test Checkbox" checked={false} onChange={() => {}} disabled={true} />
    );
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.disabled).toBe(true);
  });
});
