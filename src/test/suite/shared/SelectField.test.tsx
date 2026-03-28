import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectField } from '../../../webview/shared/components/SelectField';

describe('SelectField', () => {
  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B' },
  ];

  it('renders label and correctly selected option label', () => {
    render(<SelectField label="Test Select" value="a" options={options} onChange={() => {}} />);
    expect(screen.getByText('Test Select')).toBeInTheDocument();
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('calls onChange when dropdown changes', () => {
    const onChange = jest.fn();
    render(<SelectField label="Test Select" value="a" options={options} onChange={onChange} />);

    const dropdown = screen.getByRole('combobox');
    fireEvent.change(dropdown, { target: { value: 'b' } });

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('displays error message', () => {
    render(
      <SelectField
        label="Test Select"
        value="a"
        options={options}
        onChange={() => {}}
        error="Required!"
      />
    );
    expect(screen.getByText('Required!')).toBeInTheDocument();
  });

  it('calls onSave on Enter key', () => {
    const onSave = jest.fn();
    render(
      <SelectField
        label="Test Select"
        value="a"
        options={options}
        onChange={() => {}}
        onSave={onSave}
      />
    );

    const dropdown = screen.getByRole('combobox');
    fireEvent.keyDown(dropdown, { key: 'Enter', code: 'Enter' });

    expect(onSave).toHaveBeenCalled();
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = jest.fn();
    render(
      <SelectField
        label="Test Select"
        value="a"
        options={options}
        onChange={() => {}}
        onCancel={onCancel}
      />
    );

    const dropdown = screen.getByRole('combobox');
    fireEvent.keyDown(dropdown, { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });
});
