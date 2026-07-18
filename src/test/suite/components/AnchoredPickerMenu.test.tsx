import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { AnchoredPickerMenu } from '../../../webview/shared/components/AnchoredPickerMenu';

describe('AnchoredPickerMenu', () => {
  const items = [
    { value: null, label: '-- none --' },
    { value: 'SRC', label: 'SRC' },
    { value: 'OTHER', label: 'OTHER' },
  ];

  it('renders nothing when position is null', () => {
    const { container } = render(
      <AnchoredPickerMenu
        position={null}
        items={items}
        selectedValue={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all items and marks the selected one with a visible check', () => {
    render(
      <AnchoredPickerMenu
        position={{ x: 10, y: 20 }}
        items={items}
        selectedValue="SRC"
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText('-- none --')).toBeInTheDocument();
    expect(screen.getByText('SRC')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();

    const srcButton = screen.getByText('SRC').closest('button') as HTMLButtonElement;
    const noneButton = screen.getByText('-- none --').closest('button') as HTMLButtonElement;

    const srcCheck = srcButton.querySelector('.codicon-check') as HTMLElement;
    const noneCheck = noneButton.querySelector('.codicon-check') as HTMLElement;

    expect(srcCheck.className).not.toMatch(/opacity-0/);
    expect(noneCheck.className).toMatch(/opacity-0/);
  });

  it('calls onSelect with the clicked item value and closes', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <AnchoredPickerMenu
        position={{ x: 10, y: 20 }}
        items={items}
        selectedValue={null}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('OTHER'));
    expect(onSelect).toHaveBeenCalledWith('OTHER');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onSelect with null when the "-- none --" item is clicked', () => {
    const onSelect = jest.fn();
    render(
      <AnchoredPickerMenu
        position={{ x: 10, y: 20 }}
        items={items}
        selectedValue="SRC"
        onSelect={onSelect}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('-- none --'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(
      <AnchoredPickerMenu
        position={{ x: 10, y: 20 }}
        items={items}
        selectedValue={null}
        onSelect={jest.fn()}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on outside pointerdown', () => {
    const onClose = jest.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <AnchoredPickerMenu
          position={{ x: 10, y: 20 }}
          items={items}
          selectedValue={null}
          onSelect={jest.fn()}
          onClose={onClose}
        />
      </div>
    );

    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on pointerdown inside the menu', () => {
    const onClose = jest.fn();
    render(
      <AnchoredPickerMenu
        position={{ x: 10, y: 20 }}
        items={items}
        selectedValue={null}
        onSelect={jest.fn()}
        onClose={onClose}
      />
    );

    fireEvent.pointerDown(screen.getByText('SRC'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves the highlight with ArrowDown and selects with Enter', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <AnchoredPickerMenu
        position={{ x: 10, y: 20 }}
        items={items}
        selectedValue={null}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    // Highlight starts at index 0 ('-- none --'); two ArrowDowns move to index 2 ('OTHER').
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('OTHER');
    expect(onClose).toHaveBeenCalled();
  });
});
