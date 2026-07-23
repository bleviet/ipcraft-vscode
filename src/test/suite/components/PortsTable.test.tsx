import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PortsTable } from '../../../webview/ipcore/components/sections/PortsTable';

describe('PortsTable endianness normalization', () => {
  it('does not add little endianness when editing a scalar port', () => {
    const onUpdate = jest.fn();
    render(
      <PortsTable ports={[{ name: 'irq', direction: 'input', width: 1 }]} onUpdate={onUpdate} />
    );

    fireEvent.click(screen.getByTitle('Edit (e)'));
    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), {
      target: { value: 'irq_pending' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledWith(
      ['ports'],
      [{ name: 'irq_pending', direction: 'input', width: 1 }]
    );
  });

  it('resets an explicit big value when direction becomes inout', () => {
    const onUpdate = jest.fn();
    render(
      <PortsTable
        ports={[{ name: 'data', direction: 'input', width: 32, endianness: 'big' }]}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getByTitle('Edit (e)'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'inout' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledWith(
      ['ports'],
      [{ name: 'data', direction: 'inout', width: 32, endianness: 'little' }]
    );
  });
});
